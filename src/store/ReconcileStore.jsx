import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import i18n from "../i18n/index.js";
import { showToast } from "@ui";
import { uid, isAccepted, isCsvFile, isStatementFile, CSV_TYPE, hashFile, isSameFile } from "@utils/files";
import { uploadFile, runOcr, fetchOcr, deleteFile, saveState, loadState, clearAll as clearServer, fileUrl, thumbnailUrl } from "@utils/api";
import { autoMatch as computeMatches } from "@utils/matching";
import { splitNew } from "@utils/transactions";
import { ReconcileContext } from "./context";

// `statements` are the CSV files dropped onto an account, each read by the model into rows that
// carry its id; `banks` are the accounts themselves, set up by hand.
const initialState = { banks: [], statements: [], transactions: [], receipts: [] };

// Bumped when the saved shape changes; `migrate` brings older files up to it.
const STATE_VERSION = 3;
const OCR_CONCURRENCY = 2;
const EMPTY_PROGRESS = { total: 0, done: 0 };
const NO_PROGRESS = { statement: EMPTY_PROGRESS, receipt: EMPTY_PROGRESS };

function guessType(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function patchById(list, id, patch) {
  return list.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

function attach(state, txId, receiptId, confidence) {
  const receipt = state.receipts.find((r) => r.id === receiptId);
  const tx = state.transactions.find((t) => t.id === txId);
  if (!receipt || !tx) return state;
  // A row whose receipts change loses its confirmation: the person confirmed the receipts as they
  // were, so the new set needs looking at again.
  const transactions = state.transactions.map((t) => {
    let ids = t.receiptIds || [];
    if (t.id !== txId && ids.includes(receiptId)) ids = ids.filter((x) => x !== receiptId);
    if (t.id === txId && !ids.includes(receiptId)) ids = [...ids, receiptId];
    return ids === t.receiptIds ? t : { ...t, receiptIds: ids, confirmed: false };
  });
  const receipts = patchById(state.receipts, receiptId, { txId, confidence: confidence ?? null });
  return { ...state, transactions, receipts };
}

function detach(state, receiptId) {
  return {
    ...state,
    transactions: state.transactions.map((t) =>
      t.receiptIds?.includes(receiptId) ? { ...t, receiptIds: t.receiptIds.filter((x) => x !== receiptId), confirmed: false } : t,
    ),
    receipts: patchById(state.receipts, receiptId, { txId: null, confidence: null }),
  };
}

// Drops the rows in `txIds` and frees the receipts that were matched to them.
function dropTransactions(state, txIds) {
  return {
    ...state,
    transactions: state.transactions.filter((t) => !txIds.has(t.id)),
    receipts: state.receipts.map((r) => (txIds.has(r.txId) ? { ...r, txId: null, confidence: null } : r)),
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "hydrate":
      return { ...initialState, ...action.state };
    case "clear":
      return initialState;

    case "addBank":
      return { ...state, banks: [...state.banks, action.bank] };
    // A renamed account renames the bank on every row that belongs to it.
    case "updateBank": {
      const banks = patchById(state.banks, action.id, action.patch);
      const name = action.patch.name;
      if (name == null) return { ...state, banks };
      return {
        ...state,
        banks,
        transactions: state.transactions.map((t) => (t.bankId === action.id && t.bank !== name ? { ...t, bank: name } : t)),
      };
    }
    // An account goes with its statements and rows.
    case "removeBank": {
      const txIds = new Set(state.transactions.filter((t) => t.bankId === action.id).map((t) => t.id));
      return {
        ...dropTransactions(state, txIds),
        banks: state.banks.filter((b) => b.id !== action.id),
        statements: state.statements.filter((s) => s.bankId !== action.id),
      };
    }

    case "addStatements":
      return { ...state, statements: [...state.statements, ...action.items] };
    case "updateStatement":
      return { ...state, statements: patchById(state.statements, action.id, action.patch) };
    // A statement goes with the rows read from it.
    case "removeStatement": {
      const txIds = new Set(state.transactions.filter((t) => t.statementId === action.id).map((t) => t.id));
      return { ...dropTransactions(state, txIds), statements: state.statements.filter((s) => s.id !== action.id) };
    }

    case "addTransactions":
      return { ...state, transactions: [...state.transactions, ...action.items] };
    case "updateTransaction":
      return { ...state, transactions: patchById(state.transactions, action.id, action.patch) };
    case "removeTransaction":
      return dropTransactions(state, new Set([action.id]));

    case "addReceipts":
      return { ...state, receipts: [...state.receipts, ...action.items] };
    case "updateReceipt":
      return { ...state, receipts: patchById(state.receipts, action.id, action.patch) };
    case "removeReceipt":
      return {
        ...detach(state, action.id),
        receipts: state.receipts.filter((r) => r.id !== action.id),
      };

    case "match":
      return attach(state, action.txId, action.receiptId, action.confidence);
    case "applyMatches":
      return action.matches.reduce((s, m) => attach(s, m.txId, m.receiptId, m.confidence), state);
    case "unmatch":
      return detach(state, action.receiptId);
    // Every link undone at once, with the confirmations that rested on them.
    case "unmatchAll":
      return {
        ...state,
        transactions: state.transactions.map((t) => (t.receiptIds?.length || t.confirmed ? { ...t, receiptIds: [], confirmed: false } : t)),
        receipts: state.receipts.map((r) => (r.txId || r.confidence != null ? { ...r, txId: null, confidence: null } : r)),
      };

    default:
      return state;
  }
}

const versionOf = (saved) => Number(saved?.version) || 1;

function newBank(id, name, currency) {
  return { id, name, branch: "", accountType: "", accountNumber: "", holder: "", currency: currency || "JPY", createdAt: Date.now() };
}

// The account a statement dropped onto no account belongs to, going by what the model read off
// it: the one with the same account number, else the one with the same bank name unless their
// numbers are known to differ. null when it is a new account.
function findAccount(banks, result) {
  const number = String(result.account?.accountNumber || "").trim();
  const name = String(result.bank || "").trim();
  if (number) {
    const byNumber = banks.find((b) => b.accountNumber && b.accountNumber === number);
    if (byNumber) return byNumber;
  }
  if (name) return banks.find((b) => b.name === name && (!number || !b.accountNumber || b.accountNumber === number)) || null;
  return null;
}

// Older files brought up to the current shape. Version 1 kept statements as photos and PDFs read
// by OCR (`sources`), each row naming its bank in words: every bank name becomes an account, a
// file whose bank was not read becomes an account named after the file, and the rows and files
// move under them. Version 2 had the accounts but no statement files. The ids are fixed rather
// than random so two pages that migrate the same file agree on them.
function migrate(saved) {
  if (!saved) return null;
  const version = versionOf(saved);
  if (version >= STATE_VERSION) {
    return { banks: saved.banks || [], statements: saved.statements || [], transactions: saved.transactions || [], receipts: saved.receipts || [] };
  }
  if (version === 2) {
    return {
      banks: (saved.banks || []).map(({ imports: _imports, ...b }) => b),
      statements: [],
      transactions: saved.transactions || [],
      receipts: saved.receipts || [],
    };
  }
  const transactions = saved.transactions || [];
  const sources = saved.sources || [];
  const nameOf = (s) => s.bank || String(s.name || "").replace(/\.[a-z0-9]+$/i, "") || "—";
  const names = [];
  for (const name of [...sources.map(nameOf), ...transactions.map((t) => t.bank)]) if (name && !names.includes(name)) names.push(name);
  const banks = names.map((name, i) => newBank(`bank-${i + 1}`, name, transactions.find((t) => t.bank === name)?.currency));
  const idByName = new Map(banks.map((b) => [b.name, b.id]));
  const statements = sources.map(({ bank: _bank, ...s }) => ({ ...s, bankId: idByName.get(nameOf(s)) }));
  const bankOfStatement = new Map(statements.map((s) => [s.id, s.bankId]));
  return {
    banks,
    statements,
    transactions: transactions.map(({ sourceId, ...t }) => {
      const bankId = idByName.get(t.bank) || bankOfStatement.get(sourceId) || null;
      return { ...t, statementId: sourceId || null, bankId, bank: bankId ? banks.find((b) => b.id === bankId).name : t.bank || "" };
    }),
    receipts: saved.receipts || [],
  };
}

async function runQueue(ids, fn, concurrency) {
  let cursor = 0;
  let ok = 0;
  let errors = 0;
  let lastError = null;
  const results = [];
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        results.push(await fn(id));
        ok++;
      } catch (e) {
        errors++;
        lastError = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { ok, errors, lastError, results };
}

export function ReconcileProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState({ model: "", hasApiKey: true });
  // Reading progress per kind: files queued in the current run and how many have finished.
  const [progress, setProgress] = useState(NO_PROGRESS);
  const activeQueuesRef = useRef({ statement: 0, receipt: 0 });
  // Async actions (OCR, matching) read the latest state through this ref. It is brought forward
  // on every dispatch, not on the next render: the reducer is pure, so applying it here gives the
  // state React will render, and a file added a moment ago can be read at once instead of being
  // missed because the render has not happened yet.
  const stateRef = useRef(state);
  const dispatch = useCallback((action) => {
    stateRef.current = reducer(stateRef.current, action);
    rawDispatch(action);
  }, []);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // The state we just loaded does not need to be written back.
  const skipNextSaveRef = useRef(false);

  // Turns what the model read from a statement into rows of its account. A statement dropped onto
  // no account goes to the account the file turns out to be from, made on the spot when there is
  // none. A row already on the account (same date, description, amounts and balance) is skipped,
  // so reading a file again adds nothing it added before. Returns how many rows were added, the
  // newest date among them, and the account.
  const applyStatementResult = useCallback((id, result) => {
    const { statements, banks, transactions } = stateRef.current;
    const st = statements.find((s) => s.id === id);
    if (!st) return { added: 0, latest: null, bankId: null };
    let bank = banks.find((b) => b.id === st.bankId);
    if (!bank) {
      bank = findAccount(banks, result);
      if (!bank) {
        bank = newBank(uid(), String(result.bank || "").trim() || i18n.t("banks.unnamed"), result.currency);
        dispatch({ type: "addBank", bank });
      }
      dispatch({ type: "updateStatement", id, patch: { bankId: bank.id } });
    }
    const existing = transactions.filter((t) => t.bankId === bank.id);
    const rows = (result.transactions || []).map((t) => ({
      date: t.date || null,
      description: t.description || "",
      withdrawal: Number(t.withdrawal) || 0,
      deposit: Number(t.deposit) || 0,
      balance: t.balance == null ? null : Number(t.balance),
    }));
    const { fresh } = splitNew(existing, rows);
    const items = fresh.map((r) => ({
      id: uid(),
      bankId: bank.id,
      bank: bank.name,
      statementId: id,
      ...r,
      memo: "",
      currency: bank.currency || result.currency || "JPY",
      receiptIds: [],
    }));
    if (items.length) dispatch({ type: "addTransactions", items });
    const txCount = existing.filter((t) => t.statementId === id).length + items.length;
    dispatch({ type: "updateStatement", id, patch: { status: "done", error: null, txCount, notes: result.notes || "" } });
    // A passbook cover names the branch, account number and holder: they fill in whatever the
    // account does not have yet, and never replace what was typed in.
    const seen = result.account || {};
    const details = {};
    for (const key of ["branch", "accountType", "accountNumber", "holder"]) {
      const value = String(seen[key] || "").trim();
      if (value && !bank[key]) details[key] = value;
    }
    if (Object.keys(details).length) dispatch({ type: "updateBank", id: bank.id, patch: details });
    const latest = items.reduce((m, r) => (r.date && r.date > m ? r.date : m), "");
    return { added: items.length, latest: latest || null, bankId: bank.id };
  }, [dispatch]);

  const applyReceiptResult = useCallback((id, result) => {
    dispatch({ type: "updateReceipt", id, patch: { status: "done", error: null, ocr: result } });
  }, [dispatch]);

  // Load the state from the server; `files` tells us which uploads still exist on disk and which
  // have an OCR result there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { state: saved, files, config: serverConfig } = await loadState();
        if (cancelled) return;
        if (serverConfig) setConfig(serverConfig);
        const present = new Map((files || []).map((f) => [f.id, f]));
        const withUrls = (items) =>
          (items || []).map((it) => {
            const f = present.get(it.id);
            return {
              ...it,
              url: f ? fileUrl(it.id) : null,
              thumbUrl: f?.thumbnail ? thumbnailUrl(it.id) : null,
              missing: !f,
              status: it.status === "processing" ? "pending" : it.status,
            };
          });
        const loaded = migrate(saved);
        if (loaded) dispatch({ type: "hydrate", state: { ...loaded, statements: withUrls(loaded.statements), receipts: withUrls(loaded.receipts) } });
        // Whatever we just loaded (or the empty default) does not need to be written back; a file
        // that was just brought up to the current shape does.
        skipNextSaveRef.current = !saved || versionOf(saved) >= STATE_VERSION;
        setReady(true);

        // A run whose response no page received (the page was reloaded mid-run) still left its
        // result on the server, with the file stuck on "pending" here. Pick it up. It only fills
        // gaps: a statement that already has rows, or a receipt that already has an OCR record,
        // keeps them and is just marked done, because the late result is another model run that
        // may read the same file differently, and merging it would add near-duplicate rows.
        if (!loaded) return;
        const waiting = (items) => items.filter((it) => present.get(it.id)?.ocr && (it.status === "pending" || it.status === "processing"));
        const recover = async (id) => {
          try {
            return await fetchOcr(id);
          } catch (err) {
            console.error(`Failed to fetch the saved OCR result for ${id}`, err);
            return null;
          }
        };
        for (const st of waiting(loaded.statements)) {
          const record = await recover(st.id);
          if (cancelled) return;
          // "source" is what version 1 called a statement run.
          if (!["statement", "source"].includes(record?.kind) || !record.result) continue;
          const rows = loaded.transactions.filter((t) => t.statementId === st.id).length;
          if (rows) dispatch({ type: "updateStatement", id: st.id, patch: { status: "done", error: null, txCount: rows, notes: st.notes || record.result.notes || "" } });
          else applyStatementResult(st.id, record.result);
        }
        for (const rc of waiting(loaded.receipts)) {
          const record = await recover(rc.id);
          if (cancelled) return;
          if (record?.kind !== "receipt" || !record.result) continue;
          if (rc.ocr) dispatch({ type: "updateReceipt", id: rc.id, patch: { status: "done", error: null } });
          else applyReceiptResult(rc.id, record.result);
        }
      } catch (err) {
        console.error("Failed to load state from server", err);
        if (!cancelled) setLoadError(err.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStatementResult, applyReceiptResult, dispatch]);

  // Persist on change (debounced, writes serialized). `url`, `thumbUrl` and `missing` are runtime-only.
  const saveChainRef = useRef(Promise.resolve());
  useEffect(() => {
    if (!ready) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const strip = (items) => items.map(({ url: _url, thumbUrl: _thumbUrl, missing: _missing, ...rest }) => rest);
      const snapshot = {
        version: STATE_VERSION,
        banks: state.banks,
        statements: strip(state.statements),
        transactions: state.transactions,
        receipts: strip(state.receipts),
      };
      const run = () =>
        saveState(snapshot).catch((err) => {
          console.error("Failed to save state", err);
          showToast(i18n.t("toast.saveFailed", { message: err.message }), 6000);
        });
      saveChainRef.current = saveChainRef.current.then(run, run);
    }, 300);
    return () => clearTimeout(timer);
  }, [state, ready]);

  const addBank = useCallback((fields) => {
    const bank = { ...newBank(uid(), "", "JPY"), ...fields };
    dispatch({ type: "addBank", bank });
    return bank.id;
  }, [dispatch]);
  const updateBank = useCallback((id, patch) => dispatch({ type: "updateBank", id, patch }), [dispatch]);
  const removeBank = useCallback(async (id) => {
    const files = stateRef.current.statements.filter((s) => s.bankId === id && !s.missing).map((s) => s.id);
    dispatch({ type: "removeBank", id });
    for (const fileId of files) await deleteFile(fileId).catch((err) => console.error("Failed to delete file", err));
  }, [dispatch]);

  // Uploads files of one kind: statements (a CSV, or passbook photos and PDFs) onto an account, or
  // receipts. A file already there is not uploaded twice; the same goes for a file dropped twice in
  // one batch. Items whose upload has since vanished from disk are excluded, so re-uploading the
  // file restores them instead of being blocked.
  const importFiles = useCallback(async (kind, fileList, bankId = null) => {
    const files = Array.from(fileList || []);
    const accepted = files.filter(kind === "statement" ? isStatementFile : isAccepted);
    const existing = (kind === "statement" ? stateRef.current.statements : stateRef.current.receipts).filter((it) => !it.missing);
    const items = [];
    let failed = 0;
    let duplicates = 0;
    let lastError = null;
    for (const file of accepted) {
      const type = isCsvFile(file) ? CSV_TYPE : file.type || guessType(file.name);
      const hash = await hashFile(file);
      if (existing.some((it) => isSameFile(it, file, hash)) || items.some((it) => isSameFile(it, file, hash))) {
        duplicates++;
        continue;
      }
      let meta;
      try {
        meta = await uploadFile(file, type);
      } catch (err) {
        failed++;
        lastError = err;
        continue;
      }
      const base = {
        id: meta.id,
        name: file.name,
        type,
        size: file.size,
        hash,
        url: fileUrl(meta.id),
        thumbUrl: meta.thumbnail ? thumbnailUrl(meta.id) : null,
        status: "pending",
        error: null,
        createdAt: Date.now(),
      };
      items.push(kind === "statement" ? { ...base, bankId, txCount: 0, notes: "" } : { ...base, ocr: null, txId: null, confidence: null });
    }
    if (items.length) dispatch({ type: kind === "statement" ? "addStatements" : "addReceipts", items });
    return { added: items.length, rejected: files.length - accepted.length, duplicates, failed, lastError, ids: items.map((i) => i.id) };
  }, [dispatch]);

  const ocrStatement = useCallback(async (id) => {
    const st = stateRef.current.statements.find((s) => s.id === id);
    if (!st || st.status === "processing") return { added: 0, latest: null, bankId: st?.bankId || null };
    dispatch({ type: "updateStatement", id, patch: { status: "processing", error: null } });
    try {
      const { result } = await runOcr(id, "statement");
      return applyStatementResult(id, result);
    } catch (err) {
      dispatch({ type: "updateStatement", id, patch: { status: "error", error: err.message } });
      throw err;
    }
  }, [applyStatementResult, dispatch]);

  const ocrReceipt = useCallback(async (id) => {
    const rc = stateRef.current.receipts.find((r) => r.id === id);
    if (!rc || rc.status === "processing") return;
    dispatch({ type: "updateReceipt", id, patch: { status: "processing", error: null } });
    try {
      const { result } = await runOcr(id, "receipt");
      applyReceiptResult(id, result);
    } catch (err) {
      dispatch({ type: "updateReceipt", id, patch: { status: "error", error: err.message } });
      throw err;
    }
  }, [applyReceiptResult, dispatch]);

  // Reads the given files of a kind, or every pending one when no ids are given.
  const ocrPending = useCallback(
    async (kind, ids) => {
      const list = kind === "statement" ? stateRef.current.statements : stateRef.current.receipts;
      const targets = (ids || list.filter((it) => it.status === "pending").map((it) => it.id)).filter((id) =>
        list.some((it) => it.id === id && it.status !== "processing"),
      );
      if (!targets.length) return { ok: 0, errors: 0, lastError: null, results: [] };

      const fn = kind === "statement" ? ocrStatement : ocrReceipt;
      activeQueuesRef.current[kind]++;
      setProgress((p) => ({ ...p, [kind]: { total: p[kind].total + targets.length, done: p[kind].done } }));
      const tracked = async (id) => {
        try {
          return await fn(id);
        } finally {
          setProgress((p) => ({ ...p, [kind]: { ...p[kind], done: p[kind].done + 1 } }));
        }
      };
      try {
        return await runQueue(targets, tracked, OCR_CONCURRENCY);
      } finally {
        // Overlapping runs share one counter; it resets once the last of them finishes.
        if (--activeQueuesRef.current[kind] === 0) setProgress((p) => ({ ...p, [kind]: EMPTY_PROGRESS }));
      }
    },
    [ocrStatement, ocrReceipt],
  );

  const runAutoMatch = useCallback(() => {
    const { transactions, receipts } = stateRef.current;
    const matches = computeMatches(transactions, receipts);
    if (matches.length) dispatch({ type: "applyMatches", matches });
    return matches.length;
  }, [dispatch]);

  const match = useCallback((txId, receiptId, confidence = null) => {
    dispatch({ type: "match", txId, receiptId, confidence });
  }, [dispatch]);

  const unmatch = useCallback((receiptId) => dispatch({ type: "unmatch", receiptId }), [dispatch]);
  const unmatchAll = useCallback(() => dispatch({ type: "unmatchAll" }), [dispatch]);

  const updateTransaction = useCallback((id, patch) => dispatch({ type: "updateTransaction", id, patch }), [dispatch]);
  const addTransaction = useCallback((tx) => {
    const item = { id: uid(), bankId: null, bank: "", statementId: null, memo: "", receiptIds: [], currency: "JPY", withdrawal: 0, deposit: 0, balance: null, ...tx };
    dispatch({ type: "addTransactions", items: [item] });
    return item.id;
  }, [dispatch]);
  const removeTransaction = useCallback((id) => dispatch({ type: "removeTransaction", id }), [dispatch]);

  const updateReceipt = useCallback((id, patch) => dispatch({ type: "updateReceipt", id, patch }), [dispatch]);

  // Removes an uploaded file (a statement with its rows, or a receipt) here and on the server.
  const removeFileItem = useCallback(async (kind, id) => {
    dispatch({ type: kind === "statement" ? "removeStatement" : "removeReceipt", id });
    await deleteFile(id).catch((err) => console.error("Failed to delete file", err));
  }, [dispatch]);

  const clearEverything = useCallback(async () => {
    dispatch({ type: "clear" });
    await clearServer().catch((err) => {
      console.error("Failed to clear server data", err);
      showToast(i18n.t("toast.saveFailed", { message: err.message }), 6000);
    });
  }, [dispatch]);

  const derived = useMemo(() => {
    const receiptById = new Map(state.receipts.map((r) => [r.id, r]));
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const bankById = new Map(state.banks.map((b) => [b.id, b]));
    const matchedTx = state.transactions.filter((t) => t.receiptIds?.length).length;
    const unmatchedReceipts = state.receipts.filter((r) => !r.txId).length;
    const processing = state.statements.filter((s) => s.status === "processing").length + state.receipts.filter((r) => r.status === "processing").length;
    return {
      receiptById,
      txById,
      bankById,
      stats: {
        tx: state.transactions.length,
        matchedTx,
        unmatchedTx: state.transactions.length - matchedTx,
        receipts: state.receipts.length,
        unmatchedReceipts,
        processing,
      },
    };
  }, [state]);

  const value = useMemo(
    () => ({
      ...state,
      ...derived,
      ready,
      loadError,
      config,
      progress,
      addBank,
      updateBank,
      removeBank,
      importFiles,
      ocrStatement,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      match,
      unmatch,
      unmatchAll,
      updateTransaction,
      addTransaction,
      removeTransaction,
      updateReceipt,
      removeFileItem,
      clearEverything,
    }),
    [
      state,
      derived,
      ready,
      loadError,
      config,
      progress,
      addBank,
      updateBank,
      removeBank,
      importFiles,
      ocrStatement,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      match,
      unmatch,
      unmatchAll,
      updateTransaction,
      addTransaction,
      removeTransaction,
      updateReceipt,
      removeFileItem,
      clearEverything,
    ],
  );

  return <ReconcileContext.Provider value={value}>{children}</ReconcileContext.Provider>;
}
