import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher, BankPanel, ReceiptPanel, Ledger, PreviewModal, BackupModal, AutoMatchModal, AutoMemoModal } from "@components";
import { ChevronLeftIcon, ChevronRightIcon, ZapIcon, EditIcon, UnlinkIcon, SearchIcon, XIcon, UserIcon, ArchiveIcon, LoaderIcon } from "@components/icons";
import { showToast } from "@ui";
import { useReconcile, useAuth } from "@store";
import { ledgerView, UNDATED } from "@utils/transactions";
import styles from "./home.module.css";

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const readFlag = (key, fallback) => {
  const v = readPref(key, null);
  return v == null ? fallback : v === "1";
};
const writeFlag = (key, value) => writePref(key, value ? "1" : "0");

// A menu closes the way stash's does: on a press anywhere outside `ref`, or on Escape.
function useCloseOnOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (!ref.current?.contains(e.target)) close();
    }
    function handleKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, open, close]);
}

export default function Home() {
  const { t } = useTranslation();
  const {
    ready,
    loadError,
    config,
    stats,
    progress,
    banks,
    transactions,
    receiptById,
    runAutoMatch,
    runAutoMemo,
    runAiMemo,
    clearAutoMatches,
    clearAutoMemos,
    clearConfirmations,
    removeTransactions,
  } = useReconcile();
  const { user, logout } = useAuth();
  const ocrTotal = progress.statement.total + progress.receipt.total;
  const ocrDone = progress.statement.done + progress.receipt.done;
  const ocrPercent = ocrTotal ? Math.round((ocrDone / ocrTotal) * 100) : 0;
  const [leftOpen, setLeftOpen] = useState(() => readFlag("panel.left", true));
  const [rightOpen, setRightOpen] = useState(() => readFlag("panel.right", true));
  // What the ledger shows: one account or all of them, and one month. Both are remembered across
  // reloads; an account that has since been deleted falls back to all of them.
  const [bankId, setBankId] = useState(() => readPref("bank.selected", ""));
  const [month, setMonth] = useState(() => readPref("ledger.month", ""));
  const activeBankId = banks.some((b) => b.id === bankId) ? bankId : null;
  // What the ledger has on screen. Auto-match pairs only these rows: other months and other
  // accounts are left as they are.
  const shown = useMemo(() => ledgerView(transactions, activeBankId, month), [transactions, activeBankId, month]);
  // The status bar counts the rows of the bank and month on screen, not every transaction stored:
  // all of them, then the confirmed and the unconfirmed, in the order of the ledger's tabs.
  const shownStats = useMemo(() => {
    const confirmed = shown.rows.filter((tx) => tx.confirmed).length;
    return { tx: shown.rows.length, confirmed, unconfirmed: shown.rows.length - confirmed };
  }, [shown]);
  const canAutoMatch = shown.rows.some((tx) => !tx.receiptIds?.length) && stats.unmatchedReceipts > 0;
  // What the clear menu can take back: a receipt auto-match put on an unconfirmed row, a note
  // auto-memo wrote, a confirmation, or the rows themselves.
  const canClearAutoMatch = shown.rows.some((tx) => !tx.confirmed && tx.receiptIds?.some((id) => receiptById.get(id)?.confidence != null));
  const canClearAutoMemo = shown.rows.some((tx) => tx.autoMemo);
  const canClearConfirmed = shown.rows.some((tx) => tx.confirmed);
  const canClearMonth = shown.rows.length > 0;
  const canClear = canClearAutoMatch || canClearAutoMemo || canClearConfirmed || canClearMonth;
  const [preview, setPreview] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [autoMatchOpen, setAutoMatchOpen] = useState(false);
  const [autoMemoOpen, setAutoMemoOpen] = useState(false);
  // While the model is writing memos: the button waits, and a toast says so.
  const [generating, setGenerating] = useState(false);
  const [query, setQuery] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const clearRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => writeFlag("panel.left", leftOpen), [leftOpen]);
  useEffect(() => writeFlag("panel.right", rightOpen), [rightOpen]);
  useEffect(() => writePref("bank.selected", activeBankId || ""), [activeBankId]);
  useEffect(() => writePref("ledger.month", month), [month]);

  const closeClear = useCallback(() => setClearOpen(false), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useCloseOnOutside(clearRef, clearOpen, closeClear);
  useCloseOnOutside(menuRef, menuOpen, closeMenu);

  const closePreview = useCallback(() => setPreview(null), []);
  const selectBank = useCallback((id) => setBankId(id || ""), []);
  // An import shows what it brought in: the account it went to, at its newest month.
  const handleImported = useCallback((id, latestMonth) => {
    setBankId(id);
    if (latestMonth) setMonth(latestMonth);
  }, []);

  // Pairs the rows on screen with the open receipts, once the dialog listing the rules has been
  // agreed to.
  function handleAutoMatch() {
    setAutoMatchOpen(false);
    const n = runAutoMatch(shown.rows);
    showToast(n ? t("toast.matched", { count: n }) : t("toast.noMatches"));
  }

  // Writes the memos the rows on screen earn by the rules ticked in the dialog: the transfer
  // rule at once, and the model's memos once it has answered, with a toast up while it works.
  async function handleAutoMemo(rules, prompt) {
    setAutoMemoOpen(false);
    let n = runAutoMemo(shown.rows, rules);
    if (!rules.includes("ai")) {
      showToast(n ? t("toast.memoed", { count: n }) : t("toast.noTransfers"));
      return;
    }
    setGenerating(true);
    showToast(t("toast.generating"), null);
    try {
      n += await runAiMemo(shown.rows, prompt);
      showToast(n ? t("toast.memoed", { count: n }) : t("toast.noMemos"));
    } catch (err) {
      showToast(t("toast.generateFailed", { message: err.message }), 6000);
    } finally {
      setGenerating(false);
    }
  }

  // The three things the clear menu takes back, each on the rows on screen only, the same rows
  // auto-match and auto-memo work on. Each asks first.
  function handleClearAutoMatch() {
    setClearOpen(false);
    if (!window.confirm(t("header.clearAutoMatchConfirm"))) return;
    const n = clearAutoMatches(shown.rows);
    showToast(t("toast.autoMatchesCleared", { count: n }));
  }

  function handleClearAutoMemo() {
    setClearOpen(false);
    if (!window.confirm(t("header.clearAutoMemoConfirm"))) return;
    const n = clearAutoMemos(shown.rows);
    showToast(t("toast.autoMemosCleared", { count: n }));
  }

  function handleClearConfirmed() {
    setClearOpen(false);
    if (!window.confirm(t("header.clearConfirmedConfirm"))) return;
    const n = clearConfirmations(shown.rows);
    showToast(t("toast.confirmationsCleared", { count: n }));
  }

  function handleClearMonth() {
    setClearOpen(false);
    // The month as the ledger's picker writes it.
    const label = shown.current === UNDATED ? t("ledger.undated") : shown.current.replace("-", " - ");
    if (!window.confirm(t("header.clearMonthConfirm", { month: label, count: shown.rows.length }))) return;
    const n = removeTransactions(shown.rows);
    showToast(t("toast.rowsRemoved", { count: n }));
  }

  if (loadError) {
    return (
      <div className={styles.loadError}>
        <div>{t("app.loadError")}</div>
        <div className="muted mono">{loadError}</div>
      </div>
    );
  }
  if (!ready) return null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.logo}>{t("app.title")}</h1>
          {/* English has no subtitle; Chinese and Japanese name the job beside the logo. */}
          {t("app.subtitle") && <span className="muted">{t("app.subtitle")}</span>}
        </div>
        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={`input ${styles.searchInput}`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("header.search")}
            aria-label={t("header.search")}
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery("")}
              title={t("header.clearSearch")}
              aria-label={t("header.clearSearch")}
            >
              <XIcon />
            </button>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn" onClick={() => setAutoMatchOpen(true)} disabled={!canAutoMatch}>
            <ZapIcon />
            {t("header.autoMatch")}
          </button>
          <button type="button" className="btn" onClick={() => setAutoMemoOpen(true)} disabled={!shown.rows.length || generating}>
            {generating ? <LoaderIcon className="spin" /> : <EditIcon />}
            {t("header.autoMemo")}
          </button>
          {/* Clearing is four things under one button, as a menu like the account's: the auto
              matches, the auto memos, the confirmations, or the rows of the month on screen. */}
          <div className={styles.menuWrap} ref={clearRef} data-open={clearOpen} onMouseLeave={closeClear}>
            <button type="button" className="btn" onClick={() => setClearOpen((v) => !v)} disabled={!canClear} aria-haspopup="menu" aria-expanded={clearOpen}>
              <UnlinkIcon />
              {t("header.clear")}
            </button>
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" onClick={handleClearAutoMatch} disabled={!canClearAutoMatch}>
                {t("header.clearAutoMatch")}
              </button>
              <button type="button" role="menuitem" onClick={handleClearAutoMemo} disabled={!canClearAutoMemo}>
                {t("header.clearAutoMemo")}
              </button>
              <button type="button" role="menuitem" onClick={handleClearConfirmed} disabled={!canClearConfirmed}>
                {t("header.clearConfirmed")}
              </button>
              <button type="button" role="menuitem" onClick={handleClearMonth} disabled={!canClearMonth}>
                {t("header.clearMonth")}
              </button>
            </div>
          </div>
          <button type="button" className="btn" onClick={() => setBackupOpen(true)}>
            <ArchiveIcon />
            {t("header.backup")}
          </button>
          {/* The account, as stash's bar has it: the language switcher with a profile button
              joined to it, which opens a menu holding the name and the way out. */}
          <div className={styles.account}>
            <LanguageSwitcher />
            <div className={styles.menuWrap} ref={menuRef} data-open={menuOpen} onMouseLeave={closeMenu}>
              <button
                type="button"
                className={styles.profile}
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={user}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <UserIcon />
              </button>
              <div className={styles.menu}>
                <span>@{user}</span>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                >
                  {t("login.logout")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.drawer} data-open={leftOpen}>
          <BankPanel selectedId={activeBankId} onSelect={selectBank} onImported={handleImported} />
        </aside>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setLeftOpen((v) => !v)}
          title={leftOpen ? t("panel.closeLeft") : t("panel.openLeft")}
          aria-label={leftOpen ? t("panel.closeLeft") : t("panel.openLeft")}
        >
          {leftOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </button>

        <main className={styles.main}>
          <Ledger bankId={activeBankId} month={month} onMonthChange={setMonth} query={query} onPreviewReceipt={setPreview} />
        </main>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => setRightOpen((v) => !v)}
          title={rightOpen ? t("panel.closeRight") : t("panel.openRight")}
          aria-label={rightOpen ? t("panel.closeRight") : t("panel.openRight")}
        >
          {rightOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        <aside className={styles.drawer} data-open={rightOpen}>
          <ReceiptPanel onPreview={setPreview} />
        </aside>
      </div>

      <footer className={`${styles.statusBar} mono`}>
        <span>{t("statusBar.transactions", shownStats)}</span>
        {ocrTotal > 0 && (
          <span className={styles.progress}>
            <span className="tag info">{t("statusBar.ocrProgress", { done: ocrDone, total: ocrTotal, percent: ocrPercent })}</span>
            <span className={styles.bar} role="progressbar" aria-valuenow={ocrPercent} aria-valuemin={0} aria-valuemax={100}>
              <span className={styles.fill} style={{ width: `${ocrPercent}%` }} />
            </span>
          </span>
        )}
        <span className={styles.spacer} />
        {!config.hasApiKey && <span className="tag err">{t("statusBar.noApiKey")}</span>}
        <span className="muted" title={t("statusBar.model")}>
          {config.model}
        </span>
      </footer>

      {preview && <PreviewModal id={preview} onClose={closePreview} />}
      {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} />}
      {autoMatchOpen && <AutoMatchModal onClose={() => setAutoMatchOpen(false)} onConfirm={handleAutoMatch} />}
      {autoMemoOpen && <AutoMemoModal onClose={() => setAutoMemoOpen(false)} onConfirm={handleAutoMemo} />}
    </div>
  );
}
