import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { formatBytes } from "@utils/files";
import DropZone from "../DropZone";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import { PlayIcon, EyeIcon, TrashIcon, LoaderIcon } from "../icons";
import styles from "./source.module.css";

export default function SourcePanel({ onPreview }) {
  const { t } = useTranslation();
  const { sources, transactions, importFiles, ocrPending, removeFileItem, unmatchAll, progress } = useReconcile();
  // Files the button can read: a missing upload cannot be, one being read is already on its way.
  // `todo` are those not read yet, or whose read failed.
  const readable = sources.filter((s) => !s.missing && s.status !== "processing");
  const todo = readable.filter((s) => s.status === "pending" || s.status === "error");
  const [busy, setBusy] = useState(false);
  const running = progress.source.total > 0;
  const percent = running ? Math.round((progress.source.done / progress.source.total) * 100) : 0;

  async function runOcr(ids) {
    setBusy(true);
    try {
      const { ok, errors, lastError, results } = await ocrPending("source", ids);
      if (!ok && !errors) showToast(t("toast.nothingPending"));
      else if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
      else showToast(t("toast.rowsAdded", { count: results.reduce((a, b) => a + (b || 0), 0) }));
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files) {
    const { added, rejected, duplicates, failed, lastError, ids } = await importFiles("source", files);
    if (rejected) showToast(t("dropzone.rejected", { count: rejected }));
    if (duplicates) showToast(t("dropzone.duplicate", { count: duplicates }));
    if (failed) showToast(t("toast.uploadFailed", { count: failed, message: lastError?.message || "" }), 6000);
    if (added) runOcr(ids);
  }

  async function handleDelete(src) {
    const count = transactions.filter((tx) => tx.sourceId === src.id).length;
    if (!window.confirm(t("sources.deleteConfirm", { count }))) return;
    await removeFileItem("source", src.id);
  }

  // A file that has been read already is only read again on confirmation: it costs another model
  // call, and rows the model reads differently this time are added as new transactions.
  function handleRun(src) {
    if (src.status === "done" && !window.confirm(t("sources.rerunConfirm"))) return;
    runOcr([src.id]);
  }

  // Reads what has not been read yet. Once everything has, offers to read it all again, which
  // starts the reconciliation over: every match is undone as the run begins.
  function handleRunAll() {
    if (todo.length) return runOcr(todo.map((s) => s.id));
    if (!window.confirm(t("sources.rerunAllConfirm", { count: readable.length }))) return;
    unmatchAll();
    runOcr(readable.map((s) => s.id));
  }

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t("sources.title")}</h2>
        <button type="button" className="btn" disabled={busy || running || !readable.length} onClick={handleRunAll}>
          {busy || running ? <LoaderIcon className="spin" /> : <PlayIcon />}
          {running ? t("button.ocrRunning", { percent }) : `${t("sources.ocrAll")}${todo.length ? ` (${todo.length})` : ""}`}
        </button>
      </header>

      <div className={styles.drop}>
        <DropZone onFiles={handleFiles} />
      </div>

      <div className={`${styles.list} scroll-y`}>
        <div className={styles.listInner}>
        {sources.length === 0 && <p className={styles.empty}>{t("sources.empty")}</p>}
        {sources.map((src) => {
          const count = transactions.filter((tx) => tx.sourceId === src.id).length;
          return (
            <article key={src.id} className={styles.card} onClick={() => onPreview(src.id)}>
              <FileThumb item={src} size={44} />
              <div className={styles.info}>
                <div className={styles.name}>{src.name}</div>
                <div className={styles.meta}>
                  <span>{formatBytes(src.size)}</span>
                  {src.bank && <span>· {src.bank}</span>}
                  {src.status === "done" && <span>· {t("sources.txCount", { count })}</span>}
                </div>
                {src.error && (
                  <div className={styles.error} title={src.error}>
                    {src.error}
                  </div>
                )}
              </div>
              <div className={styles.side} onClick={(e) => e.stopPropagation()}>
                <StatusTag status={src.missing ? "missing" : src.status} />
                <div className={styles.actions}>
                  <ActionButton tooltip={t("button.ocr")} onClick={() => handleRun(src)}>
                    <PlayIcon />
                  </ActionButton>
                  <ActionButton tooltip={t("button.preview")} onClick={() => onPreview(src.id)}>
                    <EyeIcon />
                  </ActionButton>
                  <ActionButton tooltip={t("button.delete")} onClick={() => handleDelete(src)}>
                    <TrashIcon />
                  </ActionButton>
                </div>
              </div>
            </article>
          );
        })}
        </div>
      </div>
    </section>
  );
}
