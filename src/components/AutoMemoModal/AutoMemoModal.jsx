import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Checkbox, TextArea, ActionButton, showToast } from "@ui";
import { useReconcile } from "@store";
import { SPREADSHEET_ACCEPT } from "@utils/files";
import { aiMemoPromptFor } from "@utils/aiMemo";
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
// along: the prompt the model is given, which each account has of its own, and the reference file
// it follows, both kept with the data. `rows` are the rows on screen and `bankId` the account
// chosen on the left, if one is: the prompts shown are those of the accounts the rows belong to.
// `onConfirm` gets the rules ticked and the prompt of each of those accounts, by id.
export default function AutoMemoModal({ rows, bankId, onClose, onConfirm }) {
  const { t } = useTranslation();
  const { banks, settings, config, setAiMemoPrompt, setAiMemoReference, clearAiMemoReference } = useReconcile();
  const aiMemo = settings.aiMemo || {};
  const [selected, setSelected] = useState(readRules);
  const defaultPrompt = t("autoMemo.promptDefault");
  // The accounts the rows belong to, in the panel's order; the one chosen on the left comes up first.
  const accounts = useMemo(() => {
    const ids = new Set(rows.map((r) => r.bankId));
    return banks.filter((b) => ids.has(b.id));
  }, [banks, rows]);
  const [current, setCurrent] = useState(() => (accounts.some((b) => b.id === bankId) ? bankId : accounts[0]?.id || ""));
  const account = accounts.find((b) => b.id === current) || null;
  // The prompts edited here, by account, kept while the dialog is open so switching accounts loses
  // nothing; an account not edited yet shows the prompt on record, or the default.
  const [drafts, setDrafts] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  // Without the key on the server the model cannot be asked, and the rule is dimmed.
  const canAi = config.hasApiKey;
  const aiOn = selected.has("ai") && canAi;

  // What the model is given for an account: the text typed, or the default when the field is left
  // empty. The default is kept with the account as nothing, so it follows the language; a text of
  // the person's own is kept as written. An account is dirty when a run would be given something
  // other than what is on record.
  const textOf = (b) => drafts[b.id] ?? (b.aiMemoPrompt || defaultPrompt);
  const effectiveOf = (b) => textOf(b).trim() || defaultPrompt;
  const storedOf = (b) => (effectiveOf(b) === defaultPrompt ? "" : effectiveOf(b));
  const dirtyOf = (b) => effectiveOf(b) !== aiMemoPromptFor(b);

  // Keeps the account's prompt without running anything; a run keeps every edited prompt too.
  function savePrompt() {
    setAiMemoPrompt(account.id, storedOf(account));
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
    const prompts = {};
    if (aiOn) {
      for (const b of accounts) {
        if (dirtyOf(b)) setAiMemoPrompt(b.id, storedOf(b));
        prompts[b.id] = effectiveOf(b);
      }
    }
    onConfirm(rules, prompts);
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
            {account && (
              <div className="field">
                {/* The prompt is the account's. With several accounts on screen, the one whose
                    prompt is shown is picked at the right end; with one, it is named there. */}
                <div className={styles.promptHead}>
                  <label htmlFor="ai-memo-prompt">{t("autoMemo.prompt")}</label>
                  {accounts.length > 1 ? (
                    <select className={`select ${styles.account}`} value={current} onChange={(e) => setCurrent(e.target.value)} aria-label={t("autoMemo.account")}>
                      {accounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={styles.accountName} title={account.label}>
                      {account.label}
                    </span>
                  )}
                </div>
                <TextArea
                  id="ai-memo-prompt"
                  className={styles.prompt}
                  value={textOf(account)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [account.id]: e.target.value }))}
                  minHeight={92}
                />
                {/* What an empty field means, and the way to keep an edit without running a thing. */}
                <div className={styles.promptFoot}>
                  <span className={styles.hint}>{t("autoMemo.promptHint")}</span>
                  <button type="button" className="btn" onClick={savePrompt} disabled={!dirtyOf(account)}>
                    <SaveIcon />
                    {t("autoMemo.savePrompt")}
                  </button>
                </div>
              </div>
            )}
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
