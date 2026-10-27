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
// over this dialog, which stays put behind it. Opened from one of several selected rows (`txs`),
// it edits only the note, the same for them all; their receipts stay each row's own.
export default function MatchEditor({ tx, txs = [tx], onClose, onPreview }) {
  const { t } = useTranslation();
  const { txById, receiptById, unmatch, updateTransactions } = useReconcile();
  const many = txs.length > 1;
  // Rows whose notes differ open with an empty box; left empty, it keeps each row's note.
  const mixed = new Set(txs.map((r) => r.memo || "")).size > 1;
  const [memo, setMemo] = useState(mixed ? "" : tx.memo || "");
  // The row as it is now, not as it was when the dialog opened: an unmatch here takes effect at
  // once, and the receipt leaves the list.
  const live = txById.get(tx.id) || tx;
  const receipts = (live.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);

  function submit(e) {
    e.preventDefault();
    // A memo emptied by hand takes the auto-memo mark with it; the row's blue goes with the memo.
    const text = memo.trim();
    if (text || !mixed) {
      updateTransactions(
        txs.map((r) => r.id),
        text ? { memo: text } : { memo: "", autoMemo: null, aiMemo: null },
      );
    }
    showToast(t("toast.saved"));
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={many ? t("matchEditor.titleMany", { count: txs.length }) : t("matchEditor.title")}>
      <form className={styles.form} onSubmit={submit}>
        {!many && (
          <div className="field">
            <label>{t("matchEditor.receipts")}</label>
            {receipts.length ? (
              <div className={styles.receipts}>
                {receipts.map((r) => (
                  <div key={r.id} className={styles.receipt}>
                    {/* The thumbnail and the text open the preview too, as the chip's do in the ledger. */}
                    <button type="button" className={styles.receiptThumb} title={t("button.preview")} onClick={() => onPreview(r.id)}>
                      <FileThumb item={r} size={28} />
                    </button>
                    <div className={styles.receiptInfo}>
                      <button type="button" className={styles.receiptText} title={t("button.preview")} onClick={() => onPreview(r.id)}>
                        <span className={styles.receiptName}>{r.ocr?.vendor || r.name}</span>
                        <span className={`${styles.receiptMeta} mono`}>
                          <span>{r.ocr?.date || "—"}</span>
                          <span>{r.ocr?.total != null ? fmtMoney(r.ocr.total, r.ocr.currency) : t("receipts.noAmount")}</span>
                        </span>
                      </button>
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
        )}
        <div className="field">
          <label htmlFor="match-memo">{t("matchEditor.memo")}</label>
          <TextArea
            id="match-memo"
            className={styles.memo}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={mixed ? t("matchEditor.memoMixed") : undefined}
            minHeight={68}
            autoFocus
          />
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
