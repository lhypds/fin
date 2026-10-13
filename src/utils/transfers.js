import { amountGap } from "./matching";

// A transfer between two of the accounts shows up twice: money out of one account on a day, and
// the same money into another on the same day. The sender's row may be larger by the transfer
// fee, which some banks fold into the withdrawal.

const money = (v) => (v ? Number(v) : 0);
const sameCurrency = (a, b) => (a.currency || "JPY").toUpperCase() === (b.currency || "JPY").toUpperCase();

// Whether `from` (money out of one account) and `to` (money into another) are the two sides of
// one transfer: "exact" when the amounts agree, "fee" when the sender's is larger by a fee, null
// when they are not a pair.
function transferGap(from, to) {
  if (!from.date || from.date !== to.date) return null;
  if (!from.bankId || !to.bankId || from.bankId === to.bankId) return null;
  if (!sameCurrency(from, to)) return null;
  const sent = money(from.withdrawal);
  const got = money(to.deposit);
  if (!sent || !got || got > sent) return null;
  return amountGap(sent, got, from.currency);
}

// The internal transfers among `rows` (what the ledger shows), with the other side looked for in
// all `transactions`, since it is in another account and may be off screen. Each is { from, to }:
// the row the money left and the row it reached. A row is in one pair at most, and an exact
// amount is taken before a fee-sized gap.
export function findInternalTransfers(rows, transactions) {
  const byDate = new Map();
  for (const t of transactions) {
    if (!t.date) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  const used = new Set();
  const pairs = [];
  for (const row of rows) {
    if (used.has(row.id)) continue;
    const outgoing = money(row.withdrawal) > 0;
    const candidates = (byDate.get(row.date) || [])
      .filter((t) => t.id !== row.id && !used.has(t.id))
      .map((t) => {
        const [from, to] = outgoing ? [row, t] : [t, row];
        return { from, to, gap: transferGap(from, to) };
      })
      .filter((c) => c.gap)
      .sort((a, b) => (a.gap === "exact" ? 0 : 1) - (b.gap === "exact" ? 0 : 1));
    if (!candidates.length) continue;
    const { from, to } = candidates[0];
    used.add(from.id);
    used.add(to.id);
    pairs.push({ from, to });
  }
  return pairs;
}
