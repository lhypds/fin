import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtMoney } from "@utils/format";
import { matchesQuery } from "@utils/search";
import { useCloseOnOutside } from "@utils/useCloseOnOutside";
import styles from "./assets.module.css";

// The payee whose spending is charted, as a select that can be searched: a button with the
// chosen payee's name, and under it a field to type in and the payees (`payees`, in the order
// given: the one paid the most first), each with the months it was paid in and what it was paid
// in all. Typing narrows the list to the names with every word typed, whichever width the letters
// are in; Up and Down walk it, Enter picks, Escape or a press outside closes it.
export default function PayeePicker({ payees, value, currency, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The row the keys are on, as an index into the rows shown.
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutside(wrapRef, open, close);

  const chosen = payees.find((p) => p.key === value);
  const shown = useMemo(() => payees.filter((p) => matchesQuery(p.key, query)), [payees, query]);

  // The row the keys are on stays in sight as they walk the list.
  useEffect(() => {
    if (open) listRef.current?.querySelector("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [open, active, shown]);

  // The list opens with nothing typed and the keys on the chosen payee.
  function toggle() {
    if (!open) {
      setQuery("");
      setActive(Math.max(0, payees.indexOf(chosen)));
    }
    setOpen(!open);
  }

  // Picking, and Escape, hand the focus back to the button; a press outside leaves it where it went.
  function pick(payee) {
    setOpen(false);
    buttonRef.current?.focus();
    onChange(payee.key);
  }

  function handleKey(e) {
    // Enter and the arrows belong to the input method while it is composing (kana, pinyin).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      // Taken here, so the dialog stays open.
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), shown.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    }
  }

  return (
    <div
      ref={wrapRef}
      className={styles.payee}
      data-open={open}
      // A Tab out of the list closes it too.
      onBlur={(e) => {
        if (open && !wrapRef.current.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        className={styles.payeeButton}
        onClick={toggle}
        onKeyDown={(e) => {
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          toggle();
        }}
        title={chosen?.name}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.legendName}>{chosen?.name}</span>
      </button>
      {open && (
        <div className={styles.payeeMenu}>
          <input
            className={`input ${styles.payeeSearch}`}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={handleKey}
            placeholder={t("assets.payeeSearch")}
            aria-label={t("assets.payeeSearch")}
            autoFocus
          />
          <ul ref={listRef} className={`${styles.payeeList} scroll-y`} role="listbox" aria-label={t("assets.payeeLabel")}>
            {shown.map((p, i) => (
              <li
                key={p.key}
                role="option"
                aria-selected={p.key === value}
                data-active={i === active}
                onMouseMove={() => setActive(i)}
                // The press keeps the focus in the field, so the list does not close before the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                <span className={styles.legendName} title={p.name}>
                  {p.name}
                </span>
                <span className={styles.payeeMonths}>{t("assets.payeeMonths", { count: p.months.size })}</span>
                <span className={`${styles.num} mono`}>{fmtMoney(p.total, currency)}</span>
              </li>
            ))}
            {!shown.length && <li className={styles.payeeEmpty}>{t("assets.noMatch")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
