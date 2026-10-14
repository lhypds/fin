// The app's HTTP API: uploads, thumbnails, OCR, and the reconciliation state. Receipts stay as
// uploads; a statement (CSV or Excel, or a passbook image) is uploaded only to be read, and the
// client deletes it once the result is in.
// Returned as an express app so the same code mounts on the Vite dev server and on server/index.js.
//
//   data/
//   ├── state.json                 banks, transactions, receipts, matches
//   ├── backups/<unix ms>/         one folder per backup, taken on request
//   │   └── state.json             state.json as it was at that time
//   └── uploads/<unix ms>/         one folder per upload
//       ├── <original file name>   byte-identical to what was uploaded
//       ├── meta.json              name, type, size, role, uploadedAt, thumbnail
//       ├── thumbnail.webp         images only
//       └── ocr.json               written when OCR has run (raw model output + model, time)

import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { runOcr, OCR_KINDS, DEFAULT_MODEL, SPREADSHEET_TYPES } from "./ocr.js";
import { generateMemos } from "./memo.js";
import { createAuthApp, USERS_FILE } from "./auth.js";

const ID_RE = /^\d{13,16}$/;
const ACCEPTED_TYPES = new Set([...SPREADSHEET_TYPES, "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
// What an upload is for: a receipt (kept), a statement (read once and removed), or the reference
// file the AI memos are written from (kept until replaced).
const ROLES = new Set(["receipt", "statement", "reference"]);
const STATE = "state.json";
const META = "meta.json";
const THUMB = "thumbnail.webp";
const OCR = "ocr.json";
const RESERVED_NAMES = new Set([META, THUMB, OCR]);
const THUMB_SIZE = 480;

function validFileName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !/[/\\\0]/.test(name) &&
    name !== "." &&
    name !== ".." &&
    !RESERVED_NAMES.has(name)
  );
}

export function createApiApp({ dataDir, apiKey, baseUrl, model = DEFAULT_MODEL, maxUpload = "64mb" }) {
  const uploadsDir = path.join(dataDir, "uploads");
  const backupsDir = path.join(dataDir, "backups");
  const statePath = path.join(dataDir, STATE);
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  const app = express();
  app.disable("x-powered-by");

  // Login, session, and the guard that keeps every route below behind a session.
  app.use(createAuthApp({ usersPath: path.join(dataDir, USERS_FILE) }));

  const fail = (res, status, message) => res.status(status).json({ error: { message } });
  const dirOf = (id) => path.join(uploadsDir, id);
  const backupOf = (id) => path.join(backupsDir, id, STATE);

  async function readJson(file) {
    try {
      return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  const readMeta = (id) => readJson(path.join(dirOf(id), META));

  const exists = (file) => fsp.access(file).then(() => true, () => false);

  // `ocr` tells the client a result is on disk, so after a reload it can pick up a run whose
  // response no page was around to receive. `role` is what the upload was for (receipt or
  // statement); a statement still here is one whose read was cut off, and `name`, `type` and
  // `bankId` are what the client needs to finish it.
  async function listFiles() {
    const out = [];
    for (const name of (await fsp.readdir(uploadsDir)).sort()) {
      if (!ID_RE.test(name)) continue;
      const meta = await readMeta(name);
      if (!meta) continue;
      out.push({
        id: name,
        name: meta.name,
        type: meta.type,
        role: meta.role || null,
        bankId: meta.bankId || null,
        thumbnail: !!meta.thumbnail,
        ocr: await exists(path.join(dirOf(name), OCR)),
      });
    }
    return out;
  }

  // One model run per file at a time: a page that reloads while a read is under way asks again,
  // and joins the run already going rather than starting another.
  const running = new Map();

  // Folder name = the time in ms; bump by one when two land in the same millisecond.
  async function newDir(parent) {
    let id = Date.now();
    for (;;) {
      try {
        await fsp.mkdir(path.join(parent, String(id)));
        return String(id);
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        id++;
      }
    }
  }

  // Everything that touches state.json goes through one queue, so a backup copies the file as it
  // stands between two writes and a restore is not overwritten by a write that came in before it.
  // Writes are atomic (tmp + rename) so a crash never leaves a half-written file.
  let writing = Promise.resolve();
  function withState(fn) {
    const next = writing.then(fn, fn);
    writing = next.catch(() => {});
    return next;
  }
  const writeState = (json) =>
    withState(async () => {
      const tmp = `${statePath}.tmp`;
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, statePath);
    });

  // A backup as the list shows it: when it was taken, how big it is, and what it holds. One whose
  // file is missing or unreadable is left out, since it could not be restored anyway.
  async function describeBackup(id) {
    const file = backupOf(id);
    let saved;
    let size;
    try {
      size = (await fsp.stat(file)).size;
      saved = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return null;
    }
    const count = (list) => (Array.isArray(list) ? list.length : 0);
    return {
      id,
      at: new Date(Number(id)).toISOString(),
      size,
      banks: count(saved?.banks),
      transactions: count(saved?.transactions),
      receipts: count(saved?.receipts),
    };
  }

  // Newest first.
  async function listBackups() {
    const out = [];
    for (const name of (await fsp.readdir(backupsDir)).filter((n) => ID_RE.test(n)).sort().reverse()) {
      const info = await describeBackup(name);
      if (info) out.push(info);
    }
    return out;
  }

  app.get("/api/backups", async (_req, res, next) => {
    try {
      res.json({ backups: await listBackups() });
    } catch (err) {
      next(err);
    }
  });

  // Copies state.json as it is now into a new backup folder.
  app.post("/api/backups", async (_req, res, next) => {
    try {
      const id = await withState(async () => {
        if (!(await exists(statePath))) return null;
        const id = await newDir(backupsDir);
        await fsp.copyFile(statePath, backupOf(id));
        return id;
      });
      if (!id) return fail(res, 404, "There is no data to back up yet");
      res.json(await describeBackup(id));
    } catch (err) {
      next(err);
    }
  });

  // Puts a backup in place of state.json. The client loads the state again afterwards.
  app.post("/api/backups/:id/restore", async (req, res, next) => {
    try {
      const file = backupOf(req.params.id);
      if (!(await exists(file))) return fail(res, 404, "Backup not found");
      await withState(async () => {
        const tmp = `${statePath}.tmp`;
        await fsp.copyFile(file, tmp);
        await fsp.rename(tmp, statePath);
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Removes a backup folder. Queued behind the state writes so a restore under way never finds
  // its backup half removed. One already gone is fine: the list the client has may be stale.
  app.delete("/api/backups/:id", async (req, res, next) => {
    try {
      await withState(() => fsp.rm(path.join(backupsDir, req.params.id), { recursive: true, force: true }));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/state", async (_req, res, next) => {
    try {
      res.json({ state: await readJson(statePath), files: await listFiles(), config: { model, hasApiKey: Boolean(apiKey) } });
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/state", express.json({ limit: "32mb" }), async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object") return fail(res, 400, "State must be a JSON object");
      await writeState(JSON.stringify(req.body, null, 2));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Upload: raw body, mime type in content-type, original name URL-encoded in x-file-name, and
  // what it is for in x-file-role (receipt, or statement: a file read once and then removed).
  app.post("/api/files", express.raw({ type: () => true, limit: maxUpload }), async (req, res, next) => {
    try {
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!ACCEPTED_TYPES.has(type)) return fail(res, 415, `Unsupported file type: ${type || "unknown"}`);
      if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, "Empty upload");
      let name = "";
      try {
        name = decodeURIComponent(req.headers["x-file-name"] || "");
      } catch {
        /* malformed encoding → invalid */
      }
      if (!validFileName(name)) return fail(res, 400, "Invalid file name");
      const role = ROLES.has(req.headers["x-file-role"]) ? req.headers["x-file-role"] : null;
      // The account a statement is for, kept with the file so a page that reloads mid-read can
      // pick the read up again and put the result where it was meant to go.
      const bankHeader = req.headers["x-file-bank"];
      const bankId = typeof bankHeader === "string" && /^[\w-]{1,64}$/.test(bankHeader) ? bankHeader : null;

      const id = await newDir(uploadsDir);
      const dir = dirOf(id);
      await fsp.writeFile(path.join(dir, name), req.body);

      let thumbnail = false;
      if (type.startsWith("image/")) {
        try {
          await sharp(req.body, { animated: false })
            .rotate()
            .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(path.join(dir, THUMB));
          thumbnail = true;
        } catch (err) {
          console.error(`Thumbnail failed for ${id}/${name}: ${err.message}`);
        }
      }

      const meta = { id, name, type, size: req.body.length, role, bankId, uploadedAt: new Date(Number(id)).toISOString(), thumbnail };
      await fsp.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
      res.json(meta);
    } catch (err) {
      next(err);
    }
  });

  app.param("id", (_req, res, next, id) => (ID_RE.test(id) ? next() : fail(res, 400, "Invalid file id")));

  app.get("/api/files/:id", async (req, res, next) => {
    try {
      const meta = await readMeta(req.params.id);
      if (!meta) return fail(res, 404, "File not found");
      // Ids are never reused, so the browser may cache forever.
      res.sendFile(path.join(dirOf(req.params.id), meta.name), {
        maxAge: "1y",
        immutable: true,
        headers: {
          "content-type": meta.type,
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/files/:id/thumbnail", async (req, res, next) => {
    try {
      const meta = await readMeta(req.params.id);
      if (!meta?.thumbnail) return fail(res, 404, "No thumbnail");
      res.sendFile(path.join(dirOf(req.params.id), THUMB), { maxAge: "1y", immutable: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/files/:id/ocr", async (req, res, next) => {
    try {
      const record = await readJson(path.join(dirOf(req.params.id), OCR));
      if (!record) return fail(res, 404, "No OCR result");
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/files/:id/ocr", express.json(), async (req, res, next) => {
    try {
      const kind = req.body?.kind;
      if (!OCR_KINDS.includes(kind)) return fail(res, 400, `kind must be one of: ${OCR_KINDS.join(", ")}`);
      const meta = await readMeta(req.params.id);
      if (!meta) return fail(res, 404, "File not found");
      // Rows come from CSV and Excel exports only; a passbook is read for the account, never for rows.
      const spreadsheet = SPREADSHEET_TYPES.has(meta.type);
      if (kind === "statement" && !spreadsheet) return fail(res, 415, "A statement must be a CSV or Excel file");
      if (kind !== "statement" && spreadsheet) return fail(res, 415, "A CSV or Excel file can only be read as a statement");
      const id = req.params.id;
      const dir = dirOf(id);
      let job = running.get(id);
      if (!job || job.kind !== kind) {
        const promise = (async () => {
          const started = Date.now();
          const result = await runOcr({ kind, filePath: path.join(dir, meta.name), type: meta.type, name: meta.name, apiKey, baseUrl, model });
          const record = { kind, model, at: new Date().toISOString(), durationMs: Date.now() - started, result };
          // The file may have been removed while the model was reading it (a read called off).
          if (await exists(dir)) await fsp.writeFile(path.join(dir, OCR), JSON.stringify(record, null, 2));
          return record;
        })();
        job = { kind, promise };
        running.set(id, job);
        const done = () => {
          if (running.get(id) === job) running.delete(id);
        };
        promise.then(done, done);
      }
      res.json(await job.promise);
    } catch (err) {
      next(err);
    }
  });

  // Memos for ledger rows, written by the model from the person's instructions, the account, the
  // rows, and the reference file (an upload with role "reference") when one is named.
  app.post("/api/memos", express.json({ limit: "4mb" }), async (req, res, next) => {
    try {
      const { prompt, bank, rows, referenceId } = req.body || {};
      if (typeof prompt !== "string" || prompt.length > 8000) return fail(res, 400, "prompt must be a string of at most 8000 characters");
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000) return fail(res, 400, "rows must be a list of 1 to 1000 rows");
      if (bank != null && typeof bank !== "object") return fail(res, 400, "bank must be an object");
      let referencePath = null;
      let referenceType = null;
      if (referenceId != null) {
        const id = String(referenceId);
        if (!ID_RE.test(id)) return fail(res, 400, "Invalid reference file id");
        const meta = await readMeta(id);
        if (!meta) return fail(res, 404, "Reference file not found");
        if (!SPREADSHEET_TYPES.has(meta.type)) return fail(res, 415, "The reference file must be a CSV or Excel file");
        referencePath = path.join(dirOf(id), meta.name);
        referenceType = meta.type;
      }
      const clean = rows.map((r) => ({
        id: String(r?.id ?? ""),
        date: r?.date == null ? "" : String(r.date),
        description: String(r?.description ?? ""),
        withdrawal: Number(r?.withdrawal) || 0,
        deposit: Number(r?.deposit) || 0,
        currency: String(r?.currency || "JPY"),
      }));
      res.json(await generateMemos({ prompt, bank, rows: clean, referencePath, referenceType, apiKey, baseUrl, model }));
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/files/:id", async (req, res, next) => {
    try {
      await fsp.rm(dirOf(req.params.id), { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/data", async (_req, res, next) => {
    try {
      await writing;
      await fsp.rm(statePath, { force: true });
      for (const name of await fsp.readdir(uploadsDir)) {
        await fsp.rm(path.join(uploadsDir, name), { recursive: true, force: true });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Unknown /api routes get a JSON 404 instead of falling through to the SPA page.
  app.use("/api", (_req, res) => fail(res, 404, "Not found"));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    // Upstream (OpenAI) failures are expected operational errors: one line, no stack.
    if (status === 502) console.error(`[api] ${err.message}`);
    else if (status >= 500) console.error(err);
    fail(res, status, status === 413 ? "File is too large" : err.message || "Server error");
  });

  return app;
}
