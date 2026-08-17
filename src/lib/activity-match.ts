/**
 * Activity classification and the segment-matching engine (design doc §11).
 *
 * Classification decides whether a MileagePlus row is flight earning (which
 * should reconcile against a segment) or non-flight earning (credit card,
 * shopping, hotels — earning in its own right, counted toward status but never
 * matched to a flight).
 *
 * Matching scores candidate (segment, activity) pairs on weighted features and
 * explains every proposal in words (§11.3). Thresholds are exported so the UI
 * and importer agree on what "automatic" means.
 */
import { ActivityType, SegmentRow } from "./types";

/* --------------------------- classification ---------------------------- */

const RULES: [ActivityType, RegExp][] = [
  ["credit_card", /\b(card|explorer|quest|infinite|presidential|chase|club card)\b|pqp earn/i],
  ["hotel", /\b(hotel|marriott|hyatt|hilton|ihg|wyndham|accor|bonvoy|lodging)\b/i],
  ["car_rental", /\b(hertz|avis|budget|national car|enterprise|sixt|dollar rent|car rental)\b/i],
  ["rideshare", /\b(lyft|uber|ride)\b/i],
  // paid extras on a United flight — they earn PQP (a day-of-departure
  // upgrade is worth hundreds), so "Other" was hiding a real earning source
  ["ancillary", /\b(seat|upgrade|wi-?fi|in-?flight|economy plus|extra legroom)\b/i],
  ["dining", /\b(dining|restaurant|mileageplus dining)\b/i],
  ["shopping", /\b(shopping|shop through|mileageplus x|marketplace|merchandise)\b/i],
  ["redemption", /\b(redeem|redemption|award ticket|air travel award|redeposit|miles used|booked with miles)\b/i],
  ["adjustment", /\b(adjust|correction|compensation|expir|transfer|reinstat)\b/i],
  ["promotion", /\b(bonus|promotion|promo|offer|survey|referral|mile play|starter pqp)\b/i],
];

/**
 * Classify a MileagePlus row. `isAirline` comes from the CSV's Activity Type
 * column when present; `carrier` from a parsed flight description.
 */
export function classifyActivity(
  description: string,
  isAirline: boolean,
  carrier: string | null
): ActivityType {
  if (isAirline) {
    return carrier != null && carrier.toUpperCase() !== "UA"
      ? "partner_flight"
      : "united_flight";
  }
  for (const [type, re] of RULES) {
    if (re.test(description)) return type;
  }
  return "other";
}

/* ------------------------------ matching ------------------------------- */

/** Feature weights (design doc §11.2). Ticket-identifier matching is not
 *  available from the activity CSV, so its 0.10 is redistributed to the three
 *  identity features; the shape of the model is unchanged. */
const W = {
  date: 0.33,
  flightNumber: 0.28,
  route: 0.28,
  carrier: 0.06,
  timeProximity: 0.05,
};

export const AUTO_THRESHOLD = 0.9;
export const SUGGEST_THRESHOLD = 0.7;

export interface MatchCandidate {
  segment: SegmentRow;
  score: number;
  reasons: string[];
}

export interface ActivityKey {
  date: string;
  carrier: string | null;
  flightNumber: string | null;
  origin: string;
  destination: string;
}

const dayDiff = (a: string, b: string) =>
  Math.round(
    (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) /
      86400000
  );

const normFlightNo = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return isFinite(n) ? String(n) : s.toUpperCase();
};

/** Score one candidate pair, collecting human-readable reasons. */
export function scoreMatch(
  activity: ActivityKey,
  seg: SegmentRow
): MatchCandidate {
  const reasons: string[] = [];
  let score = 0;

  const dd = dayDiff(seg.flight_date, activity.date);
  if (dd === 0) {
    score += W.date;
    reasons.push("Flight date exact");
  } else if (Math.abs(dd) === 1) {
    score += W.date * 0.6;
    reasons.push(`Flight date off by ${Math.abs(dd)} day`);
  } else {
    reasons.push(`Flight date differs by ${Math.abs(dd)} days`);
  }

  const aNo = normFlightNo(activity.flightNumber);
  const sNo = normFlightNo(seg.flight_number);
  if (aNo && sNo && aNo === sNo) {
    score += W.flightNumber;
    reasons.push(`Flight number ${activity.carrier ?? ""}${aNo} exact`);
  } else if (aNo == null || sNo == null) {
    // absence isn't contradiction: with date, route and carrier agreeing this
    // should still clear the automatic threshold
    score += W.flightNumber * 0.7;
    reasons.push("Flight number unknown on one side");
  } else {
    reasons.push(`Flight number differs (${sNo} vs ${aNo})`);
  }

  const sameRoute =
    seg.origin === activity.origin && seg.destination === activity.destination;
  const reversed =
    seg.origin === activity.destination && seg.destination === activity.origin;
  if (sameRoute) {
    score += W.route;
    reasons.push(`${activity.origin} → ${activity.destination} exact`);
  } else if (reversed) {
    score += W.route * 0.3;
    reasons.push("Route reversed");
  } else {
    reasons.push("Route differs");
  }

  const segCarrier = (seg.operating_carrier ?? seg.marketing_carrier ?? "").toUpperCase();
  if (activity.carrier && segCarrier) {
    if (segCarrier === activity.carrier.toUpperCase()) {
      score += W.carrier;
      reasons.push(`Carrier ${activity.carrier} matches`);
    } else {
      reasons.push(`Carrier differs (${segCarrier} vs ${activity.carrier})`);
    }
  }

  // time proximity: same-day postings are the norm; treat exact date as close
  if (dd === 0) {
    score += W.timeProximity;
  }

  return { segment: seg, score: Math.round(score * 1000) / 1000, reasons };
}

export type MatchOutcome =
  | { status: "auto" | "suggested"; candidate: MatchCandidate; runnerUp?: MatchCandidate }
  | { status: "unmatched"; candidate?: undefined; runnerUp?: MatchCandidate };

/**
 * Pick the best segment for a flight activity. Candidates are pre-filtered to
 * a ±3-day window so unrelated flights never score at all; the winner must
 * still clear SUGGEST_THRESHOLD to be proposed.
 */
export function matchActivity(
  activity: ActivityKey,
  segments: SegmentRow[],
  opts: { excludeIds?: Set<string> } = {}
): MatchOutcome {
  const exclude = opts.excludeIds ?? new Set<string>();
  const scored = segments
    .filter(
      (s) =>
        !exclude.has(s.id) &&
        /* A cancelled coupon never posts, so it is never what a posting
           refers to — and reissue chains legitimately hold a cancelled twin
           of the very flight that flew (same date, number and route, on the
           replaced ticket). Left in the pool, every such twin tied its live
           sibling's score and demoted a perfect match to "review". */
        s.status !== "canceled" &&
        Math.abs(dayDiff(s.flight_date, activity.date)) <= 3
    )
    .map((s) => scoreMatch(activity, s))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < SUGGEST_THRESHOLD) {
    return { status: "unmatched", runnerUp: best };
  }
  // an equally-good alternative must not be auto-linked (§17: no ambiguous
  // automatic matches)
  const ambiguous = runnerUp != null && best.score - runnerUp.score < 0.05;
  const status =
    best.score >= AUTO_THRESHOLD && !ambiguous ? "auto" : "suggested";
  if (ambiguous) best.reasons.push("Another flight scores nearly as well — review");
  return { status, candidate: best, runnerUp };
}

/** Stable key for deduplicating activity rows across repeated imports. */
export function dedupKey(parts: {
  date: string;
  description: string;
  award: number | null;
  pqp: number | null;
  pqf: number | null;
}): string {
  const desc = parts.description.replace(/\s+/g, " ").trim().toUpperCase();
  return [parts.date, desc, parts.award ?? "", parts.pqp ?? "", parts.pqf ?? ""].join("|");
}
