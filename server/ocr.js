// OCR through the OpenAI Responses API with Structured Outputs.
// Runs on the server so the file never leaves data/ except to go to OpenAI.

import fsp from "node:fs/promises";
import sharp from "sharp";

export const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_IMAGE_DIM = 2048;

const PASSBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    currency: { type: "string", description: "ISO 4217 code of the account currency, e.g. JPY" },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"], description: "Gregorian date YYYY-MM-DD, null if unreadable" },
          description: { type: "string", description: "Payee / memo exactly as printed (摘要)" },
          withdrawal: { type: ["number", "null"], description: "Money out (お支払金額 / 出金), positive number or null" },
          deposit: { type: ["number", "null"], description: "Money in (お預り金額 / 入金), positive number or null" },
          balance: { type: ["number", "null"], description: "Balance after the row (差引残高) or null" },
        },
        required: ["date", "description", "withdrawal", "deposit", "balance"],
      },
    },
    notes: { type: "string", description: "Short remarks about unreadable rows or assumptions, empty if none" },
  },
  required: ["currency", "transactions", "notes"],
};

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: ["string", "null"], description: "Store / company / counterparty name" },
    date: { type: ["string", "null"], description: "Transaction or payment date, Gregorian YYYY-MM-DD" },
    total: { type: ["number", "null"], description: "Grand total actually paid, tax included" },
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
  required: ["vendor", "date", "total", "currency", "tax", "invoiceNumber", "direction", "paymentMethod", "items", "summary"],
};

const PASSBOOK_INSTRUCTIONS = `You are an OCR engine for bank passbooks (日本の銀行通帳) and bank statements.
Extract every transaction row that is visible, in printed order. Do not invent rows.
Rules:
- Dates must be Gregorian YYYY-MM-DD. Japanese passbooks print dates as YY-MM-DD in the Reiwa era (令和): a two-digit year from 01 to 12 means Reiwa, so add 2018 (e.g. 06-10-08 → 2024-10-08). A year from 20 to 99 means 20YY. "R6" or "令和6" also means 2024. Heisei (平成, H) year N → 1988 + N.
- Amounts are plain numbers without commas or currency symbols. withdrawal = お支払金額 / 出金 / お引出し. deposit = お預り金額 / 入金 / お預入れ. Never put the same number in both.
- balance = 差引残高 column if present.
- description = the 摘要 / お取引内容 text as printed, including abbreviations like カ）, ATM, 振込, 給与.
- Rows that only carry a balance (繰越, 繰越残高) may be included with description "繰越" and null amounts.
- Skip headers, footers, page numbers, account numbers and stamps.
- If the image contains multiple pages or two facing pages, read them left to right, top to bottom.`;

const RECEIPT_INSTRUCTIONS = `You are an OCR engine for receipts, invoices, payment confirmations and bank transfer slips (レシート, 領収書, 請求書, 振込明細, PDF invoices, app screenshots).
Extract the fields precisely. Rules:
- total = the grand total that was actually paid or is payable, including tax. Prefer 合計 / お支払金額 / ご請求金額 / Total over subtotals.
- date = the payment or issue date in Gregorian YYYY-MM-DD. Convert Japanese era dates (令和6年10月8日 → 2024-10-08, R6.10.8 → 2024-10-08).
- vendor = the business that issued the document (shop, company, service). For bank transfer slips use the payee.
- direction = "expense" when the account holder paid someone, "income" when the account holder received money (an invoice they issued, a sales receipt they wrote). Use "unknown" if unclear.
- items = line items with amounts if the document has them, otherwise an empty array. Keep it short (max 20).
- summary = one short line in the document's language, e.g. "セブンイレブン 食料品 ¥1,230".
- Numbers are plain numbers without commas or currency symbols.`;

const today = () => new Date().toISOString().slice(0, 10);

const SPECS = {
  source: {
    instructions: PASSBOOK_INSTRUCTIONS,
    prompt: () => `Today is ${today()}. Extract all transactions from this bank passbook / statement.`,
    schema: PASSBOOK_SCHEMA,
    schemaName: "passbook",
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

// Builds the Responses API content part. Photos are downscaled and EXIF-rotated first:
// fewer tokens, faster, same OCR quality. PDFs go as-is (text and page images are extracted upstream).
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

export async function runOcr({ kind, filePath, type, name, apiKey, baseUrl, model }) {
  const spec = SPECS[kind];
  if (!spec) throw httpError(400, `Unknown OCR kind: ${kind}`);
  if (!apiKey) {
    throw httpError(500, "OPENAI_API_KEY is not set. Put it in .env, then restart the server (./restart.sh or npm run dev).");
  }
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const part = await buildInputPart(filePath, type, name);
  const body = {
    model,
    instructions: spec.instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: spec.prompt() }, part] }],
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
