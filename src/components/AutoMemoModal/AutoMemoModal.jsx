import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Checkbox } from "@ui";
import styles from "./automemo.module.css";

// The rules auto-memo writes by, named as the dialog lists them. One so far: a transfer between
// two of the accounts (ReconcileStore's runAutoMemo).
const RULES = ["transfer"];

// What auto-memo is about to do, before it does it: the memos it writes, one row per rule with a
// box to leave a rule out, and the choice to go ahead or not. `onConfirm` gets the rules ticked.
export default function AutoMemoModal({ onClose, onConfirm }) {
  const { t } = useTranslation();
  // Every rule is ticked to begin with.
  const [selected, setSelected] = useState(() => new Set(RULES));

  function toggle(rule, on) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(rule);
      else next.delete(rule);
      return next;
    });
  }

  return (
    <Modal isOpen onClose={onClose} title={t("autoMemo.title")}>
      <div className={styles.body}>
        <p>{t("autoMemo.intro")}</p>
        <div className={styles.rules}>
          {RULES.map((rule) => (
            <Checkbox key={rule} className={styles.rule} checked={selected.has(rule)} onChange={(on) => toggle(rule, on)}>
              <span className={styles.ruleText}>
                <span className={styles.ruleName}>{t(`autoMemo.rules.${rule}`)}</span>
                <span className={styles.ruleDesc}>{t(`autoMemo.rules.${rule}Desc`)}</span>
              </span>
            </Checkbox>
          ))}
        </div>
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          <button type="button" className="btn primary lg" onClick={() => onConfirm(RULES.filter((r) => selected.has(r)))} disabled={!selected.size} autoFocus>
            {t("autoMemo.run")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
