/*
 * When has a flight ARRIVED — the one answer to a question the app used to
 * phrase separately in different places, each at day granularity: the import
 * said "past-dated means before today, not today", Reconcile said "its date
 * has passed", and both ignored the arrival time the receipt had printed all
 * along.
 *
 * The boundary is the SCHEDULED ARRIVAL, resolved to a real instant. The
 * resolution runs in two tiers:
 *
 *   - with both clocks and both airports on record, each wall clock is
 *     pinned to its real IANA zone and the arrival's calendar day is chosen
 *     as the earliest candidate AFTER departure — the same resolution the
 *     duration column uses (duration.ts), and the only one that survives
 *     the date line. The old clock-comparison rule ("arrival earlier than
 *     departure means it landed next day") read a Tokyo→LA leg — which
 *     lands the SAME calendar day on an earlier wall clock — as landing a
 *     day late, and an LA→Tokyo leg as landing before it departed;
 *   - with only an arrival clock, the destination's zone is approximated
 *     from its longitude — round(lon / 15) hours from UTC — and an arrival
 *     clock earlier than a known departure clock is taken as next-day.
 *     Political zones and DST bend this by an hour or two, which is why
 *     the predicate carries a margin rather than pretending to the minute.
 *
 * The margin also absorbs ordinary delays. A flight is called arrived six
 * hours after its scheduled arrival, not one minute after.
 *
 * A leg with no printed schedule falls back to the old day rule: before
 * today, not today — a flight departing this evening has not flown, however
 * early the receipt was printed. The asymmetry that justified that rule
 * still governs the margin: claiming an unflown flight flew corrupts miles,
 * PQP, flown counts and CPM at once, while the opposite mistake costs a
 * status flip a few hours later.
 */
import { getAirport } from "./airports";
import { addDays, wallToUtc, zoneOf } from "./duration";

/** Hours past the scheduled arrival before a flight is CALLED arrived —
 *  covering delays, and the longitude≈timezone approximation where the
 *  fallback tier answered. */
export const ARRIVAL_MARGIN_HOURS = 6;

export interface ArrivalFacts {
  flight_date: string;
  departure_time?: string | null;
  arrival_time?: string | null;
  origin?: string | null;
  destination?: string | null;
}

/** Scheduled arrival as a UTC instant (epoch ms), or null when the schedule
 *  or the destination doesn't say. */
export function scheduledArrivalUtc(s: ArrivalFacts): number | null {
  if (!s.arrival_time || !s.destination) return null;
  const dest = getAirport(s.destination);
  if (!dest) return null;
  const m = s.arrival_time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;

  /* First tier: real zones at both ends, arrival day by earliest-after-
     departure. Garbage clocks resolve to NaN, fail every comparison, and
     fall through to the approximation below. */
  const org = s.origin ? getAirport(s.origin) : null;
  if (s.departure_time && org) {
    const oz = zoneOf(org.lat, org.lon);
    const dz = zoneOf(dest.lat, dest.lon);
    if (oz && dz) {
      const dep = wallToUtc(s.flight_date, s.departure_time, oz);
      let best: number | null = null;
      for (const k of [-1, 0, 1, 2]) {
        const arr = wallToUtc(addDays(s.flight_date, k), s.arrival_time, dz);
        if (arr > dep && (best == null || arr < best)) best = arr;
      }
      if (best != null && Number.isFinite(best)) return best;
    }
  }

  /* Fallback tier: longitude approximation, next-day only when a known
     departure clock reads later than the arrival clock. */
  const base = Date.parse(`${s.flight_date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  const offsetHours = Math.round(dest.lon / 15);
  const nextDay = s.departure_time != null && s.arrival_time < s.departure_time ? 1 : 0;
  return (
    base +
    ((nextDay * 24 + Number(m[1]) - offsetHours) * 60 + Number(m[2])) * 60_000
  );
}

/**
 * Has this leg arrived, as of `nowUtcMs`? Uses the scheduled arrival plus
 * the margin when the schedule is known; otherwise the day rule against
 * `todayLocal` (a YYYY-MM-DD in the caller's reckoning of "today").
 */
export function hasArrived(
  s: ArrivalFacts,
  nowUtcMs: number,
  todayLocal: string
): boolean {
  const at = scheduledArrivalUtc(s);
  if (at != null) return nowUtcMs >= at + ARRIVAL_MARGIN_HOURS * 3_600_000;
  return s.flight_date < todayLocal;
}
