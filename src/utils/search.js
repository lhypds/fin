import { fmtMoney } from "./format";

/* NFKC folds full-width digits and half-width katakana onto their plain forms, so a query typed
   either way finds text whose OCR output used the other. */
export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase();
}

/* An amount both raw and formatted, so "11000000" and "11,000,000" both hit. */
function amountText(value, currency) {
  return value != null && value !== "" ? `${value} ${fmtMoney(value, currency)}` : "";
}

/* Everything a receipt card shows or could be searched for: file name, vendor, date, amount,
   summary, invoice number, payment method. */
export function receiptHaystack(r) {
  const o = r.ocr || {};
  return normalize(
    [r.name, o.vendor, o.vendorKana, o.date, amountText(o.total, o.currency), o.summary, o.invoiceNumber, o.paymentMethod].join(" "),
  );
}

/* Everything a ledger row shows: the transaction's own cells plus the chips of its matched receipts. */
export function transactionHaystack(tx, receipts = []) {
  const own = [tx.date, tx.bank, tx.description, amountText(tx.withdrawal, tx.currency), amountText(tx.deposit, tx.currency)];
  return normalize(own.join(" ")) + " " + receipts.map(receiptHaystack).join(" ");
}

/* True when every whitespace-separated word of the query appears somewhere in the haystack. */
export function matchesQuery(haystack, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}
