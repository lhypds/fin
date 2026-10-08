import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { login as apiLogin, logout as apiLogout, getSession, UNAUTHORIZED_EVENT } from "@utils/api";
import { AuthContext, rememberedCredentials, rememberCredentials, forgetPassword } from "./authContext";

// Logs in with what the browser remembers, if anything. Resolves to the username, or null when
// nothing is saved or the server would not have it. A password the server refuses is forgotten,
// so the login page is shown once rather than tried on every visit; a server that cannot be
// reached keeps it, and the attempt is simply repeated next time.
async function autoLogin() {
  const saved = rememberedCredentials();
  if (!saved) return null;
  try {
    const session = await apiLogin(saved.username, saved.password);
    return session.username;
  } catch (err) {
    if (err.status === 401) forgetPassword();
    return null;
  }
}

// Who is logged in, if anyone. `ready` is false until the server has been asked once, so the app
// shows nothing rather than flashing the login page at someone who still has a session, or who
// is about to be logged in with a saved password.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const restoring = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name = null;
      try {
        const session = await getSession();
        name = session ? session.username : await autoLogin();
      } catch {
        /* server unreachable: the login page's own request will say so */
      }
      if (cancelled) return;
      if (name) setUser(name);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The server dropped the session (restart, expiry). With a saved password the app logs in again
  // by itself, and the workspace remounts with fresh data; without one, back to the login page.
  useEffect(() => {
    const onUnauthorized = async () => {
      if (restoring.current) return;
      if (!rememberedCredentials()) return setUser(null);
      restoring.current = true;
      setReady(false);
      const name = await autoLogin();
      setUser(name);
      setReady(true);
      restoring.current = false;
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const session = await apiLogin(username, password);
    rememberCredentials(session.username, password);
    setUser(session.username);
  }, []);

  const logout = useCallback(async () => {
    forgetPassword();
    await apiLogout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
