import { getSettings } from "./repo";
import type { EnrichedData } from "./repo";
import { hasArrived } from "./arrival";
import {
  AdjustmentRow,
  EnrichedSegment,
  estimatedLifetimeMiles,
  FLOWN_STATUSES,
  GROSS_INCREASING_TYPES,
  isCpmEligible,
  isFlightActivity,
  NON_ALLOCABLE_STATUSES,
  Settings,
  TicketAllocation,
  TicketRow,
} from "./types";
/* Route summaries live in mix.ts so the report page can import them without
   dragging node:sqlite into a client bundle — the same reason rollingCpm and
   the mix live there. Imported and re-exported, so existing imports of
   summarizeRoutes/RouteSummary from this module keep working. */
import { summarizeRoutes } from "./mix";
import type { RouteSummary } from "./mix";
export { summarizeRoutes };
export type { RouteSummary };

export interface MonthlySummary {
  month: string; // YYYY-MM
  flights: number;
  distance: number;
  lifetime: number; // United-posted only
  lifetimeEst: number; // posted, falling back to calculated distance
  award: number;
  pqp: number;
  pqf: number;
  gross: number;
  personal: number;
  /* CPM basis: flown + cost recorded + lifetime-earning (isCpmEligible) —
     flights outside the basis would dilute the averages toward zero. */
  cpmMiles: number;
  /** The same cost over UNITED LIFETIME miles instead of distance flown. On a
   *  short hop the two differ: 326 miles in the air credits 500, so the same
   *  fare buys more lifetime than the distance suggests. Divides the identical
   *  numerator, so the two CPMs are directly comparable. */
  cpmLifetimeMiles: number;
  cpmGross: number;
  cpmPersonal: number;
  cpmAward: number;
  /* $/PQP basis: flown + cost recorded (non-UA flights earn PQP, so they count) */
  costedGross: number;
  costedPqp: number;
  grossCpm: number | null;
  grossCpmLifetime: number | null;
  personalCpm: number | null;
  personalCpmLifetime: number | null;
  costPerPqp: number | null;
  missingPostings: number;
  upcomingFlights: number;
  upcomingGross: number;
  /** receipt-projected PQP on booked (not yet flown) segments */
  upcomingPqp: number;
  /** MileagePlus earning that isn't a flight (card, shopping, hotels …) */
  nonFlightPqp: number;
  nonFlightAward: number;
  /* PQP-derived estimates for flights with no ticket — reported alongside the
     strict figures, never merged into them */
  estMiles: number;
  estGross: number;
  estFlights: number;
}

/** One month of money actually moving (design doc §7.3, cash-flow view). */
export interface CashMonth {
  month: string; // YYYY-MM
  /** tickets issued this month, in new money */
  out: number;
  /** refunds, reimbursements and credits effective this month */
  in: number;
  /** the part of `in` placed by assumption — the ticket's purchase month
   *  standing in for a date the reimbursement never recorded */
  inAssumed: number;
  net: number;
  /** running net since the first month on the timeline */
  cumulative: number;
  tickets: number;
  adjustments: number;
}

export interface CashFlow {
  months: CashMonth[];
  /** Money placed by assumption rather than record — undated inflows put in
   *  their ticket's purchase month. Totalled here so the notice above the
   *  table can say what was assumed; each month carries its own share in
   *  `inAssumed` so the rows can wear the ≈. */
  assumedIn: { count: number; amount: number };
  /**
   * Money that cannot be placed at all: an inflow with no date whose ticket
   * has no purchase date either, or a ticket with no purchase date.
   *
   * Reported rather than dropped. The common undated case — a reimbursement
   * from ticking "Reimbursed", which records no date — no longer lands here:
   * it is assumed into the ticket's purchase month instead, visibly.
   */
  undatedIn: { count: number; amount: number };
  undatedOut: { count: number; amount: number };
}

/**
 * Cash-flow accounting: money placed in the month it moved.
 *
 * The counterpart to every other figure in this file, which places cost in the
 * month FLOWN (§7.3). A ticket bought in November for March travel and
 * reimbursed in May is one month here and a different one there, and the
 * design doc's rule is that the two views must never be silently mixed — hence
 * a separate structure and a separately labelled panel, not a column.
 *
 * Outflow is `cashAt`, so an exchange chain lands across the dates its money
 * actually moved rather than all on the first ticket. Inflow is every
 * adjustment: refunds, reimbursements, statement credits and employer
 * payments all return money, and the distinction that matters elsewhere —
 * whether it reduces gross or only personal — has no meaning for cash.
 *
 * An inflow with no date of its own is assumed into its ticket's purchase
 * month. That is a guess, and it is made because the alternative answered
 * nothing: "Reimbursed" deliberately records no date, so on a real ledger the
 * ENTIRE inflow side sat off the table and the timeline read as pure spending.
 * What keeps the guess honest is that it is visible — the month carries its
 * assumed share, the UI marks it ≈, and a recorded date always replaces it.
 * Purchase month, not "today", because the tick usually happens long after
 * the money moved and the ticket is the only date the ledger actually holds.
 */
export function buildCashFlow(
  tickets: TicketRow[],
  adjustments: AdjustmentRow[],
  allocations: Record<string, TicketAllocation>
): CashFlow {
  const byMonth = new Map<string, CashMonth>();
  const get = (m: string) => {
    let row = byMonth.get(m);
    if (!row) {
      row = { month: m, out: 0, in: 0, inAssumed: 0, net: 0, cumulative: 0, tickets: 0, adjustments: 0 };
      byMonth.set(m, row);
    }
    return row;
  };

  const undatedOut = { count: 0, amount: 0 };
  const undatedIn = { count: 0, amount: 0 };
  const assumedIn = { count: 0, amount: 0 };
  const issueMonthOf = new Map<string, string>();
  for (const t of tickets) {
    if (t.issue_date) issueMonthOf.set(t.id, t.issue_date.slice(0, 7));
  }

  for (const t of tickets) {
    const cash = allocations[t.id]?.cashAt ?? 0;
    if (cash === 0) continue; // a superseded member that consumed no new money
    if (!t.issue_date) {
      undatedOut.count += 1;
      undatedOut.amount = round2(undatedOut.amount + cash);
      continue;
    }
    const row = get(t.issue_date.slice(0, 7));
    row.out = round2(row.out + cash);
    row.tickets += 1;
  }

  for (const a of adjustments) {
    const month = a.effective_date
      ? a.effective_date.slice(0, 7)
      : (issueMonthOf.get(a.ticket_id) ?? null);
    /* Extras are money OUT — a paid upgrade left the account on its own day,
       not the ticket's. Imports always date them (the purchase receipt has a
       date); a hand-entered one without a date falls back to the ticket's
       month like everything else here. */
    if (GROSS_INCREASING_TYPES.includes(a.type)) {
      if (!month) continue; // dateless AND ticketless: nothing to hang it on
      const row = get(month);
      row.out = round2(row.out + a.amount);
      row.adjustments += 1;
      continue;
    }
    if (!month) {
      undatedIn.count += 1;
      undatedIn.amount = round2(undatedIn.amount + a.amount);
      continue;
    }
    const row = get(month);
    row.in = round2(row.in + a.amount);
    row.adjustments += 1;
    if (!a.effective_date) {
      row.inAssumed = round2(row.inAssumed + a.amount);
      assumedIn.count += 1;
      assumedIn.amount = round2(assumedIn.amount + a.amount);
    }
  }

  /* Gap-filled month by month, so a quiet stretch reads as the flat run it was
     rather than closing up into the next purchase. */
  const keys = [...byMonth.keys()].sort();
  const months: CashMonth[] = [];
  if (keys.length > 0) {
    let running = 0;
    for (const m of monthsBetween(keys[0], keys[keys.length - 1])) {
      const row = byMonth.get(m) ?? {
        month: m, out: 0, in: 0, inAssumed: 0, net: 0, cumulative: 0,
        tickets: 0, adjustments: 0,
      };
      row.net = round2(row.out - row.in);
      running = round2(running + row.net);
      row.cumulative = running;
      months.push(row);
    }
  }
  return { months, assumedIn, undatedIn, undatedOut };
}

/**
 * United's Million Miler rungs. Mile counts only — what each one entitles you
 * to is United's to change, and a benefit list would age badly in a file whose
 * job is arithmetic.
 */
export const MILLION_MILER_TIERS: { miles: number; label: string }[] = [
  { miles: 1_000_000, label: "1 Million" },
  { miles: 2_000_000, label: "2 Million" },
  { miles: 3_000_000, label: "3 Million" },
  { miles: 4_000_000, label: "4 Million" },
];

/**
 * How far out a straight-line projection is still worth printing. A rung
 * fifty years past today is not a forecast, it is arithmetic about a life —
 * and quoting a year for it would dress up a number nobody should plan on.
 */
export const FORECAST_HORIZON_YEARS = 50;

export interface LifetimeMilestone {
  miles: number;
  label: string;
  reached: boolean;
  /**
   * The month the ledger crossed it — a fact, not a projection.
   *
   * Null on a rung crossed before tracking began, which is what a lifetime
   * baseline larger than the rung means: the miles are real and the date is
   * not in evidence. "Reached, and I can't tell you when" is the honest
   * reading, and it is not the same as not having reached it.
   */
  crossedAt: string | null; // YYYY-MM
  /** the year this rate arrives; null once reached, and null past the horizon */
  year: number | null;
}

export interface LifetimeForecast {
  /** lifetime miles so far — the same figure the dashboard card shows */
  current: number;
  /** miles a year, over the fitted window */
  ratePerYear: number;
  /** complete months the rate rests on */
  windowMonths: number;
  /** the window's own span, so the rate can be read against a period */
  from: string; // YYYY-MM
  to: string; // YYYY-MM
  /** how far out a year was still worth quoting — carried rather than imported,
   *  because metrics.ts reaches the database and the dashboard is a client
   *  component: a value import from here drags node:sqlite into the bundle
   *  (the same reason rollingCpm lives in rolling.ts). */
  horizonYears: number;
  milestones: LifetimeMilestone[];
}

const MS_PER_YEAR = 365.2425 * 86400000;

/**
 * When the current rate of flying reaches each Million Miler rung.
 *
 * Straight-line, from miles actually credited over a trailing window. That is
 * a strong assumption about a lumpy history, so the shape of the answer is
 * chosen to carry only what the assumption supports: a YEAR, never a date, and
 * always beside the rate and the window it came from.
 *
 * Returns null rather than a bad forecast in the two cases that produce one —
 * too little history to have a rate at all, and a window that earned nothing.
 * Both follow rollingCpm: no point until the window is full beats a figure
 * wearing a label it hasn't earned.
 */
export function forecastLifetime(
  monthly: MonthlySummary[],
  baseline: number,
  todayStr: string,
  opts: { window?: number; minMonths?: number } = {}
): LifetimeForecast | null {
  const window = opts.window ?? 24;
  const minMonths = opts.minMonths ?? 12;
  const current = baseline + monthly.reduce((a, m) => a + m.lifetimeEst, 0);

  /* The month in progress is excluded. It is a partial month counted as a
     whole one, which rates every forecast light in proportion to how early in
     the month it happens to be read — worst on the 1st, gone by the 31st, and
     a moving number is the one thing a projection must not be. */
  const complete = monthly.filter((m) => m.month < todayStr.slice(0, 7));
  /* A full year minimum, because travel has a season: half a year of history
     rates a summer flyer as though every month were July. */
  if (complete.length < minMonths) return null;

  const win = complete.slice(-Math.min(window, complete.length));
  const ratePerYear = (win.reduce((a, m) => a + m.lifetimeEst, 0) / win.length) * 12;
  /* A window that earned nothing does not mean the rungs arrive later; it
     means this cannot answer, which is a different statement and the honest
     one to make by saying nothing. */
  if (ratePerYear <= 0) return null;

  const [ty, tm, td] = todayStr.split("-").map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td);

  /* Where the running total actually crossed each rung. Walks the same
     cumulative series the lifetime chart draws — baseline plus each month's
     credit — so the date a rung is said to have fallen is the date the chart
     shows it falling. A rung already inside the baseline never records a
     crossing, because nothing here witnessed it. */
  const crossedAt = new Map<number, string>();
  let running = baseline;
  for (const m of monthly) {
    const before = running;
    running += m.lifetimeEst;
    for (const t of MILLION_MILER_TIERS) {
      if (before < t.miles && running >= t.miles) crossedAt.set(t.miles, m.month);
    }
  }

  return {
    current: Math.round(current),
    ratePerYear: Math.round(ratePerYear),
    windowMonths: win.length,
    from: win[0].month,
    to: win[win.length - 1].month,
    horizonYears: FORECAST_HORIZON_YEARS,
    milestones: MILLION_MILER_TIERS.map(({ miles, label }) => {
      const remaining = miles - current;
      if (remaining <= 0)
        return {
          miles, label, reached: true,
          crossedAt: crossedAt.get(miles) ?? null,
          year: null,
        };
      const years = remaining / ratePerYear;
      if (years > FORECAST_HORIZON_YEARS)
        return { miles, label, reached: false, crossedAt: null, year: null };
      /* Cross the threshold at a real date, then report only its year. The
         date is how the arithmetic works; the year is how much of it the
         rate can actually support. */
      const at = new Date(todayMs + years * MS_PER_YEAR);
      return {
        miles, label, reached: false, crossedAt: null,
        year: at.getUTCFullYear(),
      };
    }),
  };
}

export interface Issue {
  type:
    | "missing_posting"
    | "no_cost"
    | "unknown_airport"
    | "allocation_warning"
    | "ready_to_reconcile";
  severity: "warn" | "info";
  message: string;
  detail?: string;
  segmentId?: string;
  ticketId?: string;
  date?: string | null;
}

export interface Analytics {
  generatedAt: string;
  currency: string;
  settings: Settings;
  cards: {
    flightsThisMonth: number;
    milesThisMonth: number;
    ytdFlights: number;
    ytdMiles: number;
    ytdPqp: number; // flight PQP
    ytdNonFlightPqp: number; // card/shopping/hotel PQP
    ytdQualifyingPqp: number; // what actually counts toward Premier status
    ytdPqf: number;
    ytdAward: number; // flight-earned award miles
    ytdAwardAllSources: number;
    pendingFlownPqp: number; // projected PQP on flown legs awaiting credit — ≈ in the headline
    pendingFlownPqf: number;
    pendingBookedPqp: number; // projected PQP on booked legs — the "+to come"
    lifetimePosted: number;
    lifetimeWithEst: number;
    ytdGross: number;
    ytdPersonal: number;
    ytdCpmMiles: number; // miles behind the CPM figures (cost-tracked, lifetime-earning)
    ytdEstGrossCpm: number | null; // incl. PQP-derived estimates
    ytdEstMiles: number;
    ytdEstFlights: number;
    /** Gross for the year INCLUDING flights whose cost was reconstructed from
     *  PQP. Equal to ytdGross when every flight has a real ticket behind it —
     *  the difference is what makes the spend figure an estimate. */
    ytdEstGross: number;
    ytdGrossCpm: number | null;
    ytdPersonalCpm: number | null;
    ytdCostPerPqp: number | null;
    ytdEffectiveCpm: number | null;
    /** effective CPM at a band of award valuations — the sensitivity of a
     *  figure that rests on a user-chosen assumption (§4.5) */
    awardScenarios: { cpm: number; effective: number | null }[];
    openIssues: number;
  };
  monthly: MonthlySummary[];
  annual: MonthlySummary[]; // month field holds the year, e.g. "2026"
  /** `flown` is every mile in the air; `withEst` only the ones that credit.
   *  The gap between them IS the story — miles flown on other airlines' metal
   *  and on award tickets that earned no lifetime credit. `posted` is kept for
   *  the tooltip but is 0 throughout: United posts a lifetime TOTAL, never a
   *  per-segment figure, so nothing ever fills it. */
  cumulativeLifetime: {
    month: string;
    posted: number;
    withEst: number;
    flown: number;
  }[];
  /** null until there is enough history to fit a rate — see forecastLifetime */
  lifetimeForecast: LifetimeForecast | null;
  issues: Issue[];
  upcoming: EnrichedSegment[];
  recent: EnrichedSegment[];
  routes: RouteSummary[];
  /** money in the month it moved, not the month flown (§7.3) */
  cashFlow: CashFlow;
  totals: {
    flights: number;
    miles: number;
    pqp: number;
    nonFlightPqp: number;
    nonFlightAward: number;
    pqf: number;
    award: number;
    lifetime: number;
    gross: number;
    personal: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const isFlown = (s: EnrichedSegment) => FLOWN_STATUSES.includes(s.status);
const isUpcomingStatus = (s: EnrichedSegment) =>
  s.status === "ticketed";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function daysAgo(dateStr: string, today: string): number {
  return Math.floor(
    (new Date(today + "T00:00:00").getTime() -
      new Date(dateStr + "T00:00:00").getTime()) /
      86400000
  );
}

function emptySummary(month: string): MonthlySummary {
  return {
    month,
    flights: 0,
    distance: 0,
    lifetime: 0,
    lifetimeEst: 0,
    award: 0,
    pqp: 0,
    pqf: 0,
    gross: 0,
    personal: 0,
    cpmMiles: 0,
    cpmLifetimeMiles: 0,
    cpmGross: 0,
    cpmPersonal: 0,
    cpmAward: 0,
    costedGross: 0,
    costedPqp: 0,
    grossCpm: null,
    grossCpmLifetime: null,
    personalCpm: null,
    personalCpmLifetime: null,
    costPerPqp: null,
    missingPostings: 0,
    upcomingFlights: 0,
    upcomingGross: 0,
    upcomingPqp: 0,
    nonFlightPqp: 0,
    nonFlightAward: 0,
    estMiles: 0,
    estGross: 0,
    estFlights: 0,
  };
}

function finalizeSummary(s: MonthlySummary): MonthlySummary {
  s.distance = Math.round(s.distance);
  s.lifetimeEst = Math.round(s.lifetimeEst);
  s.gross = round2(s.gross);
  s.personal = round2(s.personal);
  s.cpmMiles = Math.round(s.cpmMiles);
  s.cpmLifetimeMiles = Math.round(s.cpmLifetimeMiles);
  s.cpmGross = round2(s.cpmGross);
  s.cpmPersonal = round2(s.cpmPersonal);
  s.costedGross = round2(s.costedGross);
  s.estMiles = Math.round(s.estMiles);
  s.estGross = round2(s.estGross);
  s.grossCpm = s.cpmMiles > 0 ? round2((100 * s.cpmGross) / s.cpmMiles) : null;
  s.personalCpm =
    s.cpmMiles > 0 ? round2((100 * s.cpmPersonal) / s.cpmMiles) : null;
  s.grossCpmLifetime =
    s.cpmLifetimeMiles > 0 ? round2((100 * s.cpmGross) / s.cpmLifetimeMiles) : null;
  s.personalCpmLifetime =
    s.cpmLifetimeMiles > 0
      ? round2((100 * s.cpmPersonal) / s.cpmLifetimeMiles)
      : null;
  s.costPerPqp =
    s.costedPqp > 0 ? round2(s.costedGross / s.costedPqp) : null;
  return s;
}

export function buildAnalytics(data: EnrichedData): Analytics {
  const settings = getSettings();
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  const delay = settings.missing_posting_delay_days;

  const byMonth = new Map<string, MonthlySummary>();
  const byYear = new Map<string, MonthlySummary>();
  const issues: Issue[] = [];

  const getMonth = (m: string) => {
    if (!byMonth.has(m)) byMonth.set(m, emptySummary(m));
    return byMonth.get(m)!;
  };
  const getYear = (y: string) => {
    if (!byYear.has(y)) byYear.set(y, emptySummary(y));
    return byYear.get(y)!;
  };

  for (const s of data.segments) {
    const month = s.flight_date.slice(0, 7);
    const year = s.flight_date.slice(0, 4);
    const M = getMonth(month);
    const Y = getYear(year);

    if (isFlown(s)) {
      const dist = s.distance_miles ?? 0;
      const cpmEligible = isCpmEligible(s);
      const costKnown = s.allocation_method !== "none";
      for (const agg of [M, Y]) {
        agg.flights += 1;
        agg.distance += dist;
        agg.lifetime += s.lifetime_miles ?? 0;
        agg.lifetimeEst += estimatedLifetimeMiles(s);
        agg.award += s.award_miles ?? 0;
        agg.pqp += s.pqp ?? 0;
        agg.pqf += s.pqf ?? 0;
        agg.gross += s.gross_cost;
        agg.personal += s.personal_cost;
        if (cpmEligible) {
          agg.cpmMiles += dist;
          agg.cpmLifetimeMiles += estimatedLifetimeMiles(s);
          agg.cpmGross += s.gross_cost;
          agg.cpmPersonal += s.personal_cost;
          agg.cpmAward += s.award_miles ?? 0;
        }
        if (costKnown) {
          agg.costedGross += s.gross_cost;
          agg.costedPqp += s.pqp ?? 0;
        }
        // estimated basis = the real one plus PQP-reconstructed flights
        if (cpmEligible) {
          agg.estMiles += dist;
          agg.estGross += s.gross_cost;
        } else if (s.estimated_gross != null && estimatedLifetimeMiles(s) > 0) {
          agg.estMiles += dist;
          agg.estGross += s.estimated_gross;
          agg.estFlights += 1;
        }
      }

      const noPostings =
        s.pqp == null && s.award_miles == null && s.lifetime_miles == null;
      if (noPostings && daysAgo(s.flight_date, today) >= delay) {
        M.missingPostings += 1;
        Y.missingPostings += 1;
        issues.push({
          type: "missing_posting",
          severity: "warn",
          message: `${s.origin}→${s.destination} on ${s.flight_date} has no MileagePlus posting recorded`,
          detail: `Flown ${daysAgo(s.flight_date, today)} days ago. Enter posted PQP / award / lifetime miles, or check for missing credit.`,
          segmentId: s.id,
          date: s.flight_date,
        });
      }
      if (
        s.status === "flown_unreconciled" &&
        (s.pqp != null || s.award_miles != null)
      ) {
        issues.push({
          type: "ready_to_reconcile",
          severity: "info",
          message: `${s.origin}→${s.destination} on ${s.flight_date} has postings — mark it reconciled`,
          segmentId: s.id,
          date: s.flight_date,
        });
      }
      if (
        s.gross_cost === 0 &&
        s.personal_cost === 0 &&
        s.allocation_method === "none"
      ) {
        issues.push({
          type: "no_cost",
          severity: "warn",
          message: `${s.origin}→${s.destination} on ${s.flight_date} has no cost recorded`,
          detail:
            "Link it to a ticket or set a manual cost (use 0 for fully covered award travel).",
          segmentId: s.id,
          date: s.flight_date,
        });
      }
    } else if (isUpcomingStatus(s)) {
      // Missed segments: cost counts (money spent, nothing flown); handled below.
      M.upcomingFlights += 1;
      M.upcomingGross += s.gross_cost;
      M.upcomingPqp += s.projected_pqp ?? 0;
      Y.upcomingFlights += 1;
      Y.upcomingGross += s.gross_cost;
      Y.upcomingPqp += s.projected_pqp ?? 0;
    } else if (s.status === "missed") {
      M.gross += s.gross_cost;
      M.personal += s.personal_cost;
      Y.gross += s.gross_cost;
      Y.personal += s.personal_cost;
    }

    if (
      s.distance_estimated &&
      !NON_ALLOCABLE_STATUSES.includes(s.status)
    ) {
      issues.push({
        type: "unknown_airport",
        severity: "warn",
        message: `${s.origin}→${s.destination} on ${s.flight_date}: unknown airport code, distance unavailable`,
        segmentId: s.id,
        date: s.flight_date,
      });
    }
  }

  // Non-flight MileagePlus earning (design doc §5.3): credit-card PQP, hotels,
  // shopping. It qualifies for status but never belongs to a flight, so it is
  // aggregated separately and never enters CPM or per-flight math.
  for (const act of data.activities) {
    if (isFlightActivity(act.activity_type)) continue;
    const month = act.activity_date.slice(0, 7);
    const year = act.activity_date.slice(0, 4);
    for (const agg of [getMonth(month), getYear(year)]) {
      agg.nonFlightPqp += act.pqp ?? 0;
      agg.nonFlightAward += act.award_miles ?? 0;
    }
  }

  for (const [ticketId, alloc] of Object.entries(data.allocations)) {
    const t = data.tickets.find((x) => x.id === ticketId);
    const label = t?.confirmation_code || t?.ticket_number || "Ticket";
    for (const w of alloc.warnings) {
      issues.push({
        type: "allocation_warning",
        severity: "warn",
        message: `${label}: ${w}`,
        ticketId,
      });
    }
  }


  // Gap-fill months from first data month through the current month
  let monthly: MonthlySummary[] = [];
  if (byMonth.size > 0) {
    const keys = [...byMonth.keys()].sort();
    const first = keys[0];
    const last = keys[keys.length - 1] > thisMonth ? keys[keys.length - 1] : thisMonth;
    monthly = monthsBetween(first, last).map((m) =>
      finalizeSummary(byMonth.get(m) ?? emptySummary(m))
    );
  }
  const annual = [...byYear.keys()]
    .sort()
    .map((y) => finalizeSummary(byYear.get(y)!));

  // Cumulative lifetime miles (baseline + running sums)
  const baseline = settings.lifetime_baseline_miles || 0;
  let cumPosted = baseline;
  let cumEst = baseline;
  let cumFlown = baseline;
  const cumulativeLifetime = monthly.map((m) => {
    cumPosted += m.lifetime;
    cumEst += m.lifetimeEst;
    cumFlown += m.distance;
    return { month: m.month, posted: cumPosted, withEst: cumEst, flown: cumFlown };
  });

  const cur = byMonth.get(thisMonth);
  const ytdMonths = monthly.filter((m) => m.month.startsWith(thisYear));
  const sum = (f: (m: MonthlySummary) => number) =>
    ytdMonths.reduce((acc, m) => acc + f(m), 0);
  const ytdMiles = sum((m) => m.distance);
  const ytdGross = round2(sum((m) => m.gross));
  const ytdPersonal = round2(sum((m) => m.personal));
  const ytdPqp = sum((m) => m.pqp);
  const ytdAward = sum((m) => m.award);
  // CPM / $-per-PQP over their restricted bases (see MonthlySummary)
  const ytdCpmMiles = sum((m) => m.cpmMiles);
  const ytdCpmGross = sum((m) => m.cpmGross);
  const ytdCpmPersonal = sum((m) => m.cpmPersonal);
  const ytdCpmAward = sum((m) => m.cpmAward);
  const ytdCostedGross = sum((m) => m.costedGross);
  const ytdCostedPqp = sum((m) => m.costedPqp);
  const ytdEstMiles = sum((m) => m.estMiles);
  const ytdEstGross = sum((m) => m.estGross);

  const totalsAll = {
    flights: annual.reduce((a, y) => a + y.flights, 0),
    miles: annual.reduce((a, y) => a + y.distance, 0),
    pqp: annual.reduce((a, y) => a + y.pqp, 0),
    nonFlightPqp: annual.reduce((a, y) => a + y.nonFlightPqp, 0),
    nonFlightAward: annual.reduce((a, y) => a + y.nonFlightAward, 0),
    pqf: annual.reduce((a, y) => a + y.pqf, 0),
    award: annual.reduce((a, y) => a + y.award, 0),
    lifetime: annual.reduce((a, y) => a + y.lifetime, 0),
    gross: round2(annual.reduce((a, y) => a + y.gross, 0)),
    personal: round2(annual.reduce((a, y) => a + y.personal, 0)),
  };

  /* "Upcoming" ends at the same boundary everything else uses (arrival.ts):
     a ticketed leg leaves this list once its scheduled arrival plus margin
     has passed — at which point the Reconcile nag holds it instead. The old
     date test kept a leg that landed this morning "upcoming" all day. */
  const nowMs = Date.now();
  const upcoming = data.segments
    .filter((s) => isUpcomingStatus(s) && !hasArrived(s, nowMs, today))
    .sort((a, b) => a.flight_date.localeCompare(b.flight_date))
    .slice(0, 8);
  const recent = data.segments
    .filter(isFlown)
    .sort((a, b) => b.flight_date.localeCompare(a.flight_date))
    .slice(0, 8);

  const routes = summarizeRoutes(data.segments);
  const cashFlow = buildCashFlow(data.tickets, data.adjustments, data.allocations);

  /* Effective CPM across a band of valuations, not just the configured one.
     The figure rests on a number the user invented, so how much it moves when
     that number moves is part of the answer: if the band is narrow the
     conclusion holds regardless, and if it is wide the headline was never
     really about the flying. The configured value joins the band so the figure
     shown above always appears in it. */
  const awardScenarios = [
    ...new Set([1, 1.5, 2, settings.award_valuation_cpm]),
  ]
    .sort((a, b) => a - b)
    .map((cpm) => ({
      cpm,
      effective:
        ytdCpmMiles > 0
          ? round2((100 * (ytdCpmPersonal - (ytdCpmAward * cpm) / 100)) / ytdCpmMiles)
          : null,
    }));

  const awardValue = (ytdCpmAward * settings.award_valuation_cpm) / 100;
  const ytdEffectiveCpm =
    ytdCpmMiles > 0
      ? round2((100 * (ytdCpmPersonal - awardValue)) / ytdCpmMiles)
      : null;

  return {
    generatedAt: new Date().toISOString(),
    currency: settings.reporting_currency,
    settings,
    cards: {
      flightsThisMonth: cur?.flights ?? 0,
      milesThisMonth: Math.round(cur?.distance ?? 0),
      ytdFlights: sum((m) => m.flights),
      ytdMiles,
      ytdPqp,
      ytdNonFlightPqp: sum((m) => m.nonFlightPqp),
      ytdQualifyingPqp: ytdPqp + sum((m) => m.nonFlightPqp),
      ytdPqf: sum((m) => m.pqf),
      ytdAward,
      ytdAwardAllSources: ytdAward + sum((m) => m.nonFlightAward),
      /* Uncredited projections, split by travel state — same basis as
         premier.ts, so the dashboard and the tracker always agree. FLOWN
         legs' projections ride ≈-absorbed in the headline (between activity
         imports that is a flight's normal state; the earning is real, only
         unposted). BOOKED legs' projections are "+to come": that travel
         hasn't happened. Never canceled, never missed. */
      ...(() => {
        const uncredited = data.segments.filter(
          (s) =>
            s.flight_date.slice(0, 4) === today.slice(0, 4) &&
            s.status !== "canceled" &&
            s.status !== "missed"
        );
        const flown = uncredited.filter(
          (s) => FLOWN_STATUSES.includes(s.status) && s.pqp == null
        );
        const booked = uncredited.filter((s) => s.status === "ticketed");
        const total = (xs: typeof flown, f: (s: (typeof flown)[number]) => number | null) =>
          Math.round(xs.reduce((a, s) => a + (f(s) ?? 0), 0));
        return {
          pendingFlownPqp: total(flown, (s) => s.projected_pqp),
          pendingFlownPqf: total(
            uncredited.filter((s) => FLOWN_STATUSES.includes(s.status) && s.pqf == null),
            (s) => s.projected_pqf
          ),
          pendingBookedPqp: total(
            booked.filter((s) => s.pqp == null),
            (s) => s.projected_pqp
          ),
        };
      })(),
      lifetimePosted: baseline + totalsAll.lifetime,
      lifetimeWithEst:
        cumulativeLifetime.length > 0
          ? cumulativeLifetime[cumulativeLifetime.length - 1].withEst
          : baseline,
      ytdGross,
      ytdPersonal,
      ytdCpmMiles: Math.round(ytdCpmMiles),
      ytdEstMiles: Math.round(ytdEstMiles),
      ytdEstFlights: sum((m) => m.estFlights),
      ytdEstGross: round2(ytdEstGross),
      ytdEstGrossCpm:
        ytdEstMiles > 0 ? round2((100 * ytdEstGross) / ytdEstMiles) : null,
      ytdGrossCpm:
        ytdCpmMiles > 0 ? round2((100 * ytdCpmGross) / ytdCpmMiles) : null,
      ytdPersonalCpm:
        ytdCpmMiles > 0 ? round2((100 * ytdCpmPersonal) / ytdCpmMiles) : null,
      ytdCostPerPqp:
        ytdCostedPqp > 0 ? round2(ytdCostedGross / ytdCostedPqp) : null,
      ytdEffectiveCpm,
      awardScenarios,
      openIssues: issues.filter((i) => i.severity === "warn").length,
    },
    monthly,
    annual,
    cumulativeLifetime,
    lifetimeForecast: forecastLifetime(monthly, baseline, today),
    issues,
    upcoming,
    recent,
    routes,
    cashFlow,
    totals: totalsAll,
  };
}
