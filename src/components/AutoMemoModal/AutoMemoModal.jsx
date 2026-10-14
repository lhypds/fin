import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Checkbox, TextArea, ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { SPREADSHEET_ACCEPT } from "@utils/files";
import { UploadIcon, TrashIcon, LoaderIcon, SaveIcon } from "../icons";
import styles from "./automemo.module.css";

// The rules auto-memo writes by, named as the dialog lists them: a transfer between two of the
// accounts (ReconcileStore's runAutoMemo), and the model's memos (runAiMemo).
const RULES = ["transfer", "ai"];
// Which rules were ticked last time, remembered in the browser.
const RULES_PREF = "autoMemo.rules";

function readRules() {
  try {
    const list = JSON.parse(localStorage.getItem(RULES_PREF));
    if (Array.isArray(list)) return new Set(list.filter((r) => RULES.includes(r)));
  } catch {
    /* no preference yet */
  }
  return new Set(["transfer"]);
}

function writeRules(set) {
  try {
    localStorage.setItem(RULES_PREF, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

// What auto-memo is about to do, before it does it: the memos it writes, one row per rule with a
// box to leave a rule out, and the choice to go ahead or not. The AI rule brings its settings
// along: the prompt the model is given and the reference file it follows, kept with the data.
// `onConfirm` gets the rules ticked and the prompt.
export default function AutoMemoModal({ onClose, onConfirm }) {
  const { t } = useTranslation();
  const { settings, config, setAiMemoPrompt, setAiMemoReference, clearAiMemoReference } = useReconcile();
  const aiMemo = settings.aiMemo || {};
  const [selected, setSelected] = useState(readRules);
  const defaultPrompt = t("autoMemo.promptDefault");
  const [prompt, setPrompt] = useState(() => aiMemo.prompt || defaultPrompt);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  // Without the key on the server the model cannot be asked, and the rule is dimmed.
  const canAi = config.hasApiKey;
  const aiOn = selected.has("ai") && canAi;

  // What the model is given: the text typed, or the default when the field is left empty. The
  // default is kept with the data as nothing, so it follows the language; a text of the person's
  // own is kept as written. `savedPrompt` is what a run would be given before any edit here.
  const effectivePrompt = prompt.trim() || defaultPrompt;
  const storedPrompt = effectivePrompt === defaultPrompt ? "" : effectivePrompt;
  const savedPrompt = (aiMemo.prompt || "").trim() || defaultPrompt;
  const promptDirty = effectivePrompt !== savedPrompt;

  // Keeps the prompt without running anything; a run with an edited prompt keeps it too.
  function savePrompt() {
    setAiMemoPrompt(storedPrompt);
    showToast(t("toast.saved"));
  }

  function toggle(rule, on) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(rule);
      else next.delete(rule);
      return next;
    });
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await setAiMemoReference(file);
    } catch (err) {
      showToast(t("toast.referenceFailed", { message: err.message }), 6000);
    } finally {
      setUploading(false);
    }
  }

  function confirm() {
    const rules = RULES.filter((r) => selected.has(r) && (r !== "ai" || canAi));
    writeRules(selected);
    if (aiOn && promptDirty) setAiMemoPrompt(storedPrompt);
    onConfirm(rules, effectivePrompt);
  }

  return (
    <Modal isOpen onClose={onClose} title={t("autoMemo.title")}>
      <div className={styles.body}>
        <p>{t("autoMemo.intro")}</p>
        <div className={styles.rules}>
          {RULES.map((rule) => (
            <Checkbox
              key={rule}
              className={styles.rule}
              checked={selected.has(rule) && (rule !== "ai" || canAi)}
              disabled={rule === "ai" && !canAi}
              onChange={(on) => toggle(rule, on)}
            >
              <span className={styles.ruleText}>
                <span className={styles.ruleName}>{t(`autoMemo.rules.${rule}`)}</span>
                <span className={styles.ruleDesc}>{t(`autoMemo.rules.${rule}Desc`)}</span>
                {rule === "ai" && !canAi && <span className={styles.ruleWarn}>{t("statusBar.noApiKey")}</span>}
              </span>
            </Checkbox>
          ))}
        </div>
        {aiOn && (
          <div className={styles.ai}>
            <div className="field">
              <label htmlFor="ai-memo-prompt">{t("autoMemo.prompt")}</label>
              <TextArea id="ai-memo-prompt" className={styles.prompt} value={prompt} onChange={(e) => setPrompt(e.target.value)} minHeight={92} />
              {/* What an empty field means, and the way to keep an edit without running a thing. */}
              <div className={styles.promptFoot}>
                <span className={styles.hint}>{t("autoMemo.promptHint")}</span>
                <button type="button" className="btn" onClick={savePrompt} disabled={!promptDirty}>
                  <SaveIcon />
                  {t("autoMemo.savePrompt")}
                </button>
              </div>
            </div>
            <div className="field">
              <label>{t("autoMemo.reference")}</label>
              {/* The file on record with a way to drop it, or what a file would be for; and a way to
                  choose one either way, which replaces the one on record. */}
              <div className={styles.reference}>
                {aiMemo.referenceId ? (
                  <>
                    <span className={styles.fileName} title={aiMemo.referenceName}>
                      {aiMemo.referenceName}
                    </span>
                    <ActionButton tooltip={t("button.delete")} onClick={clearAiMemoReference} disabled={uploading}>
                      <TrashIcon />
                    </ActionButton>
                  </>
                ) : (
                  <span className={styles.hint}>{t("autoMemo.referenceHint")}</span>
                )}
                <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <LoaderIcon className="spin" /> : <UploadIcon />}
                  {uploading ? t("autoMemo.uploading") : t("autoMemo.chooseFile")}
                </button>
                <input ref={fileRef} type="file" accept={SPREADSHEET_ACCEPT} className={styles.fileInput} onChange={handleFile} />
              </div>
            </div>
          </div>
        )}
        <div className={styles.footer}>
          <button type="button" className="btn lg" onClick={onClose}>
            {t("button.cancel")}
          </button>
          <button type="button" className="btn primary lg" onClick={confirm} disabled={uploading || !RULES.some((r) => selected.has(r) && (r !== "ai" || canAi))} autoFocus>
            {t("autoMemo.run")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
