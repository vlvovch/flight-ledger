/*
 * Fleet statistics: what airframes the flying actually happened on.
 *
 * The ledger's aircraft labels arrive from every direction — hand-typed,
 * myFlightradar24's names, Flighty's, the FAA registry's filing — so the
 * same airplane shows up as "B737-900", "Boeing 737-900" and "737-924ER".
 * `canonicalAircraft` folds that zoo into one display name per real variant.
 * It normalizes SPELLING, not IDENTITY: distinctions the sources genuinely
 * state (737-900 vs -900ER, A220-100 vs -300) stay separate rows, while
 * distinctions they state inconsistently and that carry no interest for a
 * passenger (A320-100 vs -200, Boeing customer codes like -924) are folded.
 * A label no rule recognizes passes through untouched — an honest unknown
 * beats a wrong bucket.
 */

import { FLOWN_STATUSES, type EnrichedSegment } from "./types";
import { normalizeTail } from "./fleet";

/** Boeing customer codes: 737-924ER is a 737-900ER United ordered; the two
 *  middle digits name the buyer, not the airplane. */
const BOEING = /\b(?:B\s*)?(7[0-9]7)(?:\s+(\d{1,3})\s*(ER|LR|F|W)?)?\b/;
const BOEING_MAX = /\b(?:B\s*)?(?:73)?7\s*(?:MAX|M)\s*(\d{1,2})\b/;
const AIRBUS = /\bA\s*(2\d\d|3\d\d)\s*(?:(NEO|CEO)|(\d{3,4})\s*(NEO|CEO)?)?\b/;
const EJET = /\b(?:EMBRAER|EMB|ERJ|E)\s*(170|175|190|195)(?:\s*(E2))?\b/;
const ERJ = /\bERJ\s*(135|140|145)\b/;
const CRJ = /\bCRJ\s*(\d{3,4})?\b/;
const ATR = /\bATR\s*(42|72)\b/;
const DASH8 = /\b(?:DHC\s*8|DASH\s*8|Q\s*400)\b/;

/**
 * IATA and ICAO equipment codes, matched only when the code IS the label:
 * "B739" inside a sentence stays prose, but a bare "B739" — what a flight
 * board or a terse hand entry writes — names a 737-900 exactly. Codes whose
 * common hand-typed reading disagrees with their official one are left out:
 * a person typing "B737" means the family, not the -700 ICAO assigns it.
 */
const EQUIPMENT: Record<string, string> = {
  // Boeing — ICAO
  B734: "Boeing 737-400", B735: "Boeing 737-500", B738: "Boeing 737-800",
  B739: "Boeing 737-900", B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8",
  B39M: "Boeing 737 MAX 9", B744: "Boeing 747-400", B748: "Boeing 747-8",
  B752: "Boeing 757-200", B753: "Boeing 757-300", B762: "Boeing 767-200",
  B763: "Boeing 767-300", B764: "Boeing 767-400", B772: "Boeing 777-200",
  B77L: "Boeing 777-200LR", B773: "Boeing 777-300", B77W: "Boeing 777-300ER",
  B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  // Boeing — IATA
  "733": "Boeing 737-300", "734": "Boeing 737-400", "735": "Boeing 737-500",
  "738": "Boeing 737-800", "739": "Boeing 737-900", "73G": "Boeing 737-700",
  "73H": "Boeing 737-800", "73J": "Boeing 737-900", "7M8": "Boeing 737 MAX 8",
  "7M9": "Boeing 737 MAX 9", "744": "Boeing 747-400", "748": "Boeing 747-8",
  "752": "Boeing 757-200", "753": "Boeing 757-300", "763": "Boeing 767-300",
  "764": "Boeing 767-400", "772": "Boeing 777-200", "773": "Boeing 777-300",
  "77W": "Boeing 777-300ER", "77L": "Boeing 777-200LR", "788": "Boeing 787-8",
  "789": "Boeing 787-9", "78X": "Boeing 787-10",
  // Airbus — ICAO
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900",
  A342: "Airbus A340-200", A343: "Airbus A340-300", A346: "Airbus A340-600",
  A359: "Airbus A350-900", A35K: "Airbus A350-1000", A388: "Airbus A380",
  BCS1: "Airbus A220-100", BCS3: "Airbus A220-300",
  // Airbus — IATA
  "32A": "Airbus A320", "32B": "Airbus A321", "32N": "Airbus A320neo",
  "32Q": "Airbus A321neo", "332": "Airbus A330-200", "333": "Airbus A330-300",
  "339": "Airbus A330-900", "359": "Airbus A350-900", "351": "Airbus A350-1000",
  "388": "Airbus A380", "221": "Airbus A220-100", "223": "Airbus A220-300",
  CS1: "Airbus A220-100", CS3: "Airbus A220-300",
  // regionals
  E70: "Embraer 170", E75: "Embraer 175", E90: "Embraer 190",
  E95: "Embraer 195", E75L: "Embraer 175", E75S: "Embraer 175",
  CR2: "Bombardier CRJ-200", CR7: "Bombardier CRJ-700",
  CR9: "Bombardier CRJ-900", CRK: "Bombardier CRJ-1000",
  CRJ2: "Bombardier CRJ-200", CRJ7: "Bombardier CRJ-700",
  CRJ9: "Bombardier CRJ-900", CRJX: "Bombardier CRJ-1000",
  DH4: "De Havilland Dash 8-400", DH8D: "De Havilland Dash 8-400",
  AT7: "ATR 72", AT72: "ATR 72", AT75: "ATR 72", AT76: "ATR 72",
  AT5: "ATR 42", AT45: "ATR 42",
};

export function canonicalAircraft(raw: string): string {
  const u = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const coded = EQUIPMENT[u];
  if (coded) return coded;

  let m = u.match(BOEING_MAX);
  if (m) return `Boeing 737 MAX ${m[1]}`;

  m = u.match(BOEING);
  if (m) {
    const fam = m[1];
    if (!m[2]) return `Boeing ${fam}`;
    /* three digits carry a customer code ("-924" is a -900 United ordered),
       so only the first survives; one or two ("747-8", "787-10") ARE the
       variant. "W" (winglets) and "F" (freighter) fold away. */
    const variant = m[2].length === 3 ? `${m[2][0]}00` : m[2];
    const suffix = m[3] === "ER" || m[3] === "LR" ? m[3] : "";
    return `Boeing ${fam}-${variant}${suffix}`;
  }

  m = u.match(AIRBUS);
  if (m) {
    const fam = m[1];
    const neo = m[2] === "NEO" || m[4] === "NEO";
    /* A318–A321: the -100/-200 sub-variant is stated by half the sources
       and interesting to none of the readers, so the family is the row.
       Wide-bodies and the A220 keep their variant — there a -300 is a
       different-sized airplane. */
    if (fam >= "318" && fam <= "321")
      return `Airbus A${fam}${neo ? "neo" : ""}`;
    /* the -800 was the only passenger A380 ever built, so the variant is
       not information */
    if (fam === "380") return "Airbus A380";
    /* captured whole, not digit-by-digit: the A350-1000 has a four-digit
       variant, and a (\d)(\d\d) split silently dropped it to the family */
    const variant = m[3] != null ? `-${m[3]}` : "";
    return `Airbus A${fam}${variant}${neo && !variant ? "neo" : ""}`;
  }

  m = u.match(ERJ);
  if (m) return `Embraer ERJ-${m[1]}`;

  m = u.match(EJET);
  if (m) return `Embraer ${m[1]}${m[2] ? "-E2" : ""}`;

  m = u.match(CRJ);
  if (m) return m[1] ? `Bombardier CRJ-${m[1]}` : "Bombardier CRJ";

  m = u.match(ATR);
  if (m) return `ATR ${m[1]}`;

  if (DASH8.test(u)) {
    const v = u.match(/\b([1-4]00)\b/);
    return `De Havilland Dash 8${v ? `-${v[1]}` : ""}`;
  }

  return raw.trim();
}

export interface FleetTypeRow {
  name: string;
  flights: number;
  miles: number;
  /** share of flights WITH a type on record — the disclosed basis */
  share: number;
  /** distinct registrations observed on this type in the window */
  tails: number;
  topAirline: string | null;
  topRoute: string | null;
  first: string;
  last: string;
}

export interface FleetTailRow {
  /** the most common spelling in the ledger, not a normalized form */
  tail: string;
  /** canonical types observed on this registration, most-flown first.
   *  More than one is not a contradiction: registrations get reused. */
  types: string[];
  flights: number;
  miles: number;
  airlines: string[];
  routes: string[];
  first: string;
  last: string;
}

export interface FleetStats {
  flown: number;
  withType: number;
  withTail: number;
  types: FleetTypeRow[];
  tails: FleetTailRow[];
}

const undirected = (o: string, d: string) => [o, d].sort().join(" – ");

function top(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts)
    if (v > n || (v === n && best != null && k < best)) {
      best = k;
      n = v;
    }
  return best;
}

export function summarizeFleet(segments: EnrichedSegment[]): FleetStats {
  const flown = segments.filter((s) => FLOWN_STATUSES.includes(s.status));

  type TypeAcc = {
    flights: number;
    miles: number;
    tails: Set<string>;
    airlines: Map<string, number>;
    routes: Map<string, number>;
    first: string;
    last: string;
  };
  const types = new Map<string, TypeAcc>();

  type TailAcc = {
    spellings: Map<string, number>;
    types: Map<string, number>;
    flights: number;
    miles: number;
    airlines: Set<string>;
    routes: Set<string>;
    first: string;
    last: string;
  };
  const tails = new Map<string, TailAcc>();

  let withType = 0;
  let withTail = 0;

  for (const s of flown) {
    const dist = s.distance_miles ?? 0;
    const route = undirected(s.origin, s.destination);
    if (s.aircraft) {
      withType++;
      const name = canonicalAircraft(s.aircraft);
      const t = types.get(name) ?? {
        flights: 0,
        miles: 0,
        tails: new Set<string>(),
        airlines: new Map<string, number>(),
        routes: new Map<string, number>(),
        first: s.flight_date,
        last: s.flight_date,
      };
      t.flights++;
      t.miles += dist;
      if (s.tail_number) t.tails.add(normalizeTail(s.tail_number));
      t.airlines.set(s.marketing_carrier, (t.airlines.get(s.marketing_carrier) ?? 0) + 1);
      t.routes.set(route, (t.routes.get(route) ?? 0) + 1);
      if (s.flight_date < t.first) t.first = s.flight_date;
      if (s.flight_date > t.last) t.last = s.flight_date;
      types.set(name, t);
    }
    if (s.tail_number) {
      withTail++;
      const key = normalizeTail(s.tail_number);
      const t = tails.get(key) ?? {
        spellings: new Map<string, number>(),
        types: new Map<string, number>(),
        flights: 0,
        miles: 0,
        airlines: new Set<string>(),
        routes: new Set<string>(),
        first: s.flight_date,
        last: s.flight_date,
      };
      t.spellings.set(s.tail_number, (t.spellings.get(s.tail_number) ?? 0) + 1);
      if (s.aircraft) {
        const name = canonicalAircraft(s.aircraft);
        t.types.set(name, (t.types.get(name) ?? 0) + 1);
      }
      t.flights++;
      t.miles += dist;
      t.airlines.add(s.marketing_carrier);
      t.routes.add(route);
      if (s.flight_date < t.first) t.first = s.flight_date;
      if (s.flight_date > t.last) t.last = s.flight_date;
      tails.set(key, t);
    }
  }

  const typeRows: FleetTypeRow[] = [...types.entries()]
    .map(([name, t]) => ({
      name,
      flights: t.flights,
      miles: Math.round(t.miles),
      share: withType > 0 ? t.flights / withType : 0,
      tails: t.tails.size,
      topAirline: top(t.airlines),
      topRoute: top(t.routes),
      first: t.first,
      last: t.last,
    }))
    .sort((a, b) => b.flights - a.flights || b.miles - a.miles || a.name.localeCompare(b.name));

  const tailRows: FleetTailRow[] = [...tails.values()]
    .map((t) => ({
      tail: top(t.spellings)!,
      types: [...t.types.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k),
      flights: t.flights,
      miles: Math.round(t.miles),
      airlines: [...t.airlines].sort(),
      routes: [...t.routes].sort(),
      first: t.first,
      last: t.last,
    }))
    .sort(
      (a, b) => b.flights - a.flights || b.miles - a.miles || a.tail.localeCompare(b.tail)
    );

  return {
    flown: flown.length,
    withType,
    withTail,
    types: typeRows,
    tails: tailRows,
  };
}
