const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"]);

const formatters = new Map();

export function fmtMoney(value, currency = "JPY") {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "";
  const code = (currency || "JPY").toUpperCase();
  const key = code;
  let f = formatters.get(key);
  if (!f) {
    const digits = ZERO_DECIMAL.has(code) ? 0 : 2;
    try {
      f = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formatters.set(key, f);
  }
  return f.format(Number(value));
}

export function fmtNumber(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value));
}

export function fmtDate(iso) {
  if (!iso) return "";
  return iso;
}

export function txAmount(tx) {
  if (!tx) return 0;
  if (tx.withdrawal) return Number(tx.withdrawal);
  if (tx.deposit) return Number(tx.deposit);
  return 0;
}

export function txDirection(tx) {
  if (tx?.withdrawal) return "expense";
  if (tx?.deposit) return "income";
  return "unknown";
}

export function toNumberOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[,\s¥$€£]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function confidenceLevel(c) {
  if (c == null) return "manual";
  if (c >= 0.7) return "high";
  if (c >= 0.45) return "medium";
  return "low";
}
