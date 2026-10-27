// Ledger rows: what makes two of them the same row, and the month a row files under.

export const UNDATED = "undated";
// The picker's entry for every month at once.
export const ALL = "all";

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

// An account holds its main currency (`currency`, `balance`, `balanceTxId`) and may hold others
// besides, each with a balance of its own (`balances`: [{ currency, balance, balanceTxId }]). A row
// counts toward the other currency it is in, and toward the main one otherwise, so an account
// with no others counts every row, whatever currency it is in.
function inCurrency(bank, currency) {
  const main = bank.currency || "JPY";
  if (currency !== main) return (tx) => (tx.currency || main) === currency;
  const others = new Set((bank.balances || []).map((b) => b.currency));
  return (tx) => !others.has(tx.currency || main);
}

// An account's last statement row in `currency` (the main one when left out) that shows a balance:
// the newest date, and on that day the row imported last, since a statement prints a day's rows
// oldest first. Null when there is none.
export function lastBalanceRow(transactions, bank, currency = bank.currency || "JPY") {
  const counts = inCurrency(bank, currency);
  let last = null;
  for (const tx of transactions) {
    if (tx.bankId !== bank.id || !tx.date || tx.balance == null || !counts(tx)) continue;
    if (!last || tx.date >= last.date) last = tx;
  }
  return last;
}

// What an account holds in `currency` (the main one when left out): the balance typed into the
// editor while it is still about the last row in that currency (`balanceTxId`), else the balance
// that row shows. A newer row brings the statement's figure back. Null when neither is known.
export function accountBalance(bank, transactions, currency = bank.currency || "JPY") {
  const typed = currency === (bank.currency || "JPY") ? bank : (bank.balances || []).find((b) => b.currency === currency) || {};
  const last = lastBalanceRow(transactions, bank, currency);
  if (typed.balance != null && (typed.balanceTxId ?? null) === (last?.id ?? null)) return typed.balance;
  return last ? last.balance : null;
}

// Every currency the account holds with its balance, the main one first.
export function accountBalances(bank, transactions) {
  const currencies = [bank.currency || "JPY", ...(bank.balances || []).map((b) => b.currency)];
  return currencies.map((currency) => ({ currency, balance: accountBalance(bank, transactions, currency) }));
}

const pad2 = (n) => String(n).padStart(2, "0");

// A local calendar date as YYYY-MM-DD, the way every date in the ledger is written.
export function isoDate(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const currentMonth = () => isoDate().slice(0, 7);

// The months a list of rows falls in, newest first, under an entry for all of them at once, with
// the rows that carry no date as a last entry. An empty list offers the current month so the
// picker always has a month to show.
function monthsOf(transactions) {
  const keys = new Set(transactions.map(monthOf));
  const undated = keys.delete(UNDATED);
  const list = [...keys].sort((a, b) => (a > b ? -1 : 1)).map((key) => ({ key }));
  if (!list.length) list.push({ key: currentMonth() });
  if (undated) list.push({ key: UNDATED });
  return [{ key: ALL }, ...list];
}

// How the ledger writes a month wherever it names one: "2026-10" as "2026 - 10", the two entries
// that are not months by their names.
export function monthLabel(key, t) {
  if (key === ALL) return t("ledger.allMonths");
  if (key === UNDATED) return t("ledger.undated");
  return key.replace("-", " - ");
}

// What the ledger shows for a chosen account and month: the months the account's rows (or every
// row, with no account chosen) fall in, which of them is on screen, and its rows. The month on
// screen is the chosen one, or the newest when none is chosen yet or the chosen one has no rows
// in this account; "all" is every row the account has.
export function ledgerView(transactions, bankId, month) {
  const scoped = bankId ? transactions.filter((tx) => tx.bankId === bankId) : transactions;
  const months = monthsOf(scoped);
  const found = months.findIndex((m) => m.key === month);
  const index = found >= 0 ? found : months.findIndex((m) => m.key !== ALL);
  const current = months[index].key;
  const rows = current === ALL ? scoped : scoped.filter((tx) => monthOf(tx) === current);
  return { months, index, current, rows };
}
