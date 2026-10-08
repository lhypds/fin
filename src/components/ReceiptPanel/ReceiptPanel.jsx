import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, Checkbox, showToast } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import DropZone from "../DropZone";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import { PlayIcon, EyeIcon, TrashIcon, LoaderIcon, UnlinkIcon } from "../icons";
import styles from "./receipt.module.css";

export const RECEIPT_DRAG_TYPE = "application/x-receipt";

export default function ReceiptPanel({ onPreview }) {
  const { t } = useTranslation();
  const { receipts, importFiles, ocrPending, removeFileItem, unmatch, progress } = useReconcile();
  const [showMatched, setShowMatched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Files the button can read: a missing upload cannot be, one being read is already on its way.
  // `todo` are those not read yet, or whose read failed.
  const readable = receipts.filter((r) => !r.missing && r.status !== "processing");
  const todo = readable.filter((r) => r.status === "pending" || r.status === "error");
  const running = progress.receipt.total > 0;
  const percent = running ? Math.round((progress.receipt.done / progress.receipt.total) * 100) : 0;
  const visible = showMatched ? receipts : receipts.filter((r) => !r.txId);

  async function runOcr(ids) {
    setBusy(true);
    try {
      const { ok, errors, lastError } = await ocrPending("receipt", ids);
      if (!ok && !errors) showToast(t("toast.nothingPending"));
      else if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
      else showToast(t("toast.ocrDone", { ok, errors }));
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files) {
    const { added, rejected, duplicates, failed, lastError, ids } = await importFiles("receipt", files);
    if (rejected) showToast(t("dropzone.rejected", { count: rejected }));
    if (duplicates) showToast(t("dropzone.duplicate", { count: duplicates }));
    if (failed) showToast(t("toast.uploadFailed", { count: failed, message: lastError?.message || "" }), 6000);
    if (added) runOcr(ids);
  }

  async function handleDelete(r) {
    if (!window.confirm(t("receipts.deleteConfirm"))) return;
    await removeFileItem("receipt", r.id);
  }

  // A receipt that has been read already is only read again on confirmation: the new result
  // replaces the current one, including fields edited by hand.
  function handleRun(r) {
    if (r.status === "done" && !window.confirm(t("receipts.rerunConfirm"))) return;
    runOcr([r.id]);
  }

  // Reads what has not been read yet. Once everything has, offers to read it all again.
  function handleRunAll() {
    if (todo.length) return runOcr(todo.map((r) => r.id));
    if (!window.confirm(t("receipts.rerunAllConfirm", { count: readable.length }))) return;
    runOcr(readable.map((r) => r.id));
  }

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t("receipts.title")}</h2>
        <button type="button" className="btn" disabled={busy || running || !readable.length} onClick={handleRunAll}>
          {busy || running ? <LoaderIcon className="spin" /> : <PlayIcon />}
          {running ? t("button.ocrRunning", { percent }) : `${t("receipts.ocrAll")}${todo.length ? ` (${todo.length})` : ""}`}
        </button>
      </header>

      <div className={styles.drop}>
        <DropZone onFiles={handleFiles} />
        <Checkbox className={styles.toggle} checked={showMatched} onChange={setShowMatched}>
          {t("receipts.showMatched")}
        </Checkbox>
      </div>

      <div className={`${styles.list} scroll-y`}>
        <div className={styles.listInner}>
        {visible.length === 0 && (
          <p className={styles.empty}>{receipts.length === 0 ? t("receipts.empty") : t("ledger.emptyFiltered")}</p>
        )}
        {visible.map((r) => {
          const ocr = r.ocr;
          const draggable = !r.missing && r.status !== "processing";
          return (
            <article
              key={r.id}
              className={styles.card}
              data-matched={!!r.txId}
              draggable={draggable}
              onDragStart={(e) => {
                e.dataTransfer.setData(RECEIPT_DRAG_TYPE, r.id);
                e.dataTransfer.effectAllowed = "link";
              }}
              onClick={() => onPreview(r.id)}
            >
              <FileThumb item={r} size={44} />
              <div className={styles.info}>
                <div className={styles.name}>{ocr?.vendor || r.name}</div>
                {ocr ? (
                  <div className={`${styles.meta} mono`}>
                    <span>{ocr.date || "—"}</span>
                    <span>{ocr.total != null ? fmtMoney(ocr.total, ocr.currency) : t("receipts.noAmount")}</span>
                  </div>
                ) : (
                  <div className={styles.meta}>{r.name}</div>
                )}
                {ocr?.summary && (
                  <div className={styles.summary}>{ocr.summary}</div>
                )}
                {r.error && (
                  <div className={styles.error} title={r.error}>
                    {r.error}
                  </div>
                )}
              </div>
              <div className={styles.side} onClick={(e) => e.stopPropagation()}>
                <StatusTag status={r.missing ? "missing" : r.txId ? "matched" : r.status} />
                <div className={styles.actions}>
                  {r.txId ? (
                    <ActionButton tooltip={t("button.unmatch")} onClick={() => unmatch(r.id)}>
                      <UnlinkIcon />
                    </ActionButton>
                  ) : (
                    <ActionButton tooltip={t("button.ocr")} onClick={() => handleRun(r)}>
                      <PlayIcon />
                    </ActionButton>
                  )}
                  <ActionButton tooltip={t("button.preview")} onClick={() => onPreview(r.id)}>
                    <EyeIcon />
                  </ActionButton>
                  <ActionButton tooltip={t("button.delete")} onClick={() => handleDelete(r)}>
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
