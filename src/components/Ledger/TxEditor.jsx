import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, showToast } from "@ui";
import { useReconcile } from "@store";
import { toNumberOrNull } from "@utils/format";
import styles from "./editor.module.css";

export default function TxEditor({ tx, defaultBankId = null, onClose, onSaved }) {
  const { t } = useTranslation();
  const { banks, bankById, updateTransaction, addTransaction } = useReconcile();
  const [form, setForm] = useState(() => {
    // A new row starts on the account the ledger is showing, in its currency.
    const bankId = tx ? tx.bankId || "" : defaultBankId || "";
    return {
      date: tx?.date || "",
      bankId,
      description: tx?.description || "",
      withdrawal: tx?.withdrawal || "",
      deposit: tx?.deposit || "",
      currency: tx?.currency || bankById.get(bankId)?.currency || "JPY",
    };
  });
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError(t("txEditor.dateRequired"));
    const withdrawal = toNumberOrNull(form.withdrawal) || 0;
    const deposit = toNumberOrNull(form.deposit) || 0;
    if (!withdrawal && !deposit) return setError(t("txEditor.amountRequired"));
    const bank = bankById.get(form.bankId);
    const patch = {
      date: form.date,
      bankId: bank ? bank.id : null,
      bank: bank ? bank.name : "",
      description: form.description.trim(),
      withdrawal,
      deposit,
      currency: form.currency.trim().toUpperCase() || "JPY",
    };
    if (tx) updateTransaction(tx.id, patch);
    else addTransaction(patch);
    showToast(t("toast.saved"));
    onSaved?.(patch);
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={tx ? t("txEditor.title") : t("txEditor.addTitle")}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.grid2}>
          <div className="field">
            <label htmlFor="tx-date">{t("ledger.date")}</label>
            <input id="tx-date" className="input mono" type="date" value={form.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label htmlFor="tx-bank">{t("ledger.bank")}</label>
            <select id="tx-bank" className="select" value={form.bankId} onChange={set("bankId")}>
              <option value="">{t("txEditor.noBank")}</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="tx-desc">{t("ledger.description")}</label>
          <input id="tx-desc" className="input" value={form.description} onChange={set("description")} autoFocus />
        </div>
        <div className={styles.grid}>
          <div className="field">
            <label htmlFor="tx-withdrawal">{t("ledger.withdrawal")}</label>
            <input id="tx-withdrawal" className="input mono" inputMode="decimal" value={form.withdrawal} onChange={set("withdrawal")} />
          </div>
          <div className="field">
            <label htmlFor="tx-deposit">{t("ledger.deposit")}</label>
            <input id="tx-deposit" className="input mono" inputMode="decimal" value={form.deposit} onChange={set("deposit")} />
          </div>
          <div className="field">
            <label htmlFor="tx-currency">{t("preview.currency")}</label>
            <input id="tx-currency" className="input mono" value={form.currency} onChange={set("currency")} maxLength={3} />
          </div>
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
