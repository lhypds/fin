// Client for the server API (server/api.js). Uploads live in data/uploads/<id>/, state in data/state.json.

const API = "/api";

// Fired on window when the server answers that there is no session any more (it restarted, or
// the cookie expired). The auth store listens and takes the app back to the login page.
export const UNAUTHORIZED_EVENT = "fin:unauthorized";

async function check(res) {
  if (res.ok) return res;
  let message = "";
  let code = "";
  try {
    const error = (await res.json())?.error;
    message = error?.message || "";
    code = error?.code || "";
  } catch {
    /* non-JSON error body */
  }
  if (code === "LOGIN_REQUIRED") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const err = new Error(message || `${res.status} ${res.statusText}`);
  err.status = res.status;
  err.code = code;
  throw err;
}

const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Resolves to { username }; rejects with status 401 on a wrong username or password.
export async function login(username, password) {
  const res = await check(await fetch(`${API}/login`, { method: "POST", ...json({ username, password }) }));
  return res.json();
}

// Resolves to { username } for the current session; null when nobody is logged in.
export async function getSession() {
  const res = await fetch(`${API}/session`, { cache: "no-store" });
  if (res.status === 401) return null;
  return (await check(res)).json();
}

export async function logout() {
  await check(await fetch(`${API}/session`, { method: "DELETE" }));
}

export const fileUrl = (id) => `${API}/files/${id}`;
export const thumbnailUrl = (id) => `${API}/files/${id}/thumbnail`;

// Resolves to the upload's meta: { id, name, type, size, uploadedAt, thumbnail }.
export async function uploadFile(file, type) {
  const res = await check(
    await fetch(`${API}/files`, {
      method: "POST",
      headers: {
        "content-type": type || file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
      },
      body: file,
    }),
  );
  return res.json();
}

// Runs OCR on the server; resolves to { kind, model, at, durationMs, result }.
export async function runOcr(id, kind) {
  const res = await check(await fetch(`${API}/files/${id}/ocr`, { method: "POST", ...json({ kind }) }));
  return res.json();
}

// The result of the last OCR run saved on the server, same shape as runOcr; null if there is none.
export async function fetchOcr(id) {
  const res = await fetch(`${API}/files/${id}/ocr`, { cache: "no-store" });
  if (res.status === 404) return null;
  return (await check(res)).json();
}

export async function deleteFile(id) {
  await check(await fetch(fileUrl(id), { method: "DELETE" }));
}

export async function saveState(state) {
  await check(await fetch(`${API}/state`, { method: "PUT", ...json(state) }));
}

// Resolves to { state, files: [{ id, thumbnail, ocr }], config: { model, hasApiKey } }.
export async function loadState() {
  const res = await check(await fetch(`${API}/state`, { cache: "no-store" }));
  return res.json();
}

export async function clearAll() {
  await check(await fetch(`${API}/data`, { method: "DELETE" }));
}
