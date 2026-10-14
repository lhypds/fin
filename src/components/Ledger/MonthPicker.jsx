import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCloseOnOutside } from "@utils/useCloseOnOutside";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import styles from "./monthPicker.module.css";

// The ledger's month: a step back, the month itself, a step forward. Newest month first in
// `months`, so "previous" steps down the list and "next" steps up. The month opens a list drawn
// like the header's menus rather than the browser's own: Up and Down walk it (and open it from
// the month), Enter or Space pick, Escape or a press outside closes it. `label` writes a month
// the way the ledger does.
export default function MonthPicker({ months, index, label, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const monthRef = useRef(null);
  const listRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutside(wrapRef, open, close);

  // The list opens with the month on screen focused, so the keys start from it.
  useEffect(() => {
    if (open) listRef.current?.querySelector("[aria-selected='true']")?.focus();
  }, [open]);

  // Picking, and Escape, hand the focus back to the month; a press outside leaves it where it went.
  function pick(key) {
    setOpen(false);
    monthRef.current?.focus();
    onChange(key);
  }

  function handleMonthKey(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setOpen(true);
  }

  function handleListKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      monthRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // Taken here, so the ledger's own arrows (which move its cursor) leave the list alone.
    e.preventDefault();
    const options = [...listRef.current.querySelectorAll("[role='option']")];
    const i = options.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
    options[Math.min(Math.max(i, 0), options.length - 1)]?.focus();
  }

  return (
    <div className={styles.picker}>
      <button
        type="button"
        className={styles.step}
        disabled={index >= months.length - 1}
        onClick={() => onChange(months[index + 1].key)}
        title={t("ledger.prevMonth")}
        aria-label={t("ledger.prevMonth")}
      >
        <ChevronLeftIcon />
      </button>
      <div
        ref={wrapRef}
        className={styles.monthWrap}
        data-open={open}
        // A Tab out of the list closes it too.
        onBlur={(e) => {
          if (open && !wrapRef.current.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <button
          type="button"
          ref={monthRef}
          className={styles.month}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={handleMonthKey}
          title={t("ledger.month")}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {label(months[index])}
        </button>
        {open && (
          <div ref={listRef} className={`${styles.list} scroll-y`} role="listbox" aria-label={t("ledger.month")} onKeyDown={handleListKey}>
            {months.map((m, i) => (
              <button key={m.key} type="button" role="option" aria-selected={i === index} onClick={() => pick(m.key)}>
                {label(m)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.step}
        disabled={index <= 0}
        onClick={() => onChange(months[index - 1].key)}
        title={t("ledger.nextMonth")}
        aria-label={t("ledger.nextMonth")}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
