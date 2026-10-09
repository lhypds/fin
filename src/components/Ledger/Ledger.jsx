import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney, txAmount } from "@utils/format";
import { amountGap } from "@utils/matching";
import { transactionHaystack, matchesQuery } from "@utils/search";
import FileThumb from "../FileThumb";
import { ConfidenceTag } from "../StatusTag";
import { RECEIPT_DRAG_TYPE } from "../ReceiptPanel";
import TxEditor from "./TxEditor";
import ReceiptPicker from "./ReceiptPicker";
import { EditIcon, TrashIcon, EyeIcon, UnlinkIcon, PlusIcon } from "../icons";
import styles from "./ledger.module.css";

const FILTERS = ["all", "unmatched", "matched"];

/* Newest first; rows without a date sink to the bottom. Rows on the same day keep the order
   they were extracted in, since the statement's printed order is the only within-day clue. */
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

function isReceiptDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes(RECEIPT_DRAG_TYPE);
}

export default function Ledger({ onPreviewReceipt, query = "" }) {
  const { t } = useTranslation();
  const { transactions, receiptById, match, unmatch, removeTransaction, updateTransaction } = useReconcile();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [picking, setPicking] = useState(null);
  const [overId, setOverId] = useState(null);

  // The header search narrows the list first; the filter tabs then split what it left.
  const searched = useMemo(() => {
    const sorted = sortByDate(transactions);
    if (!query.trim()) return sorted;
    return sorted.filter((tx) => {
      const receipts = (tx.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);
      return matchesQuery(transactionHaystack(tx, receipts), query);
    });
  }, [transactions, receiptById, query]);

  const rows = useMemo(() => {
    if (filter === "unmatched") return searched.filter((tx) => !tx.receiptIds?.length);
    if (filter === "matched") return searched.filter((tx) => tx.receiptIds?.length);
    return searched;
  }, [searched, filter]);

  const counts = useMemo(() => {
    const matched = searched.filter((tx) => tx.receiptIds?.length).length;
    return { all: searched.length, unmatched: searched.length - matched, matched };
  }, [searched]);

  function handleDelete(tx) {
    if (!window.confirm(t("ledger.deleteConfirm"))) return;
    removeTransaction(tx.id);
  }

  function toggleConfirmed(tx) {
    updateTransaction(tx.id, { confirmed: !tx.confirmed });
  }

  return (
    <div className={styles.ledger}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={styles.filterBtn}
              data-active={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(`ledger.filter${f[0].toUpperCase()}${f.slice(1)}`)}
              <span className={styles.count}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("ledger.add")}
        </button>
      </div>

      <div className={styles.scrollX}>
        <div className={`${styles.scroll} scroll-y`}>
          <div className={styles.table}>
            <div className={styles.sticky}>
              <div className={styles.sections}>
                <div className={styles.sectionLeft}>{t("ledger.title")}</div>
                <div className={styles.sectionRight}>{t("ledger.results")}</div>
              </div>
              <div className={`${styles.row} ${styles.head}`}>
                <div className={styles.left}>
                  <div>{t("ledger.date")}</div>
                  <div>{t("ledger.bank")}</div>
                  <div>{t("ledger.description")}</div>
                  <div className={styles.num}>{t("ledger.withdrawal")}</div>
                  <div className={styles.num}>{t("ledger.deposit")}</div>
                  <div />
                </div>
                <div className={styles.cMatch} />
              </div>
            </div>

            {rows.length === 0 && (
              <p className={styles.empty}>
                {transactions.length === 0 ? t("ledger.empty") : searched.length === 0 ? t("ledger.emptySearch") : t("ledger.emptyFiltered")}
              </p>
            )}

            {rows.map((tx) => {
              const receipts = (tx.receiptIds || []).map((id) => receiptById.get(id)).filter(Boolean);
              const matched = receipts.length > 0;
              const amount = txAmount(tx);
              const totals = receipts.map((r) => r.ocr?.total);
              const sum = totals.every((v) => v != null) ? totals.reduce((a, b) => a + Number(b), 0) : null;
              // A gap the size of a transfer fee is the fee being on one side only, not a wrong receipt.
              const mismatch = matched && sum != null && amountGap(sum, amount, tx.currency) == null;
              // An empty reconciliation cell opens the picker; a matched one holds chips with their own buttons.
              const pickProps = matched
                ? {}
                : {
                    "data-pickable": true,
                    role: "button",
                    tabIndex: 0,
                    title: t("picker.title"),
                    onClick: () => setPicking(tx),
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPicking(tx);
                      }
                    },
                  };
              // A matched row is a toggle: a click anywhere on it that no button or thumbnail
              // claims flips the human confirmation of the match. Keys count only on the row
              // itself, since Enter and Space on the buttons inside it bubble up here too.
              const confirmProps = matched
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-pressed": !!tx.confirmed,
                    onClick: () => toggleConfirmed(tx),
                    onKeyDown: (e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleConfirmed(tx);
                      }
                    },
                  }
                : {};

              return (
                <div
                  key={tx.id}
                  className={styles.row}
                  data-matched={matched}
                  data-confirmed={matched && !!tx.confirmed}
                  data-over={overId === tx.id}
                  {...confirmProps}
                  onDragOver={(e) => {
                    if (!isReceiptDrag(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "link";
                    if (overId !== tx.id) setOverId(tx.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setOverId((id) => (id === tx.id ? null : id));
                  }}
                  onDrop={(e) => {
                    const receiptId = e.dataTransfer.getData(RECEIPT_DRAG_TYPE);
                    setOverId(null);
                    if (!receiptId) return;
                    e.preventDefault();
                    match(tx.id, receiptId, null);
                  }}
                >
                  <div className={styles.left}>
                    <div className="mono">{tx.date || <span className="muted">{t("ledger.noDate")}</span>}</div>
                    <div title={tx.bank || undefined}>{tx.bank}</div>
                    <div className={styles.desc}>{tx.description}</div>
                    <div className={`${styles.num} ${styles.withdrawal} mono`}>{tx.withdrawal ? fmtMoney(tx.withdrawal, tx.currency) : ""}</div>
                    <div className={`${styles.num} ${styles.deposit} mono`}>{tx.deposit ? fmtMoney(tx.deposit, tx.currency) : ""}</div>
                    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      <ActionButton tooltip={t("button.edit")} onClick={() => setEditing(tx)}>
                        <EditIcon />
                      </ActionButton>
                      <ActionButton tooltip={t("button.delete")} onClick={() => handleDelete(tx)}>
                        <TrashIcon />
                      </ActionButton>
                    </div>
                  </div>

                  <div className={styles.cMatch} {...pickProps}>
                    {matched &&
                      receipts.map((r, i) => (
                        // The thumbnail is the chip's one button and opens the receipt preview. The
                        // rest of the chip belongs to the row, so a click there confirms the match.
                        <div key={r.id} className={styles.chip}>
                          <button
                            type="button"
                            className={styles.chipThumb}
                            title={t("button.preview")}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewReceipt(r.id);
                            }}
                          >
                            <FileThumb item={r} size={28} />
                          </button>
                          <div className={styles.chipInfo}>
                            <div className={styles.chipTitle}>{r.ocr?.vendor || r.name}</div>
                            <div className={`${styles.chipMeta} mono`}>
                              <span>{r.ocr?.date || "—"}</span>
                              <span>{r.ocr?.total != null ? fmtMoney(r.ocr.total, r.ocr.currency) : t("receipts.noAmount")}</span>
                              <ConfidenceTag confidence={r.confidence} />
                            </div>
                            {/* The sum note covers every receipt, so it hangs off the last chip. Inside the chip
                                (rather than below the stack) the thumb and buttons stay centred against it. */}
                            {mismatch && i === receipts.length - 1 && (
                              <div className={styles.mismatch}>
                                {t("ledger.sumMismatch", { sum: fmtMoney(sum, tx.currency), amount: fmtMoney(amount, tx.currency) })}
                              </div>
                            )}
                          </div>
                          <div className={styles.chipActions} onClick={(e) => e.stopPropagation()}>
                            <ActionButton tooltip={t("button.preview")} onClick={() => onPreviewReceipt(r.id)}>
                              <EyeIcon />
                            </ActionButton>
                            <ActionButton tooltip={t("button.unmatch")} onClick={() => unmatch(r.id)}>
                              <UnlinkIcon />
                            </ActionButton>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editing && <TxEditor tx={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {picking && <ReceiptPicker tx={picking} onClose={() => setPicking(null)} />}
    </div>
  );
}
