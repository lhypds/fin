import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { STATEMENT_ACCEPT, formatBytes } from "@utils/files";
import DropZone from "../DropZone";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import BankEditor from "./BankEditor";
import { PlusIcon, PlayIcon, EyeIcon, EditIcon, TrashIcon, LoaderIcon } from "../icons";
import styles from "./bank.module.css";

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

// "渋谷支店 · 普通 1234567 · カ）エイタイ": whichever of the account details are filled in.
function accountLine(bank) {
  const account = [bank.accountType, bank.accountNumber].filter(Boolean).join(" ");
  return [bank.branch, account, bank.holder].filter(Boolean).join(" · ");
}

// A statement file: thumb, name and size, status, and its buttons. A click opens it.
function StatementRow({ st, rows, onRun, onPreview, onDelete }) {
  const { t } = useTranslation();
  return (
    <div className={styles.file} onClick={() => onPreview(st.id)}>
      <FileThumb item={st} size={32} />
      <div className={styles.fileInfo}>
        <div className={styles.fileName} title={st.name}>
          {st.name}
        </div>
        <div className={styles.meta}>
          <span>{formatBytes(st.size)}</span>
          {st.status === "done" && <span> · {t("statements.txCount", { count: rows })}</span>}
        </div>
        {st.error && (
          <div className={styles.fileError} title={st.error}>
            {st.error}
          </div>
        )}
      </div>
      <div className={styles.fileSide} onClick={(e) => e.stopPropagation()}>
        <StatusTag status={st.missing ? "missing" : st.status} />
        <div className={styles.actions}>
          <ActionButton tooltip={t("button.ocr")} onClick={() => onRun(st)}>
            <PlayIcon />
          </ActionButton>
          <ActionButton tooltip={t("button.preview")} onClick={() => onPreview(st.id)}>
            <EyeIcon />
          </ActionButton>
          <ActionButton tooltip={t("button.delete")} onClick={() => onDelete(st)}>
            <TrashIcon />
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// The accounts, one of which (or all of them) the ledger shows, each with the statements dropped
// onto it: the bank's CSV, or photos and PDFs of the passbook. A statement is read by the model as
// soon as it lands, the way receipts are; its rows go on the ledger under the account, and what a
// passbook cover says about the account fills in the details not typed in yet. A file dropped
// while no account is chosen is read first and then goes to the account it is from, made on the
// spot if there is none.
export default function BankPanel({ selectedId, onSelect, onImported, onPreview }) {
  const { t } = useTranslation();
  const { banks, statements, transactions, importFiles, ocrPending, removeFileItem, removeBank, unmatchAll, progress } = useReconcile();
  const [editing, setEditing] = useState(null); // null | "new" | the bank being edited
  const [busy, setBusy] = useState(false);
  const [overId, setOverId] = useState(null);

  const selected = banks.find((b) => b.id === selectedId) || null;
  // Files not on an account yet: read and waiting for their account, or failed before getting one.
  const unassigned = statements.filter((s) => !s.bankId);
  // Files the button can read: a missing upload cannot be, one being read is already on its way.
  // `todo` are those not read yet, or whose read failed.
  const readable = statements.filter((s) => !s.missing && s.status !== "processing");
  const todo = readable.filter((s) => s.status === "pending" || s.status === "error");
  const running = progress.statement.total > 0;
  const percent = running ? Math.round((progress.statement.done / progress.statement.total) * 100) : 0;
  const rowsOf = (st) => transactions.filter((tx) => tx.statementId === st.id).length;

  // Reads statements; once done, the ledger moves to the account read into and its newest month.
  async function runOcr(ids, bankId = null) {
    setBusy(true);
    try {
      const { ok, errors, lastError, results } = await ocrPending("statement", ids);
      if (!ok && !errors) showToast(t("toast.nothingPending"));
      else if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
      else showToast(t("toast.rowsAdded", { count: results.reduce((a, r) => a + (r?.added || 0), 0) }));
      const latest = results.reduce((m, r) => (r?.latest && r.latest > m ? r.latest : m), "");
      const target = bankId || results.find((r) => r?.bankId)?.bankId || null;
      if (ok && target) onImported(target, latest ? latest.slice(0, 7) : null);
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(bank, files) {
    const { added, rejected, duplicates, failed, lastError, ids } = await importFiles("statement", files, bank?.id || null);
    if (rejected) showToast(t("dropzone.rejectedStatement", { count: rejected }));
    if (duplicates) showToast(t("dropzone.duplicate", { count: duplicates }));
    if (failed) showToast(t("toast.uploadFailed", { count: failed, message: lastError?.message || "" }), 6000);
    if (added) {
      if (bank) onSelect(bank.id);
      runOcr(ids, bank?.id || null);
    }
  }

  async function handleDeleteBank(bank) {
    const count = transactions.filter((tx) => tx.bankId === bank.id).length;
    if (!window.confirm(t("banks.deleteConfirm", { name: bank.name, count }))) return;
    await removeBank(bank.id);
  }

  async function handleDeleteStatement(st) {
    if (!window.confirm(t("statements.deleteConfirm", { count: rowsOf(st) }))) return;
    await removeFileItem("statement", st.id);
  }

  // A file that has been read already is only read again on confirmation: it costs another model
  // call, and rows the model reads differently this time are added as new transactions.
  function handleRun(st) {
    if (st.status === "done" && !window.confirm(t("statements.rerunConfirm"))) return;
    runOcr([st.id], st.bankId);
  }

  // Reads what has not been read yet. Once everything has, offers to read it all again, which
  // starts the reconciliation over: every match is undone as the run begins.
  function handleRunAll() {
    if (todo.length) return runOcr(todo.map((s) => s.id));
    if (!window.confirm(t("statements.rerunAllConfirm", { count: readable.length }))) return;
    unmatchAll();
    runOcr(readable.map((s) => s.id));
  }

  // Keys count only on the card itself: Enter and Space on the buttons inside it bubble up here too.
  const selectOnKey = (id) => (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  const rowProps = { onRun: handleRun, onPreview, onDelete: handleDeleteStatement };

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t("banks.title")}</h2>
        <div className={styles.headActions}>
          <button type="button" className="btn" disabled={busy || running || !readable.length} onClick={handleRunAll}>
            {busy || running ? <LoaderIcon className="spin" /> : <PlayIcon />}
            {running ? t("button.ocrRunning", { percent }) : `${t("statements.ocrAll")}${todo.length ? ` (${todo.length})` : ""}`}
          </button>
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("banks.add")}
          </button>
        </div>
      </header>

      {/* The drop zone feeds the chosen account; with all accounts showing, the file's own account
          is read off it. A file can also be dropped straight onto a card. */}
      <div className={styles.drop}>
        <DropZone accept={STATEMENT_ACCEPT} types="CSV · PNG · JPG · PDF" onFiles={(files) => handleFiles(selected, files)} />
      </div>

      <div className={`${styles.list} scroll-y`}>
        <div className={styles.listInner}>
          <div
            className={styles.all}
            role="button"
            tabIndex={0}
            data-active={selectedId == null}
            onClick={() => onSelect(null)}
            onKeyDown={selectOnKey(null)}
          >
            <span className={styles.name}>{t("banks.all")}</span>
            <span className={styles.count}>{t("banks.rowCount", { count: transactions.length })}</span>
          </div>
          {unassigned.length > 0 && (
            <div className={styles.unassigned}>
              <div className={styles.meta}>{t("statements.unassigned")}</div>
              <div className={styles.fileList}>
                {unassigned.map((st) => (
                  <StatementRow key={st.id} st={st} rows={rowsOf(st)} {...rowProps} />
                ))}
              </div>
            </div>
          )}
          {banks.length === 0 && <p className={styles.empty}>{t("banks.empty")}</p>}
          {banks.map((bank) => {
            const count = transactions.filter((tx) => tx.bankId === bank.id).length;
            const files = statements.filter((s) => s.bankId === bank.id);
            const details = accountLine(bank);
            return (
              <article
                key={bank.id}
                className={styles.card}
                role="button"
                tabIndex={0}
                data-active={selectedId === bank.id}
                data-over={overId === bank.id}
                onClick={() => onSelect(bank.id)}
                onKeyDown={selectOnKey(bank.id)}
                onDragOver={(e) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (overId !== bank.id) setOverId(bank.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setOverId((id) => (id === bank.id ? null : id));
                }}
                onDrop={(e) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  setOverId(null);
                  handleFiles(bank, e.dataTransfer.files);
                }}
              >
                <div className={styles.top}>
                  <div className={styles.name}>{bank.name}</div>
                  <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                    <ActionButton tooltip={t("button.edit")} onClick={() => setEditing(bank)}>
                      <EditIcon />
                    </ActionButton>
                    <ActionButton tooltip={t("button.delete")} onClick={() => handleDeleteBank(bank)}>
                      <TrashIcon />
                    </ActionButton>
                  </div>
                </div>
                {details && <div className={styles.meta}>{details}</div>}
                <div className={`${styles.meta} mono`}>{t("banks.rowCount", { count })}</div>

                {/* The statement files. A click on one opens it, not the account under it. */}
                {files.length > 0 && (
                  <div className={`${styles.files} ${styles.fileList}`} onClick={(e) => e.stopPropagation()}>
                    {files.map((st) => (
                      <StatementRow key={st.id} st={st} rows={rowsOf(st)} {...rowProps} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      {editing && <BankEditor bank={editing === "new" ? null : editing} onClose={() => setEditing(null)} onCreated={onSelect} />}
    </section>
  );
}
