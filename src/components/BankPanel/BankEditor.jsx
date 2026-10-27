import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextArea, showToast } from "@ui";
import { useReconcile } from "@store";
import { CURRENCIES, toNumberOrNull } from "@utils/format";
import { accountBalance, lastBalanceRow } from "@utils/transactions";
import { PlusIcon, XIcon } from "../icons";
import styles from "./bank.module.css";

// A bank's site typed as "www.smbc.co.jp" opens as a web address, not a path in this app.
function withScheme(url) {
  return url && !/^[a-z][a-z\d+.-]*:/i.test(url) ? `https://${url}` : url;
}

// The currencies a balance row can be in: those on the list (and its own, when it was read in one
// that is not) less the ones other rows of the account already hold.
function currencyChoices(own, taken) {
  const list = CURRENCIES.includes(own) ? CURRENCIES : [own, ...CURRENCIES];
  return list.filter((c) => c === own || !taken.includes(c));
}

// A balance with its currency: the input and the select side by side as two columns of the form,
// with a button after the select on the other currencies' rows, to remove one. Only the main row
// is labelled.
function BalanceRow({ main, value, currency, taken, placeholder, onChange, button }) {
  const { t } = useTranslation();
  const id = main ? "bank-balance" : undefined;
  return (
    <div className={styles.grid2}>
      <div className="field">
        {main && <label htmlFor={id}>{t("bankEditor.balance")}</label>}
        <input
          id={id}
          className="input mono"
          value={value}
          onChange={(e) => onChange({ balance: e.target.value })}
          inputMode="decimal"
          placeholder={placeholder}
          aria-label={main ? undefined : `${t("bankEditor.balance")} ${currency}`}
        />
      </div>
      <div className="field">
        {main && <label htmlFor="bank-currency">{t("bankEditor.currency")}</label>}
        <div className={styles.currencyLine}>
          <select
            id={main ? "bank-currency" : undefined}
            className="select mono"
            value={currency}
            onChange={(e) => onChange({ currency: e.target.value })}
            aria-label={main ? undefined : t("bankEditor.currency")}
          >
            {currencyChoices(currency, taken).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {button}
        </div>
      </div>
    </div>
  );
}

// An account's details: what it is called (the one thing shown for it), the bank it is at,
// whatever of branch, type, number and holder is worth noting, its balance, and a memo in the
// person's own words. Besides its main currency an account can hold others (a Wise or Revolut
// account), each with a balance of its own: the + under the balances adds one.
export default function BankEditor({ bank, onClose, onCreated }) {
  const { t } = useTranslation();
  const { transactions, addBank, updateBank } = useReconcile();
  // A balance comes from the account's last statement row in that currency; one typed here stands
  // in for it until a newer row arrives. Left as the statement has it, or emptied, it follows the
  // statement.
  const [form, setForm] = useState(() => ({
    balance: bank ? (accountBalance(bank, transactions) ?? "") : "",
    currency: (bank?.currency || "JPY").toUpperCase(),
    // The other currencies, in the order they were added.
    balances: (bank?.balances || []).map((b) => ({ currency: b.currency, balance: accountBalance(bank, transactions, b.currency) ?? "" })),
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
  const setOther = (i) => (patch) => setForm((f) => ({ ...f, balances: f.balances.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  const held = [form.currency, ...form.balances.map((b) => b.currency)];
  const free = CURRENCIES.find((c) => !held.includes(c));
  const addCurrency = () => setForm((f) => ({ ...f, balances: [...f.balances, { currency: free, balance: "" }] }));
  const removeCurrency = (i) => setForm((f) => ({ ...f, balances: f.balances.filter((_, j) => j !== i) }));

  // The account as it will be saved, so the rows each currency counts are those of the new set.
  const saved = bank && { ...bank, currency: form.currency, balances: form.balances };
  const lastIn = (currency) => (saved ? lastBalanceRow(transactions, saved, currency) : null);

  // What is kept of a typed balance: only one that differs from the statement's, with the row it
  // was typed against.
  function typedBalance(value, currency) {
    const last = lastIn(currency);
    const typed = toNumberOrNull(value);
    const over = typed != null && typed !== last?.balance;
    return { balance: over ? typed : null, balanceTxId: over ? (last?.id ?? null) : null };
  }

  function submit(e) {
    e.preventDefault();
    const label = form.label.trim();
    if (!label) return setError(t("bankEditor.labelRequired"));
    const fields = {
      ...typedBalance(form.balance, form.currency),
      currency: form.currency,
      balances: form.balances.map((b) => ({ currency: b.currency, ...typedBalance(b.balance, b.currency) })),
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
        <BalanceRow
          main
          value={form.balance}
          currency={form.currency}
          taken={held}
          placeholder={lastIn(form.currency) ? String(lastIn(form.currency).balance) : ""}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
        {form.balances.map((b, i) => (
          <BalanceRow
            key={i}
            value={b.balance}
            currency={b.currency}
            taken={held}
            placeholder={lastIn(b.currency) ? String(lastIn(b.currency).balance) : ""}
            onChange={setOther(i)}
            button={
              <button type="button" className={styles.currencyButton} title={t("bankEditor.removeCurrency")} aria-label={t("bankEditor.removeCurrency")} onClick={() => removeCurrency(i)}>
                <XIcon />
              </button>
            }
          />
        ))}
        {/* Under the balances: another currency for the account. */}
        <button
          type="button"
          className={`${styles.currencyButton} ${styles.addCurrency}`}
          title={t("bankEditor.addCurrency")}
          aria-label={t("bankEditor.addCurrency")}
          onClick={addCurrency}
          disabled={!free}
        >
          <PlusIcon />
        </button>
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
