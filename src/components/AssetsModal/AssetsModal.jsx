import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { useReconcile } from "@store";
import { fmtMoney } from "@utils/format";
import { accountBalances } from "@utils/transactions";
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

// What the accounts hold, in one currency at a time (amounts in different currencies are not
// added up): the total, a pie of how it is split between the accounts, and every account with its
// balance. A balance comes from the account's statements or the one typed in its editor; an
// account below zero (a card owing) counts against the total but has no slice.
export default function AssetsModal({ onClose }) {
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
  const [chosen, setChosen] = useState(null);
  const currency = currencies.includes(chosen) ? chosen : currencies[0];

  const rows = held.filter((h) => h.currency === currency).sort((a, b) => b.balance - a.balance);
  const total = rows.reduce((sum, r) => sum + r.balance, 0);
  const owing = rows.filter((r) => r.balance < 0).reduce((sum, r) => sum + r.balance, 0);
  const slices = rows.filter((r) => r.balance > 0).map((r, i) => ({ key: r.bank.id, name: r.bank.label, value: r.balance, color: COLORS[i % COLORS.length] }));
  const sliceTotal = slices.reduce((sum, s) => sum + s.value, 0);
  const unknown = banks.filter((bank) => accountBalances(bank, transactions).every((b) => b.balance == null)).length;

  return (
    <Modal isOpen onClose={onClose} title={t("assets.title")} className={styles.modal}>
      <div className={styles.body}>
        {currencies.length > 1 && (
          <div className={styles.controls}>
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
          </div>
        )}

        {rows.length === 0 ? (
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
        )}
        {unknown > 0 && <p className={styles.statNote}>{t("assets.unknown", { count: unknown })}</p>}
      </div>
    </Modal>
  );
}
