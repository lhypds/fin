import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const INDEX = path.join(DIST, "index.html");

// Load .env (KEY=value lines); variables already set in the environment win.
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {
  /* no .env */
}

const PORT = Number(process.env.PORT) || 3015;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");

if (!fs.existsSync(INDEX)) {
  console.error("dist/index.html not found — run ./setup.sh (npm run build) first");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");

app.use(
  createApiApp({
    dataDir: DATA_DIR,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL || undefined,
  }),
);
app.use(express.static(DIST));

// SPA fallback
app.use((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(404).end();
  res.sendFile(INDEX);
});

app.listen(PORT, () => {
  console.log(`fin listening on http://localhost:${PORT} (data in ${DATA_DIR})`);
});
