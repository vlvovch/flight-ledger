/** Shared domain types. DB rows use snake_case matching column names. */

export const SEGMENT_STATUSES = [
  "ticketed",
  "flown_unreconciled",
  "flown_reconciled",
  "canceled",
  "missed",
] as const;

/**
 * Statuses that were retired, and what each became.
 *
 * `planned` and `ticketed` were read identically everywhere — both simply meant
 * "not flown yet" — and "nothing bought yet" is already legible from a flight
 * with no ticket attached. `refunded` and `canceled` were likewise identical in
 * every code path: neither allocates cost, neither earns. The distinction they
 * reached for — whether the money came back — belongs on the TICKET, where it
 * already lives as a ticket status and a refund adjustment, because a refund is
 * granted per ticket and not per leg. Note the ticket status `refunded` stays;
 * only the segment status is gone.
 */
export const RETIRED_SEGMENT_STATUSES: Record<string, SegmentStatus> = {
  planned: "ticketed",
  refunded: "canceled",
};
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

/** Statuses that count as actually flown (earn miles, count as flights). */
export const FLOWN_STATUSES: SegmentStatus[] = [
  "flown_unreconciled",
  "flown_reconciled",
];

/** Statuses excluded from cost allocation entirely. */
export const NON_ALLOCABLE_STATUSES: SegmentStatus[] = ["canceled"];

export const TICKET_STATUSES = [
  "active",
  "exchanged",
  "refunded",
  "voided",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const PAYMENT_TYPES = [
  "card",
  "cash",
  "travelbank",
  "future_flight_credit",
  "travel_certificate",
  "gift_card",
  "miles",
  "other",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  card: "Credit card",
  cash: "Cash",
  travelbank: "TravelBank",
  future_flight_credit: "Future flight credit",
  travel_certificate: "Travel certificate",
  gift_card: "Gift card",
  miles: "MileagePlus miles",
  other: "Other",
};

/** Funding that came from a previous ticket's value rather than new money —
 *  the signal that a ticket is part of an exchange chain. */
export const CREDIT_PAYMENT_TYPES: PaymentType[] = [
  "future_flight_credit",
  "travel_certificate",
];

export interface PaymentRow {
  id: string;
  ticket_id: string;
  payment_type: PaymentType;
  /** null when the receipt names the method but not its share of the total */
  amount: number | null;
  currency: string;
  award_miles_used: number | null;
  payment_date: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const ADJUSTMENT_TYPES = [
  "reimbursement",
  "refund",
  "statement_credit",
  "employer_payment",
  "correction",
  "extra",
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

/** Adjustment types that ADD to gross spend: extras bought after ticketing —
 *  a paid upgrade, a seat — real money the trip cost, on its own date and its
 *  own document (EMD). Kept as dated rows rather than folded into the
 *  ticket's fare, so the fare still matches the receipt that stated it, the
 *  cash flow dates the money to the day it moved, and re-importing the same
 *  purchase email finds its EMD and does nothing. */
export const GROSS_INCREASING_TYPES: AdjustmentType[] = ["extra"];

/** Adjustment types that reduce gross spend (money actually returned for the ticket). */
export const GROSS_REDUCING_TYPES: AdjustmentType[] = ["refund"];

/** The airline when nobody wrote one down — an old charter, a decades-old
 *  diary row. A real value rather than NULL because the ledger files every flight
 *  under its carrier (mix, CPM, crediting all key on it), and an honest
 *  "??" bucket beats both refusing the flight and guessing an airline. Never
 *  UA in disguise: it fails every UA check, so it can't credit, can't earn
 *  lifetime miles, and can't sneak into the CPM basis. */
export const UNKNOWN_CARRIER = "??";

export const PURPOSES = ["business", "personal", "mixed"] as const;
export type Purpose = (typeof PURPOSES)[number];

export type AllocationMethod = "manual" | "pqp" | "distance" | "equal" | "none";

export interface TicketRow {
  id: string;
  ticket_number: string | null;
  confirmation_code: string | null;
  issuing_carrier: string | null;
  issue_date: string | null;
  currency: string;
  exchange_rate: number;
  base_fare: number;
  surcharges: number;
  taxes: number;
  ancillary_fees: number;
  gross_total: number;
  payment_method: string | null;
  status: TicketStatus;
  /** ticket whose residual value funded this one (exchange/reissue, §6.5) */
  predecessor_ticket_id: string | null;
  /** value left over and returned as a new credit when this ticket was issued */
  residual_credit: number | null;
  /** new money collected on a reissue, beyond the credit carried forward */
  additional_collection: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentRow {
  id: string;
  ticket_id: string | null;
  marketing_carrier: string;
  operating_carrier: string | null;
  flight_number: string | null;
  origin: string;
  destination: string;
  flight_date: string; // YYYY-MM-DD local departure date
  departure_time: string | null; // HH:MM
  arrival_time: string | null;
  cabin: string | null;
  booking_class: string | null;
  seat: string | null;
  aircraft: string | null;
  /** registration painted on the tail — "N27901", "D-AIMA". The type is
   *  derived from it when the fleet table knows the tail. */
  tail_number: string | null;
  status: SegmentStatus;
  purpose: Purpose | null; // null = infer from the ticket
  distance_miles: number | null; // calculated great-circle
  lifetime_miles: number | null; // United-posted, never overwritten by calc
  /** null = infer from the ticket and carrier; 1/0 = the user's own answer */
  credits_mileageplus: number | null;
  award_miles: number | null;
  pqp: number | null;
  pqf: number | null;
  /** Booking-time projections from receipt accrual tables — planning data
   *  only. Never posted values, never in reconciliation or CPM math. */
  projected_pqp: number | null;
  projected_pqf: number | null;
  projected_award_miles: number | null;
  manual_cost: number | null; // manual gross allocation override (reporting ccy)
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdjustmentRow {
  id: string;
  ticket_id: string;
  /** for "extra" rows: the flight this purchase was for, when the receipt
   *  names one — allocation puts the money on that leg instead of spreading */
  segment_id?: string | null;
  type: AdjustmentType;
  amount: number; // positive magnitude, reporting currency
  effective_date: string | null;
  payer: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------ MileagePlus activity ------------------------- */

export const ACTIVITY_TYPES = [
  "united_flight",
  "partner_flight",
  "credit_card",
  "hotel",
  "car_rental",
  "shopping",
  "dining",
  "rideshare",
  "ancillary",
  "promotion",
  "adjustment",
  "redemption",
  "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const FLIGHT_ACTIVITY_TYPES: ActivityType[] = [
  "united_flight",
  "partner_flight",
];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  united_flight: "United flight",
  partner_flight: "Partner flight",
  credit_card: "Credit card",
  hotel: "Hotel",
  car_rental: "Car rental",
  shopping: "Shopping",
  dining: "Dining",
  rideshare: "Rideshare",
  ancillary: "Seats, upgrades & extras",
  promotion: "Promotion",
  adjustment: "Adjustment",
  redemption: "Redemption",
  other: "Other",
};

export type MatchStatus =
  | "auto" // scored ≥ auto threshold, linked on import
  | "accepted" // user confirmed a suggestion
  | "suggested" // scored in the review band, awaiting a decision
  | "rejected" // user rejected the suggestion
  | "unmatched" // flight activity with no candidate
  | "not_applicable"; // non-flight activity — nothing to match

export interface ActivityRecord {
  id: string;
  activity_date: string;
  posting_date: string | null;
  description: string;
  activity_type: ActivityType;
  carrier: string | null;
  flight_number: string | null;
  origin: string | null;
  destination: string | null;
  award_miles: number | null;
  pqp: number | null;
  pqf: number | null;
  segment_id: string | null;
  match_score: number | null;
  match_status: MatchStatus;
  /** JSON array of human-readable reasons (design doc §11.3) */
  match_reason: string | null;
  source: string;
  dedup_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const isFlightActivity = (t: ActivityType) =>
  FLIGHT_ACTIVITY_TYPES.includes(t);

export interface Settings {
  /* Who the ledger belongs to. Optional, and deliberately just a name: the
     MileagePlus number was offered here briefly and taken back out. Nothing
     in the app needs it, it cannot be rotated once it leaks, and a value
     that is only ever decorative is not worth storing in plaintext beside a
     complete travel history. */
  member_first_name: string | null;
  member_last_name: string | null;

  reporting_currency: string;
  award_valuation_cpm: number; // cents per award mile, user assumption
  lifetime_baseline_miles: number;
  lifetime_baseline_date: string | null;
  missing_posting_delay_days: number;
  /** Flights before this date aren't expected to have costs — imported
   *  history stays quiet instead of raising a warning each. */
  cost_tracking_start: string | null;
  /** Reconstruct cost from PQP for flights with no ticket (PQP ≈ base fare). */
  estimate_cost_from_pqp: boolean;
  /** Override the tax rates learned from your own tickets (as fractions). */
  tax_rate_domestic: number | null;
  tax_rate_international: number | null;
  /** Premier thresholds keyed by the first qualification year each set
   *  applied to; null uses the built-in table. United revises these between
   *  program years — see DEFAULT_PREMIER_PROGRAMS in premier.ts. */
  premier_programs:
    | {
        from: number;
        minFlights: number;
        tiers: { name: string; pqp: number; pqf: number; pqpOnly: number }[];
      }[]
    | null;
}

export const DEFAULT_SETTINGS: Settings = {
  member_first_name: null,
  member_last_name: null,
  reporting_currency: "USD",
  award_valuation_cpm: 1.2,
  lifetime_baseline_miles: 0,
  lifetime_baseline_date: null,
  missing_posting_delay_days: 7,
  cost_tracking_start: null,
  estimate_cost_from_pqp: true,
  tax_rate_domestic: null,
  tax_rate_international: null,
  premier_programs: null,
};

/**
 * The cabin a fare really is, given the class it was booked in.
 *
 * United sells Basic Economy in fare class N and its receipts print it as
 * plain "United Economy" — the class is the only thing on the document that
 * tells them apart. The difference isn't cosmetic: Basic Economy earns PQP but
 * ZERO PQF, so filing it as Economy overstates progress toward any tier that
 * counts flights.
 *
 * United metal only. Other airlines use N for ordinary discount economy, and
 * an Alaska N is not a Basic Economy fare.
 */
export function effectiveCabin(
  carrier: string | null | undefined,
  bookingClass: string | null | undefined,
  cabin: string | null | undefined
): string | null {
  const isUnited = (carrier ?? "").trim().toUpperCase() === "UA";
  const cls = (bookingClass ?? "").trim().toUpperCase();
  if (isUnited && cls === "N") return "Basic Economy";
  return cabin ?? null;
}

/**
 * Million Miler lifetime miles accrue only on United-operated revenue flights.
 * Rule of thumb used for estimates: the operating carrier (falling back to
 * marketing) must be UA. United Express flights operated by regionals earn
 * too — log those with "operated by" blank, or enter the posted value.
 */
export function isUaLifetimeEarning(seg: {
  operating_carrier: string | null;
  marketing_carrier: string;
}): boolean {
  return (
    (seg.operating_carrier ?? seg.marketing_carrier ?? "UA").toUpperCase() ===
    "UA"
  );
}

/** Posted lifetime miles, else the transparent estimate: distance on
 *  UA-operated revenue flights; 0 on non-UA flights and on award travel
 *  (an explicit 0 in award miles — award tickets earn PQP/PQF but no
 *  redeemable miles and no lifetime miles). */
export const MINIMUM_CREDITED_MILES = 500;

/**
 * One day's legs, latest first — the tail of a newest-first flight list.
 *
 * Built forward and then reversed, because the forward order is the one that
 * can be reasoned about: the clock puts the legs in sequence, and where they
 * connect, the itinerary overrules it.
 *
 * Both halves are load-bearing. Departure time alone is wrong on a
 * transpacific return — KIX→SFO leaves at 16:50 local and SFO→IAH at 14:59, so
 * the clock says the Houston leg came first when it is the one the Osaka
 * flight fed. And the route alone is not enough either: 62 of these segments
 * carry no time at all, and two unconnected trips in one day have no chain to
 * follow. A leg starting where another landed is always the later of the two,
 * whatever their local clocks read.
 */
export function sameDayOrder<
  T extends { origin: string; destination: string; departure_time: string | null },
>(sameDay: T[]): T[] {
  // ascending by clock first, so legs that DON'T connect still come out in
  // time order once reversed; untimed legs sort last and let the chain decide
  const remaining = [...sameDay].sort((a, b) =>
    (a.departure_time ?? "99:99").localeCompare(b.departure_time ?? "99:99")
  );
  const forward: T[] = [];
  while (remaining.length > 0) {
    // the leg nothing else arrives into is where this run of flying began
    const arrivals = new Set(remaining.map((s) => s.destination));
    const startIdx = Math.max(
      0,
      remaining.findIndex((s) => !arrivals.has(s.origin))
    );
    let cur = remaining.splice(startIdx, 1)[0];
    forward.push(cur);
    for (;;) {
      const nextIdx = remaining.findIndex((s) => s.origin === cur.destination);
      if (nextIdx === -1) break;
      cur = remaining.splice(nextIdx, 1)[0];
      forward.push(cur);
    }
  }
  return forward.reverse();
}

/**
 * Spread each chain's reimbursement payer across every ticket in it.
 *
 * A chain is ONE purchase, reimbursed once, and the reimbursement is recorded
 * on the member holding the value — which is not necessarily the member the
 * flights hang on. ZZ0004's coupons sit on one ticket while UH's $2,052.01 is
 * on another, so a per-ticket lookup found nothing and those flights showed a
 * bare $0.00 despite being fully covered. Personal cost is already chain-wide;
 * the payer has to be too.
 *
 * Two different payers inside one chain is a split, and naming either would be
 * a guess — so that chain names nobody, matching the single-ticket rule.
 */
/**
 * Spread a per-ticket flag across every ticket in its chain.
 *
 * Same reason as `chainWidePayers`: a chain is one purchase, so a fact about
 * the purchase is a fact about all of it. Reimbursement is the flag that
 * matters — it implies business travel — and reading it per-ticket left one
 * chain member business and its sibling personal off a single reimbursement,
 * so a reimbursed flight kept turning up under the Personal filter.
 */
export function chainWideFlag(flagged: Set<string>, chains: string[][]): Set<string> {
  const out = new Set(flagged);
  for (const ids of chains) {
    if (ids.some((id) => flagged.has(id))) for (const id of ids) out.add(id);
  }
  return out;
}

/**
 * Split one quantity across the coupons that consumed it, weighted by
 * distance. Used for the miles an award chain redeemed: a chain redeems ONCE,
 * so its miles belong to all of its coupons together — giving each the full
 * figure would report a 40,000-mile ticket as 80,000 across two legs.
 *
 * The parts are made to sum EXACTLY to the total: the remainder from rounding
 * lands on the last coupon rather than quietly vanishing.
 */
export function shareByDistance<
  T extends { id: string; distance_miles: number | null },
>(total: number, segs: T[]): Map<string, number> {
  const out = new Map<string, number>();
  if (segs.length === 0 || total <= 0) return out;
  const sum = segs.reduce((a, s) => a + (s.distance_miles ?? 0), 0);
  let assigned = 0;
  segs.forEach((s, i) => {
    if (i === segs.length - 1) {
      out.set(s.id, total - assigned);
      return;
    }
    const share = sum > 0 ? (s.distance_miles ?? 0) / sum : 1 / segs.length;
    const v = Math.round(total * share);
    out.set(s.id, v);
    assigned += v;
  });
  return out;
}

export function chainWidePayers(
  perTicket: Map<string, string | null>,
  chains: string[][]
): Map<string, string | null> {
  const out = new Map(perTicket);
  for (const ids of chains) {
    const named = ids.map((id) => perTicket.get(id)).filter((p) => p != null);
    if (named.length === 0) continue;
    const agreed = named.every((p) => p === named[0]) ? named[0]! : null;
    for (const id of ids) out.set(id, agreed);
  }
  return out;
}

export function estimatedLifetimeMiles(seg: {
  lifetime_miles: number | null;
  distance_miles: number | null;
  award_miles: number | null;
  operating_carrier: string | null;
  marketing_carrier: string;
  /** the airline that issued the TICKET, when known */
  issuing_carrier?: string | null;
  credits_mileageplus?: number | null;
  ticket_id?: string | null;
  ticket_is_award?: boolean;
}): number {
  if (seg.lifetime_miles != null) return seg.lifetime_miles;
  if (seg.award_miles === 0) return 0; // award-travel signature
  /* Lifetime miles are a MileagePlus balance, so a flight that never credited
     to MileagePlus cannot add to it — whatever metal flew it. That is exactly
     the same question `expectsMileagePlusCredit` answers for the reconcile
     queue, including the user's own override, so it is asked once here rather
     than approximated a second time: judging it by the ticket's issuer alone
     missed a United ticket credited to Miles & More, which is United in every
     other field. A posted value still wins above. */
  if (!expectsMileagePlusCredit({ ticket_id: null, ...seg })) return 0;
  if (!isUaLifetimeEarning(seg) || seg.distance_miles == null) return 0;
  /* Credited miles, not distance: United's per-segment minimum applies here and
     nowhere else. A 135-mile hop credits 500 — but it still only flew 135, so
     `distance_miles` keeps the truth and CPM keeps dividing by it. */
  return Math.max(seg.distance_miles, MINIMUM_CREDITED_MILES);
}

/**
 * What a flight counts as: what you said about the flight, or — for a ticket
 * someone reimbursed — business, because that is what a reimbursed trip was.
 * Only the second step is inferred, so "unless I said personal" is honoured by
 * construction.
 */
export function effectivePurpose(
  segmentPurpose: Purpose | null,
  ticketReimbursed: boolean
): Purpose {
  return segmentPurpose ?? (ticketReimbursed ? "business" : "personal");
}

/**
 * Was this flight ever going to appear on a MileagePlus statement?
 *
 * Asking "United never credited this — claim it" only makes sense for a flight
 * United owed credit for. Three kinds never earn anything, and nagging about
 * them forever buries the one flight that really is missing:
 *   - a ticket another airline issued (it earns THEIR programme);
 *   - an award ticket flown on someone else's metal (no miles, no PQP);
 *   - a flight with no United ticket behind it at all, on another airline —
 *     a Delta or ITA segment added by hand was never a MileagePlus flight.
 * A partner segment ON a United ticket is deliberately NOT in that list: those
 * do earn, and this user's LX and LH legs prove it.
 *
 * `credits_mileageplus` overrides the inference when it gets one wrong.
 */
export function expectsMileagePlusCredit(seg: {
  credits_mileageplus?: number | null;
  issuing_carrier?: string | null;
  ticket_id: string | null;
  ticket_is_award?: boolean;
  operating_carrier: string | null;
  marketing_carrier: string;
}): boolean {
  if (seg.credits_mileageplus != null) return seg.credits_mileageplus !== 0;
  const flownByUa =
    (seg.operating_carrier ?? seg.marketing_carrier ?? "UA").toUpperCase() === "UA";
  if (seg.issuing_carrier && seg.issuing_carrier.toUpperCase() !== "UA") return false;
  if (seg.ticket_is_award && !flownByUa) return false;
  if (!seg.ticket_id && !flownByUa) return false;
  return true;
}

/**
 * Whether a segment belongs in aggregate CPM figures. Excluded: flights with
 * no recorded cost (nothing allocated — imported history without tickets) and
 * flights that earn no lifetime miles (award travel, non-UA) — either would
 * dilute cents-per-mile toward meaninglessness. Per-flight rows still show
 * their own numbers; only the averages are restricted.
 */
export function isCpmEligible(seg: {
  status: SegmentStatus;
  allocation_method: AllocationMethod;
  lifetime_miles: number | null;
  distance_miles: number | null;
  award_miles: number | null;
  operating_carrier: string | null;
  marketing_carrier: string;
}): boolean {
  return (
    FLOWN_STATUSES.includes(seg.status) &&
    seg.allocation_method !== "none" &&
    estimatedLifetimeMiles(seg) > 0
  );
}

/** Segment enriched with allocation results + airport/ticket context. */
export interface EnrichedSegment extends SegmentRow {
  gross_cost: number; // allocated, reporting currency
  personal_cost: number;
  allocation_method: AllocationMethod;
  effective_purpose: Purpose;
  /** the payer named on this ticket's reimbursement, when exactly one is */
  reimbursed_by: string | null;
  /** Miles this segment cost, on an award ticket. Cash alone made an award
   *  flight look nearly free — $5.60 over 862 miles is 0.65¢, which is a true
   *  number about a fare that wasn't paid in dollars. */
  award_miles_spent: number | null;
  /** true when the figure came from PQP x 100 rather than a recorded payment */
  award_miles_estimated: boolean;
  ticket_label: string | null;
  /** the airline that issued the covering ticket — a non-UA issuer means the
   *  flight was credited to that airline's programme, not MileagePlus */
  issuing_carrier: string | null;
  origin_city: string | null;
  destination_city: string | null;
  distance_estimated: boolean; // true when airports were unknown → distance null
  /** the covering ticket was bought with miles */
  ticket_is_award: boolean;
  /** PQP-derived cost when no ticket covers this flight (null otherwise).
   *  An estimate — never merged into gross_cost/personal_cost. */
  estimated_gross: number | null;
  /** Extras bought FOR this flight — a paid upgrade, a seat — already inside
   *  gross_cost. Carried separately so a flight can say what its money is
   *  made of: fare share plus the things bought on top of it. */
  pinned_extras: { label: string; amount: number }[];
}

export interface TicketAllocation {
  ticketId: string;
  method: AllocationMethod;
  gross_reporting: number; // gross_total × rate
  /** New money this ticket cost, at its own issue date — face value for a
   *  standalone ticket, and for a chain member its own share of the chain's
   *  cash (its additional collection, less any residual it handed back).
   *  Summed across a chain this equals `chain.cash`. Cash-flow accounting
   *  (§7.3) needs money placed where it moved, not where it flew. */
  cashAt: number;
  refunds: number;
  gross_allocable: number; // gross_reporting + extras − refunds (≥0)
  other_adjustments: number; // reimbursements/credits/etc (non-refund, non-extra)
  personal_total: number; // gross_allocable − other_adjustments (≥0)
  perSegment: Record<string, { gross: number; personal: number; method: AllocationMethod }>;
  warnings: string[];
  /** present when this ticket belongs to a reissue chain allocated as a unit */
  chain?: {
    ticketIds: string[];
    cash: number;
    /** credits handed back: recorded + inferred */
    residuals: number;
    /** the part of `residuals` derived from a cheaper reissue, not recorded */
    residualsInferred: number;
  };
}
