import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, showToast } from "@ui";
import { useReconcile } from "@store";
import styles from "./bank.module.css";

// An account's details: the bank, whatever of branch, type, number and holder is worth noting,
// and a memo in the person's own words.
export default function BankEditor({ bank, onClose, onCreated }) {
  const { t } = useTranslation();
  const { addBank, updateBank } = useReconcile();
  const [form, setForm] = useState(() => ({
    name: bank?.name || "",
    branch: bank?.branch || "",
    accountType: bank?.accountType || "",
    accountNumber: bank?.accountNumber || "",
    holder: bank?.holder || "",
    currency: bank?.currency || "JPY",
    memo: bank?.memo || "",
  }));
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setError(t("bankEditor.nameRequired"));
    const fields = {
      name,
      branch: form.branch.trim(),
      accountType: form.accountType.trim(),
      accountNumber: form.accountNumber.trim(),
      holder: form.holder.trim(),
      currency: form.currency.trim().toUpperCase() || "JPY",
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
        <div className="field">
          <label htmlFor="bank-name">{t("bankEditor.name")}</label>
          <input id="bank-name" className="input" value={form.name} onChange={set("name")} placeholder="みずほ · 三井住友 · SBJ" autoFocus />
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
        <div className={styles.grid3}>
          <div className="field">
            <label htmlFor="bank-type">{t("bankEditor.accountType")}</label>
            <input id="bank-type" className="input" value={form.accountType} onChange={set("accountType")} placeholder="普通" />
          </div>
          <div className="field">
            <label htmlFor="bank-number">{t("bankEditor.accountNumber")}</label>
            <input id="bank-number" className="input mono" value={form.accountNumber} onChange={set("accountNumber")} inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="bank-currency">{t("bankEditor.currency")}</label>
            <input id="bank-currency" className="input mono" value={form.currency} onChange={set("currency")} maxLength={3} />
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
