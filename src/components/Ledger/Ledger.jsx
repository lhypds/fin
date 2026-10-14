import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, isModalOpen } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney, txAmount } from "@utils/format";
import { receiptsSumMismatch } from "@utils/matching";
import { transactionHaystack, matchesQuery } from "@utils/search";
import { ledgerView, monthLabel, ALL } from "@utils/transactions";
import FileThumb from "../FileThumb";
import { ConfidenceTag } from "../StatusTag";
import { RECEIPT_DRAG_TYPE, isReceiptDrag } from "../ReceiptPanel";
import TxEditor from "./TxEditor";
import MatchEditor from "./MatchEditor";
import ConfirmDialog from "./ConfirmDialog";
import MonthPicker from "./MonthPicker";
import { EditIcon, TrashIcon, PlusIcon } from "../icons";
import styles from "./ledger.module.css";

/* Newest first; rows without a date sink to the bottom. Rows on the same day keep the order
   they were imported in, since the statement's printed order is the only within-day clue. */
function sortByDate(list) {
  return list
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => {
      const da = a.tx.date || "0000";
      const db = b.tx.date || "0000";
      if (da !== db) return da > db ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.tx);
}

// One month of one account (or of all of them) at a time. `bankId` is the account chosen on the
// left, `month` the one chosen here, both held by the page so an import can move them.
export default function Ledger({ bankId = null, month = "", onMonthChange, onPreviewReceipt, query = "" }) {
  const { t } = useTranslation();
  const { transactions, receiptById, match, removeTransaction, updateTransaction } = useReconcile();
  const [editing, setEditing] = useState(null);
  const [editingMatch, setEditingMatch] = useState(null);
  // The row whose confirmation is being looked over in the dialog, receipts and all.
  const [confirming, setConfirming] = useState(null);

  // The month picker's entries, the one on screen, and its rows. The header's auto-match covers
  // the same rows, so the one definition of "what the ledger shows" lives in @utils/transactions.
  const { months, index, current, rows: inMonth } = useMemo(() => ledgerView(transactions, bankId, month), [transactions, bankId, month]);
  // A picker entry, written the way the ledger writes a month everywhere.
  const labelOf = (m) => monthLabel(m.key, t);

  // The rows on screen: the month, newest first, narrowed by the header search.
  const rows = useMemo(() => {
    const sorted = sortByDate(inMonth);
    if (!query.trim()) return sorted;
    return sorted.filter((tx) => {
      const receipts = (tx.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);
      return matchesQuery(transactionHaystack(tx, receipts), query);
    });
  }, [inMonth, receiptById, query]);

  function handleDelete(tx) {
    if (!window.confirm(t("ledger.deleteConfirm"))) return;
    removeTransaction(tx.id);
  }

  // Flips the row's confirmation. A row with receipts is not confirmed on the spot: the dialog
  // opens with the row and its receipts, and confirms it once they have been looked over. Taking
  // a confirmation back is immediate either way. Returns whether the row changed here and now.
  function toggleConfirmed(tx) {
    if (!tx.confirmed && (tx.receiptIds || []).some((id) => receiptById.has(id))) {
      setConfirming(tx);
      return false;
    }
    updateTransaction(tx.id, { confirmed: !tx.confirmed });
    return true;
  }

  // The keyboard's row is the focused one: Down and Up move the focus from row to row, Space and
  // Enter toggle it like a double click and move on. The cursor remembers the row last focused and its
  // place in the list, so the arrows pick up there after a click elsewhere has taken the focus,
  // or at the same place once the row has left the list (deleted, or moved to another month).
  const scrollRef = useRef(null);
  const stickyRef = useRef(null);
  const rowRefs = useRef(new Map());
  const cursorRef = useRef(null);

  const focusRow = useCallback((tx) => {
    const el = tx && rowRefs.current.get(tx.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    // focus() alone scrolls only until the row's edge is inside the pane, which leaves it under
    // the sticky header; this brings it out from under the header, or up from below the bottom.
    const scroller = scrollRef.current;
    const sticky = stickyRef.current;
    if (!scroller || !sticky) return;
    const pane = scroller.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    const top = pane.top + sticky.offsetHeight;
    if (row.top < top) scroller.scrollTop -= top - row.top;
    else if (row.bottom > pane.bottom) scroller.scrollTop += row.bottom - pane.bottom;
  }, []);

  // The arrows work from anywhere on the page: from a row (or a button in it) they step to its
  // neighbour, from elsewhere they return to the cursor's row. A dialog keeps them, as does any
  // field that uses them itself; a one-line text box (the search) does not, so Down leaves it
  // for the rows it narrowed.
  useEffect(() => {
    function handleKey(e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isModalOpen()) return;
      if (!rows.length) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("textarea, select, [contenteditable]")) return;
      if (target instanceof HTMLInputElement && target.type !== "text" && target.type !== "search") return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const fromRow = target?.closest("[data-tx]");
      let next;
      if (fromRow) {
        const i = rows.findIndex((tx) => String(tx.id) === fromRow.dataset.tx);
        next = rows[Math.min(Math.max(i + step, 0), rows.length - 1)];
      } else {
        const cursor = cursorRef.current;
        const i = cursor ? rows.findIndex((tx) => tx.id === cursor.id) : -1;
        if (i >= 0) next = rows[i];
        else if (cursor) next = rows[Math.min(cursor.index, rows.length - 1)];
        else next = step > 0 ? rows[0] : rows[rows.length - 1];
      }
      e.preventDefault();
      focusRow(next);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [rows, focusRow]);

  // The dialog hands the focus back to the row it was opened for, confirmed or not, so the arrows
  // and the next Space carry on from there.
  const closeConfirm = useCallback(() => {
    setConfirming(null);
    focusRow(confirming);
  }, [confirming, focusRow]);

  const emptyText = () => {
    if (transactions.length === 0) return t("ledger.empty");
    if (inMonth.length === 0) return t("ledger.emptyMonth", { month: labelOf(months[index]) });
    return t("ledger.emptySearch");
  };

  return (
    <div className={styles.ledger}>
      <div className={styles.toolbar}>
        <MonthPicker months={months} index={index} label={labelOf} onChange={onMonthChange} />
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("ledger.add")}
        </button>
      </div>

      <div className={styles.scrollX}>
        <div className={`${styles.scroll} scroll-y`} ref={scrollRef}>
          <div className={styles.table}>
            <div className={styles.sticky} ref={stickyRef}>
              <div className={styles.sections}>
                <div className={styles.sectionLeft}>{t("ledger.title")}</div>
                <div className={styles.sectionRight}>{t("ledger.results")}</div>
              </div>
              <div className={`${styles.row} ${styles.head}`}>
                <div className={styles.left}>
                  <div>{t("ledger.date")}</div>
                  <div>{t("ledger.bank")}</div>
                  <div>{t("ledger.description")}</div>
                  <div className={styles.num}>{t("ledger.amount")}</div>
                  <div />
                </div>
                <div className={styles.cMatch} />
              </div>
            </div>

            {rows.length === 0 && <p className={styles.empty}>{emptyText()}</p>}

            {rows.map((tx) => {
              const receipts = (tx.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);
              const matched = receipts.length > 0;
              const amount = txAmount(tx);
              // A receipt carrying the row's amount on its own (a transfer slip, the invoice it settles)
              // is in order; the others must add up to it. The note shows the sum of those that do not.
              const sum = matched ? receiptsSumMismatch(amount, receipts, tx.currency) : null;
              const mismatch = sum != null;
              // Every row is a toggle: a double click anywhere on it that no button or thumbnail
              // claims flips the human confirmation, matched or not (a row can be checked off
              // without a receipt). A single click only focuses the row, so a stray click cannot
              // confirm one. Keys count only on the row itself, since Enter and Space on the
              // buttons inside it bubble up here too. A focus on any of those buttons still moves
              // the cursor here, so the arrows carry on from the row that was last worked on.
              const confirmProps = {
                role: "button",
                tabIndex: 0,
                "aria-pressed": !!tx.confirmed,
                onDoubleClick: () => toggleConfirmed(tx),
                // The second press of a double click would select the word under the pointer;
                // stopping its default leaves the text alone, while a drag across the row still
                // selects.
                onMouseDown: (e) => {
                  if (e.detail > 1) e.preventDefault();
                },
                onFocus: () => {
                  cursorRef.current = { id: tx.id, index: rows.indexOf(tx) };
                },
                onKeyDown: (e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    // The cursor moves on to the next row, so the next Space carries on down the
                    // list; on the last row it stays. A row that opens the dialog keeps it: the
                    // row is confirmed there, and the focus comes back to it after.
                    if (toggleConfirmed(tx)) focusRow(rows[rows.indexOf(tx) + 1]);
                  }
                },
              };

              return (
                <div
                  key={tx.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(tx.id, el);
                    else rowRefs.current.delete(tx.id);
                  }}
                  data-tx={tx.id}
                  className={styles.row}
                  data-matched={matched}
                  data-noted={!!tx.autoMemo}
                  data-confirmed={!!tx.confirmed}
                  {...confirmProps}
                  onDragOver={(e) => {
                    if (!isReceiptDrag(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "link";
                  }}
                  onDrop={(e) => {
                    const receiptId = e.dataTransfer.getData(RECEIPT_DRAG_TYPE);
                    if (!receiptId) return;
                    e.preventDefault();
                    // A chip dropped back on its own row stays as it is, confidence included.
                    if (tx.receiptIds?.includes(receiptId)) return;
                    match(tx.id, receiptId, null);
                  }}
                >
                  <div className={styles.left}>
                    <div className="mono">{tx.date || <span className="muted">{t("ledger.noDate")}</span>}</div>
                    <div title={tx.bank || undefined}>{tx.bank}</div>
                    <div className={styles.desc}>{tx.description}</div>
                    {/* One amount cell: red for money out, green for money in. */}
                    {tx.withdrawal ? (
                      <div className={`${styles.num} ${styles.withdrawal} mono`}>{fmtMoney(tx.withdrawal, tx.currency)}</div>
                    ) : (
                      <div className={`${styles.num} ${styles.deposit} mono`}>{tx.deposit ? fmtMoney(tx.deposit, tx.currency) : ""}</div>
                    )}
                    <div className={styles.actions} onDoubleClick={(e) => e.stopPropagation()}>
                      <ActionButton tooltip={t("button.edit")} onClick={() => setEditing(tx)}>
                        <EditIcon />
                      </ActionButton>
                      <ActionButton tooltip={t("button.delete")} onClick={() => handleDelete(tx)}>
                        <TrashIcon />
                      </ActionButton>
                    </div>
                  </div>

                  <div className={styles.cMatch}>
                    <div className={styles.matchBody}>
                      {matched &&
                        receipts.map((r, i) => (
                          // The thumbnail and the text (name, date, amount, confidence) are the chip's
                          // buttons and open the receipt preview; two quick clicks on them must not
                          // reach the row. The rest of the chip belongs to the row, so a double click
                          // there confirms the match.
                          // Dragged to the receipt list, the chip is unmatched; to another row, moved there.
                          <div
                            key={r.id}
                            className={styles.chip}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(RECEIPT_DRAG_TYPE, r.id);
                              e.dataTransfer.effectAllowed = "link";
                            }}
                          >
                            <button
                              type="button"
                              className={styles.chipThumb}
                              title={t("button.preview")}
                              onClick={() => onPreviewReceipt(r.id)}
                              onDoubleClick={(e) => e.stopPropagation()}
                            >
                              <FileThumb item={r} size={28} />
                            </button>
                            <div className={styles.chipInfo}>
                              <button
                                type="button"
                                className={styles.chipText}
                                title={t("button.preview")}
                                onClick={() => onPreviewReceipt(r.id)}
                                onDoubleClick={(e) => e.stopPropagation()}
                              >
                                <span className={styles.chipTitle}>{r.ocr?.vendor || r.name}</span>
                                <span className={`${styles.chipMeta} mono`}>
                                  <span>{r.ocr?.date || "—"}</span>
                                  <span>{r.ocr?.total != null ? fmtMoney(r.ocr.total, r.ocr.currency) : t("receipts.noAmount")}</span>
                                  <ConfidenceTag confidence={r.confidence} />
                                </span>
                              </button>
                              {/* The sum note covers every receipt, so it hangs off the last chip. Inside the chip
                                  (rather than below the stack) the thumb stays centred against it. */}
                              {mismatch && i === receipts.length - 1 && (
                                <div className={styles.mismatch}>
                                  {t("ledger.sumMismatch", { sum: fmtMoney(sum, tx.currency), amount: fmtMoney(amount, tx.currency) })}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      {/* The note typed on the reconciliation sits under the chips, or alone on an unmatched row. */}
                      {tx.memo && <div className={styles.note}>{tx.memo}</div>}
                    </div>
                    {/* The cell's one button opens the reconciliation editor, where receipts are unmatched
                        and the note typed. It keeps the right edge, centred on the stack beside it. */}
                    <div className={styles.matchActions} onDoubleClick={(e) => e.stopPropagation()}>
                      <ActionButton tooltip={t("button.edit")} onClick={() => setEditingMatch(tx)}>
                        <EditIcon />
                      </ActionButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editing && (
        <TxEditor
          tx={editing === "new" ? null : editing}
          defaultBankId={bankId}
          onClose={() => setEditing(null)}
          // A row saved into another month is shown, not lost from view; with every month on
          // screen it is in view already.
          onSaved={(saved) => {
            if (current !== ALL) onMonthChange(saved.date.slice(0, 7));
          }}
        />
      )}
      {editingMatch && <MatchEditor tx={editingMatch} onClose={() => setEditingMatch(null)} onPreview={onPreviewReceipt} />}
      {confirming && <ConfirmDialog tx={confirming} onClose={closeConfirm} />}
    </div>
  );
}
