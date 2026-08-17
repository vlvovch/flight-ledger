/*
 * The data behind the flight map — pure and client-safe, like mix.ts.
 *
 * The map is a rendering of numbers the app already computes: undirected
 * routes and their CPM come from summarizeRoutes (the same figures the
 * routes table prints, so the two can never disagree), and this module adds
 * only what a map needs on top — endpoints as coordinates, per-route facets
 * for the color modes, airport visit counts, and an explicit list of what
 * could NOT be placed. A route with no coordinates is reported under the
 * map, never silently dropped.
 */
import type { EnrichedSegment } from "./types";
import { FLOWN_STATUSES } from "./types";
import { routeLabel, summarizeRoutes } from "./mix";

/** What the map needs to know about one airport (from /api/airports?codes=). */
export interface MapAirportInfo {
  lat: number;
  lon: number;
  country: string | null;
  city: string | null;
  name: string;
}

export interface MapRoute {
  /** "IAH ⇄ SFO" — the same undirected key as the routes table */
  key: string;
  from: [number, number]; // [lon, lat]
  to: [number, number];
  count: number;
  miles: number;
  grossCpm: number | null;
  /** flights behind the CPM figure — its n, reported beside it */
  cpmFlights: number;
  /** each direction actually flown, most-flown first */
  directions: { route: string; count: number }[];
  /** flown segments per marketing carrier on this pair */
  carriers: Record<string, number>;
  /** flown segments per effective purpose */
  purposes: Record<string, number>;
  /** cash-priced vs award-ticket segments */
  tickets: Record<string, number>;
}

export interface MapDot {
  code: string;
  lon: number;
  lat: number;
  visits: number;
}

export interface MapData {
  routes: MapRoute[];
  airports: MapDot[];
  /** routes that could not be placed, and which codes are to blame */
  unmapped: { route: string; missing: string[] }[];
  /** flown segments in the window, mapped or not */
  flights: number;
  /** flown segments the map actually shows */
  mappedFlights: number;
  totalMiles: number;
  countries: number;
}

export function buildMapData(
  segments: EnrichedSegment[],
  coords: Record<string, MapAirportInfo>
): MapData {
  const flown = segments.filter((s) => FLOWN_STATUSES.includes(s.status));

  // facets the routes table doesn't carry, one pass
  const facets = new Map<
    string,
    {
      carriers: Record<string, number>;
      purposes: Record<string, number>;
      tickets: Record<string, number>;
    }
  >();
  const visits = new Map<string, number>();
  let totalMiles = 0;
  const bump = (rec: Record<string, number>, k: string) => {
    rec[k] = (rec[k] ?? 0) + 1;
  };
  for (const s of flown) {
    const key = routeLabel(s);
    const f =
      facets.get(key) ?? { carriers: {}, purposes: {}, tickets: {} };
    bump(f.carriers, s.marketing_carrier || "—");
    bump(f.purposes, s.effective_purpose);
    bump(f.tickets, s.ticket_is_award ? "award" : "cash");
    facets.set(key, f);
    visits.set(s.origin, (visits.get(s.origin) ?? 0) + 1);
    visits.set(s.destination, (visits.get(s.destination) ?? 0) + 1);
    totalMiles += s.distance_miles ?? 0;
  }

  const routes: MapRoute[] = [];
  const unmapped: { route: string; missing: string[] }[] = [];
  let mappedFlights = 0;
  for (const r of summarizeRoutes(flown, Infinity)) {
    const [a, b] = r.route.split(" ⇄ ");
    const ca = coords[a];
    const cb = coords[b];
    if (!ca || !cb) {
      unmapped.push({
        route: r.route,
        missing: [!ca ? a : null, !cb ? b : null].filter(
          (x): x is string => x != null
        ),
      });
      continue;
    }
    const f = facets.get(r.route)!;
    mappedFlights += r.count;
    routes.push({
      key: r.route,
      from: [ca.lon, ca.lat],
      to: [cb.lon, cb.lat],
      count: r.count,
      miles: r.miles,
      grossCpm: r.grossCpm,
      cpmFlights: r.cpmFlights,
      directions: r.directions,
      carriers: f.carriers,
      purposes: f.purposes,
      tickets: f.tickets,
    });
  }

  const airports: MapDot[] = [...visits.entries()]
    .filter(([code]) => coords[code])
    .map(([code, v]) => ({
      code,
      lon: coords[code].lon,
      lat: coords[code].lat,
      visits: v,
    }))
    .sort((a, b) => b.visits - a.visits);

  const countries = new Set(
    airports.map((a) => coords[a.code].country).filter(Boolean)
  ).size;

  return {
    routes,
    airports,
    unmapped,
    flights: flown.length,
    mappedFlights,
    totalMiles: Math.round(totalMiles),
    countries,
  };
}

/** The category with the most flights — ties broken alphabetically, so the
 *  answer is stable between renders. */
export function dominantCategory(rec: Record<string, number>): string | null {
  const entries = Object.entries(rec);
  if (!entries.length) return null;
  return entries.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
}
