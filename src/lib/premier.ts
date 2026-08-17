/**
 * Premier status qualification, per calendar year (design doc §5.3).
 *
 * United publishes two routes to each tier: PQP alongside a minimum number of
 * Premier qualifying flights, or a higher PQP total on its own. Either one
 * qualifies. On top of both sits a program-wide floor of four paid United /
 * United Express segments — which only ever binds on the PQP-only route, since
 * every flight-inclusive threshold is already higher.
 *
 * The thresholds change between qualification years, so they're a table keyed
 * by the first year each set applied, not a constant. United raised every tier
 * by roughly 25% starting with the 2025 qualification year (2026 status); the
 * years before that ran on the 2022-2024 set.
 */
import {
  ACTIVITY_TYPE_LABELS,
  FLOWN_STATUSES,
  NON_ALLOCABLE_STATUSES,
  isFlightActivity,
} from "./types";
import type { ActivityRecord, SegmentStatus } from "./types";

export interface PremierTier {
  name: string;
  /** PQP required on the flight-inclusive route */
  pqp: number;
  /** Premier qualifying flights required on that route */
  pqf: number;
  /** PQP on its own — still subject to the program's flight floor */
  pqpOnly: number;
}

export interface PremierProgram {
  /** first qualification year this set applied to */
  from: number;
  /** paid UA / UA Express segments required for any status */
  minFlights: number;
  tiers: PremierTier[];
}

/**
 * Each set United actually published, keyed by the first qualification year it
 * applied to (sources in the README). The table starts at 2020 because that is
 * when PQP/PQF replaced Premier qualifying miles, segments and dollars —
 * anything earlier ran on a different currency this model doesn't describe.
 */
export const DEFAULT_PREMIER_PROGRAMS: PremierProgram[] = [
  {
    /* Pandemic reduction, held for THREE qualification years. United's own
       November 2022 announcement contrasts the new bars with "2022
       requirements of 8 PQF + 3,000 PQP OR 3,500 PQP" — an announcement made
       in November 2022 can only be describing flying that was still to come,
       so 2022 flying ran on the reduced set. */
    from: 2020, // status 2021, 2022 and 2023
    minFlights: 4,
    tiers: [
      { name: "Premier Silver", pqp: 3000, pqf: 8, pqpOnly: 3500 },
      { name: "Premier Gold", pqp: 6000, pqf: 16, pqpOnly: 7000 },
      { name: "Premier Platinum", pqp: 9000, pqf: 24, pqpOnly: 10000 },
      { name: "Premier 1K", pqp: 13500, pqf: 36, pqpOnly: 15000 },
    ],
  },
  {
    // back to the levels United had set for 2020 before the pandemic deferred
    // them, announced November 2022 and unchanged for two qualification years
    from: 2023, // status 2024 and 2025
    minFlights: 4,
    tiers: [
      { name: "Premier Silver", pqp: 4000, pqf: 12, pqpOnly: 5000 },
      { name: "Premier Gold", pqp: 8000, pqf: 24, pqpOnly: 10000 },
      { name: "Premier Platinum", pqp: 12000, pqf: 36, pqpOnly: 15000 },
      { name: "Premier 1K", pqp: 18000, pqf: 54, pqpOnly: 24000 },
    ],
  },
  {
    from: 2025, // ~25% increase, first applying to 2025 flying / 2026 status
    minFlights: 4,
    tiers: [
      { name: "Premier Silver", pqp: 5000, pqf: 15, pqpOnly: 6000 },
      { name: "Premier Gold", pqp: 10000, pqf: 30, pqpOnly: 12000 },
      { name: "Premier Platinum", pqp: 15000, pqf: 45, pqpOnly: 18000 },
      { name: "Premier 1K", pqp: 22000, pqf: 60, pqpOnly: 28000 },
    ],
  },
];

/** The set in force for a qualification year: the latest one that had started. */
export function programFor(
  year: string | number,
  programs: PremierProgram[] = DEFAULT_PREMIER_PROGRAMS
): PremierProgram {
  const y = Number(year);
  const ordered = [...programs].sort((a, b) => a.from - b.from);
  let out = ordered[0];
  for (const p of ordered) if (p.from <= y) out = p;
  return out;
}

export type QualifyingPath = "pqp+pqf" | "pqp-only";

/** Which route (if any) these totals satisfy. */
export function pathFor(
  pqp: number,
  pqf: number,
  tier: PremierTier,
  minFlights: number,
  uaFlights: number
): QualifyingPath | null {
  if (pqp >= tier.pqp && pqf >= tier.pqf) return "pqp+pqf";
  /* The floor is UNITED FLIGHTS, not PQF. PQF used to stand in for it here,
     and the two differ exactly where it matters: partner metal earns PQF but
     United's fine print wants "flights operated by United or United
     Express" — so four Lufthansa legs could buy the PQP-only route past a
     floor they don't satisfy, while the tracker's own "✓ N flown" line
     (which counts the right thing) said otherwise. */
  if (pqp >= tier.pqpOnly && uaFlights >= minFlights) return "pqp-only";
  return null;
}

/** Highest tier these totals reach, or null. Tiers are ordered low → high. */
export function tierFor(
  pqp: number,
  pqf: number,
  program: PremierProgram,
  uaFlights: number
): PremierTier | null {
  let best: PremierTier | null = null;
  for (const t of program.tiers)
    if (pathFor(pqp, pqf, t, program.minFlights, uaFlights)) best = t;
  return best;
}

export interface PremierMilestone {
  tier: string;
  /** the date the totals first met the tier */
  date: string;
  path: QualifyingPath;
  /** what tipped it over */
  source: string;
  pqpAt: number;
  pqfAt: number;
}

/** Where a year's qualification came from, mirroring United's own breakdown. */
export interface PremierSource {
  key: string;
  label: string;
  pqp: number;
  pqf: number;
  /** Redeemable miles this source moved. NEGATIVE for redemptions — an award
   *  booking spends the balance, and a table that only ever adds can't show
   *  where the year's miles went. */
  award: number;
  /** flights, or postings, behind the figure */
  count: number;
  /**
   * What United actually called the postings in this row, biggest first — a
   * category name alone leaves the user asking "yes, but WHICH?" (they did:
   * "Is Other just Starter PQP?"). Only non-flight rows carry it; a flight
   * row's postings are the flights themselves and the ledger lists those.
   */
  detail?: string;
}

export interface PremierMonth {
  month: string; // YYYY-MM
  pqp: number;
  pqf: number;
  cumPqp: number | null; // null once the year runs past what has posted
  cumPqf: number | null;
  /** Cumulative including PQP still to come from booked flights. Equal to
   *  cumPqp through the posted part, so the two lines overlay and only part
   *  company where the projection begins. */
  projPqp: number | null;
  /** redeemable miles this month moved — negative when an award was booked */
  award: number;
  /** balance at the end of this month, carried in from prior years. Null once
   *  the year runs past the last movement, for the same reason cumPqp is:
   *  a flat line to December would assert a balance nothing has established. */
  awardBalance: number | null;
}

/**
 * One point per date something actually happened.
 *
 * The monthly series answers "how did this month do"; this one answers "where
 * did I stand on the 12th". A cumulative line drawn month by month puts its
 * mark at the month's tick while reporting the month's close, so a flight on
 * the 2nd and one on the 30th land on the same spot — the shape of a year is
 * flattened into twelve steps. These points sit at real dates on a real time
 * axis, so the gaps between them are the gaps between trips.
 */
export interface PremierDayPoint {
  date: string; // YYYY-MM-DD
  /** ms since epoch, so the axis can space points by elapsed time */
  t: number;
  /** what moved on this date */
  pqp: number;
  award: number;
  cumPqp: number | null;
  cumPqf: number | null;
  projPqp: number | null;
  /** cumulative flights including booked ones, from the junction on */
  projPqf: number | null;
  awardBalance: number | null;
}

export interface PremierYear {
  year: string;
  program: PremierProgram;
  pqp: number;
  pqf: number;
  flightPqp: number;
  nonFlightPqp: number;
  flights: number;
  /** paid United / United Express segments — what the program floor counts */
  uaFlights: number;
  /** the year predates PQP/PQF entirely — nothing here can be scored */
  beforeTable: boolean;
  tier: PremierTier | null;
  nextTier: PremierTier | null;
  /** shortfall to nextTier on each route (0 once met) */
  needPqp: number;
  needPqf: number;
  needPqpOnly: number;
  /** flights still needed for the PQP-only route's floor */
  needMinFlights: number;
  milestones: PremierMilestone[];
  /** redeemable-mile balance carried in from every prior year on record. This
   *  is a balance since tracking began, not since the account opened — if
   *  miles existed before the first row here, every figure is offset by that
   *  same amount and the SHAPE is what's being read, not the level. */
  openingAward: number;
  /** what the balance closed the year at, or opened at if nothing moved */
  closingAward: number;
  monthly: PremierMonth[];
  /** the same year read at every date that moved — see PremierDayPoint */
  points: PremierDayPoint[];
  sources: PremierSource[];
  /** projected earning on legs already FLOWN, awaiting the next activity
   *  import — displayed ≈-absorbed into the standing, never in `pqp` itself:
   *  tier facts and milestones stay posted-only */
  flownPendingPqp: number;
  flownPendingPqf: number;
  /** null when no BOOKED travel is still to come for this year */
  projection: {
    pqp: number;
    pqf: number;
    /** what the booked calendar adds — flown-pending is already in the
     *  standing, so it is not "to come" */
    addedPqp: number;
    addedPqf: number;
    /** booked flights contributing */
    flights: number;
    tier: PremierTier | null;
    /** tiers the projection reaches that the ≈ standing doesn't */
    unlocks: string[];
  } | null;
  /** the qualifying year has ended — totals are final */
  closed: boolean;
}

export interface PremierSegment {
  flight_date: string;
  status: SegmentStatus;
  operating_carrier?: string | null;
  /** 0 award miles is the award-travel signature — it still earns PQP/PQF */
  award_miles?: number | null;
  pqp: number | null;
  pqf: number | null;
  projected_pqp: number | null;
  projected_pqf: number | null;
  marketing_carrier: string;
  flight_number: string | null;
  origin: string;
  destination: string;
}

const label = (s: PremierSegment) =>
  `${s.marketing_carrier}${s.flight_number ?? ""} ${s.origin}→${s.destination}`;

/**
 * Name the postings behind a category row, biggest earner first. Capped at
 * three because the point is to answer "which ones?", not to reprint the
 * activity log — the log itself is one tab away.
 */
function detailOf(
  items: Map<string, { pqp: number; n: number }> | undefined
): string | undefined {
  if (!items || items.size === 0) return undefined;
  const sorted = [...items.entries()].sort(
    (a, b) => b[1].pqp - a[1].pqp || b[1].n - a[1].n || a[0].localeCompare(b[0])
  );
  const shown = sorted.slice(0, 3).map(([name, v]) => (v.n > 1 ? `${name} ×${v.n}` : name));
  const rest = sorted.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` +${rest} more` : "");
}

/**
 * Posted PQP comes from flights; non-flight PQP (cards, shopping, hotels) from
 * the activity ledger. Flight-type activity rows are deliberately skipped —
 * they are the same flights, and counting both would double every trip.
 */
export function buildPremierYears(
  segments: PremierSegment[],
  activities: ActivityRecord[],
  programs: PremierProgram[] = DEFAULT_PREMIER_PROGRAMS,
  todayStr: string = new Date().toISOString().slice(0, 10)
): PremierYear[] {
  const years = new Map<
    string,
    {
      /** ua marks a posting from a UA-metal flight — the milestone walk
       *  counts these toward the flights floor as it replays the year */
      events: { date: string; pqp: number; pqf: number; source: string; ua?: boolean }[];
      /** booked-but-not-yet-credited PQP/PQF, at the date it should post */
      projected: { date: string; pqp: number; pqf: number }[];
      pendingPqp: number;
      pendingPqf: number;
      pendingFlights: number;
      /** projected earning on legs already FLOWN, waiting on the next
       *  activity import — ≈-absorbed into the displayed standing, unlike
       *  the booked pending above, which stays behind the toggle */
      flownPendingPqp: number;
      flownPendingPqf: number;
      flightPqp: number;
      nonFlightPqp: number;
      flights: number;
      uaFlights: number;
      /** booked UA-metal legs — by year end they'll be flown, so the
       *  projected tier gets a floor of uaFlights + these */
      pendingUaFlights: number;
      sources: Map<string, PremierSource>;
      /** source key → description → what it contributed */
      items: Map<string, Map<string, { pqp: number; n: number }>>;
    }
  >();
  const addSource = (
    y: {
      sources: Map<string, PremierSource>;
      items: Map<string, Map<string, { pqp: number; n: number }>>;
    },
    key: string, label: string, pqp: number, pqf: number,
    /** what United called this posting; omitted for flights */
    item?: string,
    award = 0
  ) => {
    const cur =
      y.sources.get(key) ?? { key, label, pqp: 0, pqf: 0, award: 0, count: 0 };
    cur.pqp += pqp;
    cur.pqf += pqf;
    cur.award += award;
    cur.count += 1;
    y.sources.set(key, cur);
    if (item == null) return;
    const items = y.items.get(key) ?? new Map();
    const e = items.get(item) ?? { pqp: 0, n: 0 };
    e.pqp += pqp;
    e.n += 1;
    items.set(item, e);
    y.items.set(key, items);
  };

  const get = (year: string) => {
    let y = years.get(year);
    if (!y) {
      y = {
        events: [], projected: [], pendingPqp: 0, pendingPqf: 0, pendingFlights: 0,
        flownPendingPqp: 0, flownPendingPqf: 0,
        flightPqp: 0, nonFlightPqp: 0, flights: 0, uaFlights: 0, pendingUaFlights: 0,
        sources: new Map(), items: new Map(),
      };
      years.set(year, y);
    }
    return y;
  };

  for (const s of segments) {
    if (NON_ALLOCABLE_STATUSES.includes(s.status)) continue;
    const y = get(s.flight_date.slice(0, 4));
    const posted = FLOWN_STATUSES.includes(s.status) && (s.pqp != null || s.pqf != null);
    if (posted) {
      y.events.push({
        date: s.flight_date,
        pqp: s.pqp ?? 0,
        pqf: s.pqf ?? 0,
        source: label(s),
        ua: (s.operating_carrier ?? s.marketing_carrier) === "UA",
      });
      y.flightPqp += s.pqp ?? 0;
      y.flights += 1;
      /* Split by carrier as well as revenue-vs-award: which airline earned
         the points is the granularity that actually informs where to fly.
         The NAME, though, is the activity log's own vocabulary — a row
         reading "LX flights" where every badge in the log says "Partner
         flight" reads like a different taxonomy instead of the same one at
         finer grain. Carrier rides along after the category, not instead of
         it. */
      const award = s.award_miles === 0;
      const carrier = (s.operating_carrier ?? s.marketing_carrier).toUpperCase();
      const kind = award ? "award flights" : "flights";
      addSource(
        y,
        `${award ? "award_flight" : "flight"}:${carrier}`,
        carrier === "UA" ? `United ${kind}` : `Partner ${kind} · ${carrier}`,
        s.pqp ?? 0,
        s.pqf ?? 0,
        undefined,
        s.award_miles ?? 0
      );
    }
    /* The floor is UA metal only — partner flights earn PQF but don't count.
       And it counts flights FLOWN, not flights credited: this bump used to
       live inside the `posted` branch above, so a leg that departed
       yesterday stayed off the "✓ N flown" line until United posted it —
       a count wearing a label it didn't mean. The PQP/PQF above keep
       waiting for the CSV; money is a claim, but a flight is an event. */
    if (
      FLOWN_STATUSES.includes(s.status) &&
      (s.operating_carrier ?? s.marketing_carrier) === "UA"
    )
      y.uaFlights += 1;
    // …and a booked UA leg will be, by the time the projection is judged
    if (s.status === "ticketed" && (s.operating_carrier ?? s.marketing_carrier) === "UA")
      y.pendingUaFlights += 1;
    // still to come: booked flights, and flown ones United hasn't credited
    // yet — never canceled coupons: a voided leg keeps its printed accrual
    // as history, but that money will never post, and counting it inflated
    // "Future flights" by every cancelled booking's worth of PQP.
    // Missed legs are just as dead: the seat flew empty, nothing will post.
    const live = s.status !== "canceled" && s.status !== "missed";
    const projPqpAdd = live && s.pqp == null ? (s.projected_pqp ?? 0) : 0;
    const projPqfAdd = live && s.pqf == null ? (s.projected_pqf ?? 0) : 0;
    /* Uncredited splits by travel state. A FLOWN leg's projection rides with
       the standing (≈-marked): between activity imports — a flight's normal
       state — the earning is real, only unposted. A BOOKED leg's projection
       stays behind the Future-flights toggle: that travel hasn't happened. */
    if (FLOWN_STATUSES.includes(s.status)) {
      y.flownPendingPqp += projPqpAdd;
      y.flownPendingPqf += projPqfAdd;
    } else {
      if (projPqpAdd > 0) {
        y.pendingPqp += projPqpAdd;
        y.pendingFlights += 1;
      }
      y.pendingPqf += projPqfAdd;
    }
    if (projPqpAdd > 0 || projPqfAdd > 0)
      y.projected.push({ date: s.flight_date, pqp: projPqpAdd, pqf: projPqfAdd });
  }

  const nonFlight = activities.filter((a) => !isFlightActivity(a.activity_type));
  for (const a of nonFlight) {
    const pqp = a.pqp ?? 0;
    const pqf = a.pqf ?? 0;
    if (pqp === 0 && pqf === 0) continue;
    const y = get(a.activity_date.slice(0, 4));
    y.events.push({ date: a.activity_date, pqp, pqf, source: a.description });
    y.nonFlightPqp += pqp;
    addSource(
      y, a.activity_type, ACTIVITY_TYPE_LABELS[a.activity_type], pqp, pqf,
      a.description.trim(), a.award_miles ?? 0
    );
  }
  /* "Where did my PQP come from" is also answered by "your Lyft rides earned
     none", so a category with postings but no PQP still gets a table row.
     Separate pass, and JOIN-ONLY: a qualifying year is one with flights or PQP
     in it, and a lone 0-PQP car rental must not conjure a whole "2021 — no
     status" year around itself. */
  for (const a of nonFlight) {
    if ((a.pqp ?? 0) !== 0 || (a.pqf ?? 0) !== 0) continue;
    const y = years.get(a.activity_date.slice(0, 4));
    if (!y) continue;
    addSource(
      y, a.activity_type, ACTIVITY_TYPE_LABELS[a.activity_type], 0, 0,
      a.description.trim(), a.award_miles ?? 0
    );
  }

  /* Award miles on ONE timeline rather than per-year buckets. A balance is a
     running total: a year that opens at 214,000 cannot be reconstructed from
     buckets that each start at zero. Flights come from segments and everything
     else from non-flight activities — the same split the source table uses, so
     a flight is never counted from both sides. Redemptions matter most here
     and post with zero PQP, which is exactly why they never reach `events`. */
  const awardMoves: { date: string; award: number }[] = [];
  for (const s of segments) {
    if (NON_ALLOCABLE_STATUSES.includes(s.status)) continue;
    if (!FLOWN_STATUSES.includes(s.status)) continue;
    if (s.pqp == null && s.pqf == null) continue;
    if (s.award_miles) awardMoves.push({ date: s.flight_date, award: s.award_miles });
  }
  for (const a of nonFlight) {
    if (a.award_miles) awardMoves.push({ date: a.activity_date, award: a.award_miles });
  }
  awardMoves.sort((a, b) => a.date.localeCompare(b.date));

  const out: PremierYear[] = [];
  for (const [year, y] of years) {
    const program = programFor(year, programs);
    const tiers = [...program.tiers].sort((a, b) => a.pqp - b.pqp);
    y.events.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));

    let pqp = 0;
    let pqf = 0;
    /* The floor replayed at posting granularity: milestones date a tier by
       when the TOTALS met it, and totals are posted things — so the floor
       here counts posted UA flights, not flown-awaiting-credit ones. */
    let uaSoFar = 0;
    const milestones: PremierMilestone[] = [];
    const hit = new Set<string>();
    const byMonth = new Map<string, PremierMonth>();
    for (const e of y.events) {
      pqp += e.pqp;
      pqf += e.pqf;
      if (e.ua) uaSoFar += 1;
      const key = e.date.slice(0, 7);
      const m =
        byMonth.get(key) ??
        ({ month: key, pqp: 0, pqf: 0, cumPqp: 0, cumPqf: 0, projPqp: 0,
           award: 0, awardBalance: null } as PremierMonth);
      m.pqp += e.pqp;
      m.pqf += e.pqf;
      m.cumPqp = Math.round(pqp);
      m.cumPqf = pqf;
      byMonth.set(key, m);
      for (const t of tiers) {
        if (hit.has(t.name)) continue;
        const path = pathFor(pqp, pqf, t, program.minFlights, uaSoFar);
        if (!path) continue;
        hit.add(t.name);
        milestones.push({
          tier: t.name, date: e.date, path, source: e.source,
          pqpAt: Math.round(pqp), pqfAt: pqf,
        });
      }
    }
    /* Run the series to the end of the qualification year rather than
       stopping at the last thing that posted. A year cut off in July looks
       finished; the tier bars are annual, so the empty half is the part that
       still decides them. Months past the last posting carry no cumPqp — a
       flat line to December would claim a total that hasn't happened — and
       the projection continues alone from there. */
    /* Everything that moved before this January is the balance it opens on. */
    const openingAward = awardMoves
      .filter((m) => m.date < `${year}-01-01`)
      .reduce((a, m) => a + m.award, 0);
    const awardByMonth = new Map<string, number>();
    for (const m of awardMoves) {
      if (m.date.slice(0, 4) !== year) continue;
      const k = m.date.slice(0, 7);
      awardByMonth.set(k, (awardByMonth.get(k) ?? 0) + m.award);
    }
    /* The balance has its own horizon: miles move on months where no PQP
       posted (a redemption earns none), so borrowing the PQP cutoff would cut
       the line short of movements that did happen. */
    const lastAwardMonth = [...awardByMonth.keys()].sort().pop() ?? null;

    const lastPosted = [...byMonth.keys()].sort().pop() ?? null;
    const projByMonth = new Map<string, number>();
    for (const e of y.projected) {
      const k = e.date.slice(0, 7);
      projByMonth.set(k, (projByMonth.get(k) ?? 0) + e.pqp);
    }
    let runningProj = 0;
    let lastCum = 0;
    let balance = openingAward;
    for (let mo = 1; mo <= 12; mo++) {
      const key = `${year}-${String(mo).padStart(2, "0")}`;
      const actual = byMonth.get(key);
      if (actual) lastCum = actual.cumPqp ?? lastCum;
      runningProj += projByMonth.get(key) ?? 0;
      const awardDelta = awardByMonth.get(key) ?? 0;
      balance += awardDelta;
      const awardPast = lastAwardMonth == null || key <= lastAwardMonth;
      const past = lastPosted != null && key <= lastPosted;
      byMonth.set(key, {
        month: key,
        pqp: actual?.pqp ?? 0,
        pqf: actual?.pqf ?? 0,
        cumPqp: past ? lastCum : null,
        cumPqf: past ? (actual?.cumPqf ?? null) : null,
        /* Only from the junction onward. Carrying it back over the posted
           months drew a second line on top of the first, and because the two
           series then had different endpoints, Recharts' monotone spline
           curved them differently near the join — showing a gap between two
           sets of identical numbers. */
        projPqp: past && key !== lastPosted ? null : Math.round(lastCum + runningProj),
        award: awardDelta,
        awardBalance: awardPast ? Math.round(balance) : null,
      });
    }
    const closingAward = Math.round(balance);

    /* The same year, read at every date that moved rather than at twelve
       month-ends. Both series are carried at every point — a date where only
       miles moved still has to state where PQP stood, or the PQP line breaks
       at a gap that isn't a gap in PQP. Each series still ends at its OWN last
       movement: miles keep moving after the last PQP posts, and running PQP
       flat past that would assert a total nothing has established. */
    const awardInYear = awardMoves.filter((m) => m.date.slice(0, 4) === year);
    const pqpByDate = new Map<string, { pqp: number; pqf: number }>();
    for (const e of y.events) {
      const cur = pqpByDate.get(e.date) ?? { pqp: 0, pqf: 0 };
      cur.pqp += e.pqp;
      cur.pqf += e.pqf;
      pqpByDate.set(e.date, cur);
    }
    const awardByDate = new Map<string, number>();
    for (const m of awardInYear) {
      awardByDate.set(m.date, (awardByDate.get(m.date) ?? 0) + m.award);
    }
    const projByDate = new Map<string, { pqp: number; pqf: number }>();
    for (const e of y.projected) {
      const cur = projByDate.get(e.date) ?? { pqp: 0, pqf: 0 };
      cur.pqp += e.pqp;
      cur.pqf += e.pqf;
      projByDate.set(e.date, cur);
    }
    const lastPqpDate = [...pqpByDate.keys()].sort().pop() ?? null;
    const lastAwardDate = [...awardByDate.keys()].sort().pop() ?? null;
    /* Anchor on 1 January so both lines start where the year starts: PQP at
       zero because it resets, miles at the balance carried in. Without it the
       first flight of the year appears to be where the year began.
       
       Every month-end is anchored too. Between two distant events a cumulative
       line is FLAT — nothing happened — but drawn as a spline through sparse
       points it bows upward and shows growth across months with no activity in
       them. The anchors carry the running totals forward, so a quiet stretch
       renders as the flat run it actually was and each jump stays at its own
       date. They cost nothing where events are dense. */
    const monthEnds = Array.from({ length: 12 }, (_, i) => {
      const last = new Date(Date.UTC(Number(year), i + 1, 0)).getUTCDate();
      return `${year}-${String(i + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    });
    const dates = [
      ...new Set([
        `${year}-01-01`,
        ...monthEnds,
        ...pqpByDate.keys(),
        ...awardByDate.keys(),
        ...projByDate.keys(),
      ]),
    ].sort();
    let runPqp = 0;
    let runPqf = 0;
    let runAward = openingAward;
    let runProj = 0;
    let runProjPqf = 0;
    const points: PremierDayPoint[] = dates.map((date) => {
      const mv = pqpByDate.get(date);
      const aw = awardByDate.get(date) ?? 0;
      runPqp += mv?.pqp ?? 0;
      runPqf += mv?.pqf ?? 0;
      runAward += aw;
      runProj += projByDate.get(date)?.pqp ?? 0;
      runProjPqf += projByDate.get(date)?.pqf ?? 0;
      const [yy, mm, dd] = date.split("-").map(Number);
      return {
        date,
        t: Date.UTC(yy, mm - 1, dd),
        pqp: mv?.pqp ?? 0,
        award: aw,
        cumPqp: lastPqpDate != null && date <= lastPqpDate ? Math.round(runPqp) : null,
        cumPqf: lastPqpDate != null && date <= lastPqpDate ? runPqf : null,
        /* Only from the junction on, for the same reason the monthly series
           does it: two identical series with different endpoints get drawn
           with different curves and show a gap between equal numbers. */
        projPqp:
          lastPqpDate != null && date < lastPqpDate
            ? null
            : Math.round(runPqp + runProj),
        projPqf:
          lastPqpDate != null && date < lastPqpDate ? null : runPqf + runProjPqf,
        awardBalance:
          lastAwardDate != null && date <= lastAwardDate ? Math.round(runAward) : null,
      };
    });

    pqp = Math.round(pqp);

    /* Before 2020 MileagePlus qualified on miles, segments and dollars, not
       PQP/PQF. Scoring such a year against PQP bars would be meaningless, so
       it's reported with its totals and no tier rather than a wrong one. */
    const beforeTable = Number(year) < Math.min(...programs.map((p) => p.from));
    const tier = beforeTable ? null : tierFor(pqp, pqf, program, y.uaFlights);
    const nextTier = beforeTable
      ? null
      : (tiers.find((t) => !pathFor(pqp, pqf, t, program.minFlights, y.uaFlights)) ?? null);
    /* year-end = posted + flown-awaiting-credit + booked */
    const standPqp = Math.round(pqp + y.flownPendingPqp);
    const standPqf = pqf + y.flownPendingPqf;
    const projPqp = Math.round(pqp + y.flownPendingPqp + y.pendingPqp);
    const projPqf = pqf + y.flownPendingPqf + y.pendingPqf;

    out.push({
      year,
      program,
      pqp,
      pqf,
      flightPqp: Math.round(y.flightPqp),
      nonFlightPqp: Math.round(y.nonFlightPqp),
      flights: y.flights,
      uaFlights: y.uaFlights,
      beforeTable,
      tier,
      nextTier,
      needPqp: nextTier ? Math.max(0, nextTier.pqp - pqp) : 0,
      needPqf: nextTier ? Math.max(0, nextTier.pqf - pqf) : 0,
      needPqpOnly: nextTier ? Math.max(0, nextTier.pqpOnly - pqp) : 0,
      needMinFlights: Math.max(0, program.minFlights - y.uaFlights),
      milestones: beforeTable ? [] : milestones,
      flownPendingPqp: Math.round(y.flownPendingPqp),
      flownPendingPqf: y.flownPendingPqf,
      openingAward: Math.round(openingAward),
      closingAward,
      monthly: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
      points,
      sources: [...y.sources.values()]
        .map((x) => ({ ...x, pqp: Math.round(x.pqp), detail: detailOf(y.items.get(x.key)) }))
        .sort(
          (a, b) =>
            b.pqp - a.pqp || b.pqf - a.pqf || b.count - a.count ||
            a.label.localeCompare(b.label)
        ),
      projection:
        y.pendingPqp > 0 || y.pendingPqf > 0
          ? {
              pqp: projPqp,
              pqf: projPqf,
              addedPqp: Math.round(y.pendingPqp),
              addedPqf: y.pendingPqf,
              flights: y.pendingFlights,
              tier: tierFor(projPqp, projPqf, program, y.uaFlights + y.pendingUaFlights),
              unlocks: tiers
                .filter(
                  (t) =>
                    pathFor(projPqp, projPqf, t, program.minFlights,
                      y.uaFlights + y.pendingUaFlights) &&
                    !pathFor(standPqp, standPqf, t, program.minFlights, y.uaFlights)
                )
                .map((t) => t.name),
            }
          : null,
      closed: year < todayStr.slice(0, 4),
    });
  }

  return out.sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * What's left to the next rung, on whichever route is nearer. Both parts of the
 * flight-inclusive route are always stated — quoting only the PQP reads as if
 * the flights were already in hand.
 */
export function shortfall(y: PremierYear, includeBooked = false): string | null {
  const next = y.nextTier;
  if (!next) return null;
  /* With booked flights included, the ask shrinks by what's already on the
     calendar — the same arithmetic against the projected standings. Either
     way the base carries the flown-awaiting-credit part, because the gauges
     beside this line do: the ask must agree with the standing shown. */
  const basePqp =
    includeBooked && y.projection ? y.projection.pqp : y.pqp + y.flownPendingPqp;
  const basePqf =
    includeBooked && y.projection ? y.projection.pqf : y.pqf + y.flownPendingPqf;
  const needPqp = Math.max(0, next.pqp - basePqp);
  const needPqf = Math.max(0, next.pqf - basePqf);
  const needPqpOnly = Math.max(0, next.pqpOnly - basePqp);
  const n = (v: number) => v.toLocaleString();
  const viaFlights = [
    needPqp > 0 ? `${n(needPqp)} more PQP` : null,
    needPqf > 0 ? `${n(needPqf)} more flight${needPqf === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const viaPqp = [
    needPqpOnly > 0 ? `${n(needPqpOnly)} more PQP` : null,
    y.needMinFlights > 0
      ? `${n(y.needMinFlights)} more paid UA flight${y.needMinFlights === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  if (viaFlights.length === 0 && viaPqp.length === 0) return null;
  // whichever route is the shorter ask leads; ties go to the flight route
  const flightsFirst = needPqp <= needPqpOnly;
  const first = flightsFirst ? viaFlights : viaPqp;
  const second = flightsFirst ? viaPqp : viaFlights;
  const firstText = `${next.name} needs ${first.join(" and ")}`;
  if (second.length === 0) return `${firstText}.`;
  return `${firstText} — or ${second.join(" and ")} on the other route.`;
}
