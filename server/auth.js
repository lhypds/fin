// Login for the whole app: one shared workspace, several people who may open it.
//
// Accounts live in data/users.json, written by hand (see users.example.json):
//
//   [
//     { "username": "liu", "password": "secret" },
//     { "username": "张三", "password": "..." }
//   ]
//
// Every account sees the same data; there is nothing per user. The file is read on each login so
// an edit takes effect without a restart. Passwords are kept as plain text deliberately: the
// administrator is the one who sets them, and the file is the only place to look them up or reset
// one. The data/ folder is not committed and must not be served.
//
// Sessions are kept in memory, keyed by a random token in an httpOnly cookie, so the password
// never lives in the browser. A restart signs everyone out; the login page is what they come back to.

import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";

const SESSION_COOKIE = "fin_session";
const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_PER_WINDOW = 20;

export const USERS_FILE = "users.json";

// Constant-time comparison so a wrong password takes as long to refuse as a nearly-right one.
function passwordsMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const part = String(req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(prefix));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return null;
  }
}

// Returns the accounts in users.json, or null when the file does not exist. Throws when the file
// exists but is not a list of { username, password } objects, so a typo is reported, not ignored.
async function readUsers(usersPath) {
  let raw;
  try {
    raw = await fsp.readFile(usersPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const users = JSON.parse(raw);
  const valid =
    Array.isArray(users) &&
    users.every(
      (u) => u && typeof u.username === "string" && u.username.trim() && typeof u.password === "string" && u.password,
    );
  if (!valid) throw new Error(`${usersPath} must be a list of { "username", "password" } objects`);
  return users.map((u) => ({ username: u.username.trim(), password: u.password }));
}

// Mounts POST /api/login, GET and DELETE /api/session, and then a guard that turns away every
// other /api request that has no session. Mount it before the data routes.
export function createAuthApp({ usersPath }) {
  const app = express();
  const sessions = new Map();
  const fail = (res, status, message, code) => res.status(status).json({ error: { message, code } });

  if (!fs.existsSync(usersPath)) {
    console.warn(`${usersPath} not found — nobody can log in. Copy users.example.json there and set a password.`);
  }

  function currentSession(req) {
    const token = cookieValue(req, SESSION_COOKIE);
    const session = token ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { token, ...session };
  }

  function startSession(username, req, res) {
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { username, expiresAt: Date.now() + SESSION_AGE_MS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: SESSION_AGE_MS,
      path: "/",
    });
  }

  function clearSession(req, res) {
    const session = currentSession(req);
    if (session) sessions.delete(session.token);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/" });
  }

  // Per-IP fixed window on login attempts so the password list cannot be walked quickly. In memory,
  // like the sessions, so it resets with the process.
  const attempts = new Map();
  function loginLimiter(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const rec = attempts.get(ip);
    if (!rec || now - rec.start >= LOGIN_WINDOW_MS) attempts.set(ip, { start: now, count: 1 });
    else if (rec.count >= LOGIN_MAX_PER_WINDOW) return fail(res, 429, "Too many login attempts, try again in a minute", "RATE_LIMITED");
    else rec.count++;
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (now - v.start >= LOGIN_WINDOW_MS) attempts.delete(k);
    }
    next();
  }

  app.post("/api/login", loginLimiter, express.json({ limit: "4kb" }), async (req, res, next) => {
    try {
      const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const users = await readUsers(usersPath);
      if (!users) return fail(res, 503, "No users configured: create data/users.json (see users.example.json)", "NO_USERS");
      // Every account is checked, and the password compared even when the name is unknown, so a
      // response takes the same time whether or not the name exists.
      let found = null;
      for (const u of users) {
        const ok = passwordsMatch(password, u.password);
        if (u.username === username && ok) found = u;
      }
      if (!found) return fail(res, 401, "Wrong username or password", "INVALID_CREDENTIALS");
      startSession(found.username, req, res);
      res.json({ username: found.username });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/session", (req, res) => {
    const session = currentSession(req);
    if (!session) return fail(res, 401, "Login required", "LOGIN_REQUIRED");
    res.json({ username: session.username });
  });

  app.delete("/api/session", (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  app.use("/api", (req, res, next) => {
    const session = currentSession(req);
    if (!session) return fail(res, 401, "Login required", "LOGIN_REQUIRED");
    req.session = session;
    next();
  });

  return app;
}
