import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import i18n from "../i18n/index.js";
import { showToast } from "@ui";
import { uid, isAccepted, isSpreadsheet, spreadsheetType, isStatementFile, hashFile, isSameFile } from "@utils/files";
import {
  uploadFile,
  runOcr,
  fetchOcr,
  deleteFile,
  saveState,
  loadState,
  restoreBackup as restoreOnServer,
  generateMemos,
  fileUrl,
  thumbnailUrl,
} from "@utils/api";
import { autoMatch as computeMatches } from "@utils/matching";
import { findInternalTransfers } from "@utils/transfers";
import { splitNew } from "@utils/transactions";
import { aiMemoPromptFor } from "@utils/aiMemo";
import { ReconcileContext } from "./context";

// `banks` are the accounts; `transactions` their rows; `receipts` the uploaded receipts. A
// statement (a CSV or Excel file, or a passbook image) is never kept: it is uploaded, read by the
// model, and removed, leaving only what it said. `settings` holds what the person set up: so far
// `aiMemo`, the reference file the AI memos follow; the prompt they are written from is each
// account's own (`aiMemoPrompt`).
// An account's `label` is what it is called in the app and the one thing shown for it; `name` is
// the bank it is at, a detail like the branch, read off the passbook or typed in.
const initialState = { banks: [], transactions: [], receipts: [], settings: {} };

// Bumped when the saved shape changes; `migrate` brings older files up to it.
const STATE_VERSION = 6;
// How many statements or receipts are read by the model at once.
const OCR_CONCURRENCY = 5;
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

    case "addBank":
      return { ...state, banks: [...state.banks, action.bank] };
    // A renamed account renames itself on every row that belongs to it.
    case "updateBank": {
      const banks = patchById(state.banks, action.id, action.patch);
      const label = action.patch.label;
      if (label == null) return { ...state, banks };
      return {
        ...state,
        banks,
        transactions: state.transactions.map((t) => (t.bankId === action.id && t.bank !== label ? { ...t, bank: label } : t)),
      };
    }
    // An account goes with its rows.
    case "removeBank": {
      const txIds = new Set(state.transactions.filter((t) => t.bankId === action.id).map((t) => t.id));
      return { ...dropTransactions(state, txIds), banks: state.banks.filter((b) => b.id !== action.id) };
    }

    case "addTransactions":
      return { ...state, transactions: [...state.transactions, ...action.items] };
    case "updateTransaction":
      return { ...state, transactions: patchById(state.transactions, action.id, action.patch) };
    // Several rows patched in one step, so one save covers them all.
    case "patchTransactions":
      return { ...state, transactions: action.patches.reduce((txs, p) => patchById(txs, p.id, p.patch), state.transactions) };
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
    // Several links undone at once, each as "unmatch" does it.
    case "unmatchMany":
      return action.receiptIds.reduce((s, id) => detach(s, id), state);
    case "removeTransactions":
      return dropTransactions(state, new Set(action.ids));

    case "updateSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    default:
      return state;
  }
}

const versionOf = (saved) => Number(saved?.version) || 1;

// The auto memo's notes in every language the app has, as patterns with the account's name left
// open, so a note written while another language was on is recognised too.
const AUTO_NOTE_KEYS = ["memo.transferTo", "memo.transferFrom"];
function autoNotePatterns() {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [];
  for (const lng of Object.keys(i18n.options.resources || {})) {
    for (const key of AUTO_NOTE_KEYS) patterns.push(new RegExp(`^${escape(i18n.t(key, { lng, bank: "\u0000" })).replace("\u0000", ".*")}$`));
  }
  return patterns;
}

// A memo with the auto memo's notes taken out: the transfer notes line by line, and the memo the
// model wrote (`aiText`) where it still stands as it was.
function stripAutoNotes(memo, patterns, aiText = "") {
  const ai = (aiText || "").trim();
  const text = (memo || "").trim();
  if (ai && text === ai) return "";
  return text
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      return !(ai && l === ai) && !patterns.some((p) => p.test(l));
    })
    .join("\n")
    .trim();
}

// An account at bank `name`, called `name` too until it is given a name of its own.
function newBank(id, name, currency) {
  return { id, name, label: name, branch: "", accountType: "", accountNumber: "", holder: "", url: "", memo: "", aiMemoPrompt: "", currency: currency || "JPY", createdAt: Date.now() };
}

// Accounts saved before they had a name of their own (version 4 and earlier) are called what
// their bank was called, which is what the app showed for them.
const labelled = (banks) => (banks || []).map((b) => (b.label ? b : { ...b, label: b.name || "" }));

// The account a read belongs to, or null for a new one. A spreadsheet goes where the person said. A
// passbook names its own account on the cover: the account with that number, wherever the file
// was dropped; the chosen account only when it has no number yet (the cover fills it in) or the
// cover shows none. The bank's name alone is never enough: one bank, many accounts.
function resolveAccount(banks, read, result) {
  const chosen = banks.find((b) => b.id === read.bankId) || null;
  if (read.kind !== "passbook") return chosen;
  const number = String(result.account?.accountNumber || "").trim();
  const byNumber = (number && banks.find((b) => b.accountNumber === number)) || null;
  return byNumber || (chosen && (!chosen.accountNumber || !number) ? chosen : null);
}

// Older files brought up to the current shape. Version 1 kept statements as photos and PDFs read
// by OCR (`sources`), each row naming its bank in words: every bank name becomes an account, and
// the rows move under them. Versions 2 and 3 had the accounts; 3 also kept the statement files,
// which are no longer kept at all. Up to 4 an account had no name but its bank's. The ids are
// fixed rather than random so two pages that migrate the same file agree on them.
function migrateShape(saved) {
  if (!saved) return null;
  const version = versionOf(saved);
  const receipts = saved.receipts || [];
  const strip = (list) => (list || []).map(({ statementId: _statementId, ...t }) => t);
  if (version >= 3) return { banks: labelled(saved.banks), transactions: strip(saved.transactions), receipts, settings: saved.settings || {} };
  if (version === 2) return { banks: labelled((saved.banks || []).map(({ imports: _imports, ...b }) => b)), transactions: saved.transactions || [], receipts, settings: {} };
  const transactions = saved.transactions || [];
  const sources = saved.sources || [];
  const nameOf = (s) => s.bank || String(s.name || "").replace(/\.[a-z0-9]+$/i, "") || "—";
  const names = [];
  for (const name of [...sources.map(nameOf), ...transactions.map((t) => t.bank)]) if (name && !names.includes(name)) names.push(name);
  const banks = names.map((name, i) => newBank(`bank-${i + 1}`, name, transactions.find((t) => t.bank === name)?.currency));
  const idByName = new Map(banks.map((b) => [b.name, b.id]));
  const bankOfSource = new Map(sources.map((s) => [s.id, idByName.get(nameOf(s))]));
  return {
    banks,
    transactions: transactions.map(({ sourceId, ...t }) => {
      const bankId = idByName.get(t.bank) || bankOfSource.get(sourceId) || null;
      return { ...t, bankId, bank: bankId ? banks.find((b) => b.id === bankId).name : t.bank || "" };
    }),
    receipts,
    settings: {},
  };
}

// Up to version 5 the AI memos had one prompt for every account, in `settings.aiMemo`; from 6 each
// account keeps its own as `aiMemoPrompt`. The one prompt goes to the accounts that have none yet
// and leaves the settings.
function perAccountPrompts(state) {
  const { prompt: shared = "", ...aiMemo } = state.settings?.aiMemo || {};
  return {
    ...state,
    banks: state.banks.map((b) => (b.aiMemoPrompt == null ? { ...b, aiMemoPrompt: shared } : b)),
    settings: state.settings?.aiMemo ? { ...state.settings, aiMemo } : state.settings,
  };
}

function migrate(saved) {
  const shaped = migrateShape(saved);
  return shaped && perAccountPrompts(shaped);
}

async function runQueue(items, fn, concurrency) {
  let cursor = 0;
  let ok = 0;
  let errors = 0;
  let lastError = null;
  const results = [];
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        results.push(await fn(item));
        ok++;
      } catch (e) {
        errors++;
        lastError = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { ok, errors, lastError, results };
}

export function ReconcileProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState({ model: "", hasApiKey: true });
  // Reading progress per kind: files queued in the current run and how many have finished.
  const [progress, setProgress] = useState(NO_PROGRESS);
  // Statements being read right now: { id, name, type, kind, bankId }. Not saved here; the file
  // on the server, with its role and account, is what lets a reloaded page pick the read up again.
  const [reads, setReads] = useState([]);
  // Reads called off: their result is thrown away when it comes, and their file is already gone.
  const cancelledRef = useRef(new Set());
  const abortersRef = useRef(new Map());
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

  // Turns what the model read from a statement into its account's rows and details. Rows come
  // from a CSV or Excel file only; a passbook photo or PDF gives the account's identity and nothing else. A
  // file read for no account goes to the account with the number it names, made on the spot when
  // there is none. A row already on the account (same date, description, amounts and balance) is
  // skipped, so reading a file again adds nothing it added before. Returns how many rows were
  // added, the newest date among them, the account, and which kind of read it was.
  const applyRead = useCallback(
    (read, result) => {
      const { banks, transactions } = stateRef.current;
      let bank = resolveAccount(banks, read, result);
      if (!bank) {
        // The new account is called after its bank, or "new account" when the file names none.
        const bankName = String(result.bank || "").trim();
        bank = { ...newBank(uid(), bankName, result.currency), label: bankName || i18n.t("banks.unnamed") };
        dispatch({ type: "addBank", bank });
      }
      let items = [];
      if (read.kind === "statement") {
        const existing = transactions.filter((t) => t.bankId === bank.id);
        const rows = (result.transactions || []).map((t) => ({
          date: t.date || null,
          description: t.description || "",
          withdrawal: Number(t.withdrawal) || 0,
          deposit: Number(t.deposit) || 0,
          balance: t.balance == null ? null : Number(t.balance),
        }));
        const { fresh } = splitNew(existing, rows);
        // The rows are in the statement's currency, which is the account's unless the file says
        // otherwise; a row's currency can be changed on the row.
        items = fresh.map((r) => ({
          id: uid(),
          bankId: bank.id,
          bank: bank.label,
          ...r,
          memo: "",
          currency: result.currency || bank.currency || "JPY",
          receiptIds: [],
        }));
        if (items.length) dispatch({ type: "addTransactions", items });
      }
      // A passbook cover names the branch, account number and holder: they fill in whatever the
      // account does not have yet, and never replace what was typed in. A spreadsheet says nothing
      // about the account; its details are typed in by hand.
      if (read.kind === "passbook") {
        const seen = result.account || {};
        const details = {};
        for (const key of ["branch", "accountType", "accountNumber", "holder"]) {
          const value = String(seen[key] || "").trim();
          if (value && !bank[key]) details[key] = value;
        }
        if (Object.keys(details).length) dispatch({ type: "updateBank", id: bank.id, patch: details });
      }
      const latest = items.reduce((m, r) => (r.date && r.date > m ? r.date : m), "");
      return { added: items.length, latest: latest || null, bankId: bank.id, kind: read.kind };
    },
    [dispatch],
  );

  const applyReceiptResult = useCallback(
    (id, result) => {
      dispatch({ type: "updateReceipt", id, patch: { status: "done", error: null, ocr: result } });
    },
    [dispatch],
  );

  // Reads statements the model has been given: waits for each result (joining a run the server
  // already has going, or taking a result it already wrote, when `resume`), puts it on its
  // account, and removes the file. Returns the run counts; a read called off counts as done with
  // no result.
  const runReads = useCallback(
    async (items, { resume = false } = {}) => {
      setReads((r) => [...r, ...items]);
      activeQueuesRef.current.statement++;
      setProgress((p) => ({ ...p, statement: { total: p.statement.total + items.length, done: p.statement.done } }));
      const readOne = async (read) => {
        const controller = new AbortController();
        abortersRef.current.set(read.id, controller);
        try {
          let record = resume ? await fetchOcr(read.id).catch(() => null) : null;
          if (record?.kind !== read.kind) record = await runOcr(read.id, read.kind, controller.signal);
          if (cancelledRef.current.has(read.id)) return null;
          return applyRead(read, record.result);
        } catch (err) {
          if (cancelledRef.current.has(read.id)) return null;
          throw err;
        } finally {
          abortersRef.current.delete(read.id);
          setReads((r) => r.filter((x) => x.id !== read.id));
          setProgress((p) => ({ ...p, statement: { ...p.statement, done: p.statement.done + 1 } }));
          if (!cancelledRef.current.delete(read.id)) {
            deleteFile(read.id).catch((err) => console.error("Failed to remove the statement after reading it", err));
          }
        }
      };
      try {
        return await runQueue(items, readOne, OCR_CONCURRENCY);
      } finally {
        // Overlapping runs share one counter; it resets once the last of them finishes.
        if (--activeQueuesRef.current.statement === 0) setProgress((p) => ({ ...p, statement: EMPTY_PROGRESS }));
      }
    },
    [applyRead],
  );

  // Stops waiting for a read and removes its file. The model may still finish on the server;
  // what it says is then thrown away.
  const cancelRead = useCallback((id) => {
    cancelledRef.current.add(id);
    abortersRef.current.get(id)?.abort();
    setReads((r) => r.filter((x) => x.id !== id));
    deleteFile(id).catch((err) => console.error("Failed to delete file", err));
  }, []);

  // Loads the state from the server and puts it in place of what is here; `files` tells us which
  // uploads still exist on disk and which have an OCR result there. Returns what came back for
  // the pick-ups below, or null when `isCancelled` says the caller has gone away meanwhile.
  const hydrate = useCallback(
    async (isCancelled = () => false) => {
      const { state: saved, files, config: serverConfig } = await loadState();
      if (isCancelled()) return null;
      if (serverConfig) setConfig(serverConfig);
      const present = new Map((files || []).map((f) => [f.id, f]));
      const loaded = migrate(saved);
      const receipts = (loaded?.receipts || []).map((it) => {
        const f = present.get(it.id);
        return {
          ...it,
          url: f ? fileUrl(it.id) : null,
          thumbUrl: f?.thumbnail ? thumbnailUrl(it.id) : null,
          missing: !f,
          status: it.status === "processing" ? "pending" : it.status,
        };
      });
      // A reference file for the AI memos that is no longer on disk is forgotten.
      const aiMemo = loaded?.settings?.aiMemo;
      const settings =
        aiMemo?.referenceId && !present.has(aiMemo.referenceId)
          ? { ...loaded.settings, aiMemo: { ...aiMemo, referenceId: null, referenceName: "" } }
          : loaded?.settings || {};
      // Always a new state object, so the save effect runs once and takes the skip below.
      dispatch({ type: "hydrate", state: loaded ? { ...loaded, receipts, settings } : {} });
      // Whatever we just loaded (or the empty default) does not need to be written back; a file
      // that was just brought up to the current shape does.
      skipNextSaveRef.current = !saved || versionOf(saved) >= STATE_VERSION;
      setReady(true);
      return { loaded, files: files || [], present };
    },
    [dispatch],
  );

  // A receipt run whose response no page received (the page was reloaded mid-run) still left its
  // result on the server, with the file stuck on "pending" here. Pick it up. A receipt that
  // already has an OCR record keeps it and is just marked done, because the late result is
  // another model run that may read the same file differently.
  const pickUpReceipts = useCallback(
    async (loaded, present, isCancelled = () => false) => {
      if (!loaded) return;
      const waiting = loaded.receipts.filter((it) => present.get(it.id)?.ocr && (it.status === "pending" || it.status === "processing"));
      for (const rc of waiting) {
        let record = null;
        try {
          record = await fetchOcr(rc.id);
        } catch (err) {
          console.error(`Failed to fetch the saved OCR result for ${rc.id}`, err);
        }
        if (isCancelled()) return;
        if (record?.kind !== "receipt" || !record.result) continue;
        if (rc.ocr) dispatch({ type: "updateReceipt", id: rc.id, patch: { status: "done", error: null } });
        else applyReceiptResult(rc.id, record.result);
      }
    },
    [applyReceiptResult, dispatch],
  );

  // Load the state on mount, then pick up whatever was cut off by the last reload.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    (async () => {
      try {
        const result = await hydrate(isCancelled);
        if (!result) return;
        const { loaded, files, present } = result;

        // Statements are read and removed, so one still on disk is a read this page (or another)
        // was cut off from, by a reload mid-run. It is picked up where it was left: the result
        // the server has, or the run it is still on, goes to the account the file was for.
        const keep = new Set((loaded?.receipts || []).map((r) => r.id));
        const leftovers = files.filter((f) => f.role === "statement" && !keep.has(f.id));
        if (leftovers.length) {
          const items = leftovers.map((f) => ({ id: f.id, name: f.name, type: f.type, kind: isSpreadsheet(f.type) ? "statement" : "passbook", bankId: f.bankId || null }));
          runReads(items, { resume: true }).then(({ errors, lastError, results }) => {
            if (errors) showToast(i18n.t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
            const done = results.filter(Boolean);
            if (!done.length) return;
            const added = done.reduce((a, r) => a + r.added, 0);
            showToast(done.every((r) => r.kind === "passbook") ? i18n.t("toast.accountRead") : i18n.t("toast.rowsAdded", { count: added }));
          });
        }

        await pickUpReceipts(loaded, present, isCancelled);
      } catch (err) {
        console.error("Failed to load state from server", err);
        if (!cancelled) setLoadError(err.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate, pickUpReceipts, runReads]);

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
        transactions: state.transactions,
        receipts: strip(state.receipts),
        settings: state.settings,
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

  // Puts a backup in place of the data, on the server and then here. A save still on its way
  // lands first, so none can land after the restore and undo it. Statement reads under way are
  // left alone: their results go onto the restored state when they come.
  const restoreBackup = useCallback(
    async (id) => {
      let last;
      do {
        last = saveChainRef.current;
        await last;
      } while (last !== saveChainRef.current);
      await restoreOnServer(id);
      const { loaded, present } = await hydrate();
      await pickUpReceipts(loaded, present);
    },
    [hydrate, pickUpReceipts],
  );

  const addBank = useCallback(
    (fields) => {
      const bank = { ...newBank(uid(), "", "JPY"), ...fields };
      dispatch({ type: "addBank", bank });
      return bank.id;
    },
    [dispatch],
  );
  const updateBank = useCallback((id, patch) => dispatch({ type: "updateBank", id, patch }), [dispatch]);
  const removeBank = useCallback((id) => dispatch({ type: "removeBank", id }), [dispatch]);

  // Reads statements for an account (or for the account each turns out to be from, when `bankId`
  // is null): every file goes up, is read by the model, and comes down again. Returns the usual
  // run counts, with how many files were not statements at all.
  const readStatements = useCallback(
    async (fileList, bankId = null) => {
      const files = Array.from(fileList || []);
      const accepted = files.filter(isStatementFile);
      const uploaded = [];
      let failed = 0;
      let lastError = null;
      for (const file of accepted) {
        const type = spreadsheetType(file) || file.type || guessType(file.name);
        try {
          const meta = await uploadFile(file, type, "statement", bankId);
          uploaded.push({ id: meta.id, name: file.name, type, kind: isSpreadsheet(type) ? "statement" : "passbook", bankId });
        } catch (err) {
          failed++;
          lastError = err;
        }
      }
      const rejected = files.length - accepted.length;
      if (!uploaded.length) return { ok: 0, errors: failed, lastError, results: [], rejected, failed };
      const out = await runReads(uploaded);
      return { ...out, errors: out.errors + failed, lastError: out.lastError || lastError, rejected, failed };
    },
    [runReads],
  );

  // Uploads receipts. A file already there is not uploaded twice; the same goes for a file
  // dropped twice in one batch. Items whose upload has since vanished from disk are excluded, so
  // re-uploading the file restores them instead of being blocked.
  const importReceipts = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      const accepted = files.filter(isAccepted);
      const existing = stateRef.current.receipts.filter((it) => !it.missing);
      const items = [];
      let failed = 0;
      let duplicates = 0;
      let lastError = null;
      for (const file of accepted) {
        const type = file.type || guessType(file.name);
        const hash = await hashFile(file);
        if (existing.some((it) => isSameFile(it, file, hash)) || items.some((it) => isSameFile(it, file, hash))) {
          duplicates++;
          continue;
        }
        let meta;
        try {
          meta = await uploadFile(file, type, "receipt");
        } catch (err) {
          failed++;
          lastError = err;
          continue;
        }
        items.push({
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
          ocr: null,
          txId: null,
          confidence: null,
        });
      }
      if (items.length) dispatch({ type: "addReceipts", items });
      return { added: items.length, rejected: files.length - accepted.length, duplicates, failed, lastError, ids: items.map((i) => i.id) };
    },
    [dispatch],
  );

  const ocrReceipt = useCallback(
    async (id) => {
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
    },
    [applyReceiptResult, dispatch],
  );

  // Reads the given receipts, or every pending one when no ids are given.
  const ocrPending = useCallback(
    async (ids) => {
      const list = stateRef.current.receipts;
      const targets = (ids || list.filter((it) => it.status === "pending").map((it) => it.id)).filter((id) =>
        list.some((it) => it.id === id && it.status !== "processing"),
      );
      if (!targets.length) return { ok: 0, errors: 0, lastError: null, results: [] };

      activeQueuesRef.current.receipt++;
      setProgress((p) => ({ ...p, receipt: { total: p.receipt.total + targets.length, done: p.receipt.done } }));
      const tracked = async (id) => {
        try {
          return await ocrReceipt(id);
        } finally {
          setProgress((p) => ({ ...p, receipt: { ...p.receipt, done: p.receipt.done + 1 } }));
        }
      };
      try {
        return await runQueue(targets, tracked, OCR_CONCURRENCY);
      } finally {
        // Overlapping runs share one counter; it resets once the last of them finishes.
        if (--activeQueuesRef.current.receipt === 0) setProgress((p) => ({ ...p, receipt: EMPTY_PROGRESS }));
      }
    },
    [ocrReceipt],
  );

  // Pairs the given rows (what the ledger shows) with the open receipts; the receipts are never scoped.
  const runAutoMatch = useCallback(
    (transactions) => {
      const matches = computeMatches(transactions, stateRef.current.receipts);
      if (matches.length) dispatch({ type: "applyMatches", matches });
      return matches.length;
    },
    [dispatch],
  );

  // Writes the memos the given rows (what the ledger shows) earn by rule, and returns how many
  // rows were written. The one rule so far: a transfer between two of the accounts on the same
  // day marks the row with the other account's name. The other side is looked for in every
  // account, so a transfer is found even when it is off screen, but only the rows on screen are
  // written: the other side gets its note when its own account is shown. A memo already there is
  // kept and the note goes under it, and a note already present is not written twice. A written
  // row carries `autoMemo`, the name of the rule, which is what the clear menu takes back; it
  // goes when the memo does. `rules` names the rules to apply, the ones ticked in the dialog; a
  // rule left out writes nothing.
  const runAutoMemo = useCallback(
    (transactions, rules = ["transfer"]) => {
      const shown = new Set(transactions.map((t) => t.id));
      const patches = [];
      const transfers = rules.includes("transfer") ? findInternalTransfers(transactions, stateRef.current.transactions) : [];
      for (const { from, to } of transfers) {
        const sides = [
          [from, i18n.t("memo.transferTo", { bank: to.bank })],
          [to, i18n.t("memo.transferFrom", { bank: from.bank })],
        ];
        for (const [tx, note] of sides) {
          if (!shown.has(tx.id)) continue;
          const memo = tx.memo || "";
          const noted = memo.includes(note);
          if (noted && tx.autoMemo) continue;
          patches.push({ id: tx.id, patch: { memo: noted ? memo : memo ? `${memo}\n${note}` : note, autoMemo: "transfer" } });
        }
      }
      if (patches.length) dispatch({ type: "patchTransactions", patches });
      return patches.length;
    },
    [dispatch],
  );

  const match = useCallback(
    (txId, receiptId, confidence = null) => {
      dispatch({ type: "match", txId, receiptId, confidence });
    },
    [dispatch],
  );

  const unmatch = useCallback((receiptId) => dispatch({ type: "unmatch", receiptId }), [dispatch]);

  const updateTransaction = useCallback((id, patch) => dispatch({ type: "updateTransaction", id, patch }), [dispatch]);
  const addTransaction = useCallback(
    (tx) => {
      const item = { id: uid(), bankId: null, bank: "", memo: "", receiptIds: [], currency: "JPY", withdrawal: 0, deposit: 0, balance: null, ...tx };
      dispatch({ type: "addTransactions", items: [item] });
      return item.id;
    },
    [dispatch],
  );
  const removeTransaction = useCallback((id) => dispatch({ type: "removeTransaction", id }), [dispatch]);

  const updateReceipt = useCallback((id, patch) => dispatch({ type: "updateReceipt", id, patch }), [dispatch]);

  const removeReceipt = useCallback(
    async (id) => {
      dispatch({ type: "removeReceipt", id });
      await deleteFile(id).catch((err) => console.error("Failed to delete file", err));
    },
    [dispatch],
  );

  // Takes back what auto-match did on the given rows (what the ledger shows): the receipts it put
  // there go back to the open list. A receipt matched by hand (no confidence) stays, and so does
  // everything on a row the person has confirmed. Returns how many receipts were freed.
  const clearAutoMatches = useCallback(
    (transactions) => {
      const { receipts } = stateRef.current;
      const receiptIds = [];
      for (const tx of transactions) {
        if (tx.confirmed) continue;
        for (const id of tx.receiptIds || []) if (receipts.find((r) => r.id === id)?.confidence != null) receiptIds.push(id);
      }
      if (receiptIds.length) dispatch({ type: "unmatchMany", receiptIds });
      return receiptIds.length;
    },
    [dispatch],
  );

  // Takes back what auto-memo did on the given rows: the transfer notes come out of the memo line
  // by line, whatever language they were written in, the model's memo goes where it still stands
  // as written, and what the person wrote stays. Returns how many rows were written.
  const clearAutoMemos = useCallback(
    (transactions) => {
      const patterns = autoNotePatterns();
      const patches = transactions
        .filter((t) => t.autoMemo)
        .map((t) => ({ id: t.id, patch: { memo: stripAutoNotes(t.memo, patterns, t.aiMemo), autoMemo: null, aiMemo: null } }));
      if (patches.length) dispatch({ type: "patchTransactions", patches });
      return patches.length;
    },
    [dispatch],
  );

  // The AI memos' settings, kept with the data: the prompt the model is given, which is each
  // account's own, and the reference file it follows, which lives on the server as an upload with
  // role "reference".
  const setAiMemoPrompt = useCallback((bankId, prompt) => dispatch({ type: "updateBank", id: bankId, patch: { aiMemoPrompt: prompt } }), [dispatch]);

  // Uploads a reference file (CSV or Excel) in place of the one before, which is removed.
  const setAiMemoReference = useCallback(
    async (file) => {
      const type = spreadsheetType(file);
      if (!type) throw new Error(i18n.t("autoMemo.referenceType"));
      const meta = await uploadFile(file, type, "reference");
      const before = stateRef.current.settings.aiMemo || {};
      dispatch({ type: "updateSettings", patch: { aiMemo: { ...before, referenceId: meta.id, referenceName: file.name } } });
      if (before.referenceId) deleteFile(before.referenceId).catch((err) => console.error("Failed to delete file", err));
      return meta;
    },
    [dispatch],
  );

  const clearAiMemoReference = useCallback(() => {
    const before = stateRef.current.settings.aiMemo || {};
    if (before.referenceId) deleteFile(before.referenceId).catch((err) => console.error("Failed to delete file", err));
    dispatch({ type: "updateSettings", patch: { aiMemo: { ...before, referenceId: null, referenceName: "" } } });
  }, [dispatch]);

  // Memos written by the model for the given rows (what the ledger shows) that have none yet,
  // account by account so each call carries the account its rows belong to and that account's
  // prompt: the one in `prompts` (by account id, as the dialog showed them), or failing that the
  // one on record. A row is written only once the model has answered, and only if it still has
  // no memo by then; a written row carries `autoMemo: "ai"` and the text as `aiMemo`, so the
  // clear menu can take it back. Returns how many rows were written. A failed call throws, after
  // what came back before it has been written.
  const runAiMemo = useCallback(
    async (transactions, prompts = {}) => {
      const { banks, settings } = stateRef.current;
      const todo = transactions.filter((t) => !t.memo);
      if (!todo.length) return 0;
      const groups = new Map();
      for (const t of todo) {
        const key = t.bankId || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      const memos = new Map();
      const write = () => {
        const patches = [];
        for (const tx of stateRef.current.transactions) {
          const memo = memos.get(tx.id);
          if (memo && !tx.memo) patches.push({ id: tx.id, patch: { memo, autoMemo: "ai", aiMemo: memo } });
        }
        if (patches.length) dispatch({ type: "patchTransactions", patches });
        return patches.length;
      };
      try {
        for (const [bankId, rows] of groups) {
          const b = banks.find((x) => x.id === bankId);
          const bank = b ? { label: b.label, name: b.name, branch: b.branch, accountType: b.accountType, accountNumber: b.accountNumber, holder: b.holder, currency: b.currency, memo: b.memo } : null;
          const result = await generateMemos({
            prompt: prompts[bankId] ?? aiMemoPromptFor(b),
            bank,
            rows: rows.map(({ id, date, description, withdrawal, deposit, currency }) => ({ id, date, description, withdrawal, deposit, currency })),
            referenceId: settings.aiMemo?.referenceId || null,
          });
          for (const m of result.memos || []) if (m.memo) memos.set(m.id, m.memo);
        }
      } catch (err) {
        write();
        throw err;
      }
      return write();
    },
    [dispatch],
  );

  // Takes the confirmation off the given rows; their receipts and memos stay. Returns how many
  // rows were confirmed.
  const clearConfirmations = useCallback(
    (transactions) => {
      const patches = transactions.filter((t) => t.confirmed).map((t) => ({ id: t.id, patch: { confirmed: false } }));
      if (patches.length) dispatch({ type: "patchTransactions", patches });
      return patches.length;
    },
    [dispatch],
  );

  // Deletes the given rows (what the ledger shows); their receipts go back to the open list.
  const removeTransactions = useCallback(
    (transactions) => {
      if (transactions.length) dispatch({ type: "removeTransactions", ids: transactions.map((t) => t.id) });
      return transactions.length;
    },
    [dispatch],
  );

  const derived = useMemo(() => {
    const receiptById = new Map(state.receipts.map((r) => [r.id, r]));
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const bankById = new Map(state.banks.map((b) => [b.id, b]));
    const unmatchedReceipts = state.receipts.filter((r) => !r.txId).length;
    return {
      receiptById,
      txById,
      bankById,
      stats: { unmatchedReceipts },
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
      reads,
      addBank,
      updateBank,
      removeBank,
      readStatements,
      cancelRead,
      importReceipts,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      runAutoMemo,
      runAiMemo,
      setAiMemoPrompt,
      setAiMemoReference,
      clearAiMemoReference,
      match,
      unmatch,
      updateTransaction,
      addTransaction,
      removeTransaction,
      updateReceipt,
      removeReceipt,
      clearAutoMatches,
      clearAutoMemos,
      clearConfirmations,
      removeTransactions,
      restoreBackup,
    }),
    [
      state,
      derived,
      ready,
      loadError,
      config,
      progress,
      reads,
      addBank,
      updateBank,
      removeBank,
      readStatements,
      cancelRead,
      importReceipts,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      runAutoMemo,
      runAiMemo,
      setAiMemoPrompt,
      setAiMemoReference,
      clearAiMemoReference,
      match,
      unmatch,
      updateTransaction,
      addTransaction,
      removeTransaction,
      updateReceipt,
      removeReceipt,
      clearAutoMatches,
      clearAutoMemos,
      clearConfirmations,
      removeTransactions,
      restoreBackup,
    ],
  );

  return <ReconcileContext.Provider value={value}>{children}</ReconcileContext.Provider>;
}
