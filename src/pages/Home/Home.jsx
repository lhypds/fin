import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher, BankPanel, ReceiptPanel, Ledger, PreviewModal, BackupModal } from "@components";
import { ChevronLeftIcon, ChevronRightIcon, ZapIcon, EditIcon, UnlinkIcon, SearchIcon, XIcon, UserIcon, ArchiveIcon } from "@components/icons";
import { showToast } from "@ui";
import { useReconcile, useAuth } from "@store";
import { ledgerView } from "@utils/transactions";
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

export default function Home() {
  const { t } = useTranslation();
  const { ready, loadError, config, stats, progress, banks, transactions, runAutoMatch, runAutoMemo, clearResults } = useReconcile();
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
  const canAutoMatch = shown.rows.some((tx) => !tx.receiptIds?.length) && stats.unmatchedReceipts > 0;
  const canClear = shown.rows.some((tx) => tx.receiptIds?.length || tx.confirmed || tx.memo);
  const [preview, setPreview] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => writeFlag("panel.left", leftOpen), [leftOpen]);
  useEffect(() => writeFlag("panel.right", rightOpen), [rightOpen]);
  useEffect(() => writePref("bank.selected", activeBankId || ""), [activeBankId]);
  useEffect(() => writePref("ledger.month", month), [month]);

  // The account menu closes the way stash's does: on a press anywhere outside it, or on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e) {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const closePreview = useCallback(() => setPreview(null), []);
  const selectBank = useCallback((id) => setBankId(id || ""), []);
  // An import shows what it brought in: the account it went to, at its newest month.
  const handleImported = useCallback((id, latestMonth) => {
    setBankId(id);
    if (latestMonth) setMonth(latestMonth);
  }, []);

  function handleAutoMatch() {
    const n = runAutoMatch(shown.rows);
    showToast(n ? t("toast.matched", { count: n }) : t("toast.noMatches"));
  }

  // Writes the memos the rows on screen earn by rule; so far only the internal transfer one.
  function handleAutoMemo() {
    const n = runAutoMemo(shown.rows);
    showToast(n ? t("toast.memoed", { count: n }) : t("toast.noTransfers"));
  }

  // Clears the reconciliation result of the rows on screen only, the same rows auto-match pairs.
  function handleClear() {
    if (!window.confirm(t("header.clearConfirm"))) return;
    const n = clearResults(shown.rows);
    showToast(t("toast.cleared", { count: n }));
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
          <button type="button" className="btn" onClick={handleAutoMatch} disabled={!canAutoMatch}>
            <ZapIcon />
            {t("header.autoMatch")}
          </button>
          <button type="button" className="btn" onClick={handleAutoMemo} disabled={!shown.rows.length}>
            <EditIcon />
            {t("header.autoMemo")}
          </button>
          <button type="button" className="btn" onClick={handleClear} disabled={!canClear}>
            <UnlinkIcon />
            {t("header.clear")}
          </button>
          <button type="button" className="btn" onClick={() => setBackupOpen(true)}>
            <ArchiveIcon />
            {t("header.backup")}
          </button>
          {/* The account, as stash's bar has it: the language switcher with a profile button
              joined to it, which opens a menu holding the name and the way out. */}
          <div className={styles.account}>
            <LanguageSwitcher />
            <div className={styles.profileWrap} ref={menuRef} data-open={menuOpen} onMouseLeave={() => setMenuOpen(false)}>
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
        <span>{t("statusBar.transactions", { tx: stats.tx, matched: stats.matchedTx, unmatched: stats.unmatchedTx })}</span>
        <span className={styles.divider} />
        <span>{t("statusBar.receipts", { total: stats.receipts, open: stats.unmatchedReceipts })}</span>
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
    </div>
  );
}
