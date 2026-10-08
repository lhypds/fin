import Home from "@pages/Home";
import Login from "@pages/Login";
import { Toast } from "@ui";
import { AuthProvider, ReconcileProvider, useAuth } from "@store";

// The workspace only mounts once someone is logged in: its store loads the data on mount, and
// without a session that request would be refused anyway.
function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  return (
    <ReconcileProvider>
      <Home />
    </ReconcileProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
      <Toast />
    </AuthProvider>
  );
}
