import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { listBackups, createBackup, deleteBackup } from "@utils/api";
import { fmtDateTime } from "@utils/format";
import { confirm } from "../ConfirmModal";
import { ArchiveIcon, LoaderIcon, TrashIcon } from "../icons";
import styles from "./backup.module.css";

// Backup above, restore below. A backup copies the data as it is now into data/backups/<time>/;
// restoring puts one of those copies back in place of the data. Only the state is kept and put
// back (accounts, rows, receipts and matches); the uploaded files stay as they are. A backup no
// longer wanted is deleted from its row.
export default function BackupModal({ onClose }) {
  const { t } = useTranslation();
  const { restoreBackup } = useReconcile();
  const [backups, setBackups] = useState(null); // null until the list has come
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(null); // null | "backup" | "restore" | "delete"

  useEffect(() => {
    let cancelled = false;
    listBackups().then(
      (list) => {
        if (!cancelled) setBackups(list);
      },
      (err) => {
        if (cancelled) return;
        setBackups([]);
        showToast(t("toast.backupsFailed", { message: err.message }), 6000);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function backup() {
    setBusy("backup");
    try {
      const made = await createBackup();
      setBackups((list) => [made, ...(list || [])]);
      showToast(t("toast.backedUp"));
    } catch (err) {
      showToast(t("toast.backupFailed", { message: err.message }), 6000);
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    const chosen = backups?.find((b) => b.id === choice);
    if (!chosen) return;
    if (!(await confirm(t("backup.restoreConfirm", { time: fmtDateTime(chosen.id) }), { confirmLabel: t("backup.restore") }))) return;
    setBusy("restore");
    try {
      await restoreBackup(chosen.id);
      showToast(t("toast.restored"));
      onClose();
    } catch (err) {
      showToast(t("toast.restoreFailed", { message: err.message }), 6000);
      setBusy(null);
    }
  }

  async function remove(b) {
    if (!(await confirm(t("backup.deleteConfirm", { time: fmtDateTime(b.id) }), { confirmLabel: t("button.delete") }))) return;
    setBusy("delete");
    try {
      await deleteBackup(b.id);
      setBackups((list) => list.filter((x) => x.id !== b.id));
      setChoice((c) => (c === b.id ? null : c));
      showToast(t("toast.backupDeleted"));
    } catch (err) {
      showToast(t("toast.deleteBackupFailed", { message: err.message }), 6000);
    } finally {
      setBusy(null);
    }
  }

  // Nothing closes the dialog while a backup, restore or delete is under way.
  return (
    <Modal isOpen onClose={busy ? undefined : onClose} title={t("backup.title")}>
      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.heading}>{t("backup.backupSection")}</h3>
          <div>
            <button type="button" className="btn lg" onClick={backup} disabled={!!busy}>
              {busy === "backup" ? <LoaderIcon className="spin" /> : <ArchiveIcon />}
              {t("backup.backupNow")}
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>{t("backup.restoreSection")}</h3>
          {backups?.length === 0 && <p className={styles.empty}>{t("backup.empty")}</p>}
          {backups?.length > 0 && (
            <div className={`${styles.list} scroll-y`}>
              {backups.map((b) => (
                <label key={b.id} className={styles.item} data-active={choice === b.id}>
                  <input
                    type="radio"
                    name="backup"
                    className={styles.radio}
                    value={b.id}
                    checked={choice === b.id}
                    onChange={() => setChoice(b.id)}
                    disabled={!!busy}
                  />
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={`${styles.time} mono`}>{fmtDateTime(b.id)}</span>
                  <span className={styles.meta}>
                    {t("backup.summary", { banks: b.banks, transactions: b.transactions, receipts: b.receipts })}
                  </span>
                  {/* A button inside a label is its own control: clicking it does not pick the radio. */}
                  <ActionButton tooltip={t("button.delete")} onClick={() => remove(b)} disabled={!!busy}>
                    <TrashIcon />
                  </ActionButton>
                </label>
              ))}
            </div>
          )}
          <div className={styles.footer}>
            <button type="button" className="btn lg" onClick={onClose} disabled={!!busy}>
              {t("button.cancel")}
            </button>
            <button type="button" className="btn primary lg" onClick={restore} disabled={!!busy || !choice}>
              {busy === "restore" && <LoaderIcon className="spin" />}
              {t("backup.restore")}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
