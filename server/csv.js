// A CSV statement as text, cut into parts small enough for the model to read without losing rows.

// Japanese banks export in Shift_JIS or UTF-8 (sometimes with a BOM); Excel's "Unicode text" is
// UTF-16. UTF-8 is tried strictly first, so Shift_JIS bytes are never mistaken for it.
export function decodeCsv(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    /* not UTF-8 */
  }
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

// The file's records, each as written: a line break inside quotes does not end a record. Blank
// lines are dropped.
export function splitRecords(text) {
  const out = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) {
      out.push(text.slice(start, i));
      if (c === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.filter((line) => line.trim() !== "");
}

const HEADER_WORDS = [
  /日付|取引日|年月日|取扱日|利用日|date/i,
  /摘要|内容|description|detail/i,
  /金額|入金|出金|預|支払|引出|引落|amount|deposit|withdraw|credit|debit/i,
  /残高|balance/i,
];
const DATE_RE = /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/;

// The header's index among the first records: the first line naming at least two of the usual
// columns and carrying no date. Some exports open with the account details, so it is not always
// the first line. Falls back to the first line.
export function findHeader(records) {
  for (let i = 0; i < Math.min(records.length, 20); i++) {
    const line = records[i].normalize("NFKC");
    const hits = HEADER_WORDS.filter((re) => re.test(line)).length;
    if (hits >= 2 && !DATE_RE.test(line)) return i;
  }
  return 0;
}

// The statement in parts of at most `maxRows` data rows. A short file is one part, as it is. Every
// later part repeats the header line so the model knows the columns; the first part also keeps
// whatever came before the header, which may name the bank.
export function statementParts(text, maxRows = 100) {
  const records = splitRecords(text);
  const h = findHeader(records);
  const data = records.slice(h + 1);
  if (data.length <= maxRows) return [records.join("\n")];
  const parts = [];
  for (let i = 0; i < data.length; i += maxRows) {
    const prefix = i === 0 ? records.slice(0, h + 1) : [records[h]];
    parts.push([...prefix, ...data.slice(i, i + maxRows)].join("\n"));
  }
  return parts;
}
