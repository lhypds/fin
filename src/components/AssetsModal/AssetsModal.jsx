import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import { ALL, UNDATED, accountBalances, balanceBefore, monthLabel, monthOf, nextMonth } from "@utils/transactions";
import MonthPicker from "../Ledger/MonthPicker";
import { findInternalTransfers } from "@utils/transfers";
import styles from "./assets.module.css";

// One color per account in the pie, in order; they repeat past the tenth account. The same as
// tm's income analysis.
const COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

// The pie of `slices` ({ key, name, value, color }), drawn clockwise from the top.
function Pie({ slices, currency }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;
  const point = (turn) => [100 + 90 * Math.sin(turn * 2 * Math.PI), 100 - 90 * Math.cos(turn * 2 * Math.PI)];
  // Where each slice starts and ends, as a fraction of the turn.
  const ends = slices.reduce((list, s) => [...list, (list.at(-1) ?? 0) + s.value / total], []);
  return (
    <svg className={styles.pie} viewBox="0 0 200 200" role="img">
      {slices.map((s, i) => {
        const share = s.value / total;
        const start = i ? ends[i - 1] : 0;
        const at = ends[i];
        const tip = <title>{`${s.name}: ${fmtMoney(s.value, currency)} (${(share * 100).toFixed(1)}%)`}</title>;
        // A whole circle cannot be one arc.
        if (share >= 1)
          return (
            <circle key={s.key} cx="100" cy="100" r="90" fill={s.color}>
              {tip}
            </circle>
          );
        const [x1, y1] = point(start);
        const [x2, y2] = point(at);
        return (
          <path key={s.key} d={`M100 100 L${x1} ${y1} A90 90 0 ${share > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.color}>
            {tip}
          </path>
        );
      })}
    </svg>
  );
}

// An amount of money with its direction written out: "+" in, "-" out, no sign on zero.
const fmtSigned = (value, currency) => (value > 0 ? "+" : value < 0 ? "-" : "") + fmtMoney(Math.abs(value), currency);

// How many rows each side of a month lists by name; the rest share one slice.
const TOP = 10;

// A month's money in and money out in `currency`, in one account (`bankId`) or all of them,
// transfers between the accounts left out (they move money, they do not earn or spend it). Each
// side is its total and its rows, largest first.
function monthFlows(transactions, banks, month, currency, bankId) {
  const main = new Map(banks.map((b) => [b.id, b.currency || "JPY"]));
  const inMonth = transactions.filter(
    (tx) => monthOf(tx) === month && (!bankId || tx.bankId === bankId) && (tx.currency || main.get(tx.bankId) || "JPY") === currency,
  );
  const moved = new Set(findInternalTransfers(inMonth, transactions).flatMap((p) => [p.from.id, p.to.id]));
  const side = (field) => {
    const rows = inMonth
      .filter((tx) => !moved.has(tx.id) && Number(tx[field]) > 0)
      .map((tx) => ({ tx, value: Number(tx[field]) }))
      .sort((a, b) => b.value - a.value);
    return { rows, total: rows.reduce((sum, r) => sum + r.value, 0) };
  };
  return { spending: side("withdrawal"), income: side("deposit"), transfers: moved.size };
}

// One side of the month: its largest rows by name, the rest as one grey slice, as a pie with
// its legend. A row is named by its memo, or its statement text without one. `sign` is 1 for
// money in, -1 for money out, and writes the amounts "+" or "-".
function FlowChart({ title, side, sign, currency }) {
  const { t } = useTranslation();
  if (!side.rows.length) return null;
  const top = side.rows.slice(0, TOP);
  const rest = side.rows.slice(TOP);
  const slices = top.map((r, i) => ({
    key: r.tx.id,
    name: r.tx.memo?.trim() || r.tx.description || "",
    note: r.tx.date?.slice(5),
    value: r.value,
    color: COLORS[i % COLORS.length],
  }));
  if (rest.length)
    slices.push({
      key: "rest",
      name: t("assets.others", { count: rest.length }),
      value: rest.reduce((sum, r) => sum + r.value, 0),
      color: "var(--faint)",
    });
  return (
    <div className={styles.flow}>
      <h3 className={styles.flowTitle}>{title}</h3>
      <div className={styles.chart}>
        <Pie slices={slices} currency={currency} />
        <ul className={styles.legend}>
          {slices.map((s) => (
            <li key={s.key}>
              <span className={styles.swatch} style={{ background: s.color }} />
              {s.note && <span className={`${styles.note} mono`}>{s.note}</span>}
              <span className={styles.legendName} title={s.name}>
                {s.name}
              </span>
              <span className={`${styles.num} ${sign > 0 ? styles.income : styles.spending} mono`}>{fmtSigned(sign * s.value, currency)}</span>
              <span className={`${styles.num} ${styles.share} mono`}>{((s.value / side.total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// What the accounts hold, in one currency at a time (amounts in different currencies are not
// added up): the total, a pie of how it is split between the accounts, and every account with its
// balance. A balance comes from the account's statements or the one typed in its editor; an
// account below zero (a card owing) counts against the total but has no slice. A second tab has
// one month's income and spending, in the ledger's month (`month`) and account (`bankId`) at first.
export default function AssetsModal({ month: ledgerMonth, bankId: ledgerBankId = null, onClose }) {
  const { t } = useTranslation();
  const { banks, transactions } = useReconcile();

  // Every account's balance in every currency it holds, the unknown ones left out.
  const held = useMemo(
    () => banks.flatMap((bank) => accountBalances(bank, transactions).filter((b) => b.balance != null).map((b) => ({ ...b, bank }))),
    [banks, transactions],
  );
  // The currencies held, the one held by the most accounts first.
  const currencies = useMemo(() => {
    const count = new Map();
    for (const h of held) count.set(h.currency, (count.get(h.currency) || 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [held]);
  const [tab, setTab] = useState("assets");
  const [chosen, setChosen] = useState(null);
  const currency = currencies.includes(chosen) ? chosen : currencies[0] || "JPY";

  // The months with dated rows, newest first; the ledger's month to start with, or the newest
  // when it shows every month or the undated rows.
  const months = useMemo(() => [...new Set(transactions.map(monthOf))].filter((m) => m !== UNDATED).sort().reverse(), [transactions]);
  const [chosenMonth, setChosenMonth] = useState(ledgerMonth !== ALL && ledgerMonth !== UNDATED ? ledgerMonth : null);
  const month = months.includes(chosenMonth) ? chosenMonth : months[0];
  const pickerMonths = useMemo(() => months.map((key) => ({ key })), [months]);
  // One account, or all of them ("").
  const [chosenBank, setChosenBank] = useState(ledgerBankId || "");
  const flowBank = banks.some((b) => b.id === chosenBank) ? chosenBank : "";
  const flows = useMemo(
    () => month && monthFlows(transactions, banks, month, currency, flowBank),
    [transactions, banks, month, currency, flowBank],
  );
  const net = flows ? flows.income.total - flows.spending.total : 0;
  // What the account (or every account, added up) held when the month began and when it ended,
  // from the statements' balances; the accounts with none are left out, null when none has one.
  const monthBalances = useMemo(() => {
    if (!month) return null;
    const scoped = banks.filter((b) => !flowBank || b.id === flowBank);
    const sum = (date) => {
      const known = scoped.map((b) => balanceBefore(b, transactions, currency, date)).filter((v) => v != null);
      return known.length ? known.reduce((a, v) => a + Number(v), 0) : null;
    };
    return { start: sum(`${month}-01`), end: sum(`${nextMonth(month)}-01`) };
  }, [transactions, banks, month, currency, flowBank]);

  const rows = held.filter((h) => h.currency === currency).sort((a, b) => b.balance - a.balance);
  const total = rows.reduce((sum, r) => sum + r.balance, 0);
  const owing = rows.filter((r) => r.balance < 0).reduce((sum, r) => sum + r.balance, 0);
  const slices = rows.filter((r) => r.balance > 0).map((r, i) => ({ key: r.bank.id, name: r.bank.label, value: r.balance, color: COLORS[i % COLORS.length] }));
  const sliceTotal = slices.reduce((sum, s) => sum + s.value, 0);
  const unknown = banks.filter((bank) => accountBalances(bank, transactions).every((b) => b.balance == null)).length;

  return (
    <Modal isOpen onClose={onClose} title={t("assets.title")} className={styles.modal}>
      <div className={styles.body}>
        <div className={styles.tabs} role="tablist">
          {["assets", "monthly"].map((key) => (
            <button key={key} type="button" role="tab" className={styles.tab} aria-selected={tab === key} onClick={() => setTab(key)}>
              {t(key === "assets" ? "assets.total" : "assets.monthly")}
            </button>
          ))}
        </div>

        {(currencies.length > 1 || (tab === "monthly" && months.length > 0)) && (
          <div className={styles.controls}>
            {/* The month as the ledger's toolbar has it: a step back, the month and its list, a step forward. */}
            {tab === "monthly" && months.length > 0 && (
              <MonthPicker months={pickerMonths} index={months.indexOf(month)} label={(m) => monthLabel(m.key, t)} onChange={setChosenMonth} />
            )}
            {tab === "monthly" && months.length > 0 && (
              <label className={styles.control}>
                {t("assets.account")}
                <select className="select" value={flowBank} onChange={(e) => setChosenBank(e.target.value)}>
                  <option value="">{t("banks.all")}</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {currencies.length > 1 && (
              <label className={styles.control}>
                {t("bankEditor.currency")}
                <select className="select mono" value={currency} onChange={(e) => setChosen(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {tab === "assets" && (rows.length === 0 ? (
          <p className="muted">{t("assets.none")}</p>
        ) : (
          <>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("assets.total")}</span>
                <span className={`${styles.statValue} mono`}>{fmtMoney(total, currency)}</span>
                <span className={styles.statNote}>{t("assets.accounts", { count: rows.length })}</span>
              </div>
              {owing < 0 && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t("assets.owing")}</span>
                  <span className={`${styles.statValue} mono`}>{fmtMoney(owing, currency)}</span>
                  <span className={styles.statNote}>{t("assets.owingNote")}</span>
                </div>
              )}
            </div>

            {slices.length > 0 && (
              <div className={styles.chart}>
                <Pie slices={slices} currency={currency} />
                <ul className={styles.legend}>
                  {slices.map((s) => (
                    <li key={s.key}>
                      <span className={styles.swatch} style={{ background: s.color }} />
                      <span className={styles.legendName} title={s.name}>
                        {s.name}
                      </span>
                      <span className={`${styles.num} mono`}>{fmtMoney(s.value, currency)}</span>
                      <span className={`${styles.num} ${styles.share} mono`}>{((s.value / sliceTotal) * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("assets.account")}</th>
                    <th>{t("bankEditor.name")}</th>
                    <th>{t("bankEditor.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.bank.id}>
                      <td className={styles.legendName} title={r.bank.label}>
                        {r.bank.label}
                      </td>
                      <td className={styles.legendName} title={r.bank.name}>
                        {r.bank.name}
                      </td>
                      <td className="mono">{fmtMoney(r.balance, currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>{t("assets.sum")}</td>
                    <td className="mono">{fmtMoney(total, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ))}
        {tab === "assets" && unknown > 0 && <p className={styles.statNote}>{t("assets.unknown", { count: unknown })}</p>}

        {tab === "monthly" && !flows && <p className="muted">{t("assets.noFlows")}</p>}
        {tab === "monthly" && flows && (
          <>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("assets.income")}</span>
                <span className={`${styles.statValue} ${styles.income} mono`}>{fmtSigned(flows.income.total, currency)}</span>
                <span className={styles.statNote}>{t("assets.count", { count: flows.income.rows.length })}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("assets.spending")}</span>
                <span className={`${styles.statValue} ${styles.spending} mono`}>{fmtSigned(-flows.spending.total, currency)}</span>
                <span className={styles.statNote}>{t("assets.count", { count: flows.spending.rows.length })}</span>
              </div>
              {/* The balances either side of the month and what it left, in small type in one card. */}
              <dl className={`${styles.stat} ${styles.summary}`}>
                {monthBalances?.start != null && (
                  <>
                    <dt>{t("assets.startBalance")}</dt>
                    <dd className="mono">{fmtMoney(monthBalances.start, currency)}</dd>
                    <dt>{t("assets.endBalance")}</dt>
                    <dd className="mono">{fmtMoney(monthBalances.end, currency)}</dd>
                  </>
                )}
                <dt>{t("assets.net")}</dt>
                <dd className={`${net > 0 ? styles.income : net < 0 ? styles.spending : ""} mono`}>{fmtSigned(net, currency)}</dd>
                {flows.transfers > 0 && <p className={styles.statNote}>{t("assets.transfersNote", { count: flows.transfers })}</p>}
              </dl>
            </div>
            {!flows.income.rows.length && !flows.spending.rows.length ? (
              <p className="muted">{t("assets.noFlows")}</p>
            ) : (
              <div className={styles.flows}>
                <FlowChart title={t("assets.topSpending", { count: TOP })} side={flows.spending} sign={-1} currency={currency} />
                <FlowChart title={t("assets.topIncome", { count: TOP })} side={flows.income} sign={1} currency={currency} />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
