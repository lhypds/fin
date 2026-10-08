// The app's HTTP API: uploads, thumbnails, OCR, and the reconciliation state.
// Returned as an express app so the same code mounts on the Vite dev server and on server/index.js.
//
//   data/
//   ├── state.json                 transactions, receipts, sources, matches
//   └── uploads/<unix ms>/         one folder per upload
//       ├── <original file name>   byte-identical to what was uploaded
//       ├── meta.json              name, type, size, uploadedAt, thumbnail
//       ├── thumbnail.webp         images only
//       └── ocr.json               written when OCR has run (raw model output + model, time)

import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { runOcr, OCR_KINDS, DEFAULT_MODEL } from "./ocr.js";
import { createAuthApp, USERS_FILE } from "./auth.js";

const ID_RE = /^\d{13,16}$/;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
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
  const statePath = path.join(dataDir, "state.json");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = express();
  app.disable("x-powered-by");

  // Login, session, and the guard that keeps every route below behind a session.
  app.use(createAuthApp({ usersPath: path.join(dataDir, USERS_FILE) }));

  const fail = (res, status, message) => res.status(status).json({ error: { message } });
  const dirOf = (id) => path.join(uploadsDir, id);

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
  // response no page was around to receive.
  async function listFiles() {
    const out = [];
    for (const name of (await fsp.readdir(uploadsDir)).sort()) {
      if (!ID_RE.test(name)) continue;
      const meta = await readMeta(name);
      if (meta) out.push({ id: name, thumbnail: !!meta.thumbnail, ocr: await exists(path.join(dirOf(name), OCR)) });
    }
    return out;
  }

  // Folder name = upload time in ms; bump by one when two uploads land in the same millisecond.
  async function newUploadDir() {
    let id = Date.now();
    for (;;) {
      try {
        await fsp.mkdir(dirOf(String(id)));
        return String(id);
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        id++;
      }
    }
  }

  // State writes are serialized and atomic (tmp + rename) so a crash never leaves a half-written file.
  let writing = Promise.resolve();
  function writeState(json) {
    const run = async () => {
      const tmp = `${statePath}.tmp`;
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, statePath);
    };
    writing = writing.then(run, run);
    return writing;
  }

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

  // Upload: raw body, mime type in content-type, original name URL-encoded in x-file-name.
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

      const id = await newUploadDir();
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

      const meta = { id, name, type, size: req.body.length, uploadedAt: new Date(Number(id)).toISOString(), thumbnail };
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
      const dir = dirOf(req.params.id);
      const started = Date.now();
      const result = await runOcr({ kind, filePath: path.join(dir, meta.name), type: meta.type, name: meta.name, apiKey, baseUrl, model });
      const record = { kind, model, at: new Date().toISOString(), durationMs: Date.now() - started, result };
      await fsp.writeFile(path.join(dir, OCR), JSON.stringify(record, null, 2));
      res.json(record);
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
