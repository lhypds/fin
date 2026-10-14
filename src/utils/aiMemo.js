import i18n from "../i18n/index.js";

// The prompt the model is given for an account's rows: the account's own (`aiMemoPrompt`), or the
// default in the current language when it has none. The default is kept with the account as
// nothing, so it follows the language; a text of the person's own is kept as written.
export function aiMemoPromptFor(bank) {
  return (bank?.aiMemoPrompt || "").trim() || i18n.t("autoMemo.promptDefault");
}
