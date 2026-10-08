import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, showToast } from "@ui";
import { useReconcile } from "@store";
import { isPdf } from "@utils/files";
import { fmtMoney, txAmount, toNumberOrNull } from "@utils/format";
import StatusTag from "../StatusTag";
import { PlayIcon, LoaderIcon, UnlinkIcon } from "../icons";
import styles from "./preview.module.css";

function Viewer({ item }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  if (!item.url) {
    return (
      <div className={styles.viewer}>
        <p className="muted">{t("preview.noPreview")}</p>
      </div>
    );
  }
  if (isPdf(item.type)) {
    return <iframe className={styles.frame} src={item.url} title={item.name} />;
  }
  return (
    <div className={styles.viewer} data-zoom={zoom} onClick={() => setZoom((z) => !z)}>
      <img src={item.url} alt={item.name} draggable={false} />
    </div>
  );
}

function SourceDetails({ item }) {
  const { t } = useTranslation();
  const { transactions, ocrPending, setSourceBank } = useReconcile();
  const rows = transactions.filter((tx) => tx.sourceId === item.id);
  const busy = item.status === "processing";
  // The bank is edited in place; a new OCR result resets the draft (state-from-props, adjusted during render).
  const [bank, setBank] = useState(item.bank || "");
  const [seenBank, setSeenBank] = useState(item.bank);
  if (seenBank !== item.bank) {
    setSeenBank(item.bank);
    setBank(item.bank || "");
  }

  async function run() {
    if (item.status === "done" && !window.confirm(t("sources.rerunConfirm"))) return;
    const { errors, lastError, results } = await ocrPending("source", [item.id]);
    if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
    else showToast(t("toast.rowsAdded", { count: results.reduce((a, b) => a + (b || 0), 0) }));
  }

  // Writes the bank onto the file and all of its rows.
  function commitBank() {
    const value = bank.trim();
    if (value === (item.bank || "")) return;
    setSourceBank(item.id, value);
    showToast(t("toast.saved"));
  }

  return (
    <>
      <div className={styles.statusRow}>
        <StatusTag status={item.missing ? "missing" : item.status} />
        <button type="button" className="btn" disabled={busy || item.missing} onClick={run}>
          {busy ? <LoaderIcon className="spin" /> : <PlayIcon />}
          {item.status === "done" ? t("preview.rerun") : t("preview.run")}
        </button>
      </div>
      {item.error && <div className={styles.error}>{item.error}</div>}
      <div className="field">
        <label htmlFor="src-bank">{t("ledger.bank")}</label>
        <input
          id="src-bank"
          className="input"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          onBlur={commitBank}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="みずほ · 三井住友 · SBJ"
        />
      </div>
      {item.notes && (
        <div className="field">
          <label>{t("preview.notes")}</label>
          <div className={styles.notes}>{item.notes}</div>
        </div>
      )}
      <div className="field">
        <label>
          {t("preview.transactions")} ({rows.length})
        </label>
        <div className={`${styles.rows} scroll-y`}>
          {rows.map((tx) => (
            <div key={tx.id} className={`${styles.txRow} mono`}>
              <span>{tx.date || "—"}</span>
              <span className={styles.txDesc}>{tx.description}</span>
              <span className={`${styles.txAmount} ${tx.withdrawal ? styles.withdrawal : styles.deposit}`}>
                {tx.withdrawal ? `-${fmtMoney(tx.withdrawal, tx.currency)}` : fmtMoney(tx.deposit, tx.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function toDraft(ocr) {
  return {
    vendor: ocr?.vendor ?? "",
    date: ocr?.date ?? "",
    total: ocr?.total ?? "",
    currency: ocr?.currency ?? "JPY",
    direction: ocr?.direction ?? "unknown",
    tax: ocr?.tax ?? "",
    invoiceNumber: ocr?.invoiceNumber ?? "",
    paymentMethod: ocr?.paymentMethod ?? "",
    summary: ocr?.summary ?? "",
  };
}

// Fields the form does not show (items, vendorKana, fee) are carried over from the OCR result.
function fromDraft(d, prev) {
  return {
    ...prev,
    items: prev?.items || [],
    vendor: d.vendor.trim() || null,
    date: d.date || null,
    total: toNumberOrNull(d.total),
    currency: d.currency.trim().toUpperCase() || "JPY",
    direction: d.direction,
    tax: toNumberOrNull(d.tax),
    invoiceNumber: d.invoiceNumber.trim() || null,
    paymentMethod: d.paymentMethod.trim() || null,
    summary: d.summary.trim(),
  };
}

function ReceiptDetails({ item }) {
  const { t } = useTranslation();
  const { updateReceipt, ocrPending, txById, unmatch } = useReconcile();
  const [draft, setDraft] = useState(() => toDraft(item.ocr));
  // Reset the form when a new OCR result arrives (state-from-props, adjusted during render).
  const [seenOcr, setSeenOcr] = useState(item.ocr);
  if (seenOcr !== item.ocr) {
    setSeenOcr(item.ocr);
    setDraft(toDraft(item.ocr));
  }

  const busy = item.status === "processing";
  const tx = item.txId ? txById.get(item.txId) : null;
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function run() {
    if (item.status === "done" && !window.confirm(t("receipts.rerunConfirm"))) return;
    const { errors, lastError } = await ocrPending("receipt", [item.id]);
    if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
    else showToast(t("toast.ocrDone", { ok: 1, errors: 0 }));
  }

  function save(e) {
    e.preventDefault();
    updateReceipt(item.id, { ocr: fromDraft(draft, item.ocr), status: "done", error: null });
    showToast(t("toast.saved"));
  }

  return (
    <>
      <div className={styles.statusRow}>
        <StatusTag status={item.missing ? "missing" : item.status} />
        <button type="button" className="btn" disabled={busy || item.missing} onClick={run}>
          {busy ? <LoaderIcon className="spin" /> : <PlayIcon />}
          {item.ocr ? t("preview.rerun") : t("preview.run")}
        </button>
      </div>
      {item.error && <div className={styles.error}>{item.error}</div>}

      {tx && (
        <div className="field">
          <label>{t("preview.matchedTo")}</label>
          <div className={styles.matched}>
            <span className={`${styles.matchedText} mono`}>
              {tx.date || "—"} · {tx.description} · {fmtMoney(txAmount(tx), tx.currency)}
            </span>
            <button type="button" className="btn" onClick={() => unmatch(item.id)}>
              <UnlinkIcon />
              {t("button.unmatch")}
            </button>
          </div>
        </div>
      )}

      <form className={styles.form} onSubmit={save}>
        <div className={styles.sectionTitle}>{t("preview.ocrResult")}</div>
        {!item.ocr && <p className="muted">{t("preview.noOcr")}</p>}
        <div className="field">
          <label htmlFor="rc-vendor">{t("preview.vendor")}</label>
          <input id="rc-vendor" className="input" value={draft.vendor} onChange={set("vendor")} />
        </div>
        <div className={styles.grid}>
          <div className="field">
            <label htmlFor="rc-date">{t("preview.date")}</label>
            <input id="rc-date" className="input mono" type="date" value={draft.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label htmlFor="rc-direction">{t("preview.direction")}</label>
            <select id="rc-direction" className="select" value={draft.direction} onChange={set("direction")}>
              <option value="expense">{t("preview.expense")}</option>
              <option value="income">{t("preview.income")}</option>
              <option value="unknown">{t("preview.unknown")}</option>
            </select>
          </div>
        </div>
        <div className={styles.grid3}>
          <div className="field">
            <label htmlFor="rc-total">{t("preview.total")}</label>
            <input id="rc-total" className="input mono" inputMode="decimal" value={draft.total} onChange={set("total")} />
          </div>
          <div className="field">
            <label htmlFor="rc-tax">{t("preview.tax")}</label>
            <input id="rc-tax" className="input mono" inputMode="decimal" value={draft.tax} onChange={set("tax")} />
          </div>
          <div className="field">
            <label htmlFor="rc-currency">{t("preview.currency")}</label>
            <input id="rc-currency" className="input mono" maxLength={3} value={draft.currency} onChange={set("currency")} />
          </div>
        </div>
        <div className={styles.grid}>
          <div className="field">
            <label htmlFor="rc-invoice">{t("preview.invoiceNumber")}</label>
            <input id="rc-invoice" className="input mono" value={draft.invoiceNumber} onChange={set("invoiceNumber")} />
          </div>
          <div className="field">
            <label htmlFor="rc-payment">{t("preview.paymentMethod")}</label>
            <input id="rc-payment" className="input" value={draft.paymentMethod} onChange={set("paymentMethod")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="rc-summary">{t("preview.summary")}</label>
          <input id="rc-summary" className="input" value={draft.summary} onChange={set("summary")} />
        </div>
        {item.ocr?.items?.length > 0 && (
          <div className="field">
            <label>{t("preview.items")}</label>
            <div className={`${styles.rows} scroll-y`}>
              {item.ocr.items.map((it, i) => (
                <div key={i} className={`${styles.txRow} mono`}>
                  <span className={styles.txDesc}>{it.name}</span>
                  <span className={styles.txAmount}>{it.amount != null ? fmtMoney(it.amount, item.ocr.currency) : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={styles.footer}>
          <button type="submit" className="btn primary lg">
            {t("button.save")}
          </button>
        </div>
      </form>
    </>
  );
}

export default function PreviewModal({ kind, id, onClose }) {
  const store = useReconcile();
  const list = kind === "source" ? store.sources : store.receipts;
  const item = list.find((x) => x.id === id);

  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  if (!item) return null;

  return (
    <Modal isOpen onClose={onClose} title={item.name} className={styles.modal}>
      <div className={styles.body}>
        <Viewer item={item} />
        <aside className={`${styles.side} scroll-y`}>
          {kind === "source" ? <SourceDetails item={item} /> : <ReceiptDetails item={item} />}
        </aside>
      </div>
    </Modal>
  );
}
