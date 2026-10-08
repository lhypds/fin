import { txAmount, txDirection } from "./format";

// Corporate suffixes and passbook abbreviations that add noise to name comparison.
const NOISE = [
  /株式会社|有限会社|合同会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|カ\)|カ）|ユ\)|ユ）|ｶ\)|ｶ）/g,
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

export function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86400000));
}

function dateScore(diff) {
  if (diff == null) return 0.3;
  if (diff === 0) return 1;
  if (diff === 1) return 0.9;
  if (diff <= 3) return 0.8;
  if (diff <= 7) return 0.6;
  if (diff <= 14) return 0.4;
  if (diff <= 31) return 0.25;
  return null;
}

export const DEFAULT_OPTIONS = { maxDays: 31, threshold: 0.4 };

// Returns a 0..1 confidence, or null when the pair cannot be a match.
export function scoreMatch(tx, receipt, options = DEFAULT_OPTIONS) {
  const ocr = receipt?.ocr;
  if (!ocr || ocr.total == null) return null;
  const amount = txAmount(tx);
  if (!amount) return null;
  if (Math.round(Math.abs(Number(ocr.total))) !== Math.round(Math.abs(amount))) return null;

  const diff = daysBetween(tx.date, ocr.date);
  if (diff != null && diff > options.maxDays) return null;
  const ds = dateScore(diff);
  if (ds == null) return null;

  const ns = nameSimilarity(ocr.vendor, tx.description);

  let score = 0.7 * ds + 0.3 * ns;
  const dir = txDirection(tx);
  if (ocr.direction && ocr.direction !== "unknown" && dir !== "unknown" && ocr.direction !== dir) {
    score *= 0.6;
  }
  return Math.min(1, Math.max(0, score));
}

// Greedy 1:1 assignment, best scores first. Ambiguous pairs get a confidence haircut.
export function autoMatch(transactions, receipts, options = DEFAULT_OPTIONS) {
  const openTx = transactions.filter((t) => !t.receiptIds?.length);
  const openRc = receipts.filter((r) => !r.txId && r.status === "done" && r.ocr);

  const candidates = [];
  for (const r of openRc) {
    for (const t of openTx) {
      const score = scoreMatch(t, r, options);
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
