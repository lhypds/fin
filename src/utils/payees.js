import { findInternalTransfers } from "./transfers";

// Who a withdrawal went to, read off its statement text: the text with its widths folded (NFKC,
// so a name printed full-width one month and half-width the next is one name) and its spaces
// evened out, less the approval number a debit card puts before the shop ("V906393 GUCCI"), which
// is different on every row. A row that is nothing but that number keeps it.
export function payeeName(description) {
  const text = String(description ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return text.replace(/^V\d{6}\s*/, "") || text;
}

// In how many different months a payee must have been paid to count as a recurring one.
export const MIN_MONTHS = 2;

// The payees money went out to in `MIN_MONTHS` months or more, in `currency`, from one account
// (`bankId`) or all of them, the one paid the most first. Two rows are the same payee when their
// names agree whatever the case ("Trip.com", "TRIP.COM"). Transfers between the accounts are left
// out, as in the month's spending, and so are rows with no date or no text. Each payee is
// { key, name, total, count, months }: `months` maps a month ("2026-10") to what went out in it.
export function recurringPayees(transactions, banks, currency, bankId) {
  const main = new Map(banks.map((b) => [b.id, b.currency || "JPY"]));
  const rows = transactions.filter(
    (tx) =>
      tx.date && Number(tx.withdrawal) > 0 && (!bankId || tx.bankId === bankId) && (tx.currency || main.get(tx.bankId) || "JPY") === currency,
  );
  const moved = new Set(findInternalTransfers(rows, transactions).flatMap((p) => [p.from.id, p.to.id]));
  const payees = new Map();
  for (const tx of rows) {
    const name = payeeName(tx.description);
    if (!name || moved.has(tx.id)) continue;
    const key = name.toLowerCase();
    if (!payees.has(key)) payees.set(key, { key, name, total: 0, count: 0, months: new Map() });
    const payee = payees.get(key);
    const month = tx.date.slice(0, 7);
    const value = Number(tx.withdrawal);
    payee.total += value;
    payee.count += 1;
    payee.months.set(month, (payee.months.get(month) || 0) + value);
  }
  return [...payees.values()].filter((p) => p.months.size >= MIN_MONTHS).sort((a, b) => b.total - a.total);
}
