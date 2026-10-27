import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, showToast } from "@ui";
import { useReconcile } from "@store";
import { CURRENCIES, toNumberOrNull } from "@utils/format";
import { accountBalance, lastBalanceRow } from "@utils/transactions";
import styles from "./bank.module.css";

// A bank's site typed as "www.smbc.co.jp" opens as a web address, not a path in this app.
function withScheme(url) {
  return url && !/^[a-z][a-z\d+.-]*:/i.test(url) ? `https://${url}` : url;
}

// An account's details: what it is called (the one thing shown for it), the bank it is at,
// whatever of branch, type, number and holder is worth noting, its balance, and a memo in the
// person's own words.
export default function BankEditor({ bank, onClose, onCreated }) {
  const { t } = useTranslation();
  const { transactions, addBank, updateBank } = useReconcile();
  // The balance comes from the account's last statement row; one typed here stands in for it
  // until a newer row arrives. Left as the statement has it, or emptied, it follows the statement.
  const lastRow = bank ? lastBalanceRow(transactions, bank.id) : null;
  const [form, setForm] = useState(() => ({
    balance: bank ? (accountBalance(bank, transactions) ?? "") : "",
    currency: (bank?.currency || "JPY").toUpperCase(),
    label: bank?.label || "",
    name: bank?.name || "",
    branch: bank?.branch || "",
    accountType: bank?.accountType || "",
    accountNumber: bank?.accountNumber || "",
    holder: bank?.holder || "",
    url: bank?.url || "",
    memo: bank?.memo || "",
  }));
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    const label = form.label.trim();
    if (!label) return setError(t("bankEditor.labelRequired"));
    const typed = toNumberOrNull(form.balance);
    const typedOver = typed != null && typed !== lastRow?.balance;
    const fields = {
      balance: typedOver ? typed : null,
      balanceTxId: typedOver ? (lastRow?.id ?? null) : null,
      currency: form.currency,
      label,
      name: form.name.trim(),
      branch: form.branch.trim(),
      accountType: form.accountType.trim(),
      accountNumber: form.accountNumber.trim(),
      holder: form.holder.trim(),
      url: withScheme(form.url.trim()),
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
        <div className={styles.grid2}>
          <div className="field">
            <label htmlFor="bank-balance">{t("bankEditor.balance")}</label>
            <input
              id="bank-balance"
              className="input mono"
              value={form.balance}
              onChange={set("balance")}
              inputMode="decimal"
              placeholder={lastRow ? String(lastRow.balance) : ""}
            />
          </div>
          <div className="field">
            <label htmlFor="bank-currency">{t("bankEditor.currency")}</label>
            <select id="bank-currency" className="select mono" value={form.currency} onChange={set("currency")}>
              {/* An account read in a currency not on the list keeps it as a choice. */}
              {(CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bank-url">{t("bankEditor.url")}</label>
          <input id="bank-url" className="input mono" type="url" value={form.url} onChange={set("url")} placeholder="https://" />
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
