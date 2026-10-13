// An Excel statement (.xlsx or .xls) as CSV text, one string per sheet, so it is cut into parts
// and read by the model exactly like the bank's CSV export.

import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { decodeCsv } from "./csv.js";

// The ESM build leaves out the code page tables; without them a .xls written in Shift_JIS comes
// out garbled.
XLSX.set_cptable(cptable);

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLS_TYPE = "application/vnd.ms-excel";
export const EXCEL_TYPES = new Set([XLSX_TYPE, XLS_TYPE]);

const pad = (n) => String(n).padStart(2, "0");

// A cell as the model should see it: a date as YYYY-MM-DD (the time after it only when there is
// one), a number as a plain number, text as it is. Formatting (thousands separators, ¥, △ for a
// minus) is the cell's style, not its value, so none of it gets in the way.
function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const date = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const h = v.getHours();
    const m = v.getMinutes();
    const s = v.getSeconds();
    return h || m || s ? `${date} ${pad(h)}:${pad(m)}:${pad(s)}` : date;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v);
}

function csvField(text) {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const READ_OPTIONS = { cellDates: true, cellText: false, cellHTML: false };

// A real workbook is a ZIP (.xlsx) or a compound file (.xls); both start with a signature.
function isWorkbookContainer(buf) {
  return (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf);
}

// The workbook's visible sheets that hold anything, each as CSV text. Throws when the file is not
// a spreadsheet at all (or is encrypted), and when no sheet holds a row.
export function excelToCsv(buf) {
  let wb;
  try {
    if (isWorkbookContainer(buf)) {
      wb = XLSX.read(buf, { type: "buffer", ...READ_OPTIONS });
    } else {
      // Some banks' "Excel" downloads are an HTML table or CSV text under an .xls name, in
      // Shift_JIS as often as not: decoded the way a CSV is, then read as text, every cell kept
      // as written (`raw`) for the model to make out, as it does with a CSV. Anything else would
      // be read as text too, and sent to the model as noise, so it is turned away.
      const text = decodeCsv(buf);
      if (text.includes("\0")) throw new Error("not an Excel workbook");
      wb = XLSX.read(text, { type: "string", raw: true, ...READ_OPTIONS });
    }
  } catch (err) {
    throw new Error(`Could not read the spreadsheet: ${err.message}`);
  }
  const hidden = (i) => Boolean(wb.Workbook?.Sheets?.[i]?.Hidden);
  const texts = [];
  wb.SheetNames.forEach((name, i) => {
    const sheet = wb.Sheets[name];
    if (hidden(i) || !sheet?.["!ref"]) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
    const lines = [];
    for (const row of rows) {
      const fields = Array.from(row, cellText);
      if (fields.some((f) => f !== "")) lines.push(fields.map(csvField).join(","));
    }
    if (lines.length) texts.push(lines.join("\n"));
  });
  if (!texts.length) throw new Error("The spreadsheet has no rows");
  return texts;
}
