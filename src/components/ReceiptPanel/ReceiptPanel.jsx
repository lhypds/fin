import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, Checkbox, showToast } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import { receiptHaystack, matchesQuery } from "@utils/search";
import DropZone from "../DropZone";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import { PlayIcon, EyeIcon, TrashIcon, UnlinkIcon, SearchIcon, XIcon } from "../icons";
import { RECEIPT_DRAG_TYPE, isReceiptDrag } from "./drag";
import styles from "./receipt.module.css";

export default function ReceiptPanel({ onPreview }) {
  const { t } = useTranslation();
  const { receipts, stats, importReceipts, ocrPending, removeReceipt, unmatch } = useReconcile();
  const [showMatched, setShowMatched] = useState(false);
  const [query, setQuery] = useState("");

  // The open receipts, or all of them, narrowed by the search box above the list.
  const listed = showMatched ? receipts : receipts.filter((r) => !r.txId);
  const visible = query.trim() ? listed.filter((r) => matchesQuery(receiptHaystack(r), query)) : listed;

  // Reads the given receipts; the status bar shows the run's progress while it goes.
  async function runOcr(ids) {
    const { ok, errors, lastError } = await ocrPending(ids);
    if (!ok && !errors) showToast(t("toast.nothingPending"));
    else if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
    else showToast(t("toast.ocrDone", { ok, errors }));
  }

  // Every file dropped here is read as soon as it is up; a failed one is read again from its card.
  async function handleFiles(files) {
    const { added, rejected, duplicates, failed, lastError, ids } = await importReceipts(files);
    if (rejected) showToast(t("dropzone.rejected", { count: rejected }));
    if (duplicates) showToast(t("dropzone.duplicate", { count: duplicates }));
    if (failed) showToast(t("toast.uploadFailed", { count: failed, message: lastError?.message || "" }), 6000);
    if (added) runOcr(ids);
  }

  async function handleDelete(r) {
    if (!window.confirm(t("receipts.deleteConfirm"))) return;
    await removeReceipt(r.id);
  }

  // A receipt that has been read already is only read again on confirmation: the new result
  // replaces the current one, including fields edited by hand.
  function handleRun(r) {
    if (r.status === "done" && !window.confirm(t("receipts.rerunConfirm"))) return;
    runOcr([r.id]);
  }

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t("receipts.title")}</h2>
        {/* How many are still open, whatever the list below is narrowed to, at the right edge. */}
        <span className={`${styles.count} muted mono`}>{stats.unmatchedReceipts}</span>
      </header>

      <div className={styles.drop}>
        <DropZone onFiles={handleFiles} />
        <Checkbox className={styles.toggle} checked={showMatched} onChange={setShowMatched}>
          {t("receipts.showMatched")}
        </Checkbox>
      </div>

      {/* Drawn like the header's search: the icon on the left, a clear button on the right once
          there is text. */}
      <div className={styles.search}>
        <div className={styles.searchBox}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={`input ${styles.searchInput}`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("receipts.search")}
            aria-label={t("receipts.search")}
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery("")}
              title={t("header.clearSearch")}
              aria-label={t("header.clearSearch")}
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      {/* The list is a drop target for a chip dragged back from the ledger: the receipt is unmatched.
          Nothing marks the list while the chip is over it. */}
      <div
        className={`${styles.list} scroll-y`}
        onDragOver={(e) => {
          if (!isReceiptDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "link";
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(RECEIPT_DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          // A card dropped back on its own list is already unmatched and is left alone.
          if (receipts.some((r) => r.id === id && r.txId)) unmatch(id);
        }}
      >
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
