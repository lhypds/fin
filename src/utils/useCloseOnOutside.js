import { useEffect } from "react";

// A menu closes the way stash's does: on a press anywhere outside `ref`, or on Escape.
export function useCloseOnOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (!ref.current?.contains(e.target)) close();
    }
    function handleKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, open, close]);
}
