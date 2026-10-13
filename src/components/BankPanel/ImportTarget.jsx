import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { useReconcile } from "@store";
import { fmtAccount } from "@utils/format";
import styles from "./bank.module.css";

// Which account a CSV statement goes onto: one of the accounts, or a new one named here. Nothing
// is uploaded until the choice is made.
export default function ImportTarget({ files, defaultBankId, onClose, onConfirm }) {
  const { t } = useTranslation();
  const { banks, addBank } = useReconcile();
  const [choice, setChoice] = useState(() => (banks.some((b) => b.id === defaultBankId) ? defaultBankId : banks[0]?.id || "new"));
  const [name, setName] = useState("");
  const [error, setError] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (choice !== "new") return onConfirm(choice);
    const trimmed = name.trim();
    if (!trimmed) return setError(t("bankEditor.nameRequired"));
    onConfirm(addBank({ name: trimmed }));
  }

  const option = (value, label, meta) => (
    <label key={value} className={styles.target} data-active={choice === value}>
      <input type="radio" name="target" className={styles.radio} value={value} checked={choice === value} onChange={() => setChoice(value)} />
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.targetName}>{label}</span>
      {meta && <span className={styles.targetMeta}>{meta}</span>}
    </label>
  );

  return (
    <Modal isOpen onClose={onClose} title={t("importTarget.title")}>
      <form className={styles.form} onSubmit={submit}>
        <div className={`${styles.fileNames} mono`}>
          {files.map((f) => (
            <div key={f.name}>{f.name}</div>
          ))}
        </div>
        <div className={styles.targets}>
          {banks.map((b) => option(b.id, b.name, fmtAccount(b)))}
          {option("new", t("importTarget.newAccount"))}
        </div>
        {choice === "new" && (
          <div className="field">
            <label htmlFor="target-name">{t("bankEditor.name")}</label>
            <input
              id="target-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="みずほ · 三井住友 · SBJ"
              autoFocus
            />
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          <button type="submit" className="btn primary lg">
            {t("importTarget.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
