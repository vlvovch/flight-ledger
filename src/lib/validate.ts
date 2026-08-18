import {
  ADJUSTMENT_TYPES,
  PAYMENT_TYPES,
  PURPOSES,
  SEGMENT_STATUSES,
  TICKET_STATUSES,
} from "./types";

type Values = Record<string, unknown>;
export type Prepared =
  | { ok: true; values: Values }
  | { ok: false; error: string };

const err = (error: string): Prepared => ({ ok: false, error });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** A date the CALENDAR has, not merely a string of the right shape. The
 *  browser's date input can't produce 2026-02-31, but the API is a public
 *  surface — imports, restores and scripts all arrive here — and an
 *  impossible date sorts into groups nothing can reconcile. */
export function realDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // day 0 of the next month is the last day of this one
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A time the CLOCK has: 00:00–23:59. */
export function realTime(v: string): boolean {
  if (!TIME_RE.test(v)) return false;
  const [h, mi] = v.split(":").map(Number);
  return h <= 23 && mi <= 59;
}
const IATA_RE = /^[A-Za-z]{3}$/;

/** Normalize: trim strings, "" → null. */
function norm(v: unknown): unknown {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v;
}

function toNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return v as null | undefined;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : undefined; // undefined = invalid
}

interface FieldSpec {
  name: string;
  kind: "string" | "number" | "date" | "time" | "iata" | "enum" | "tail";
  required?: boolean;
  /** may be omitted (a schema default fills it) but never explicitly null —
      the shape of a NOT NULL column with a DEFAULT */
  nonNull?: boolean;
  enumVals?: readonly string[];
  min?: number;
  upper?: boolean;
}

function prepare(input: Values, specs: FieldSpec[], partial: boolean): Prepared {
  const out: Values = {};
  for (const spec of specs) {
    if (!(spec.name in input)) {
      if (spec.required && !partial) return err(`${spec.name} is required`);
      continue;
    }
    const v = norm(input[spec.name]);
    if (v === null) {
      if (spec.required) return err(`${spec.name} is required`);
      if (spec.nonNull) return err(`${spec.name} must not be blank`);
      out[spec.name] = null;
      continue;
    }
    switch (spec.kind) {
      case "number": {
        const n = toNumber(v);
        if (n === undefined) return err(`${spec.name} must be a number`);
        if (n !== null && spec.min !== undefined && n < spec.min)
          return err(`${spec.name} must be ≥ ${spec.min}`);
        out[spec.name] = n;
        break;
      }
      case "date":
        if (!realDate(String(v)))
          return err(`${spec.name} must be a real date, as YYYY-MM-DD`);
        out[spec.name] = v;
        break;
      case "time":
        if (!realTime(String(v)))
          return err(`${spec.name} must be a real time, as HH:MM`);
        out[spec.name] = v;
        break;
      case "tail": {
        /* A registration as the world writes it: "N27901", "D-AIMA",
           "JA873A". Stored uppercase with spaces gone, hyphens kept —
           outside the US the hyphen is part of the mark. */
        const tail = String(v).toUpperCase().replace(/\s+/g, "");
        if (!/^[A-Z0-9-]{2,10}$/.test(tail))
          return err(`${spec.name} must be a registration like N27901 or D-AIMA`);
        out[spec.name] = tail;
        break;
      }
      case "iata":
        if (!IATA_RE.test(String(v)))
          return err(`${spec.name} must be a 3-letter airport code`);
        out[spec.name] = String(v).toUpperCase();
        break;
      case "enum":
        if (!spec.enumVals!.includes(String(v)))
          return err(`${spec.name} must be one of: ${spec.enumVals!.join(", ")}`);
        out[spec.name] = v;
        break;
      default:
        out[spec.name] = spec.upper ? String(v).toUpperCase() : v;
    }
  }
  return { ok: true, values: out };
}

/* ------------------------------ segments ------------------------------- */

const SEGMENT_SPECS: FieldSpec[] = [
  { name: "ticket_id", kind: "string" },
  /* nonNull in words here, because the schema would otherwise say it in
     SQLite's: the column is NOT NULL with a 'UA' default, so omission is
     fine but an explicit null overrides the default — a carrier-less diary
     row once crashed a whole import transaction instead of erroring as one
     row. */
  { name: "marketing_carrier", kind: "string", upper: true, nonNull: true },
  { name: "operating_carrier", kind: "string", upper: true },
  { name: "flight_number", kind: "string" },
  { name: "origin", kind: "iata", required: true },
  { name: "destination", kind: "iata", required: true },
  { name: "flight_date", kind: "date", required: true },
  { name: "departure_time", kind: "time" },
  { name: "arrival_time", kind: "time" },
  { name: "cabin", kind: "string" },
  { name: "booking_class", kind: "string", upper: true },
  { name: "seat", kind: "string", upper: true },
  { name: "aircraft", kind: "string" },
  { name: "tail_number", kind: "tail" },
  { name: "status", kind: "enum", enumVals: SEGMENT_STATUSES },
  { name: "purpose", kind: "enum", enumVals: PURPOSES },
  { name: "lifetime_miles", kind: "number", min: 0 },
  { name: "credits_mileageplus", kind: "number", min: 0 },
  { name: "award_miles", kind: "number" }, // may be negative (corrections)
  { name: "pqp", kind: "number", min: 0 },
  { name: "pqf", kind: "number", min: 0 },
  { name: "projected_pqp", kind: "number", min: 0 },
  { name: "projected_pqf", kind: "number", min: 0 },
  { name: "projected_award_miles", kind: "number", min: 0 },
  { name: "manual_cost", kind: "number", min: 0 },
  { name: "notes", kind: "string" },
];

export function prepareSegment(input: Values, partial = false): Prepared {
  // distance_miles is always computed server-side from the route
  const { distance_miles: _ignored, ...rest } = input;
  const p = prepare(rest, SEGMENT_SPECS, partial);
  if (!p.ok) return p;
  const v = p.values;
  const origin = v.origin ?? (partial ? undefined : null);
  const destination = v.destination ?? (partial ? undefined : null);
  if (origin && destination && origin === destination)
    return err("origin and destination cannot be identical");
  return p;
}

/* ------------------------------- tickets ------------------------------- */

const TICKET_SPECS: FieldSpec[] = [
  { name: "ticket_number", kind: "string" },
  { name: "confirmation_code", kind: "string", upper: true },
  { name: "issuing_carrier", kind: "string", upper: true },
  { name: "issue_date", kind: "date" },
  { name: "currency", kind: "string", upper: true },
  { name: "exchange_rate", kind: "number", min: 0.000001 },
  { name: "base_fare", kind: "number", min: 0 },
  { name: "surcharges", kind: "number", min: 0 },
  { name: "taxes", kind: "number", min: 0 },
  { name: "ancillary_fees", kind: "number", min: 0 },
  { name: "gross_total", kind: "number", min: 0 },
  { name: "payment_method", kind: "string" },
  { name: "status", kind: "enum", enumVals: TICKET_STATUSES },
  { name: "predecessor_ticket_id", kind: "string" },
  { name: "residual_credit", kind: "number", min: 0 },
  { name: "additional_collection", kind: "number", min: 0 },
  { name: "notes", kind: "string" },
];

export function prepareTicket(input: Values, partial = false): Prepared {
  const p = prepare(input, TICKET_SPECS, partial);
  if (!p.ok) return p;
  const c = p.values.currency;
  if (c != null && !/^[A-Z]{3}$/.test(String(c)))
    return err("currency must be a 3-letter code");
  return p;
}

/* ----------------------------- adjustments ----------------------------- */

const ADJUSTMENT_SPECS: FieldSpec[] = [
  { name: "ticket_id", kind: "string", required: true },
  { name: "segment_id", kind: "string" },
  { name: "type", kind: "enum", enumVals: ADJUSTMENT_TYPES, required: true },
  { name: "amount", kind: "number", min: 0.01, required: true },
  { name: "effective_date", kind: "date" },
  { name: "payer", kind: "string" },
  { name: "notes", kind: "string" },
];

export const prepareAdjustment = (input: Values, partial = false): Prepared =>
  prepare(input, ADJUSTMENT_SPECS, partial);

/* ------------------------------- payments ------------------------------ */

const PAYMENT_SPECS: FieldSpec[] = [
  { name: "ticket_id", kind: "string", required: true },
  { name: "payment_type", kind: "enum", enumVals: PAYMENT_TYPES, required: true },
  { name: "amount", kind: "number", min: 0 },
  { name: "currency", kind: "string", upper: true },
  { name: "award_miles_used", kind: "number", min: 0 },
  { name: "payment_date", kind: "date" },
  { name: "reference", kind: "string" },
  { name: "notes", kind: "string" },
];

export function preparePayment(
  input: Values,
  partial = false,
  /** Receipts routinely name a funding method without splitting the total
   *  across methods ("Previous Ticket Balance" + a card). That row still says
   *  something true and is what PaymentRow.amount is nullable for, so the
   *  import path opts in; hand-entered payments stay strict. */
  opts: { allowMethodOnly?: boolean } = {}
): Prepared {
  const p = prepare(input, PAYMENT_SPECS, partial);
  if (!p.ok) return p;
  const c = p.values.currency;
  if (c != null && !/^[A-Z]{3}$/.test(String(c)))
    return err("currency must be a 3-letter code");
  if (
    !partial &&
    !opts.allowMethodOnly &&
    p.values.amount == null &&
    p.values.award_miles_used == null
  )
    return err("a payment needs an amount, miles used, or both");
  return p;
}
