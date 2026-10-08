import { createContext, useContext } from "react";

export const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// What this browser remembers of the last login. The name is kept for good: the login form opens
// with it in the field, so coming back is one password to type, not two fields. The password is
// kept so the app can log in by itself on the next visit, and is forgotten again on logout, or
// once the server stops accepting it. It is stored as it is, in local storage: anyone who can read
// this browser's profile can read it.
const LAST_USER_KEY = "fin:user";
const PASSWORD_KEY = "fin:password";

function read(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function rememberedUsername() {
  return read(LAST_USER_KEY);
}

// The saved name and password together, or null when there is no password to log in with.
export function rememberedCredentials() {
  const username = read(LAST_USER_KEY);
  const password = read(PASSWORD_KEY);
  return username && password ? { username, password } : null;
}

export function rememberCredentials(username, password) {
  write(LAST_USER_KEY, username);
  write(PASSWORD_KEY, password);
}

export function forgetPassword() {
  write(PASSWORD_KEY, "");
}
