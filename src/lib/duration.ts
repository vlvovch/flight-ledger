/*
 * Flight block time, honestly. Gate to gate, from the scheduled clocks —
 * NOT airborne time, and every consumer should say so.
 *
 * The ledger stores departure and arrival as LOCAL wall clocks at two
 * different airports, so subtracting them answers nothing until each is
 * pinned to its zone. The zone comes from the airport's coordinates
 * (tz-lookup: pure data, offline, CC0-1.0). Its boundary resolution is
 * approximate — fine for airports, which are rarely built on a timezone
 * border — and the offset for the specific date comes from Intl, which
 * means daylight saving is tracked properly: a January departure out of
 * SFO is PST, a July one PDT, with the runtime's own IANA tables carrying
 * the historical rules.
 *
 * Where the clocks or coordinates are missing, a distance model stands in
 * (taxi + climb ≈ 35 min, cruise ≈ 470 mph) and SAYS so — the figure wears
 * the app's ≈, never passes as recorded. The same fallback catches clocks
 * that CAN'T mean what they say: a derived time far outside what the
 * distance supports is bad data wearing a timestamp, and a confidently
 * wrong 10-hour SFO–LAX is worse than an estimate.
 */

import tzlookup from "@photostructure/tz-lookup";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const fmtFor = (zone: string): Intl.DateTimeFormat => {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    fmtCache.set(zone, f);
  }
  return f;
};

/** the zone's UTC offset (ms) at a given instant */
function offsetAt(utcMs: number, zone: string): number {
  const parts = fmtFor(zone).formatToParts(utcMs);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // Intl prints midnight as 24 in some ICU versions
    get("minute"),
    get("second")
  );
  return asUtc - utcMs;
}

/** a local wall clock in a zone, as a UTC instant — two passes so a time
 *  near a DST transition resolves against the offset actually in force */
export function wallToUtc(date: string, time: string, zone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const guess = naive - offsetAt(naive, zone);
  return naive - offsetAt(guess, zone);
}

export function zoneOf(lat: number, lon: number): string | null {
  try {
    return tzlookup(lat, lon);
  } catch {
    return null;
  }
}

export interface FlightDuration {
  minutes: number;
  /** true when the figure is the distance model, not the clocks */
  estimated: boolean;
}

/** the distance model, exposed for the fallback disclosure */
export function estimatedMinutes(distanceMiles: number): number {
  return Math.round(35 + (distanceMiles / 470) * 60);
}

const MIN_PLAUSIBLE = 20;
const MAX_PLAUSIBLE = 22 * 60; // longest scheduled flights run ~19h

/**
 * The raw clock arithmetic, with no plausibility judgment: local wall
 * clocks pinned to each end's zone, rolled forward across midnight and the
 * dateline. flightDuration guards this before showing it; the reconcile
 * queue reads it bare, because "what the clocks literally say" is exactly
 * what a data-quality check needs to inspect.
 */
export function clockMinutes(
  seg: {
    flight_date: string;
    departure_time: string | null;
    arrival_time: string | null;
  },
  origin: { lat: number; lon: number } | null | undefined,
  destination: { lat: number; lon: number } | null | undefined
): number | null {
  if (!seg.departure_time || !seg.arrival_time || !origin || !destination)
    return null;
  const oz = zoneOf(origin.lat, origin.lon);
  const dz = zoneOf(destination.lat, destination.lon);
  if (!oz || !dz) return null;
  const dep = wallToUtc(seg.flight_date, seg.departure_time, oz);
  /* The ledger stores no arrival DATE, so the arrival wall clock is tried on
     each plausible calendar day: -1 for an eastbound date-line hop that lands
     the previous local date (APW–PPG), 0 for the ordinary case, +1 for a
     red-eye, +2 for a westbound trans-Pacific leg landing two local dates
     later. Each candidate advances the local DATE and re-resolves the zone —
     adding flat 24-hour blocks of UTC lands an hour off whenever the
     candidate day crosses a DST transition. The result is the earliest
     arrival after departure, RAW: the reconcile queue needs to see a 23-hour
     reading to flag it, so judging plausibility is flightDuration's job. */
  let best: number | null = null;
  for (const k of [-1, 0, 1, 2]) {
    const arr = wallToUtc(addDays(seg.flight_date, k), seg.arrival_time, dz);
    const minutes = Math.round((arr - dep) / 60000);
    if (minutes > 0 && (best == null || minutes < best)) best = minutes;
  }
  return best;
}

function addDays(date: string, k: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function flightDuration(
  seg: {
    flight_date: string;
    departure_time: string | null;
    arrival_time: string | null;
    distance_miles: number | null;
  },
  origin: { lat: number; lon: number } | null | undefined,
  destination: { lat: number; lon: number } | null | undefined
): FlightDuration | null {
  const fallback: FlightDuration | null =
    seg.distance_miles != null && seg.distance_miles > 0
      ? { minutes: estimatedMinutes(seg.distance_miles), estimated: true }
      : null;

  const minutes = clockMinutes(seg, origin, destination);
  if (minutes == null) return fallback;
  /* the raw reading can be a 23-hour same-zone impossibility — display
     only believes the window a real flight can occupy */
  if (minutes < MIN_PLAUSIBLE || minutes > MAX_PLAUSIBLE) return fallback;
  /* The malformed-clock guard is ASYMMETRIC, because the two directions
     fail differently: no flight beats physics, so far under the model means
     a wrong clock — but a real flight sits on taxiways and in holds, so a
     recorded three-hour SFO–LAX is a bad day, not bad data. Only a reading
     past double the model plus two hours is rejected as nonsense; the
     reconcile queue flags the questionable middle for a human. */
  if (seg.distance_miles != null && seg.distance_miles > 0) {
    const model = estimatedMinutes(seg.distance_miles);
    if (minutes < model * 0.55 || minutes > model * 2 + 120) return fallback;
  }
  return { minutes, estimated: false };
}

/** "11h 30m", or bare hours once minutes stop meaning anything */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h >= 100) return `${Math.round(minutes / 60).toLocaleString("en-US")}h`;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
