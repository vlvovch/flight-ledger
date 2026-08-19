/*
 * How the Reconcile page groups exceptions — order, headings, accents.
 *
 * This lives beside the kinds rather than inside the page because a kind
 * with no group is INVISIBLE: it is computed, counted, and never drawn.
 * Two of them shipped that way. TypeScript cannot catch it (a missing entry
 * is a shorter array, not a type error), so the selftest holds this list
 * against ExceptionKind instead — which needs it importable from somewhere
 * that isn't a Next page, since pages may only export their own few names.
 */
import type { ExceptionKind } from "./reconcile";

export interface ExceptionGroup {
  kind: ExceptionKind;
  label: string;
  blurb: string;
  accent: string;
}

/**
 * What each kind is called, and how it reads.
 *
 * A Record over ExceptionKind, deliberately: a kind added to the union
 * without an entry here is a COMPILE error rather than a group that quietly
 * never renders. That is the whole point of this file — two kinds shipped
 * invisible before it existed.
 */
const GROUP_META: Record<ExceptionKind, Omit<ExceptionGroup, "kind">> = {
  suggested_match: {
    label: "Possible matches",
    blurb: "The matcher isn’t confident — confirm or reject each.",
    accent: "var(--color-warning)",
  },
  unmatched_activity: {
    label: "Credited flights not in the ledger",
    blurb: "United credited these; the tracker has no matching flight.",
    accent: "var(--color-warning)",
  },
  missing_posting: {
    label: "Flights United never credited",
    blurb: "Flown, but nothing posted — worth claiming.",
    accent: "var(--color-serious)",
  },
  unconverted_currency: {
    label: "Foreign-currency tickets counted at 1:1",
    blurb: "Priced in another currency with no exchange rate set.",
    accent: "var(--color-serious)",
  },
  broken_chain: {
    label: "Reissue chains that fork",
    blurb: "Two tickets claim one predecessor, so its value is spent twice.",
    accent: "var(--color-serious)",
  },
  duplicate_ticket: {
    label: "One ticket, more than one row",
    blurb: "Same eTicket number twice — its cost is counted twice.",
    accent: "var(--color-serious)",
  },
  duplicate_segment: {
    label: "Duplicate flights",
    blurb: "Same date, route and flight number.",
    accent: "var(--color-serious)",
  },
  duplicate_activity: {
    label: "Duplicate activity rows",
    blurb: "Identical statement rows.",
    accent: "var(--color-serious)",
  },
  exchange_double_count: {
    label: "Exchanged tickets still charging cost",
    blurb: "Their value moved to a new ticket, so cost is counted twice.",
    accent: "var(--color-serious)",
  },
  fare_parts_mismatch: {
    label: "Fare breakdown doesn’t add up",
    blurb: "Base + taxes ≠ the ticket total — usually a stale figure from an edit.",
    accent: "var(--color-serious)",
  },
  payment_mismatch: {
    label: "Funding doesn’t match the ticket",
    blurb: "Recorded payments don’t add up to what the ticket cost.",
    accent: "var(--color-serious)",
  },
  allocation_warning: {
    label: "Ticket allocation warnings",
    blurb: "Costs that don’t reconcile.",
    accent: "var(--color-serious)",
  },
  unlinked_exchange: {
    label: "Credit-funded tickets",
    blurb: "Paid with a credit — link the ticket it came from to avoid double counting.",
    accent: "var(--color-s-miles)",
  },
  unknown_airport: {
    label: "Unknown airports",
    blurb: "No coordinates, so no distance or CPM.",
    accent: "var(--color-serious)",
  },
  implausible_clocks: {
    label: "Clocks that disagree with the distance",
    blurb:
      "The recorded times imply a block time far from what the route supports — a wrong clock, or a very delayed day.",
    accent: "var(--color-mute)",
  },
  no_cost: {
    label: "Flights without cost",
    blurb: "Outside the CPM basis until a cost is attached.",
    accent: "var(--color-mute)",
  },
  ready_to_reconcile: {
    label: "Ready to mark reconciled",
    blurb: "Postings recorded; status still says flown.",
    accent: "var(--color-s-award)",
  },
};

/** The order the page shows them in: worst first, nudges last. */
const ORDER = [
  "suggested_match",
  "unmatched_activity",
  "missing_posting",
  "unconverted_currency",
  "broken_chain",
  "duplicate_ticket",
  "duplicate_segment",
  "duplicate_activity",
  "exchange_double_count",
  "fare_parts_mismatch",
  "payment_mismatch",
  "allocation_warning",
  "unlinked_exchange",
  "unknown_airport",
  "implausible_clocks",
  "no_cost",
  "ready_to_reconcile",
] as const satisfies readonly ExceptionKind[];

/* Order is a list, and a list can be short. This makes a forgotten kind a
   compile error too: if any kind is missing from ORDER, `Missing` stops
   being `never` and the assertion below fails to typecheck. */
type Missing = Exclude<ExceptionKind, (typeof ORDER)[number]>;
type MustBeNever<T extends never> = T;
export type OrderIsExhaustive = MustBeNever<Missing>;

export const RECONCILE_GROUPS: ExceptionGroup[] = ORDER.map((kind) => ({
  kind,
  ...GROUP_META[kind],
}));

/** Every kind, from the type itself — no hand-kept second copy. */
export const ALL_EXCEPTION_KINDS = Object.keys(GROUP_META) as ExceptionKind[];
