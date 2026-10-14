// Memos for ledger rows, written by the model. Each row's date, description and amount go to the
// model with the account's details, the person's own instructions and, when one is given, a
// reference file (past rows with the memos a person wrote for them, as CSV or Excel); a short
// memo per row comes back. Runs on the server, next to the OCR, with the same API and model.

import fsp from "node:fs/promises";
import { callModel, httpError } from "./ocr.js";
import { decodeCsv } from "./csv.js";
import { EXCEL_TYPES, excelToCsv } from "./excel.js";

// Rows per model call; shorter parts are answered more faithfully than one long list.
const MEMO_PART_ROWS = 60;
// How much of the reference file goes along with every call.
const MAX_REFERENCE_CHARS = 60000;

const MEMO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The row's id, exactly as given" },
          memo: { type: "string", description: "The memo for the row, one short line; an empty string when there is nothing to say" },
        },
        required: ["id", "memo"],
      },
    },
  },
  required: ["memos"],
};

// What the model is told before the person's own instructions, which come last and win.
const FRAMING = `You write the memo (備考 / 摘要メモ) for rows of a bank account's ledger, as a bookkeeper would: one short line per row saying what the row is for or who the counterparty is, in the language the rows are written in.
You are given the account, the rows as CSV (id, date, description 摘要, withdrawal, deposit, currency), and sometimes reference material: past rows with the memos a person wrote for them. When the reference has a row with the same or a similar description, follow the memo written there, wording included. Leave the memo empty when there is nothing sensible to say; never guess a counterparty the description does not support.
Return exactly one entry per row id given, with the id unchanged, and no other entries.
Instructions from the person, which take precedence where they differ:
`;

function csvField(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The rows of one part as CSV, numbered 1.. within the part: short ids the model copies back
// reliably, mapped back to the rows afterwards.
function rowsCsv(rows) {
  const lines = ["id,date,description,withdrawal,deposit,currency"];
  rows.forEach((r, i) => lines.push([i + 1, r.date, r.description, r.withdrawal || "", r.deposit || "", r.currency].map(csvField).join(",")));
  return lines.join("\n");
}

function accountText(bank) {
  const parts = bank
    ? [
        bank.name && `bank ${bank.name}`,
        bank.branch && `branch ${bank.branch}`,
        bank.accountType && `type ${bank.accountType}`,
        bank.accountNumber && `number ${bank.accountNumber}`,
        bank.holder && `holder ${bank.holder}`,
        bank.currency && `currency ${bank.currency}`,
        bank.memo && `note: ${bank.memo}`,
      ].filter(Boolean)
    : [];
  return `Account: ${parts.join(", ") || "not specified"}.`;
}

// The reference file as text: a CSV as it is, a workbook sheet by sheet, cut to size.
async function referenceText(filePath, type) {
  const buf = await fsp.readFile(filePath);
  let text;
  if (EXCEL_TYPES.has(type)) {
    try {
      text = excelToCsv(buf).join("\n\n");
    } catch (err) {
      throw httpError(422, err.message);
    }
  } else {
    text = decodeCsv(buf);
  }
  return text.length > MAX_REFERENCE_CHARS ? `${text.slice(0, MAX_REFERENCE_CHARS)}\n… (the rest of the file is left out)` : text;
}

// Resolves to { memos: [{ id, memo }] } for the rows the model answered about, in the rows'
// ids; a row it left empty is left out.
export async function generateMemos({ prompt, bank, rows, referencePath, referenceType, apiKey, baseUrl, model }) {
  if (!apiKey) {
    throw httpError(500, "OPENAI_API_KEY is not set. Put it in .env, then restart the server (./restart.sh or npm run dev).");
  }
  const spec = { instructions: FRAMING + (prompt || ""), schema: MEMO_SCHEMA, schemaName: "memos" };
  const reference = referencePath ? await referenceText(referencePath, referenceType) : null;
  const memos = [];
  for (let i = 0; i < rows.length; i += MEMO_PART_ROWS) {
    const part = rows.slice(i, i + MEMO_PART_ROWS);
    const content = [{ type: "input_text", text: accountText(bank) }];
    if (reference) content.push({ type: "input_text", text: `Reference material, past rows with their memos:\n${reference}` });
    content.push({ type: "input_text", text: `Write the memo for each of these rows:\n${rowsCsv(part)}` });
    const result = await callModel({ spec, content, apiKey, baseUrl, model });
    for (const m of result.memos || []) {
      const row = part[Number(m.id) - 1];
      const memo = typeof m.memo === "string" ? m.memo.trim() : "";
      if (row && memo) memos.push({ id: row.id, memo });
    }
  }
  return { memos };
}
