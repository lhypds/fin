import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import { scoreMatch } from "@utils/matching";
import { receiptHaystack, matchesQuery } from "@utils/search";
import FileThumb from "../FileThumb";
import StatusTag from "../StatusTag";
import styles from "./picker.module.css";

export default function ReceiptPicker({ tx, onClose }) {
  const { t } = useTranslation();
  const { receipts, match } = useReconcile();
  const [query, setQuery] = useState("");

  const candidates = useMemo(
    () =>
      receipts
        .filter((r) => !r.txId)
        .map((r) => ({ r, score: scoreMatch(tx, r) }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [receipts, tx],
  );

  const shown = useMemo(() => {
    if (!query.trim()) return candidates;
    return candidates.filter(({ r }) => matchesQuery(receiptHaystack(r), query));
  }, [candidates, query]);

  return (
    <Modal isOpen onClose={onClose} title={t("picker.title")} className={styles.modal}>
      <div className={styles.body}>
        {candidates.length === 0 ? (
          <p className="muted">{t("picker.empty")}</p>
        ) : (
          <input
            className={`input ${styles.search}`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("picker.search")}
            aria-label={t("picker.search")}
            autoFocus
          />
        )}
        {candidates.length > 0 && shown.length === 0 && <p className="muted">{t("picker.noResults")}</p>}
        <div className={`${styles.list} scroll-y`}>
          {shown.map(({ r, score }) => (
            <button
              key={r.id}
              type="button"
              className={styles.item}
              onClick={() => {
                match(tx.id, r.id, score);
                onClose();
              }}
            >
              <FileThumb item={r} size={36} />
              <div className={styles.info}>
                <div className={styles.name}>{r.ocr?.vendor || r.name}</div>
                <div className={`${styles.meta} mono`}>
                  {r.ocr ? (
                    <>
                      <span>{r.ocr.date || "—"}</span>
                      <span>{r.ocr.total != null ? fmtMoney(r.ocr.total, r.ocr.currency) : t("receipts.noAmount")}</span>
                      {r.ocr.summary && <span className={styles.summary}>{r.ocr.summary}</span>}
                    </>
                  ) : (
                    <span>{r.name}</span>
                  )}
                </div>
              </div>
              {score != null ? (
                <span className="tag ok">
                  {t("picker.suggested")} {Math.round(score * 100)}%
                </span>
              ) : (
                !r.ocr && <StatusTag status={r.status} />
              )}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
