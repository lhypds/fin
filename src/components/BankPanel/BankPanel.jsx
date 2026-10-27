import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { STATEMENT_ACCEPT, isSpreadsheetFile } from "@utils/files";
import DropZone from "../DropZone";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import { confirm } from "../ConfirmModal";
import BankEditor from "./BankEditor";
import ImportTarget from "./ImportTarget";
import { PlusIcon, EditIcon, TrashIcon, LoaderIcon, XIcon } from "../icons";
import styles from "./bank.module.css";

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

// A statement while the model reads it, as an item at the end of the list. It is gone, file and
// all, once the result is in, or when it is called off.
function ReadingItem({ read, bank, onCancel }) {
  const { t } = useTranslation();
  return (
    <div className={styles.pending}>
      <FileThumb item={read} size={32} />
      <div className={styles.fileInfo}>
        <div className={styles.fileName} title={read.name}>
          {read.name}
        </div>
        {bank && <div className={styles.meta}>{bank.label}</div>}
      </div>
      <div className={styles.fileSide}>
        <StatusTag status="processing" />
        <div className={styles.actions}>
          <ActionButton tooltip={t("button.cancel")} onClick={() => onCancel(read.id)}>
            <XIcon />
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// The accounts, one of which (or all of them) the ledger shows. A file dropped here is read by
// the model and then discarded: a CSV or Excel statement into rows, after asking which account it
// belongs to (or making a new one); a passbook photo or PDF into the account on its cover, made
// if there is none with that number, filling in details not typed in yet. Only the results stay.
export default function BankPanel({ selectedId, onSelect, onImported }) {
  const { t } = useTranslation();
  const { banks, transactions, reads, readStatements, cancelRead, removeBank, progress } = useReconcile();
  const [editing, setEditing] = useState(null); // null | "new" | the bank being edited
  const [choosing, setChoosing] = useState(null); // null | { files, bankId }: spreadsheets waiting for their account
  const [overId, setOverId] = useState(null);

  const selected = banks.find((b) => b.id === selectedId) || null;
  const running = progress.statement.total > 0;
  const percent = running ? Math.round((progress.statement.done / progress.statement.total) * 100) : 0;

  // Reads files; once done, the ledger moves to the account read into and its newest month.
  async function read(files, bankId) {
    if (bankId) onSelect(bankId);
    const { errors, lastError, results, rejected } = await readStatements(files, bankId);
    if (rejected) showToast(t("dropzone.rejectedStatement", { count: rejected }));
    if (errors) showToast(t("toast.ocrFailed", { message: lastError?.message || "" }), 6000);
    // A read called off leaves no result behind.
    const done = results.filter(Boolean);
    if (!done.length) return;
    const added = done.reduce((a, r) => a + r.added, 0);
    showToast(done.every((r) => r.kind === "passbook") ? t("toast.accountRead") : t("toast.rowsAdded", { count: added }));
    const latest = done.reduce((m, r) => (r.latest && r.latest > m ? r.latest : m), "");
    // The account the read went to: a passbook may name one other than the account chosen.
    const target = done.find((r) => r.bankId)?.bankId || bankId || null;
    if (target) onImported(target, latest ? latest.slice(0, 7) : null);
  }

  // Files dropped on an account's card (`card`), or on the zone with `bank` the account chosen in
  // the panel, if any. Passbooks are read straight away, for that account when one applies (a
  // chosen account without a number takes the cover's). Spreadsheets (CSV, Excel) first ask which
  // account they are for: the dialog offers the card they were dropped on, else the first account
  // in the list.
  function handleFiles(bank, fileList, card = false) {
    const files = Array.from(fileList || []);
    const sheets = files.filter(isSpreadsheetFile);
    const others = files.filter((f) => !isSpreadsheetFile(f));
    if (others.length) read(others, bank?.id || null);
    if (sheets.length) setChoosing({ files: sheets, bankId: card ? bank.id : null });
  }

  async function handleDeleteBank(bank) {
    const count = transactions.filter((tx) => tx.bankId === bank.id).length;
    if (!(await confirm(t("banks.deleteConfirm", { name: bank.label, count }), { confirmLabel: t("button.delete") }))) return;
    removeBank(bank.id);
  }

  // Keys count only on the card itself: Enter and Space on the buttons inside it bubble up here too.
  const selectOnKey = (id) => (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t("banks.title")}</h2>
        <div className={styles.headActions}>
          {running && (
            <button type="button" className="btn" disabled>
              <LoaderIcon className="spin" />
              {t("button.ocrRunning", { percent })}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("banks.add")}
          </button>
        </div>
      </header>

      {/* The drop zone: a spreadsheet asks for its account; a passbook makes or completes its own.
          A file can also be dropped straight onto a card. */}
      <div className={styles.drop}>
        <DropZone accept={STATEMENT_ACCEPT} types="CSV · XLSX · PNG · JPG · PDF" onFiles={(files) => handleFiles(selected, files)} />
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
          </div>
          {banks.length === 0 && reads.length === 0 && <p className={styles.empty}>{t("banks.empty")}</p>}
          {banks.map((bank) => {
            // The card: the account's name, then the branch and number, then the holder, each
            // line only once filled in (an account just made for a CSV has only its name). The
            // bank and the memo stay in the editor.
            const account = [bank.branch, bank.accountNumber].filter(Boolean).join(" ");
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
                  handleFiles(bank, e.dataTransfer.files, true);
                }}
              >
                <div className={styles.top}>
                  <div className={styles.name}>{bank.label}</div>
                  <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                    <ActionButton tooltip={t("button.edit")} onClick={() => setEditing(bank)}>
                      <EditIcon />
                    </ActionButton>
                    <ActionButton tooltip={t("button.delete")} onClick={() => handleDeleteBank(bank)}>
                      <TrashIcon />
                    </ActionButton>
                  </div>
                </div>
                {account && <div className={styles.meta}>{account}</div>}
                {bank.holder && <div className={styles.meta}>{bank.holder}</div>}
              </article>
            );
          })}
          {/* Whatever is being read, after the accounts, whichever account it is for. */}
          {reads.map((r) => (
            <ReadingItem key={r.id} read={r} bank={banks.find((b) => b.id === r.bankId) || null} onCancel={cancelRead} />
          ))}
        </div>
      </div>

      {editing && <BankEditor bank={editing === "new" ? null : editing} onClose={() => setEditing(null)} onCreated={onSelect} />}
      {choosing && (
        <ImportTarget
          files={choosing.files}
          defaultBankId={choosing.bankId}
          onClose={() => setChoosing(null)}
          onConfirm={(bankId) => {
            setChoosing(null);
            read(choosing.files, bankId);
          }}
        />
      )}
    </section>
  );
}
