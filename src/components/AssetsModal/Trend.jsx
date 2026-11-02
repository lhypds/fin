import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@ui";
import { fmtMoney } from "@utils/format";
import styles from "./assets.module.css";

// The plot's size in the viewBox, and the room kept for the axes' labels around it.
const W = 600;
const H = 220;
const PAD = { top: 8, right: 8, bottom: 20, left: 48 };

// Round steps for the value axis: about `count` of them from `min` to `max`, a 1, 2 or 5 times a
// power of ten apart.
function ticks(min, max, count = 4) {
  const raw = (max - min) / count || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const start = Math.floor(min / step);
  const list = [];
  for (let i = start; !list.length || list.at(-1) < max; i++) list.push(i * step);
  return list;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

// What the accounts held at the end of each month (`months`, oldest first) as lines: the total
// (`total`) in the ink colour and thicker, each account (`series`: { key, name, color, values })
// in its pie colour, a gap where an account had no statements yet. A line is hidden by unticking
// it in the legend, and the value axis fits the lines shown. Dragging across the plot zooms into
// those months; a double click, or the button above, shows them all again. Pointing at the plot
// picks the nearest month; the legend gives every line's value then, the last month's otherwise.
export default function Trend({ months: allMonths, total, series, currency }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  // The months zoomed into, as the first and last index into `allMonths`; null for all of them.
  const [range, setRange] = useState(null);
  // Where a drag began and where it is now, as indexes into the months shown.
  const [drag, setDrag] = useState(null);
  const [from, to] = range ?? [0, allMonths.length - 1];
  const months = allMonths.slice(from, to + 1);
  const lines = [{ key: "total", name: t("assets.total"), color: "var(--fg)", values: total, width: 2.5 }, ...series.map((s) => ({ ...s, width: 1.5 }))].map(
    (l) => ({ ...l, values: l.values.slice(from, to + 1) }),
  );
  const shown = lines.filter((l) => !hidden.has(l.key));
  const all = shown.flatMap((l) => l.values).filter((v) => v != null);
  const axis = all.length ? ticks(Math.min(...all), Math.max(...all)) : [0];
  const lo = axis[0];
  const hi = axis.at(-1) === lo ? lo + 1 : axis.at(-1);
  const span = W - PAD.left - PAD.right;
  const step = months.length > 1 ? span / (months.length - 1) : 1;
  const x = (i) => PAD.left + (months.length > 1 ? i * step : span / 2);
  const y = (v) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  // The line through a series' known months, broken where one is missing.
  const path = (values) =>
    values.map((v, i) => (v == null ? "" : `${i && values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).join("");
  // At most six month labels, evenly spaced, the last month always among them.
  const every = Math.ceil(months.length / 6);
  const labelled = months.map((_, i) => (months.length - 1 - i) % every === 0);
  const at = hover ?? months.length - 1;

  // The month nearest the pointer, as an index into the months shown.
  const indexAt = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(months.length - 1, Math.round((px - PAD.left) / step)));
  };
  const move = (e) => {
    const i = indexAt(e);
    setHover(i);
    if (drag) setDrag({ ...drag, end: i });
  };
  // A drag over two months or more zooms into them; a click alone does nothing.
  const release = () => {
    if (drag && drag.end !== drag.start) setRange([from + Math.min(drag.start, drag.end), from + Math.max(drag.start, drag.end)]);
    setDrag(null);
  };
  const toggle = (key, on) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.trend}>
      <div className={styles.trendHead}>
        <span className={styles.statNote}>{range ? `${months[0]} – ${months.at(-1)}` : t("assets.zoomHint")}</span>
        {range && (
          <button type="button" className="btn" onClick={() => setRange(null)}>
            {t("assets.zoomReset")}
          </button>
        )}
      </div>
      <svg
        className={styles.trendPlot}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        onMouseDown={(e) => {
          e.preventDefault();
          const i = indexAt(e);
          setDrag({ start: i, end: i });
        }}
        onMouseMove={move}
        onMouseUp={release}
        onMouseLeave={() => {
          setHover(null);
          setDrag(null);
        }}
        onDoubleClick={() => setRange(null)}
      >
        {axis.map((v) => (
          <g key={v}>
            <line className={v === 0 ? styles.zero : styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className={styles.tick} x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {compact.format(v)}
            </text>
          </g>
        ))}
        {months.map(
          (m, i) =>
            labelled[i] && (
              <text key={m} className={styles.tick} x={x(i)} y={H - 4} textAnchor="middle">
                {m}
              </text>
            ),
        )}
        {drag && drag.end !== drag.start && (
          <rect
            className={styles.selection}
            x={x(Math.min(drag.start, drag.end))}
            width={Math.abs(x(drag.end) - x(drag.start))}
            y={PAD.top}
            height={H - PAD.top - PAD.bottom}
          />
        )}
        {hover != null && <line className={styles.cursor} x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />}
        {/* The accounts under the total, the total drawn last so it stays on top. */}
        {[...shown].reverse().map((l) => (
          <g key={l.key}>
            <path d={path(l.values)} fill="none" stroke={l.color} strokeWidth={l.width} strokeLinejoin="round" strokeLinecap="round" />
            {/* A month standing alone has no line to show it, so it gets a dot; the hovered month a dot on every line. */}
            {l.values.map(
              (v, i) =>
                v != null &&
                (i === hover || (l.values[i - 1] == null && l.values[i + 1] == null)) && (
                  <circle key={i} className={styles.dot} cx={x(i)} cy={y(v)} r={4} fill={l.color} />
                ),
            )}
          </g>
        ))}
      </svg>
      <div className={styles.trendHead}>
        <span className="mono">{months[at]}</span>
        <span className={styles.statNote}>{t("assets.monthEnd")}</span>
      </div>
      <ul className={styles.legend}>
        {lines.map((l) => (
          <li key={l.key} className={[l.key === "total" && styles.totalRow, hidden.has(l.key) && styles.off].filter(Boolean).join(" ") || undefined}>
            <Checkbox className={styles.lineToggle} checked={!hidden.has(l.key)} onChange={(on) => toggle(l.key, on)}>
              <span className={styles.swatch} style={{ background: l.color }} />
              <span className={styles.legendName} title={l.name}>
                {l.name}
              </span>
            </Checkbox>
            <span className={`${styles.num} mono`}>{l.values[at] == null ? "—" : fmtMoney(l.values[at], currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
