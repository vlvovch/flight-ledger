/**
 * Estimating what an uncosted flight cost, from its PQP.
 *
 * United's PQP is revenue-based: one PQP ≈ one dollar of base fare (carrier
 * surcharges included, government taxes excluded). Measured against this
 * ledger's own receipts the ratio sits within a fraction of a percent, so
 * `base fare ≈ PQP` is a sound reconstruction — the missing piece is tax,
 * which varies by itinerary.
 *
 * Rather than hard-coding a "typical" tax rate, rates are derived from the
 * user's OWN costed tickets, split domestic vs international (international
 * tax burden varies far too much to blend with domestic). A configured rate
 * overrides the derivation; a documented fallback applies when there is no
 * evidence yet.
 *
 * Estimates are never mixed into the strict cost figures — they are surfaced
 * separately and always marked (design doc §1.2: estimated and confirmed
 * values must be visibly different).
 */
import { getAirport } from "./airports";
import { EnrichedSegment, FLOWN_STATUSES, SegmentRow, TicketRow } from "./types";

/** Fallback rates, used only until the ledger has costed tickets to learn from. */
export const FALLBACK_TAX_RATES = { domestic: 0.175, international: 0.2 };
/** Minimum costed tickets in a bucket before its derived rate is trusted. */
const MIN_SAMPLE = 2;

export interface TaxRates {
  domestic: number;
  international: number;
  /** how many of the user's own tickets each rate was derived from */
  domesticSample: number;
  internationalSample: number;
  source: "derived" | "partly-derived" | "fallback" | "configured";
}

const countryOf = (iata: string) => getAirport(iata)?.country ?? null;

/** A segment is international when its endpoints sit in different countries. */
export function isInternationalSegment(seg: {
  origin: string;
  destination: string;
}): boolean {
  const a = countryOf(seg.origin);
  const b = countryOf(seg.destination);
  if (!a || !b) return false;
  return a !== b;
}

/**
 * Learn tax-to-fare ratios from tickets that have both a real fare breakdown
 * and attached flights. Award tickets are excluded — their taxes bear no
 * relation to a fare.
 */
export function deriveTaxRates(
  tickets: TicketRow[],
  segments: SegmentRow[],
  configured?: { domestic?: number | null; international?: number | null }
): TaxRates {
  const dom: number[] = [];
  const intl: number[] = [];

  for (const t of tickets) {
    const segs = segments.filter((s) => s.ticket_id === t.id);
    if (segs.length === 0) continue;
    const base = t.base_fare;
    // taxes must be itemized and the fare must be real (award tickets have none)
    if (!(base > 0) || !(t.taxes > 0)) continue;
    const ratio = t.taxes / base;
    // guard against malformed rows (a 300% tax ratio is a data error, not a fare)
    if (!isFinite(ratio) || ratio <= 0 || ratio > 1.5) continue;
    (segs.some(isInternationalSegment) ? intl : dom).push(ratio);
  }

  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const domDerived = dom.length >= MIN_SAMPLE ? median(dom) : null;
  const intlDerived = intl.length >= MIN_SAMPLE ? median(intl) : null;

  const domestic =
    configured?.domestic ?? domDerived ?? FALLBACK_TAX_RATES.domestic;
  const international =
    configured?.international ?? intlDerived ?? FALLBACK_TAX_RATES.international;

  let source: TaxRates["source"] = "fallback";
  if (configured?.domestic != null || configured?.international != null)
    source = "configured";
  else if (domDerived != null && intlDerived != null) source = "derived";
  else if (domDerived != null || intlDerived != null) source = "partly-derived";

  return {
    domestic: Math.round(domestic * 10000) / 10000,
    international: Math.round(international * 10000) / 10000,
    domesticSample: dom.length,
    internationalSample: intl.length,
    source,
  };
}

/**
 * Whether a flight is a candidate for a PQP-derived cost estimate: flown, no
 * cost recorded, earned PQP, and not award travel (award tickets are paid in
 * miles, so PQP says nothing about the cash spent).
 */
export function canEstimateCost(seg: {
  status: EnrichedSegment["status"];
  allocation_method: EnrichedSegment["allocation_method"];
  pqp: number | null;
  award_miles: number | null;
}): boolean {
  return (
    FLOWN_STATUSES.includes(seg.status) &&
    seg.allocation_method === "none" &&
    seg.pqp != null &&
    seg.pqp > 0 &&
    seg.award_miles !== 0 // award-travel signature
  );
}

/** Estimated ticket cost for one segment: PQP as base fare, plus tax. */
export function estimateSegmentCost(
  seg: { origin: string; destination: string; pqp: number | null },
  rates: TaxRates
): number | null {
  if (seg.pqp == null || seg.pqp <= 0) return null;
  const rate = isInternationalSegment(seg) ? rates.international : rates.domestic;
  return Math.round(seg.pqp * (1 + rate) * 100) / 100;
}
