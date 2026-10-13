// Reading files through the OpenAI Responses API with Structured Outputs: CSV and Excel bank
// statements into ledger rows, passbook photos and PDFs into the account's details, receipts into
// their fields. Runs on the server so the file never leaves data/ except to go to OpenAI.

import fsp from "node:fs/promises";
import sharp from "sharp";
import { decodeCsv, statementParts } from "./csv.js";
import { EXCEL_TYPES, excelToCsv } from "./excel.js";

export const DEFAULT_MODEL = "gpt-5.4-mini";
export const CSV_TYPE = "text/csv";
// What rows are read from: the bank's CSV export, or the same as an Excel workbook.
export const SPREADSHEET_TYPES = new Set([CSV_TYPE, ...EXCEL_TYPES]);
const MAX_IMAGE_DIM = 2048;
// Rows of a statement per model call. Shorter parts are read more faithfully than one long file.
const STATEMENT_PART_ROWS = 100;

const STATEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bank: {
      type: ["string", "null"],
      description:
        "The bank the statement belongs to, as its common short name without 株式会社 or 銀行: みずほ, 三井住友, 三菱UFJ, りそな, きらぼし, SBJ, ゆうちょ, 楽天, 住信SBI, 横浜. null if the file does not say",
    },
    currency: { type: "string", description: "ISO 4217 code of the account currency, e.g. JPY" },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"], description: "Gregorian date YYYY-MM-DD, null if unreadable" },
          description: { type: "string", description: "Payee / memo exactly as written (摘要)" },
          withdrawal: { type: ["number", "null"], description: "Money out (お支払金額 / 出金), positive number or null" },
          deposit: { type: ["number", "null"], description: "Money in (お預り金額 / 入金), positive number or null" },
          balance: { type: ["number", "null"], description: "Balance after the row (残高) or null" },
        },
        required: ["date", "description", "withdrawal", "deposit", "balance"],
      },
    },
    notes: { type: "string", description: "Short remarks about rows that could not be read or assumptions made, empty if none" },
  },
  required: ["bank", "currency", "transactions", "notes"],
};

// A passbook cover or account document: who the account is, and nothing of what moved on it. A
// CSV is never asked about the account: its rows are all that is wanted from it, and the details
// are typed in or read off the passbook.
const ACCOUNT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bank: STATEMENT_SCHEMA.properties.bank,
    currency: STATEMENT_SCHEMA.properties.currency,
    account: {
      type: "object",
      additionalProperties: false,
      properties: {
        branch: { type: ["string", "null"], description: "Branch name as printed (支店名), e.g. 渋谷支店; null if not shown" },
        accountType: { type: ["string", "null"], description: "Account type as printed (普通 / 当座 / 貯蓄); null if not shown" },
        accountNumber: { type: ["string", "null"], description: "Account number (口座番号), digits only; null if not shown" },
        holder: { type: ["string", "null"], description: "Account holder as printed (口座名義), e.g. カ）エイタイトウシコウコ; null if not shown" },
      },
      required: ["branch", "accountType", "accountNumber", "holder"],
    },
    notes: { type: "string", description: "Short remarks about details that could not be read, empty if none" },
  },
  required: ["bank", "currency", "account", "notes"],
};

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: ["string", "null"], description: "Store / company / counterparty name" },
    vendorKana: {
      type: ["string", "null"],
      description:
        "Katakana reading of the vendor name as a Japanese bank statement would print it, without 株式会社 etc. and without spaces, e.g. 栄泰投資控股株式会社 → エイタイトウシコウコ, 天野正康 → アマノマサヤス. null when the name has no Japanese reading",
    },
    date: { type: ["string", "null"], description: "Transaction or payment date, Gregorian YYYY-MM-DD" },
    total: { type: ["number", "null"], description: "Grand total actually paid, tax included" },
    fee: { type: ["number", "null"], description: "Transfer or handling fee (振込手数料) that is part of total, if printed separately; null otherwise" },
    currency: { type: "string", description: "ISO 4217 code, e.g. JPY" },
    tax: { type: ["number", "null"], description: "Tax amount if printed" },
    invoiceNumber: { type: ["string", "null"], description: "Invoice / receipt / registration number if printed" },
    direction: {
      type: "string",
      enum: ["expense", "income", "unknown"],
      description: "expense = the account holder paid; income = the account holder received money",
    },
    paymentMethod: { type: ["string", "null"], description: "cash, credit card, bank transfer, etc." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          amount: { type: ["number", "null"] },
        },
        required: ["name", "amount"],
      },
    },
    summary: { type: "string", description: "One line describing the document in its own language" },
  },
  required: ["vendor", "vendorKana", "date", "total", "fee", "currency", "tax", "invoiceNumber", "direction", "paymentMethod", "items", "summary"],
};

const STATEMENT_INSTRUCTIONS = `You are given a bank statement exported as CSV text (日本の銀行の入出金明細). Turn every transaction row into a record, in file order, exactly as the file has it. Do not invent, merge, reorder or omit rows.
Rules:
- bank = the institution's usual short name if the file names it (株式会社三井住友銀行 → 三井住友, みずほ銀行 → みずほ, 三菱UFJ銀行 → 三菱UFJ, きらぼし銀行 → きらぼし, SBJ銀行 → SBJ, ゆうちょ銀行 → ゆうちょ); null when the file does not say.
- currency = the ISO 4217 code of the amounts; JPY unless the file says otherwise.
- date = Gregorian YYYY-MM-DD. 2026/7/1, 2026-07-01, 20260701, 2026年7月1日 all mean 2026-07-01. Japanese era dates: Reiwa (令和, R) year N = 2018 + N, so 令和8年7月1日 and R8.7.1 mean 2026-07-01; Heisei (平成, H) year N = 1988 + N. A time after the date is ignored.
- withdrawal = money out: お支払金額 / 支払金額 / 出金 / お引出し / 引落. deposit = money in: お預り金額 / 預り金額 / 入金 / お預入れ. A single signed amount column (入出金, 金額, 取引金額): a negative number is a withdrawal, a positive one a deposit. A separate 入/出 or 入金/出金 marker column decides the side of an unsigned amount. Amounts are plain numbers: drop commas, spaces, ¥ and 円; △, ▲, a leading minus or parentheses mean negative. Never put the same number in both withdrawal and deposit.
- balance = the 残高 / 差引残高 / 取引後残高 column when there is one, else null.
- description = the 摘要 / 内容 / お取引内容 / 入出金内容 text exactly as written: keep half-width katakana, abbreviations like カ） and ATM, and spacing. When the file splits it over two columns (摘要 and 摘要内容), join them with one space.
- Skip the header line, lines before it (account number, holder, period, export date), totals, and blank lines. A row with a date but no amount (繰越) may be kept with null amounts.`;

const PASSBOOK_INSTRUCTIONS = `You are an OCR engine for the cover and header of Japanese bank passbooks (通帳) and other account documents (キャッシュカード, 口座開設の書類, 当座勘定照合表の見出し), photographed or scanned.
Read who the account is. Ignore the transaction rows entirely; they are not wanted.
Rules:
- bank = the institution's usual short name, the way people say it, 2 to 6 characters: 株式会社三井住友銀行 → 三井住友, みずほ銀行 → みずほ, 三菱UFJ銀行 → 三菱UFJ, きらぼし銀行 → きらぼし, SBJ銀行 → SBJ, ゆうちょ銀行 → ゆうちょ, 城南信用金庫 → 城南信金. Read it from the logo, header, stamp or branch line. null when no bank is identifiable.
- account.branch = the branch name as printed (支店名, e.g. 渋谷支店), without the 店番 number.
- account.accountType = 普通 / 当座 / 貯蓄 as printed.
- account.accountNumber = the 口座番号, digits only.
- account.holder = the 口座名義 exactly as printed, usually katakana (e.g. カ）エイタイトウシコウコ), without 様 or 御中.
- null for anything that is not visible. currency = JPY unless the document says otherwise.`;

const RECEIPT_INSTRUCTIONS = `You are an OCR engine for receipts, invoices, payment confirmations and bank transfer slips (レシート, 領収書, 請求書, 振込明細, PDF invoices, app screenshots).
Extract the fields precisely. Rules:
- total = the grand total that was actually paid or is payable, including tax. Prefer 合計 / お支払金額 / ご請求金額 / Total over subtotals. On a bank transfer slip total = 振込金額 + 振込手数料 when the fee is charged to the payer.
- fee = the 振込手数料 / handling fee when it is printed as its own line and included in total; null otherwise. Also list 振込金額 and 手数料 as separate items.
- date = the payment or issue date in Gregorian YYYY-MM-DD. Convert Japanese era dates (令和6年10月8日 → 2024-10-08, R6.10.8 → 2024-10-08).
- vendor = the business that issued the document (shop, company, service). For bank transfer slips use the payee.
- vendorKana = the vendor's name in katakana the way a passbook prints it (no spaces, no 株式会社 / 有限会社): 栄泰投資控股株式会社 → エイタイトウシコウコ, 天野正康 公認会計士事務所 → アマノマサヤス, スターティア株式会社 → スターティア. null for names with no Japanese reading.
- direction = "expense" when the account holder paid someone, "income" when the account holder received money (an invoice they issued, a sales receipt they wrote). Use "unknown" if unclear.
- items = line items with amounts if the document has them, otherwise an empty array. Keep it short (max 20).
- summary = one short line in the document's language, e.g. "セブンイレブン 食料品 ¥1,230".
- Numbers are plain numbers without commas or currency symbols.`;

const today = () => new Date().toISOString().slice(0, 10);

// statement: a CSV or Excel export, read into rows (and whatever it says about the account).
// passbook: a photo, scan or PDF of the passbook, read for the account's identity only.
// receipt: a receipt, invoice or slip, read into its fields.
const SPECS = {
  statement: {
    instructions: STATEMENT_INSTRUCTIONS,
    prompt: (part, parts) =>
      parts > 1
        ? `Today is ${today()}. Extract all transactions from part ${part} of ${parts} of this CSV bank statement. Its first line is the file's header; every line after it is a row of this part.`
        : `Today is ${today()}. Extract all transactions from this CSV bank statement.`,
    schema: STATEMENT_SCHEMA,
    schemaName: "statement",
  },
  passbook: {
    instructions: PASSBOOK_INSTRUCTIONS,
    prompt: () => `Read the bank and the account details from this passbook or account document.`,
    schema: ACCOUNT_SCHEMA,
    schemaName: "account",
  },
  receipt: {
    instructions: RECEIPT_INSTRUCTIONS,
    prompt: () => `Today is ${today()}. Extract the payment details from this document.`,
    schema: RECEIPT_SCHEMA,
    schemaName: "receipt",
  },
};

export const OCR_KINDS = Object.keys(SPECS);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Builds the Responses API content part for a receipt. Photos are downscaled and EXIF-rotated
// first: fewer tokens, faster, same OCR quality. PDFs go as-is (text and page images are extracted upstream).
async function buildInputPart(filePath, type, name) {
  const buf = await fsp.readFile(filePath);
  if (type === "application/pdf") {
    return { type: "input_file", filename: name, file_data: `data:application/pdf;base64,${buf.toString("base64")}` };
  }
  const png = type === "image/png";
  const pipeline = sharp(buf, { animated: false })
    .rotate()
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: "inside", withoutEnlargement: true });
  const out = png ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 92 }).toBuffer();
  return {
    type: "input_image",
    image_url: `data:${png ? "image/png" : "image/jpeg"};base64,${out.toString("base64")}`,
    detail: "high",
  };
}

function extractOutputText(data) {
  if (data?.status === "incomplete") {
    throw httpError(502, `Response incomplete (${data.incomplete_details?.reason || "unknown"})`);
  }
  const parts = [];
  for (const item of data?.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text") parts.push(c.text);
      if (c.type === "refusal") throw httpError(502, `Model refused: ${c.refusal}`);
    }
  }
  const text = parts.join("");
  if (!text) throw httpError(502, "Empty response from model");
  return text;
}

// One call: the spec's instructions and schema, the given content parts, the parsed JSON back.
async function callModel({ spec, content, apiKey, baseUrl, model }) {
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const body = {
    model,
    instructions: spec.instructions,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: spec.schemaName, strict: true, schema: spec.schema } },
  };
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning = { effort: "low" };

  let res;
  try {
    res = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw httpError(502, `Failed to reach OpenAI: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, data?.error?.message || `OpenAI API error (${res.status})`);
  const text = extractOutputText(data);
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, "Model returned invalid JSON");
  }
}

// A statement is read part by part and the parts joined: the rows in file order, the bank and
// currency from the first part that names them, the remarks from every part. An Excel workbook
// is first turned into CSV text, sheet by sheet, and goes the same way.
async function readStatement({ spec, filePath, type, apiKey, baseUrl, model }) {
  const buf = await fsp.readFile(filePath);
  let texts;
  if (EXCEL_TYPES.has(type)) {
    try {
      texts = excelToCsv(buf);
    } catch (err) {
      throw httpError(422, err.message);
    }
  } else {
    texts = [decodeCsv(buf)];
  }
  const parts = texts.flatMap((text) => statementParts(text, STATEMENT_PART_ROWS));
  const merged = { bank: null, currency: "", transactions: [], notes: [] };
  for (let i = 0; i < parts.length; i++) {
    const content = [
      { type: "input_text", text: spec.prompt(i + 1, parts.length) },
      { type: "input_text", text: parts[i] },
    ];
    const result = await callModel({ spec, content, apiKey, baseUrl, model });
    merged.bank ||= result.bank || null;
    merged.currency ||= result.currency || "";
    merged.transactions.push(...(result.transactions || []));
    if (result.notes && !merged.notes.includes(result.notes)) merged.notes.push(result.notes);
  }
  return { ...merged, currency: merged.currency || "JPY", notes: merged.notes.join(" / ") };
}

export async function runOcr({ kind, filePath, type, name, apiKey, baseUrl, model }) {
  const spec = SPECS[kind];
  if (!spec) throw httpError(400, `Unknown OCR kind: ${kind}`);
  if (!apiKey) {
    throw httpError(500, "OPENAI_API_KEY is not set. Put it in .env, then restart the server (./restart.sh or npm run dev).");
  }
  if (kind === "statement") return readStatement({ spec, filePath, type, apiKey, baseUrl, model });
  const content = [{ type: "input_text", text: spec.prompt() }, await buildInputPart(filePath, type, name)];
  return callModel({ spec, content, apiKey, baseUrl, model });
}
