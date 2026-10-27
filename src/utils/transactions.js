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
// the newest date, and on that day the row no other row of the day follows. Banks print a day's
// rows oldest first or newest first, so file order cannot tell; the balances can: a row starts
// from its balance plus what went out less what came in, and the last row's balance is where no
// other row starts. When the balances don't single one out, the row imported last. Null when
// there is none.
export function lastBalanceRow(transactions, bank, currency = bank.currency || "JPY") {
  const counts = inCurrency(bank, currency);
  let day = [];
  for (const tx of transactions) {
    if (tx.bankId !== bank.id || !tx.date || tx.balance == null || !counts(tx)) continue;
    if (!day.length || tx.date > day[0].date) day = [tx];
    else if (tx.date === day[0].date) day.push(tx);
  }
  if (!day.length) return null;
  const before = (tx) => Number(tx.balance) + (Number(tx.withdrawal) || 0) - (Number(tx.deposit) || 0);
  const ends = day.filter((tx) => !day.some((o) => o !== tx && before(o) === Number(tx.balance)));
  return ends.length === 1 ? ends[0] : day[day.length - 1];
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

// A date as every date in the app is written, YYYY-MM-DD with a two-digit month and day: the
// model sometimes copies a statement's "2026/6/9" as "2026-6-9", which sorts after "2026-10-1" and
// files under a month of its own. "2026-6-9", "2026/6/9", "2026.6.9" and "2026年6月9日" all become
// "2026-06-09"; anything else comes back as it was.
export function normDate(value) {
  const m = /^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?\s*$/.exec(value ?? "");
  return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : value;
}

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

// How the ledger writes a month wherever it names one: "2026-10" as its key, the two entries
// that are not months by their names.
export function monthLabel(key, t) {
  if (key === ALL) return t("ledger.allMonths");
  if (key === UNDATED) return t("ledger.undated");
  return key;
}

// Which side of the account a row is on: money out, or money in (a row with no amount counts as in).
const isWithdrawal = (tx) => Boolean(tx.withdrawal);

// The ledger's filter with nothing hidden: money in, money out, any amount.
export const NO_FILTER = { deposit: true, withdrawal: true, minAmount: 0 };

// The amounts the ledger's filter offers: every row, or only those over 1,000, 10,000 or 100,000.
export const MIN_AMOUNTS = [0, 1000, 10000, 100000];

// How the filter writes an amount: "> 1K" and so on, the same in every language.
export const minAmountLabel = (n) => `> ${n / 1000}K`;

// Whether a row passes the ledger's filter: on a side it shows, and over its amount if it has one.
function passes(tx, filter) {
  if (!(isWithdrawal(tx) ? filter.withdrawal : filter.deposit)) return false;
  const amount = Number(tx.withdrawal || tx.deposit || 0);
  return !filter.minAmount || amount > filter.minAmount;
}

// What the ledger shows for a chosen account and month: the months the account's rows (or every
// row, with no account chosen) fall in, which of them is on screen, and its rows. The month on
// screen is the chosen one, or the newest when none is chosen yet or the chosen one has no rows
// in this account; "all" is every row the account has. `filter` narrows the rows to money in
// (`deposit`), money out (`withdrawal`) or both, and to amounts over `minAmount`; the months
// offered stay the same either way, and `inMonth` keeps the month's rows before that.
export function ledgerView(transactions, bankId, month, filter = NO_FILTER) {
  const scoped = bankId ? transactions.filter((tx) => tx.bankId === bankId) : transactions;
  const months = monthsOf(scoped);
  const found = months.findIndex((m) => m.key === month);
  const index = found >= 0 ? found : months.findIndex((m) => m.key !== ALL);
  const current = months[index].key;
  const inMonth = current === ALL ? scoped : scoped.filter((tx) => monthOf(tx) === current);
  const rows = inMonth.filter((tx) => passes(tx, filter));
  return { months, index, current, rows, inMonth };
}
