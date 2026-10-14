import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, showToast } from "@ui";
import { useReconcile } from "@store";
import styles from "./bank.module.css";

// An account's details: what it is called (the one thing shown for it), the bank it is at,
// whatever of branch, type, number and holder is worth noting, and a memo in the person's own
// words.
export default function BankEditor({ bank, onClose, onCreated }) {
  const { t } = useTranslation();
  const { addBank, updateBank } = useReconcile();
  const [form, setForm] = useState(() => ({
    label: bank?.label || "",
    name: bank?.name || "",
    branch: bank?.branch || "",
    accountType: bank?.accountType || "",
    accountNumber: bank?.accountNumber || "",
    holder: bank?.holder || "",
    memo: bank?.memo || "",
  }));
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    const label = form.label.trim();
    if (!label) return setError(t("bankEditor.labelRequired"));
    const fields = {
      label,
      name: form.name.trim(),
      branch: form.branch.trim(),
      accountType: form.accountType.trim(),
      accountNumber: form.accountNumber.trim(),
      holder: form.holder.trim(),
      memo: form.memo.trim(),
    };
    if (bank) updateBank(bank.id, fields);
    else onCreated?.(addBank(fields));
    showToast(t("toast.saved"));
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={bank ? t("bankEditor.title") : t("bankEditor.addTitle")}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.grid2}>
          <div className="field">
            <label htmlFor="bank-label">{t("bankEditor.label")}</label>
            <input id="bank-label" className="input" value={form.label} onChange={set("label")} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="bank-name">{t("bankEditor.name")}</label>
            <input id="bank-name" className="input" value={form.name} onChange={set("name")} placeholder="みずほ · 三井住友 · SBJ" />
          </div>
        </div>
        <div className={styles.grid2}>
          <div className="field">
            <label htmlFor="bank-branch">{t("bankEditor.branch")}</label>
            <input id="bank-branch" className="input" value={form.branch} onChange={set("branch")} />
          </div>
          <div className="field">
            <label htmlFor="bank-holder">{t("bankEditor.holder")}</label>
            <input id="bank-holder" className="input" value={form.holder} onChange={set("holder")} />
          </div>
        </div>
        <div className={styles.grid2}>
          <div className="field">
            <label htmlFor="bank-type">{t("bankEditor.accountType")}</label>
            <input id="bank-type" className="input" value={form.accountType} onChange={set("accountType")} placeholder="普通" />
          </div>
          <div className="field">
            <label htmlFor="bank-number">{t("bankEditor.accountNumber")}</label>
            <input id="bank-number" className="input mono" value={form.accountNumber} onChange={set("accountNumber")} inputMode="numeric" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bank-memo">{t("bankEditor.memo")}</label>
          <TextArea id="bank-memo" className={styles.memo} value={form.memo} onChange={set("memo")} minHeight={68} />
        </div>
        {error && <div className={styles.error}>{error}</div>}
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
