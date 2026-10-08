import { txAmount, txDirection } from "./format";

// Corporate suffixes and passbook abbreviations that add noise to name comparison. "(カ" is the
// truncated "(カ)" a statement prints after a company name (NFKC has already folded ｶ and （).
const NOISE = [
  /株式会社|有限会社|合同会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|カ\)|カ）|ユ\)|ユ）|ｶ\)|ｶ）|\(カ(?=\s|$)/g,
  /co\.?,?\s*ltd\.?|inc\.?|corp\.?|llc|k\.k\.|company|limited/g,
  /振込|振替|カード|ｶｰﾄﾞ|デビット|ﾃﾞﾋﾞｯﾄ|引落|ｲﾝﾀｰﾈｯﾄ|インターネット/g,
];

export function normalizeText(s) {
  if (!s) return "";
  let t = String(s).normalize("NFKC").toLowerCase();
  for (const re of NOISE) t = t.replace(re, " ");
  // Katakana → Hiragana so カタカナ names compare equal to ひらがな ones.
  t = t.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  t = t.replace(/[^\p{L}\p{N}]+/gu, "");
  return t;
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

export function nameSimilarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.9;
  const bx = bigrams(x);
  const by = bigrams(y);
  if (!bx.size || !by.size) return 0;
  let inter = 0;
  for (const g of bx) if (by.has(g)) inter++;
  return (2 * inter) / (bx.size + by.size);
}

// Statements print payee names in katakana (エイタイトウシコウ) while receipts carry the kanji
// (栄泰投資控股), so the vendor as printed rarely matches. The OCR's katakana reading of the
// vendor and the one-line summary are tried as well; the best of them counts.
function receiptNameScore(tx, receipt) {
  const ocr = receipt.ocr || {};
  let best = 0;
  for (const name of [ocr.vendor, ocr.vendorKana, ocr.summary]) {
    if (name) best = Math.max(best, nameSimilarity(name, tx.description));
  }
  return best;
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86400000));
}

const pad2 = (n) => String(n).padStart(2, "0");
const validMonthDay = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

// Dates written into a file name or an item label: 2026-09-14, 2026/9/14, 20260914, 2026年9月14日.
const FULL_DATE_RE = /(20\d{2})(?:[-/.年]\s?)?(\d{1,2})(?:[-/.月]\s?)?(\d{1,2})日?(?!\d)/g;
// A file name that starts with MMDD ("0910-171600-…") names the payment day without a year.
const LEADING_MMDD_RE = /^(\d{2})(\d{2})(?!\d)/;

function fullDatesIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(FULL_DATE_RE)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (validMonthDay(month, day)) out.push(`${m[1]}-${pad2(month)}-${pad2(day)}`);
  }
  return out;
}

function stripExtension(name) {
  return String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "");
}

// A month and day without a year get the year that puts them closest to `anchor` (an ISO date).
function nearestYear(month, day, anchor) {
  const year = Number(anchor.slice(0, 4));
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const iso = `${y}-${pad2(month)}-${pad2(day)}`;
    const diff = daysBetween(anchor, iso);
    if (diff != null && (best == null || diff < best.diff)) best = { iso, diff };
  }
  return best?.iso || null;
}

// Every date the receipt offers: the OCR date, dates in the file name and in item labels, and a
// leading MMDD in the file name. The MMDD takes its year from the OCR date, or failing that from
// the upload time, both of which sit within months of the payment; the transaction's own year
// would make a row from the year before look like a same-week match.
function receiptDates(receipt) {
  const ocr = receipt.ocr || {};
  const name = stripExtension(receipt.name).normalize("NFKC");
  const dates = [];
  if (ocr.date) dates.push(ocr.date);
  dates.push(...fullDatesIn(name));
  for (const it of ocr.items || []) dates.push(...fullDatesIn(it?.name));
  const lead = LEADING_MMDD_RE.exec(name);
  if (lead && validMonthDay(Number(lead[1]), Number(lead[2]))) {
    const anchor = ocr.date || (receipt.createdAt ? new Date(receipt.createdAt).toISOString().slice(0, 10) : null);
    const iso = anchor && nearestYear(Number(lead[1]), Number(lead[2]), anchor);
    if (iso) dates.push(iso);
  }
  return dates;
}

// Days from the closest date the receipt offers to the transaction: positive when the payment came
// after the document, negative when before. null if neither side has a date.
function bestDateDiff(tx, receipt) {
  if (!tx.date) return null;
  const txTime = Date.parse(tx.date);
  if (Number.isNaN(txTime)) return null;
  let best = null;
  for (const d of receiptDates(receipt)) {
    const time = Date.parse(d);
    if (Number.isNaN(time)) continue;
    const signed = Math.round((txTime - time) / 86400000);
    if (best == null || Math.abs(signed) < Math.abs(best)) best = signed;
  }
  return best;
}

// The date never rules a pair out, it only sets the confidence. A payment long after its document
// is normal (an invoice, 請求書, settled months later), so the score floors at 0.15, where an exact
// amount on its own still just clears the auto-match threshold. No date at all counts like a
// distant one.
function dateScore(diff) {
  if (diff == null) return 0.2;
  if (diff === 0) return 1;
  if (diff === 1) return 0.95;
  if (diff <= 3) return 0.85;
  if (diff <= 7) return 0.7;
  if (diff <= 14) return 0.5;
  if (diff <= 31) return 0.3;
  if (diff <= 60) return 0.2;
  return 0.15;
}

// Domestic transfer fees in Japan run 110..880 yen. A gap of that size between a receipt and a
// statement row is the fee sitting on one side only: a transfer slip prints 振込金額 + 手数料 as
// its total, and some banks (Mizuho) fold the fee into the withdrawal on the statement.
const FEE_RANGE = { JPY: [100, 880], KRW: [100, 1100] };
const FEE_RANGE_DEFAULT = [0.5, 10];

// "exact" when the two amounts agree, "fee" when they differ by a transfer fee, null otherwise.
export function amountGap(a, b, currency = "JPY") {
  if (a == null || b == null) return null;
  const x = Math.round(Math.abs(Number(a)));
  const y = Math.round(Math.abs(Number(b)));
  if (!x || !y || Number.isNaN(x) || Number.isNaN(y)) return null;
  const diff = Math.abs(x - y);
  if (diff === 0) return "exact";
  const [min, max] = FEE_RANGE[(currency || "JPY").toUpperCase()] || FEE_RANGE_DEFAULT;
  if (diff >= min && diff <= max && diff <= 0.2 * Math.max(x, y)) return "fee";
  return null;
}

// Amounts written into a file name: "0910-171600-雅山.pdf" → 171600, "收款700万" → 7000000. The
// leading MMDD token, full dates and years ("2026年6月期", "2026-08") are dates, not amounts.
function fileNameAmounts(name) {
  let text = stripExtension(name).normalize("NFKC");
  text = text
    .replace(LEADING_MMDD_RE, " ")
    .replace(FULL_DATE_RE, " ")
    .replace(/(?:19|20)\d{2}(?=\s*年|[-/.]\d)/g, " ");
  const out = new Set();
  text = text.replace(/(\d+(?:\.\d+)?)\s*万/g, (_, n) => {
    out.add(Math.round(Number(n) * 10000));
    return " ";
  });
  for (const m of text.matchAll(/\d{3,}/g)) out.add(Number(m[0]));
  return [...out].filter((n) => n > 0);
}

// Line items whose label names a payment rather than goods: a slip's 振込金額, the 入金 / 出金 rows
// of a statement used as a receipt. Only these are amounts a bank row could carry.
const PAYMENT_ITEM_RE = /振込|振替|入金|出金|引出|預入|支払|金額|amount|transfer|deposit|withdraw/i;

// Every amount the receipt could stand for, each with how much a hit on it is worth. The OCR total
// comes first; the total without its fee, payment-like line items and amounts in the file name are
// a little less certain.
function receiptAmounts(receipt) {
  const ocr = receipt.ocr || {};
  const out = [];
  const total = ocr.total == null ? null : Number(ocr.total);
  if (total) out.push({ value: total, weight: 1 });
  if (total && ocr.fee) out.push({ value: total - Number(ocr.fee), weight: 1 });
  for (const it of ocr.items || []) {
    const v = Number(it?.amount);
    if (v && PAYMENT_ITEM_RE.test(it.name || "") && !/手数料/.test(it.name || "")) out.push({ value: v, weight: 0.9 });
  }
  for (const v of fileNameAmounts(receipt.name)) out.push({ value: v, weight: 0.95 });
  return out;
}

// How well the receipt's amounts fit the transaction: { score: 0..1, gap: "exact" | "fee" }, or
// null when none of them does.
function amountScore(amount, receipt, currency) {
  let best = null;
  for (const { value, weight } of receiptAmounts(receipt)) {
    const gap = amountGap(amount, value, currency);
    if (!gap) continue;
    const score = weight * (gap === "exact" ? 1 : 0.85);
    if (best == null || score > best.score) best = { score, gap };
  }
  return best;
}

// Bank fees, interest and carry-over rows: a receipt rarely documents these, so a same-amount
// receipt landing on one is more likely a coincidence.
const BANK_ROW_RE = /手数料|利息|繰越|^INT$/i;

export const DEFAULT_OPTIONS = { threshold: 0.4 };

// A document dated this long after the payment is not how receipts work. Beyond it the whole score
// is cut so the pair can never be attached unasked, whatever the name says: a company moving the
// same 50,000,000 between its own accounts every few months would otherwise see a September slip
// land on last November's row, since the names agree on both.
const LATE_DOCUMENT_DAYS = 45;

// Returns a 0..1 confidence, or null when the pair cannot be a match. Only the amount can rule a
// pair out; date, name and direction set how sure the match is, and the threshold in autoMatch
// decides which of them are attached without being asked.
export function scoreMatch(tx, receipt) {
  if (!receipt?.ocr) return null;
  const amount = txAmount(tx);
  if (!amount) return null;
  const as = amountScore(amount, receipt, tx.currency || receipt.ocr.currency);
  if (as == null) return null;

  const signed = bestDateDiff(tx, receipt);
  const ds = dateScore(signed == null ? null : Math.abs(signed));
  const ns = receiptNameScore(tx, receipt);

  // An exact amount on the same day scores 0.8 without any name evidence, a month apart about 0.5,
  // months apart about 0.42. A fee-sized gap (0.85) or an opposite direction (0.9) on top of a far
  // date drops below the threshold: those pairs stay suggestions in the picker.
  let score = as.score * (0.35 + 0.45 * ds + 0.2 * ns);

  // A payer's transfer slip (expense) legitimately matches the deposit it caused on the receiving
  // account's statement, and the OCR often guesses the perspective wrong, so this is only a nudge.
  const dir = txDirection(tx);
  const rdir = receipt.ocr.direction;
  if (rdir && rdir !== "unknown" && dir !== "unknown" && rdir !== dir) score *= 0.9;
  if (BANK_ROW_RE.test(tx.description || "")) score *= 0.7;
  // 0.6 keeps even a perfect name on an exact amount (0.6175) under the threshold.
  if (signed != null && signed < -LATE_DOCUMENT_DAYS) score *= 0.6;
  return Math.min(1, Math.max(0, score));
}

// Greedy 1:1 assignment, best scores first. Ambiguous pairs get a confidence haircut.
export function autoMatch(transactions, receipts, options = DEFAULT_OPTIONS) {
  const openTx = transactions.filter((t) => !t.receiptIds?.length);
  const openRc = receipts.filter((r) => !r.txId && r.status === "done" && r.ocr);

  const candidates = [];
  for (const r of openRc) {
    for (const t of openTx) {
      const score = scoreMatch(t, r);
      if (score != null && score >= options.threshold) candidates.push({ txId: t.id, receiptId: r.id, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Count competing candidates so a receipt that fits several rows is flagged as less certain.
  const perReceipt = new Map();
  const perTx = new Map();
  for (const c of candidates) {
    perReceipt.set(c.receiptId, (perReceipt.get(c.receiptId) || 0) + 1);
    perTx.set(c.txId, (perTx.get(c.txId) || 0) + 1);
  }

  const usedTx = new Set();
  const usedRc = new Set();
  const result = [];
  for (const c of candidates) {
    if (usedTx.has(c.txId) || usedRc.has(c.receiptId)) continue;
    usedTx.add(c.txId);
    usedRc.add(c.receiptId);
    const ambiguous = perReceipt.get(c.receiptId) > 1 || perTx.get(c.txId) > 1;
    result.push({ txId: c.txId, receiptId: c.receiptId, confidence: ambiguous ? c.score * 0.85 : c.score });
  }
  return result;
}
