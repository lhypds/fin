import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, showToast } from "@ui";
import { EXPORT_COLUMNS, EXPORT_FORMATS, exportLedger } from "@utils/export";
import { monthLabel } from "@utils/transactions";
import { DownloadIcon, LoaderIcon } from "../icons";
import styles from "./export.module.css";

// Which format was chosen last time, remembered in the browser.
const FORMAT_PREF = "export.format";

function readFormat() {
  try {
    const v = localStorage.getItem(FORMAT_PREF);
    if (EXPORT_FORMATS.includes(v)) return v;
  } catch {
    /* no preference yet */
  }
  return EXPORT_FORMATS[0];
}

function writeFormat(format) {
  try {
    localStorage.setItem(FORMAT_PREF, format);
  } catch {
    /* ignore */
  }
}

// Downloads the rows on screen (one account or all of them, one month) with their memos, as an
// Excel workbook or a CSV: what is about to be exported, the format as a stack of rows with a
// square radio dot, and the choice to go ahead or not. `bank` is the account shown, or null for
// all of them; `month` the month key as the ledger has it.
export default function ExportModal({ rows, bank, month, onClose }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState(readFormat);
  const [busy, setBusy] = useState(false);
  const scope = bank?.label || t("banks.all");
  // The month as the ledger's picker writes it, in the text and in the file's name.
  const monthText = monthLabel(month, t);

  async function run() {
    writeFormat(format);
    setBusy(true);
    try {
      await exportLedger({
        rows,
        format,
        header: EXPORT_COLUMNS.map((key) => t(`export.columns.${key}`)),
        name: `${scope} ${monthText}`,
      });
      showToast(t("toast.exported", { count: rows.length }));
      onClose();
    } catch (err) {
      showToast(t("toast.exportFailed", { message: err.message }), 6000);
      setBusy(false);
    }
  }

  // Nothing closes the dialog while the file is being made.
  return (
    <Modal isOpen onClose={busy ? undefined : onClose} title={t("export.title")}>
      <div className={styles.body}>
        <p>{t("export.intro", { scope, month: monthText, count: rows.length })}</p>
        <div className={styles.options}>
          {EXPORT_FORMATS.map((f) => (
            <label key={f} className={styles.option} data-active={format === f}>
              <input
                type="radio"
                name="export-format"
                className={styles.radio}
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                disabled={busy}
              />
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.optionText}>
                <span className={styles.optionName}>{t(`export.formats.${f}`)}</span>
                <span className={styles.optionDesc}>{t(`export.formats.${f}Desc`)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose} disabled={busy}>
            {t("button.cancel")}
          </button>
          <button type="button" className="btn primary lg" onClick={run} disabled={busy || !rows.length} autoFocus>
            {busy ? <LoaderIcon className="spin" /> : <DownloadIcon />}
            {t("export.run")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
