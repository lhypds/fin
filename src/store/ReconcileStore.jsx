import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import i18n from "../i18n/index.js";
import { showToast } from "@ui";
import { uid, isAccepted, hashFile, isSameFile } from "@utils/files";
import { uploadFile, runOcr, fetchOcr, deleteFile, saveState, loadState, clearAll as clearServer, fileUrl, thumbnailUrl } from "@utils/api";
import { autoMatch as computeMatches } from "@utils/matching";
import { ReconcileContext } from "./context";

const initialState = { sources: [], transactions: [], receipts: [] };

const OCR_CONCURRENCY = 2;
const EMPTY_PROGRESS = { total: 0, done: 0 };

function guessType(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function txKey(t) {
  return [t.date || "", (t.description || "").trim(), Number(t.withdrawal) || 0, Number(t.deposit) || 0, t.balance ?? ""].join("|");
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

function reducer(state, action) {
  switch (action.type) {
    case "hydrate":
      return { ...initialState, ...action.state };
    case "clear":
      return initialState;

    case "addSources":
      return { ...state, sources: [...state.sources, ...action.items] };
    case "updateSource":
      return { ...state, sources: patchById(state.sources, action.id, action.patch) };
    // The bank of a statement, written onto its rows too: all of them when the user set it, only
    // the rows without one when it comes from OCR, so a hand-corrected row keeps its value.
    case "setSourceBank": {
      const bank = action.bank || "";
      return {
        ...state,
        sources: patchById(state.sources, action.id, { bank }),
        transactions: state.transactions.map((t) =>
          t.sourceId === action.id && (action.overwrite || !t.bank) && (t.bank || "") !== bank ? { ...t, bank } : t,
        ),
      };
    }
    case "removeSource": {
      const txIds = new Set(state.transactions.filter((t) => t.sourceId === action.id).map((t) => t.id));
      return {
        ...state,
        sources: state.sources.filter((s) => s.id !== action.id),
        transactions: state.transactions.filter((t) => !txIds.has(t.id)),
        receipts: state.receipts.map((r) => (txIds.has(r.txId) ? { ...r, txId: null, confidence: null } : r)),
      };
    }

    case "addTransactions":
      return { ...state, transactions: [...state.transactions, ...action.items] };
    case "updateTransaction":
      return { ...state, transactions: patchById(state.transactions, action.id, action.patch) };
    case "removeTransaction": {
      const tx = state.transactions.find((t) => t.id === action.id);
      const released = new Set(tx?.receiptIds || []);
      return {
        ...state,
        transactions: state.transactions.filter((t) => t.id !== action.id),
        receipts: state.receipts.map((r) => (released.has(r.id) ? { ...r, txId: null, confidence: null } : r)),
      };
    }

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
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState({ model: "", hasApiKey: true });
  // Batch OCR progress per kind: total files queued in the current run and how many have finished.
  const [progress, setProgress] = useState({ source: EMPTY_PROGRESS, receipt: EMPTY_PROGRESS });
  const activeQueuesRef = useRef({ source: 0, receipt: 0 });
  // Async actions (OCR, matching) read the latest state through this ref.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // The state we just loaded does not need to be written back.
  const skipNextSaveRef = useRef(false);

  // Turns a statement's OCR result into ledger rows. A row identical to one already there (same
  // date, description, amounts and balance) is skipped. Returns the number of rows added.
  const applySourceResult = useCallback((id, result) => {
    const existing = stateRef.current.transactions;
    const seen = new Set(existing.map(txKey));
    const bank = result.bank || "";
    const items = [];
    for (const t of result.transactions || []) {
      const tx = {
        id: uid(),
        sourceId: id,
        bank,
        date: t.date || null,
        description: t.description || "",
        withdrawal: Number(t.withdrawal) || 0,
        deposit: Number(t.deposit) || 0,
        balance: t.balance == null ? null : Number(t.balance),
        currency: result.currency || "JPY",
        receiptIds: [],
      };
      const key = txKey(tx);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(tx);
    }
    if (items.length) dispatch({ type: "addTransactions", items });
    const txCount = existing.filter((t) => t.sourceId === id).length + items.length;
    dispatch({ type: "updateSource", id, patch: { status: "done", error: null, txCount, notes: result.notes || "" } });
    // Rows from an earlier read of the same file get the bank as well.
    if (bank) dispatch({ type: "setSourceBank", id, bank, overwrite: false });
    return items.length;
  }, []);

  const applyReceiptResult = useCallback((id, result) => {
    dispatch({ type: "updateReceipt", id, patch: { status: "done", error: null, ocr: result } });
  }, []);

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
        if (saved) {
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
          dispatch({
            type: "hydrate",
            state: { sources: withUrls(saved.sources), transactions: saved.transactions || [], receipts: withUrls(saved.receipts) },
          });
        }
        // Whatever we just loaded (or the empty default) does not need to be written back.
        skipNextSaveRef.current = true;
        setReady(true);

        // A run whose response no page received (the page was reloaded mid-run) still left its
        // result on the server, with the file stuck on "pending" here. Pick it up. It only fills
        // gaps: a statement that already has rows, or a receipt that already has an OCR record,
        // keeps them and is just marked done, because the late result is another model run that
        // may read the same page differently, and merging it would add near-duplicate rows.
        if (!saved) return;
        const waiting = (items) =>
          (items || []).filter((it) => present.get(it.id)?.ocr && (it.status === "pending" || it.status === "processing"));
        const recover = async (id) => {
          try {
            return await fetchOcr(id);
          } catch (err) {
            console.error(`Failed to fetch the saved OCR result for ${id}`, err);
            return null;
          }
        };
        const transactions = saved.transactions || [];
        for (const src of waiting(saved.sources)) {
          const record = await recover(src.id);
          if (cancelled) return;
          if (record?.kind !== "source" || !record.result) continue;
          const rows = transactions.filter((t) => t.sourceId === src.id).length;
          if (rows) {
            dispatch({ type: "updateSource", id: src.id, patch: { status: "done", error: null, txCount: rows, notes: src.notes || record.result.notes || "" } });
            if (record.result.bank) dispatch({ type: "setSourceBank", id: src.id, bank: record.result.bank, overwrite: false });
          } else {
            applySourceResult(src.id, record.result);
          }
        }
        for (const rc of waiting(saved.receipts)) {
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
  }, [applySourceResult, applyReceiptResult]);

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
        version: 1,
        sources: strip(state.sources),
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

  const importFiles = useCallback(async (kind, fileList) => {
    const files = Array.from(fileList || []);
    const accepted = files.filter(isAccepted);
    // A file already in this panel is not uploaded twice; the same goes for a file dropped twice in
    // one batch. Items whose upload has since vanished from disk are excluded, so re-uploading the
    // file restores them instead of being blocked.
    const existing = (kind === "source" ? stateRef.current.sources : stateRef.current.receipts).filter((it) => !it.missing);
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
      items.push(kind === "source" ? { ...base, txCount: 0, notes: "" } : { ...base, ocr: null, txId: null, confidence: null });
    }
    if (items.length) dispatch({ type: kind === "source" ? "addSources" : "addReceipts", items });
    return { added: items.length, rejected: files.length - accepted.length, duplicates, failed, lastError, ids: items.map((i) => i.id) };
  }, []);

  const ocrSource = useCallback(async (id) => {
    const src = stateRef.current.sources.find((s) => s.id === id);
    if (!src || src.status === "processing") return 0;
    dispatch({ type: "updateSource", id, patch: { status: "processing", error: null } });
    try {
      const { result } = await runOcr(id, "source");
      return applySourceResult(id, result);
    } catch (err) {
      dispatch({ type: "updateSource", id, patch: { status: "error", error: err.message } });
      throw err;
    }
  }, [applySourceResult]);

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
  }, [applyReceiptResult]);

  const ocrPending = useCallback(
    async (kind, ids) => {
      const list = kind === "source" ? stateRef.current.sources : stateRef.current.receipts;
      const targets = (ids || list.filter((it) => it.status === "pending").map((it) => it.id)).filter((id) =>
        list.some((it) => it.id === id && it.status !== "processing"),
      );
      if (!targets.length) return { ok: 0, errors: 0, lastError: null, results: [] };

      const fn = kind === "source" ? ocrSource : ocrReceipt;
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
    [ocrSource, ocrReceipt],
  );

  const runAutoMatch = useCallback(() => {
    const { transactions, receipts } = stateRef.current;
    const matches = computeMatches(transactions, receipts);
    if (matches.length) dispatch({ type: "applyMatches", matches });
    return matches.length;
  }, []);

  const match = useCallback((txId, receiptId, confidence = null) => {
    dispatch({ type: "match", txId, receiptId, confidence });
  }, []);

  const unmatch = useCallback((receiptId) => dispatch({ type: "unmatch", receiptId }), []);
  const unmatchAll = useCallback(() => dispatch({ type: "unmatchAll" }), []);

  const updateTransaction = useCallback((id, patch) => dispatch({ type: "updateTransaction", id, patch }), []);
  const addTransaction = useCallback((tx) => {
    const item = { id: uid(), sourceId: null, bank: "", receiptIds: [], currency: "JPY", withdrawal: 0, deposit: 0, balance: null, ...tx };
    dispatch({ type: "addTransactions", items: [item] });
    return item.id;
  }, []);
  const removeTransaction = useCallback((id) => dispatch({ type: "removeTransaction", id }), []);
  // Sets the bank of a statement and of every row that came from it.
  const setSourceBank = useCallback((id, bank) => dispatch({ type: "setSourceBank", id, bank, overwrite: true }), []);

  const updateReceipt = useCallback((id, patch) => dispatch({ type: "updateReceipt", id, patch }), []);

  const removeFileItem = useCallback(async (kind, id) => {
    dispatch({ type: kind === "source" ? "removeSource" : "removeReceipt", id });
    await deleteFile(id).catch((err) => console.error("Failed to delete file", err));
  }, []);

  const clearEverything = useCallback(async () => {
    dispatch({ type: "clear" });
    await clearServer().catch((err) => {
      console.error("Failed to clear server data", err);
      showToast(i18n.t("toast.saveFailed", { message: err.message }), 6000);
    });
  }, []);

  const derived = useMemo(() => {
    const receiptById = new Map(state.receipts.map((r) => [r.id, r]));
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const matchedTx = state.transactions.filter((t) => t.receiptIds?.length).length;
    const unmatchedReceipts = state.receipts.filter((r) => !r.txId).length;
    const processing = state.sources.filter((s) => s.status === "processing").length + state.receipts.filter((r) => r.status === "processing").length;
    return {
      receiptById,
      txById,
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
      importFiles,
      ocrSource,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      match,
      unmatch,
      unmatchAll,
      updateTransaction,
      addTransaction,
      removeTransaction,
      setSourceBank,
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
      importFiles,
      ocrSource,
      ocrReceipt,
      ocrPending,
      runAutoMatch,
      match,
      unmatch,
      unmatchAll,
      updateTransaction,
      addTransaction,
      removeTransaction,
      setSourceBank,
      updateReceipt,
      removeFileItem,
      clearEverything,
    ],
  );

  return <ReconcileContext.Provider value={value}>{children}</ReconcileContext.Provider>;
}
