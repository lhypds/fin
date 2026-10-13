// Ledger rows: what makes two of them the same row, and the month a row files under.

export const UNDATED = "undated";

export function txKey(t) {
  return [t.date || "", (t.description || "").trim(), Number(t.withdrawal) || 0, Number(t.deposit) || 0, t.balance ?? ""].join("|");
}

// Splits incoming rows into those not yet among `existing` and the count that already are. Equal
// rows pair off one for one, so two identical ATM withdrawals on one day stay two rows, while a
// statement imported twice adds nothing the second time.
export function splitNew(existing, incoming) {
  const counts = new Map();
  for (const t of existing) {
    const key = txKey(t);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const fresh = [];
  let duplicates = 0;
  for (const row of incoming) {
    const key = txKey(row);
    const n = counts.get(key) || 0;
    if (n > 0) {
      counts.set(key, n - 1);
      duplicates++;
    } else fresh.push(row);
  }
  return { fresh, duplicates };
}

export const monthOf = (tx) => (tx.date ? tx.date.slice(0, 7) : UNDATED);

const pad2 = (n) => String(n).padStart(2, "0");

// A local calendar date as YYYY-MM-DD, the way every date in the ledger is written.
export function isoDate(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const currentMonth = () => isoDate().slice(0, 7);

// The months a list of rows falls in, newest first, with the rows that carry no date as a last
// entry. An empty list offers the current month so the picker is never blank.
function monthsOf(transactions) {
  const keys = new Set(transactions.map(monthOf));
  const undated = keys.delete(UNDATED);
  const list = [...keys].sort((a, b) => (a > b ? -1 : 1)).map((key) => ({ key }));
  if (!list.length) list.push({ key: currentMonth() });
  if (undated) list.push({ key: UNDATED });
  return list;
}

// What the ledger shows for a chosen account and month: the months the account's rows (or every
// row, with no account chosen) fall in, which of them is on screen, and its rows. The month on
// screen is the chosen one, or the newest when the chosen one has no rows in this account.
export function ledgerView(transactions, bankId, month) {
  const scoped = bankId ? transactions.filter((tx) => tx.bankId === bankId) : transactions;
  const months = monthsOf(scoped);
  const index = Math.max(0, months.findIndex((m) => m.key === month));
  const current = months[index].key;
  const rows = scoped.filter((tx) => monthOf(tx) === current);
  return { months, index, current, rows };
}
