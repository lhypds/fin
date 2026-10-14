// The ledger's rows as a file to download: an Excel workbook (.xlsx) or a CSV. One sheet, one
// header line, one line per row with its memo, oldest first as a statement is printed; rows
// without a date come last. The workbook keeps dates and amounts as dates and numbers; the CSV
// opens with a UTF-8 BOM so Excel reads it as UTF-8 rather than Shift_JIS.

import { CSV_TYPE, XLSX_TYPE } from "./files";

// The columns, in order; the caller names them in the header.
export const EXPORT_COLUMNS = ["date", "bank", "description", "withdrawal", "deposit", "balance", "currency", "memo"];

export const EXPORT_FORMATS = ["xlsx", "csv"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// An amount of zero means "none on this side" (the ledger shows nothing for it), so the cell is empty.
const amount = (v) => (Number(v) ? Number(v) : null);

function cellsOf(tx) {
  return [
    tx.date || "",
    tx.bank || "",
    tx.description || "",
    amount(tx.withdrawal),
    amount(tx.deposit),
    tx.balance == null || tx.balance === "" ? null : Number(tx.balance),
    tx.currency || "",
    tx.memo || "",
  ];
}

// Oldest first; rows on the same day keep the order they were imported in (the statement's own).
// The sort is stable, so the index is not needed as a tie-break.
function chronological(rows) {
  const key = (tx) => tx.date || "~"; // "~" sorts after every digit, so undated rows go last
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// The table the file is made of: the header as given, then the rows' cells, a string or a number
// each (null for an empty cell).
export function ledgerTable(rows, header) {
  return { header, rows: chronological(rows).map(cellsOf) };
}

function csvField(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CRLF line ends, as RFC 4180 has it and Excel expects; the BOM up front says UTF-8.
export function toCsv(table) {
  const lines = [table.header, ...table.rows].map((cells) => cells.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// A workbook with the table on one sheet. The library is a megabyte, loaded the first time it is
// needed and not before. Dates are written as dates shown as YYYY-MM-DD, as the ledger writes them.
export async function toXlsx(table, sheetName) {
  const XLSX = await import("xlsx");
  const dateCol = EXPORT_COLUMNS.indexOf("date");
  const rows = table.rows.map((cells) =>
    cells.map((v, i) => {
      if (i !== dateCol || !DATE_RE.test(v)) return v;
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet([table.header, ...rows], { dateNF: "yyyy-mm-dd" });
  ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

// A sheet's name as Excel allows it: none of []:*?/\ and at most 31 characters.
export const sheetNameOf = (name) => (name || "Sheet1").replace(/[[\]:*?/\\]/g, "-").slice(0, 31);

// A file's name as every file system allows it.
export const fileNameOf = (name) => name.replace(/[\\/:*?"<>|]/g, "-").trim();

// Hands the browser a file to save.
export function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked once the download has had time to start; some browsers drop it if the URL goes at once.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Builds the file in `format` ("xlsx" or "csv") and hands it to the browser. `header` names the
// columns in EXPORT_COLUMNS order; `name` is the file's name without its extension, and the
// sheet's name in a workbook.
export async function exportLedger({ rows, format, header, name }) {
  const table = ledgerTable(rows, header);
  const blob =
    format === "csv"
      ? new Blob([toCsv(table)], { type: `${CSV_TYPE};charset=utf-8` })
      : new Blob([await toXlsx(table, sheetNameOf(name))], { type: XLSX_TYPE });
  download(blob, `${fileNameOf(name)}.${format}`);
}
