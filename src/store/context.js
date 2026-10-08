import { createContext, useContext } from "react";

export const ReconcileContext = createContext(null);

export function useReconcile() {
  const ctx = useContext(ReconcileContext);
  if (!ctx) throw new Error("useReconcile must be used inside ReconcileProvider");
  return ctx;
}
