import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { register } from "./confirmApi";
import styles from "./confirm.module.css";

// The one confirmation dialog, asked for through confirm() from anywhere. A question asked while
// another is still up answers that one with no and takes its place.
export default function ConfirmModal() {
  const { t } = useTranslation();
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  function answer(ok) {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setRequest(null);
  }

  useEffect(() => {
    const unregister = register(
      (req) =>
        new Promise((resolve) => {
          resolveRef.current?.(false);
          resolveRef.current = resolve;
          setRequest(req);
        })
    );
    return () => {
      unregister();
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  return (
    <Modal isOpen={!!request} onClose={() => answer(false)} title={request?.title ?? t("button.confirm")} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          answer(true);
        }}
      >
        <p className={styles.message}>{request?.message}</p>
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={() => answer(false)}>
            {t("button.cancel")}
          </button>
          <button type="submit" className="btn lg primary" autoFocus>
            {request?.confirmLabel ?? t("button.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
