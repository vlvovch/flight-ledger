/*
 * What the flying is made of — three cuts of one set of segments.
 *
 * Kept out of metrics.ts for the same reason rollingCpm is: the Analysis page
 * needs this in the browser, and metrics.ts reaches the database, so importing
 * it as a VALUE from a client component drags node:sqlite into the bundle. A
 * type-only import erases; a function does not. Everything here touches only
 * its arguments, and both imports below are client-safe (types, and an airport
 * lookup over bundled JSON).
 *
 * It lives client-side rather than in the analytics payload because the mix has
 * to follow the Analysis page's range control — a 2022 chart above an all-time
 * mix is the same inconsistency the monthly ledger was fixed for — and the
 * range is UI state the server never sees.
 */
import { isInternationalSegment } from "./cost-estimate";
import { EnrichedSegment, FLOWN_STATUSES, isCpmEligible } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One slice of a dimension — a share of the flying, with what it cost. */
export interface MixBucket {
  key: string;
  label: string;
  flights: number;
  miles: number;
  /** share of the dimension's flown miles, 0–1 */
  share: number;
  /** flights behind the cost figures — see pricesInCash */
  cpmFlights: number;
  cpmMiles: number;
  gross: number;
  grossCpm: number | null;
}

export interface TravelMix {
  /** business vs personal — see effectivePurpose, which infers from reimbursement */
  purpose: MixBucket[];
  /** United metal vs everyone else's */
  carrier: MixBucket[];
  geography: MixBucket[];
  /** busiest airports, counted once per flight that touches them */
  airports: { code: string; flights: number }[];
}

/**
 * Whether a flight can price a slice in cents per mile.
 *
 * Deliberately wider than `isCpmEligible`, and only here. The aggregate basis
 * (§4.7) also demands lifetime-mile credit, which no non-UA flight earns —
 * defensible for a headline about United earning, fatal for a panel whose job
 * is comparing United against everyone else, since it leaves one whole side
 * structurally unanswerable rather than merely unknown.
 *
 * What this still keeps out is what actually distorts a cents-per-mile figure:
 * a flight with no cost recorded, which is 0¢ over real miles, and award
 * travel, where $5.60 of taxes over 862 miles reads as 0.65¢ and quietly beats
 * every fare that was paid in money. Other airlines' metal does neither — it
 * cost cash and it flew miles, so it can be priced.
 *
 * The consequence is that mix CPM and the dashboard's headline CPM rest on
 * different populations. That is why every slice states its own n.
 */
export function pricesInCash(s: EnrichedSegment): boolean {
  return (
    s.allocation_method !== "none" && s.award_miles !== 0 && !s.ticket_is_award
  );
}

/**
 * Split flown segments into buckets on some test, with each bucket's share.
 *
 * First matching bucket wins, so order them specific-first. Empty buckets are
 * kept rather than dropped: on a two-sided split "international, 0 flights" is
 * an answer, and the caller is better placed than this to decide whether to
 * draw it.
 */
function bucketize(
  segments: EnrichedSegment[],
  buckets: { key: string; label: string; test: (s: EnrichedSegment) => boolean }[]
): MixBucket[] {
  const acc = buckets.map((b) => ({
    ...b, flights: 0, miles: 0, cpmFlights: 0, cpmMiles: 0, gross: 0,
  }));
  for (const s of segments) {
    const b = acc.find((x) => x.test(s));
    if (!b) continue;
    const dist = s.distance_miles ?? 0;
    b.flights += 1;
    b.miles += dist;
    if (pricesInCash(s)) {
      b.cpmFlights += 1;
      b.cpmMiles += dist;
      b.gross += s.gross_cost;
    }
  }
  const total = acc.reduce((a, b) => a + b.miles, 0);
  return acc.map((b) => {
    /* Round the basis before dividing, as finalizeSummary and summarizeRoutes
       do — a CPM printed beside its own miles has to divide into them. */
    const cpmMiles = Math.round(b.cpmMiles);
    const gross = round2(b.gross);
    return {
      key: b.key,
      label: b.label,
      flights: b.flights,
      miles: Math.round(b.miles),
      share: total > 0 ? b.miles / total : 0,
      cpmFlights: b.cpmFlights,
      cpmMiles,
      gross,
      grossCpm: cpmMiles > 0 ? round2((100 * gross) / cpmMiles) : null,
    };
  });
}

/**
 * One city pair, undirected, with what flying it has cost.
 *
 * The pair is undirected because "what does IAH–SFO cost me" is one question,
 * not two: a round trip is bought as one fare and reading the legs apart would
 * split every itinerary down the middle. `directions` keeps the split for when
 * it matters — a paid outbound and an award return are the case where the two
 * halves genuinely differ.
 */
export interface RouteSummary {
  /** "IAH ⇄ SFO" — endpoints sorted, so both directions land on one row */
  route: string;
  /** every flown segment on the pair */
  count: number;
  /** every flown mile on the pair */
  miles: number;
  /* The CPM figures run on the same restricted basis as every other average
     in this file (isCpmEligible): flown, cost recorded, lifetime-earning.
     `cpmFlights` is the n behind them, and it is reported rather than hidden —
     on a route flown twice it is the difference between a fact and an anecdote,
     and the aggregate figures at least have the whole ledger behind them. */
  cpmFlights: number;
  cpmMiles: number;
  gross: number;
  personal: number;
  grossCpm: number | null;
  personalCpm: number | null;
  /** each direction actually flown, most-flown first */
  directions: { route: string; count: number }[];
}

export interface RouteTableRow {
  key: string;
  flights: number;
  miles: number;
  /** allocated cost of EVERY flown flight on the pair — an award ticket's
   *  taxes are money spent even though they price no mile */
  gross: number;
  personal: number;
  /** the pair's one-leg distance — the most common value the segments
   *  carry, since a great-circle doesn't change between visits */
  distance: number | null;
  /** cash-priced flights behind the ¢/mi — see pricesInCash */
  cpmFlights: number;
  cpmMiles: number;
  cpmGross: number;
  grossCpm: number | null;
  /** summed gate-to-gate time, when the caller supplied a duration source */
  timeMin: number | null;
  /** legs actually behind timeMin — fewer than flights means partial */
  timeFlights: number;
  /** true when any leg's time is the distance model, not the clocks */
  timeEstimated: boolean;
  airlines: string[];
  first: string;
  last: string;
}

/**
 * The routes table: every pair (or direction) with its traffic and its money.
 * Unlike summarizeRoutes' dashboard rows, the money columns sum every flown
 * flight — "what did this route cost me" includes the award taxes and the
 * uncosted history contributes its zero honestly — while ¢/mi keeps the
 * cash-priced basis and states it, exactly like the travel mix slices.
 */
export function summarizeRouteTable(
  segments: EnrichedSegment[],
  directed: boolean,
  durationOf?: (
    s: EnrichedSegment
  ) => { minutes: number; estimated: boolean } | null
): RouteTableRow[] {
  type Acc = {
    flights: number; miles: number; gross: number; personal: number;
    cpmFlights: number; cpmMiles: number; cpmGross: number;
    dists: Map<number, number>;
    timeMin: number; timeKnown: number; timeEstimated: boolean;
    airlines: Set<string>; first: string; last: string;
  };
  const acc = new Map<string, Acc>();
  for (const s of segments) {
    if (!FLOWN_STATUSES.includes(s.status)) continue;
    const key = directed ? `${s.origin} → ${s.destination}` : routeLabel(s);
    const r =
      acc.get(key) ??
      {
        flights: 0, miles: 0, gross: 0, personal: 0,
        cpmFlights: 0, cpmMiles: 0, cpmGross: 0,
        dists: new Map<number, number>(),
        timeMin: 0, timeKnown: 0, timeEstimated: false,
        airlines: new Set<string>(), first: s.flight_date, last: s.flight_date,
      };
    const dist = s.distance_miles ?? 0;
    r.flights += 1;
    r.miles += dist;
    r.gross += s.gross_cost;
    r.personal += s.personal_cost;
    if (pricesInCash(s)) {
      r.cpmFlights += 1;
      r.cpmMiles += dist;
      r.cpmGross += s.gross_cost;
    }
    if (s.distance_miles != null) {
      const d = Math.round(s.distance_miles);
      r.dists.set(d, (r.dists.get(d) ?? 0) + 1);
    }
    const t = durationOf?.(s) ?? null;
    if (t) {
      r.timeMin += t.minutes;
      r.timeKnown += 1;
      if (t.estimated) r.timeEstimated = true;
    }
    r.airlines.add(s.marketing_carrier);
    if (s.flight_date < r.first) r.first = s.flight_date;
    if (s.flight_date > r.last) r.last = s.flight_date;
    acc.set(key, r);
  }
  return [...acc.entries()].map(([key, v]) => {
    /* basis rounded before dividing — the printed figures must divide into
       each other, same rule as finalizeSummary and summarizeRoutes */
    const cpmMiles = Math.round(v.cpmMiles);
    const cpmGross = round2(v.cpmGross);
    let distance: number | null = null;
    let dn = 0;
    for (const [d, n] of v.dists)
      if (n > dn || (n === dn && distance != null && d < distance)) {
        distance = d;
        dn = n;
      }
    return {
      key,
      flights: v.flights,
      miles: Math.round(v.miles),
      distance,
      gross: round2(v.gross),
      personal: round2(v.personal),
      cpmFlights: v.cpmFlights,
      cpmMiles,
      cpmGross,
      grossCpm: cpmMiles > 0 ? (100 * cpmGross) / cpmMiles : null,
      timeMin: v.timeKnown > 0 ? v.timeMin : null,
      timeFlights: v.timeKnown,
      timeEstimated: v.timeEstimated,
      airlines: [...v.airlines].sort(),
      first: v.first,
      last: v.last,
    };
  });
}

/** Endpoints sorted — the undirected key both directions share. */
export const routeLabel = (s: { origin: string; destination: string }) =>
  [s.origin, s.destination].sort().join(" ⇄ ");

/**
 * Group flown segments by city pair. Pure, so it can be tested without a
 * database — the rest of buildAnalytics cannot.
 *
 * Physical totals count every flown segment; the cost figures count only the
 * ones inside the CPM basis. That is the same split §4.7 applies everywhere
 * else: a route flown four times of which one had a ticket reports four
 * flights, and a CPM that says it rests on one.
 */
export function summarizeRoutes(
  segments: EnrichedSegment[],
  limit = 8
): RouteSummary[] {
  const acc = new Map<
    string,
    {
      count: number;
      miles: number;
      cpmFlights: number;
      cpmMiles: number;
      gross: number;
      personal: number;
      dirs: Map<string, number>;
    }
  >();

  for (const s of segments) {
    if (!FLOWN_STATUSES.includes(s.status)) continue;
    const key = routeLabel(s);
    const r =
      acc.get(key) ??
      {
        count: 0, miles: 0, cpmFlights: 0, cpmMiles: 0,
        gross: 0, personal: 0, dirs: new Map<string, number>(),
      };
    const dist = s.distance_miles ?? 0;
    r.count += 1;
    r.miles += dist;
    if (isCpmEligible(s)) {
      r.cpmFlights += 1;
      r.cpmMiles += dist;
      r.gross += s.gross_cost;
      r.personal += s.personal_cost;
    }
    const dir = `${s.origin} → ${s.destination}`;
    r.dirs.set(dir, (r.dirs.get(dir) ?? 0) + 1);
    acc.set(key, r);
  }

  return [...acc.entries()]
    .map(([route, v]) => {
      /* Round the basis BEFORE dividing, exactly as finalizeSummary does for
         the monthly figures. Dividing at full precision is the more accurate
         answer and the wrong one to print: it put 10.21¢ beside a row reading
         1,118 mi and $114.24, which divide to 10.22¢. Two CPM figures on one
         dashboard have to be checkable by the same arithmetic. */
      const cpmMiles = Math.round(v.cpmMiles);
      const gross = round2(v.gross);
      const personal = round2(v.personal);
      return {
        route,
        count: v.count,
        miles: Math.round(v.miles),
        cpmFlights: v.cpmFlights,
        cpmMiles,
        gross,
        personal,
        /* Over the basis miles, never over v.miles: spreading one flight's
           fare across a whole route's distance would report a CPM several
           times lighter than anything that was actually paid. */
        grossCpm: cpmMiles > 0 ? round2((100 * gross) / cpmMiles) : null,
        personalCpm: cpmMiles > 0 ? round2((100 * personal) / cpmMiles) : null,
        directions: [...v.dirs.entries()]
          .map(([r2, count]) => ({ route: r2, count }))
          .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)),
      };
    })
    /* Ordered by how often it was flown, not by CPM. This is the "top routes"
       list, and sorting by cost would put a single expensive one-off at the
       head of it — the least representative row in the table leading a panel
       about where the flying goes. */
    .sort((a, b) => b.count - a.count || b.miles - a.miles)
    .slice(0, limit);
}

/** The per-flight cost distribution behind the averages (§5.5). */
export interface CpmSpread {
  /** cash-priced flights behind the figures */
  flights: number;
  median: number;
  p10: number;
  p90: number;
}

/**
 * What a TYPICAL flight costs per mile — the counterpart to every weighted
 * mean in the app. The mean answers "what does my flying cost"; miles dominate
 * it, so three transatlantics outvote ten hops. Here each flight is one vote:
 * half cost less than the median, and the p10–p90 band is the spread the
 * average erases. On one real ledger the mean was 13.8¢, the median 12.9¢,
 * and the band ran 9.2¢ to 26.4¢ — a 3× spread inside one tidy-looking mean.
 *
 * Basis: cash-priced flights (pricesInCash) with a positive cost and a known
 * distance. Percentiles are nearest-rank; the median averages the two middle
 * flights on an even count.
 */
export function flightCpmSpread(segments: EnrichedSegment[]): CpmSpread | null {
  const cpms = segments
    .filter(
      (s) =>
        FLOWN_STATUSES.includes(s.status) &&
        pricesInCash(s) &&
        (s.distance_miles ?? 0) > 0 &&
        s.gross_cost > 0
    )
    .map((s) => (100 * s.gross_cost) / (s.distance_miles as number))
    .sort((a, b) => a - b);
  const n = cpms.length;
  if (n === 0) return null;
  const at = (q: number) => cpms[Math.min(n - 1, Math.floor(q * n))];
  const median =
    n % 2 === 1 ? cpms[(n - 1) / 2] : (cpms[n / 2 - 1] + cpms[n / 2]) / 2;
  return {
    flights: n,
    median: round2(median),
    p10: round2(at(0.1)),
    p90: round2(at(0.9)),
  };
}

/** One booking class, with what it cost and what it earned. */
export interface FareClassRow {
  /** the class exactly as the document wrote it — never parsed or normalized */
  code: string;
  /** the airline whose fare it is — the MARKETING carrier, because the class
   *  letter lives in the seller's inventory: a codeshare is booked in the
   *  marketing airline's class whoever flies it. (The travel mix's "metal"
   *  split uses the operating carrier — a different question.) */
  carrier: string;
  /** cabins seen on it, most flown first; a class can span more than one */
  cabins: string[];
  flights: number;
  miles: number;
  /** flights carrying the award signature — see the note in summarizeFareClasses */
  awardFlights: number;
  /* Cash figures over pricesInCash flights only, INCLUDING their PQP. Dividing
     cash by every flight's PQP would let an award booking's points cheapen a
     class it paid nothing toward: XN earns 2,005 PQP on this ledger for no
     fare at all, which would read as buying status almost free. */
  cashFlights: number;
  cashMiles: number;
  gross: number;
  grossCpm: number | null;
  cashPqp: number;
  costPerPqp: number | null;
  /** every PQP the class earned, award bookings included */
  pqp: number;
}

/**
 * What each booking class costs, and how efficiently it buys status.
 *
 * The class is reported verbatim. Nothing is inferred from its letters: on this
 * ledger XN, YN and IN are award fares and PZ and RN are cash ones, so neither
 * length nor any prefix separates them — only the recorded award signature
 * does, which is what `pricesInCash` already tests. A rule read off the code
 * would be United-specific, undocumented, and wrong on the next airline.
 *
 * Classes are NOT ranked, only ordered by how much they were flown. This
 * ledger uses PZ for both a domestic First recliner and a lie-flat Polaris
 * seat, so the code cannot carry a hierarchy even within one airline.
 *
 * And they are keyed per AIRLINE, because a booking class is the airline's
 * own namespace. One ledger's V spanned United, Lufthansa and Alaska fares
 * with nothing in common but the letter — blended, they priced three
 * different products as one and quoted a ¢/mi nobody ever paid.
 */
export function summarizeFareClasses(
  segments: EnrichedSegment[],
  limit = 10
): FareClassRow[] {
  const acc = new Map<
    string,
    {
      code: string;
      carrier: string;
      cabins: Map<string, number>;
      flights: number; miles: number; awardFlights: number;
      cashFlights: number; cashMiles: number; gross: number; cashPqp: number;
      pqp: number;
    }
  >();

  for (const s of segments) {
    if (!FLOWN_STATUSES.includes(s.status)) continue;
    /* An empty code is kept, not skipped. It groups per airline like any
       real class and renders as "no class" — "which of my flying is
       unclassified" is answered by seeing the row, the same rule that keeps
       the Premier breakdown's zero-PQP Lyft rides on the table. An earlier
       version dropped these on the grounds that "a class we never learned
       isn't a class", which was true and beside the point. */
    const code = (s.booking_class ?? "").trim().toUpperCase();
    const carrier = (s.marketing_carrier || "UA").trim().toUpperCase();
    const key = `${carrier}:${code}`;
    const r =
      acc.get(key) ??
      {
        code,
        carrier,
        cabins: new Map<string, number>(),
        flights: 0, miles: 0, awardFlights: 0,
        cashFlights: 0, cashMiles: 0, gross: 0, cashPqp: 0, pqp: 0,
      };
    const dist = s.distance_miles ?? 0;
    r.flights += 1;
    r.miles += dist;
    r.pqp += s.pqp ?? 0;
    if (s.award_miles === 0 || s.ticket_is_award) r.awardFlights += 1;
    if (s.cabin) r.cabins.set(s.cabin, (r.cabins.get(s.cabin) ?? 0) + 1);
    if (pricesInCash(s)) {
      r.cashFlights += 1;
      r.cashMiles += dist;
      r.gross += s.gross_cost;
      r.cashPqp += s.pqp ?? 0;
    }
    acc.set(key, r);
  }

  return [...acc.values()]
    .map((v) => {
      const cashMiles = Math.round(v.cashMiles);
      const gross = round2(v.gross);
      const cashPqp = Math.round(v.cashPqp);
      return {
        code: v.code,
        carrier: v.carrier,
        cabins: [...v.cabins.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([c]) => c),
        flights: v.flights,
        miles: Math.round(v.miles),
        awardFlights: v.awardFlights,
        cashFlights: v.cashFlights,
        cashMiles,
        gross,
        grossCpm: cashMiles > 0 ? round2((100 * gross) / cashMiles) : null,
        cashPqp,
        costPerPqp: cashPqp > 0 ? round2(gross / cashPqp) : null,
        pqp: Math.round(v.pqp),
      };
    })
    .sort((a, b) => b.flights - a.flights || b.miles - a.miles || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/**
 * Each dimension partitions the SAME flown segments, so the three mile totals
 * agree with each other and with the ledger. Purpose comes from
 * `effective_purpose` rather than from comparing gross against personal cost,
 * because that is already this app's one answer to "was this work?" — the
 * flight's own purpose where set, business inferred from a reimbursed ticket
 * otherwise, which on a ledger that rarely sets purpose by hand is where the
 * signal actually is.
 */
export function summarizeMix(
  segments: EnrichedSegment[],
  airportLimit = 6
): TravelMix {
  const flown = segments.filter((s) => FLOWN_STATUSES.includes(s.status));
  const uaMetal = (s: EnrichedSegment) =>
    (s.operating_carrier ?? s.marketing_carrier ?? "").toUpperCase() === "UA";

  const seen = new Map<string, number>();
  for (const s of flown) {
    for (const code of [s.origin, s.destination]) {
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
  }

  return {
    purpose: bucketize(flown, [
      { key: "business", label: "Business", test: (s) => s.effective_purpose === "business" },
      { key: "mixed", label: "Mixed", test: (s) => s.effective_purpose === "mixed" },
      { key: "personal", label: "Personal", test: () => true },
    ]),
    carrier: bucketize(flown, [
      { key: "ua", label: "United", test: uaMetal },
      /* NOT "Partners". Delta and American are competitors, not partners, and
         SkyWest flies for whoever holds the contract — this ledger has all
         three. The dimension is whose metal you were on, which is a question
         about the aircraft and says nothing about an alliance. */
      { key: "other", label: "Other airlines", test: () => true },
    ]),
    geography: bucketize(flown, [
      { key: "intl", label: "International", test: isInternationalSegment },
      { key: "domestic", label: "Domestic", test: () => true },
    ]),
    airports: [...seen.entries()]
      .map(([code, flights]) => ({ code, flights }))
      .sort((a, b) => b.flights - a.flights || a.code.localeCompare(b.code))
      .slice(0, airportLimit),
  };
}
