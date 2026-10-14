import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import styles from "./automatch.module.css";

// What auto-match weighs, named as the dialog lists them: the amount, which alone can rule a pair
// out, then the date and the name, which set how sure the match is (utils/matching.js).
const RULES = ["amount", "date", "name"];

// What auto-match is about to do, before it does it: the rules it pairs by, one row each, how the
// result can be taken back, and the choice to go ahead or not. The twin of AutoMemoModal.
export default function AutoMatchModal({ onClose, onConfirm }) {
  const { t } = useTranslation();
  return (
    <Modal isOpen onClose={onClose} title={t("autoMatch.title")}>
      <div className={styles.body}>
        <p>{t("autoMatch.intro")}</p>
        <div className={styles.rules}>
          {RULES.map((rule) => (
            <div key={rule} className={styles.rule}>
              <div className={styles.ruleName}>{t(`autoMatch.rules.${rule}`)}</div>
              <div className={styles.ruleDesc}>{t(`autoMatch.rules.${rule}Desc`)}</div>
            </div>
          ))}
        </div>
        <p className={styles.note}>{t("autoMatch.note")}</p>
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          <button type="button" className="btn primary lg" onClick={onConfirm} autoFocus>
            {t("autoMatch.run")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
