import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney, txAmount } from "@utils/format";
import { receiptsSumMismatch } from "@utils/matching";
import FileThumb from "../FileThumb";
import FileViewer from "../FileViewer";
import { ConfidenceTag } from "../StatusTag";
import { UnlinkIcon } from "../icons";
import styles from "./confirm.module.css";

// A row with receipts is confirmed here rather than by the double click itself: the row's details
// on top, and under them the receipts one at a time, each as the file itself, to be checked against
// the row. Next goes from one receipt to the one after it; after the last the same button confirms
// the row, and only then does it turn green. A receipt that does not belong is unmatched on the
// spot and the row goes on without it; with none left the row can still be confirmed, as a row
// without receipts can be from the ledger.
export default function ConfirmDialog({ tx, onClose }) {
  const { t } = useTranslation();
  const { txById, receiptById, unmatch, updateTransaction } = useReconcile();
  const [index, setIndex] = useState(0);
  // The row as it is now, not as it was when the dialog opened: an unmatch here takes effect at
  // once, and the receipt leaves the sequence.
  const live = txById.get(tx.id);
  const receipts = (live?.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);
  // The receipt on screen. An unmatch can leave `index` past the end; the one now last shows.
  const at = Math.min(index, receipts.length - 1);
  const current = receipts[at] || null;
  const last = at >= receipts.length - 1;

  // The row deleted meanwhile (from another tab): nothing left to confirm.
  useEffect(() => {
    if (!live) onClose();
  }, [live, onClose]);

  function confirm() {
    updateTransaction(live.id, { confirmed: true });
    onClose();
  }

  // Space is the primary button wherever the focus is: next receipt, or on the last one, confirm.
  // The dialog has no text fields, and the focus wanders to Unmatch, Back or the viewer; a space
  // there would press that button (or nothing), so the key is taken on the way down, before any
  // button acts on it. Read through a ref so the listener is registered once.
  const advanceRef = useRef(null);
  useEffect(() => {
    advanceRef.current = !live ? null : last ? confirm : () => setIndex(at + 1);
  });
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== " " || e.defaultPrevented || e.isComposing) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      e.preventDefault();
      advanceRef.current?.();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  if (!live) return null;

  const amount = txAmount(live);
  const sum = receipts.length ? receiptsSumMismatch(amount, receipts, live.currency) : null;

  return (
    <Modal isOpen onClose={onClose} title={t("confirmMatch.title")} className={styles.modal}>
      <div className={styles.body}>
        {/* The row as the ledger has it, with its memo under it. */}
        <div className={styles.section}>
          <div className={styles.label}>{t("ledger.title")}</div>
          <div className={styles.tx}>
            <div className={`${styles.txRow} ${styles.txHead}`}>
              <div>{t("ledger.date")}</div>
              <div>{t("ledger.bank")}</div>
              <div>{t("ledger.description")}</div>
              <div className={styles.num}>{t("ledger.amount")}</div>
            </div>
            <div className={styles.txRow}>
              <div className="mono">{live.date || <span className="muted">{t("ledger.noDate")}</span>}</div>
              <div>{live.bank}</div>
              <div>{live.description}</div>
              <div className={`${styles.num} ${live.withdrawal ? styles.withdrawal : styles.deposit} mono`}>{fmtMoney(amount, live.currency)}</div>
            </div>
            {live.memo && <div className={styles.memo}>{live.memo}</div>}
          </div>
        </div>

        <div className={`${styles.section} ${styles.grow}`}>
          <div className={styles.section}>
            <div className={styles.labelRow}>
              <span className={styles.label}>{t("matchEditor.receipts")}</span>
              {current && <span className={`${styles.label} mono`}>{t("confirmMatch.step", { index: at + 1, total: receipts.length })}</span>}
            </div>
            {current && (
              <div className={styles.receipt}>
                <FileThumb item={current} size={28} />
                <div className={styles.receiptInfo}>
                  <span className={styles.receiptName}>{current.ocr?.vendor || current.name}</span>
                  <span className={`${styles.receiptMeta} mono`}>
                    <span>{current.ocr?.date || "—"}</span>
                    <span>{current.ocr?.total != null ? fmtMoney(current.ocr.total, current.ocr.currency) : t("receipts.noAmount")}</span>
                    <ConfidenceTag confidence={current.confidence} />
                    {/* The file's own name, when the vendor read off it stands in for it above. */}
                    {current.ocr?.vendor && <span className={styles.fileName}>{current.name}</span>}
                  </span>
                </div>
                <button type="button" className="btn" onClick={() => unmatch(current.id)}>
                  <UnlinkIcon />
                  {t("button.unmatch")}
                </button>
              </div>
            )}
            {/* The ledger's note on the receipts' sum, here too, since this is where the receipts are judged. */}
            {sum != null && <div className={styles.mismatch}>{t("ledger.sumMismatch", { sum: fmtMoney(sum, live.currency), amount: fmtMoney(amount, live.currency) })}</div>}
          </div>
          {/* Keyed by the receipt so a zoomed image is back at its size on the next file. */}
          {current ? <FileViewer key={current.id} item={current} /> : <p className={`${styles.none} muted`}>{t("confirmMatch.noReceipts")}</p>}
        </div>

        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          {at > 0 && (
            <button type="button" className="btn lg" onClick={() => setIndex(at - 1)}>
              {t("button.back")}
            </button>
          )}
          {/* One button for both steps, so the focus it takes on opening stays on it to the end. */}
          <button type="button" className="btn primary lg" onClick={last ? confirm : () => setIndex(at + 1)} autoFocus>
            {last ? t("button.confirm") : t("button.next")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
