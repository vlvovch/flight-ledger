import type { MonthlySummary } from "./metrics";

const round2 = (n: number) => Math.round(n * 100) / 100;

/*
 * Kept out of metrics.ts because the charts need it in the browser, and
 * metrics.ts reaches the database — importing it as a VALUE from a client
 * component drags node:sqlite into the bundle. A type-only import erases; a
 * function does not. Nothing here touches anything but its arguments.
 */

export interface RollingCpmPoint {
  month: string;
  /** null until the window is full, and where the window has no miles */
  gross: number | null;
  personal: number | null;
}

/**
 * Trailing rolling cost-per-mile.
 *
 * WEIGHTED, not the mean of the monthly figures. CPM is a ratio, and averaging
 * ratios gives a month with one cheap short hop the same say as a month with
 * twenty long-haul segments. The window sums cost and miles separately and
 * divides once at the end, which is what "cents per mile over the last N
 * months" actually means — and it's the same arithmetic the year-to-date
 * figures already use.
 *
 * A point appears only once the window is FULL. A "12-month average" plotted
 * at month three is a three-month average wearing the wrong label, and the
 * early, noisiest part of the series is exactly where that misleads.
 */
export function rollingCpm(
  months: MonthlySummary[],
  window: number,
  basis: "flown" | "lifetime" = "flown"
): RollingCpmPoint[] {
  return months.map((m, i) => {
    if (i + 1 < window) return { month: m.month, gross: null, personal: null };
    const slice = months.slice(i + 1 - window, i + 1);
    const miles = slice.reduce(
      (a, x) => a + (basis === "flown" ? x.cpmMiles : x.cpmLifetimeMiles),
      0
    );
    if (miles <= 0) return { month: m.month, gross: null, personal: null };
    const g = slice.reduce((a, x) => a + x.cpmGross, 0);
    const p = slice.reduce((a, x) => a + x.cpmPersonal, 0);
    return {
      month: m.month,
      gross: round2((100 * g) / miles),
      personal: round2((100 * p) / miles),
    };
  });
}
