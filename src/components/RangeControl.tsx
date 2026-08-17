"use client";

/*
 * The time-window control the Dashboard and Analysis pages share.
 *
 * Shared as a component rather than copied, because the two pages must answer
 * to the same windows: a "24 mo" that meant one thing on one page and another
 * thing on the other would be the range-control equivalent of the bug where
 * the monthly ledger ignored the range entirely. The helpers travel with it
 * for the same reason — the filtering and the label are part of what "the
 * range" means, not per-page details.
 */

/** A rolling window, everything, or one specific year ("y2024"). */
export type Range = "12" | "24" | "all" | `y${string}`;

/** The rows of a monthly series that fall inside the range. */
export function filterByRange<T extends { month: string }>(
  rows: T[],
  range: Range
): T[] {
  if (range === "all") return rows;
  if (range.startsWith("y")) {
    const y = range.slice(1);
    return rows.filter((r) => r.month.startsWith(y));
  }
  return rows.slice(-Number(range));
}

/** What to call the window on screen: "Last 24 mo", "2024", "All time". */
export function windowLabelFor(range: Range): string {
  if (range === "all") return "All time";
  if (range.startsWith("y")) return range.slice(1);
  return `Last ${range} mo`;
}

export function RangeControl({
  range,
  years,
  onChange,
}: {
  range: Range;
  /** every year the ledger touches, newest first — the Year… options */
  years: string[];
  onChange: (r: Range) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-line">
        {(["12", "24", "all"] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => onChange(r)}
            className={`t-display px-3 py-1 text-[11.5px] tracking-[0.1em] transition-colors ${
              range === r
                ? "bg-[var(--tint-accent-strong)] text-ink"
                : "text-mute hover:text-ink2"
            }`}
          >
            {r === "all" ? "All" : `${r} mo`}
          </button>
        ))}
      </div>
      <select
        className="field !w-auto !py-1 text-[11.5px]"
        value={range.startsWith("y") ? range : ""}
        onChange={(e) => e.target.value && onChange(e.target.value as Range)}
      >
        <option value="">Year…</option>
        {years.map((y) => (
          <option key={y} value={`y${y}`}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
