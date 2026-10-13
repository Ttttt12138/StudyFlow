import type { ReactNode } from "react";

/*
 * Small, dependency-free charts for tool panels. Every figure is drawn from values the
 * caller already has from the API; nothing here estimates or converts money.
 */

const num = (value: string | number | null | undefined) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

/** Horizontal bars comparing one measure across options; the best one is marked. */
export function BarCompare({ rows, label }: { rows: { key: string; label: ReactNode; value: number; display: ReactNode; best?: boolean; note?: ReactNode }[]; label: string }) {
  const peak = Math.max(...rows.map((row) => row.value), 0) || 1;
  return <ul className="chart-bars" aria-label={label}>{rows.map((row) => <li key={row.key} className={row.best ? "is-best" : ""}>
    <span className="chart-bars-label">{row.label}</span>
    <span className="chart-bars-track" aria-hidden="true"><span style={{ width: `${Math.max(4, row.value / peak * 100)}%` }} /></span>
    <span className="chart-bars-value">{row.display}{row.note && <small>{row.note}</small>}</span>
  </li>)}</ul>;
}

export type Slice = { key: string; label: ReactNode; value: number; color: string; display?: ReactNode };

/** Composition ring with a legend; zero-value slices are left out. */
export function Donut({ slices, label, center }: { slices: Slice[]; label: string; center?: ReactNode }) {
  const shown = slices.filter((slice) => slice.value > 0);
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 25;
  return <figure className="chart-donut">
    <div className="chart-donut-ring">
      <svg viewBox="0 0 42 42" role="img" aria-label={label}>
        <circle cx="21" cy="21" r="15.9" fill="none" className="chart-track" strokeWidth="4.5" />
        {total > 0 && shown.map((slice) => {
          const share = slice.value / total * 100;
          const circle = <circle key={slice.key} cx="21" cy="21" r="15.9" fill="none" stroke={slice.color} strokeWidth="4.5"
            strokeDasharray={`${Math.max(share - .6, .1)} ${100 - Math.max(share - .6, .1)}`} strokeDashoffset={offset} />;
          offset -= share;
          return circle;
        })}
      </svg>
      {center && <div className="chart-donut-center">{center}</div>}
    </div>
    <figcaption><ul className="chart-legend">{shown.map((slice) => <li key={slice.key}>
      <span className="chart-swatch" style={{ background: slice.color }} aria-hidden="true" />
      <span>{slice.label}</span>
      <strong>{total ? Math.round(slice.value / total * 1000) / 10 : 0}%</strong>
      {slice.display && <small>{slice.display}</small>}
    </li>)}</ul></figcaption>
  </figure>;
}

/** Amount ranges of several tiers on one scale, with a marker for the entered amount. */
export function RangeTrack({ tiers, value, label, format }: {
  tiers: { key: string; label: ReactNode; min: number; max: number }[]; value: number | null; label: string; format: (n: number) => string;
}) {
  if (!tiers.length) return null;
  const low = Math.min(...tiers.map((tier) => tier.min)), high = Math.max(...tiers.map((tier) => tier.max));
  // A log scale keeps a 100–90,000 spread readable; ranges starting at 0 fall back to linear.
  const log = low > 0 && high / low > 20;
  const at = (n: number) => { const v = Math.min(Math.max(n, low), high);
    return high === low ? 0 : log ? (Math.log(v) - Math.log(low)) / (Math.log(high) - Math.log(low)) * 100 : (v - low) / (high - low) * 100; };
  const outside = value !== null && value > 0 && (value < low || value > high);
  return <figure className="chart-range" aria-label={label}>
    <div className="chart-range-rows">{tiers.map((tier) => <div key={tier.key} className="chart-range-row">
      <span className="chart-range-name">{tier.label}</span>
      <span className="chart-range-track"><span style={{ left: `${at(tier.min)}%`, width: `${Math.max(2, at(tier.max) - at(tier.min))}%` }} /></span>
    </div>)}
      {value !== null && value > 0 && <span className={`chart-range-marker${outside ? " is-out" : ""}`} style={{ left: `calc(var(--range-name) + (100% - var(--range-name)) * ${at(value) / 100})` }} aria-hidden="true" />}
    </div>
    <figcaption className="chart-axis"><span>{format(low)}</span><span>{format(high)}</span></figcaption>
  </figure>;
}

/** One quantity against a maximum, optionally with a second "after" value. */
export function LevelBar({ value, max, after, tone }: { value: number; max: number; after?: number; tone?: "warn" }) {
  const pct = (n: number) => `${max > 0 ? Math.min(100, Math.max(0, n / max * 100)) : 0}%`;
  return <span className={`chart-level${tone === "warn" ? " is-warn" : ""}`} aria-hidden="true">
    <span className="chart-level-value" style={{ width: pct(value) }} />
    {after !== undefined && <span className="chart-level-after" style={{ width: pct(after) }} />}
  </span>;
}

/** Status progression; a failed or refunded order stops at its step in red. */
export function StepTrack({ steps, current, failed, label }: { steps: string[]; current: number; failed?: boolean; label: string }) {
  return <ol className="chart-steps" aria-label={label}>{steps.map((step, index) => <li key={step}
    className={index < current ? "is-done" : index === current ? failed ? "is-failed" : "is-current" : ""} aria-current={index === current ? "step" : undefined}>
    <span aria-hidden="true" />{step}</li>)}</ol>;
}

/** A date window (for example an expected arrival) on an axis, with an optional deadline marker. */
export function DateWindow({ start, end, deadline, from, to, labels }: {
  start: string; end: string; deadline?: string | null; from: string; to: string; labels: { start: string; end: string; deadline?: string };
}) {
  const t = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).getTime();
  const lo = t(from), hi = t(to), span = Math.max(hi - lo, 1);
  const at = (d: string) => Math.min(100, Math.max(0, (t(d) - lo) / span * 100));
  const late = !!deadline && t(end) > t(deadline);
  return <figure className={`chart-window${late ? " is-late" : ""}`}>
    <div className="chart-window-axis">
      <span className="chart-window-span" style={{ left: `${at(start)}%`, width: `${Math.max(2, at(end) - at(start))}%` }} />
      {deadline && <span className="chart-window-deadline" style={{ left: `${at(deadline)}%` }} />}
    </div>
    <figcaption className="chart-axis"><span>{labels.start}</span>{labels.deadline && <span className="chart-window-note">{labels.deadline}</span>}<span>{labels.end}</span></figcaption>
  </figure>;
}

/** A line over evenly spaced points, with an optional straight "pace" reference line. */
export function LineChart({ points, label, pace, max, height = 96 }: { points: number[]; label: string; pace?: number; max?: number; height?: number }) {
  if (points.length < 2) return null;
  const top = Math.max(max ?? 0, pace ?? 0, ...points) || 1;
  const w = 100, h = 40, step = w / (points.length - 1);
  const xy = (v: number, i: number) => `${(i * step).toFixed(2)},${(h - v / top * (h - 2)).toFixed(2)}`;
  const line = points.map(xy).join(" ");
  return <svg className="chart-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
    <polygon className="chart-line-area" points={`0,${h} ${line} ${w},${h}`} />
    {pace !== undefined && <line className="chart-line-pace" x1="0" y1={h} x2={w} y2={h - pace / top * (h - 2)} />}
    <polyline className="chart-line-stroke" points={line} />
    <circle className="chart-line-end" cx={w} cy={h - points[points.length - 1] / top * (h - 2)} r="1.4" />
  </svg>;
}

/** Days of one month as a strip; marked days carry a dot (for example a bill due date). */
export function MonthStrip({ month, marks, today, label }: { month: string; marks: { day: number; tone: "due" | "paid" | "overdue" }[]; today?: number; label: string }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const byDay = new Map(marks.map((mark) => [mark.day, mark.tone]));
  return <ol className="chart-month" aria-label={label}>{Array.from({ length: days }, (_, i) => i + 1).map((day) =>
    <li key={day} className={`${byDay.get(day) ? `is-${byDay.get(day)}` : ""}${day === today ? " is-today" : ""}`}>
      <span>{day}</span></li>)}</ol>;
}

/** Stacked shares in one bar (for example covered vs. gap, paid vs. unpaid). */
export function StackBar({ parts, label }: { parts: { key: string; value: number; tone: "mint" | "gold" | "muted" | "red"; label: ReactNode }[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) || 1;
  return <figure className="chart-stack">
    <span className="chart-stack-bar" role="img" aria-label={label}>{parts.filter((part) => part.value > 0).map((part) =>
      <span key={part.key} className={`is-${part.tone}`} style={{ width: `${part.value / total * 100}%` }} />)}</span>
    <figcaption className="chart-legend is-inline">{parts.map((part) => <span key={part.key} className={`is-${part.tone}`}>{part.label}</span>)}</figcaption>
  </figure>;
}

export { num };
