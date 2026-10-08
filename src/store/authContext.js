import { createContext, useContext } from "react";

export const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// The last name that logged in from this browser. Not a credential: the login form opens with it
// in the field, so coming back after a session has gone is one password to type, not two fields.
const LAST_USER_KEY = "fin:user";

export function rememberedUsername() {
  try {
    return localStorage.getItem(LAST_USER_KEY) || "";
  } catch {
    return "";
  }
}

export function rememberUsername(username) {
  try {
    localStorage.setItem(LAST_USER_KEY, username);
  } catch {
    /* ignore */
  }
}
