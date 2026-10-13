import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, showToast } from "@ui";
import { useReconcile } from "@store";
import styles from "./editor.module.css";

// The reconciliation side of a row: a note on how it was matched, or why it could not be.
export default function MatchEditor({ tx, onClose }) {
  const { t } = useTranslation();
  const { updateTransaction } = useReconcile();
  const [memo, setMemo] = useState(tx.memo || "");

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
