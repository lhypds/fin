import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import FileThumb from "../FileThumb";
import { EyeIcon, UnlinkIcon } from "../icons";
import styles from "./editor.module.css";

// The reconciliation side of a row: the receipts matched to it, each with a preview and an unmatch
// button, and under them a note on how it was matched, or why it could not be. The preview opens
// over this dialog, which stays put behind it.
export default function MatchEditor({ tx, onClose, onPreview }) {
  const { t } = useTranslation();
  const { txById, receiptById, unmatch, updateTransaction } = useReconcile();
  const [memo, setMemo] = useState(tx.memo || "");
  // The row as it is now, not as it was when the dialog opened: an unmatch here takes effect at
  // once, and the receipt leaves the list.
  const live = txById.get(tx.id) || tx;
  const receipts = (live.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);

  function submit(e) {
    e.preventDefault();
    updateTransaction(tx.id, { memo: memo.trim() });
    showToast(t("toast.saved"));
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={t("matchEditor.title")}>
      <form className={styles.form} onSubmit={submit}>
        <div className="field">
          <label>{t("matchEditor.receipts")}</label>
          {receipts.length ? (
            <div className={styles.receipts}>
              {receipts.map((r) => (
                <div key={r.id} className={styles.receipt}>
                  {/* The thumbnail opens the preview too, as the chip's does in the ledger. */}
                  <button type="button" className={styles.receiptThumb} title={t("button.preview")} onClick={() => onPreview(r.id)}>
                    <FileThumb item={r} size={28} />
                  </button>
                  <div className={styles.receiptInfo}>
                    <div className={styles.receiptName}>{r.ocr?.vendor || r.name}</div>
                    <div className={`${styles.receiptMeta} mono`}>
                      <span>{r.ocr?.date || "—"}</span>
                      <span>{r.ocr?.total != null ? fmtMoney(r.ocr.total, r.ocr.currency) : t("receipts.noAmount")}</span>
                    </div>
                  </div>
                  <div className={styles.receiptActions}>
                    <ActionButton tooltip={t("button.preview")} onClick={() => onPreview(r.id)}>
                      <EyeIcon />
                    </ActionButton>
                    <ActionButton tooltip={t("button.unmatch")} onClick={() => unmatch(r.id)}>
                      <UnlinkIcon />
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("matchEditor.noReceipts")}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="match-memo">{t("matchEditor.memo")}</label>
          <TextArea id="match-memo" className={styles.memo} value={memo} onChange={(e) => setMemo(e.target.value)} minHeight={68} autoFocus />
        </div>
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          <button type="submit" className="btn primary lg">
            {t("button.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
