/*
 * When has a flight ARRIVED — the one answer to a question the app used to
 * phrase separately in different places, each at day granularity: the import
 * said "past-dated means before today, not today", Reconcile said "its date
 * has passed", and both ignored the arrival time the receipt had printed all
 * along.
 *
 * The boundary is the SCHEDULED ARRIVAL, resolved to a real instant:
 *
 *   - the destination's clock is approximated from its longitude —
 *     round(lon / 15) hours from UTC. Political time zones bend that by an
 *     hour or two (and DST by one more), which is why the predicate carries
 *     a margin rather than pretending to the minute;
 *   - an arrival clock earlier than the departure clock lands the next day
 *     (the red-eye rule; double-overnight arrivals exist but are covered by
 *     the margin);
 *   - the margin also absorbs ordinary delays. A flight is called arrived
 *     six hours after its scheduled arrival, not one minute after.
 *
 * A leg with no printed schedule falls back to the old day rule: before
 * today, not today — a flight departing this evening has not flown, however
 * early the receipt was printed. The asymmetry that justified that rule
 * still governs the margin: claiming an unflown flight flew corrupts miles,
 * PQP, flown counts and CPM at once, while the opposite mistake costs a
 * status flip a few hours later.
 */
import { getAirport } from "./airports";

/** Hours past the scheduled arrival before a flight is CALLED arrived —
 *  covering the longitude≈timezone approximation, DST, and ordinary delays. */
export const ARRIVAL_MARGIN_HOURS = 6;

export interface ArrivalFacts {
  flight_date: string;
  departure_time?: string | null;
  arrival_time?: string | null;
  destination?: string | null;
}

/** Scheduled arrival as a UTC instant (epoch ms), or null when the schedule
 *  or the destination doesn't say. */
export function scheduledArrivalUtc(s: ArrivalFacts): number | null {
  if (!s.arrival_time || !s.destination) return null;
  const airport = getAirport(s.destination);
  if (!airport) return null;
  const m = s.arrival_time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const base = Date.parse(`${s.flight_date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  const offsetHours = Math.round(airport.lon / 15);
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
