import { useCallback, useEffect, useMemo, useState } from "react";
import { login as apiLogin, logout as apiLogout, getSession, UNAUTHORIZED_EVENT } from "@utils/api";
import { AuthContext, rememberUsername } from "./authContext";

// Who is logged in, if anyone. `ready` is false until the server has been asked once, so the app
// shows nothing rather than flashing the login page at someone who still has a session.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (!cancelled && session) setUser(session.username);
      } catch {
        /* server unreachable: the login page's own request will say so */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The server dropped the session (restart, expiry): back to the login page.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const session = await apiLogin(username, password);
    rememberUsername(session.username);
    setUser(session.username);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
