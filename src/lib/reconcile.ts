/**
 * Reconciliation exceptions (design doc §5.6) computed on read: everything the
 * ledger and the account statement disagree about, in one place.
 */
import type { EnrichedData } from "./repo";
import { hasArrived } from "./arrival";
import {
  ActivityRecord,
  CREDIT_PAYMENT_TYPES,
  EnrichedSegment,
  FLOWN_STATUSES,
  expectsMileagePlusCredit,
  isFlightActivity,
  PAYMENT_TYPE_LABELS,
  Settings,
  TicketRow,
} from "./types";

export type ExceptionKind =
  | "missing_posting"
  | "unmatched_activity"
  | "suggested_match"
  | "duplicate_segment"
  | "duplicate_activity"
  | "duplicate_ticket"
  | "unconverted_currency"
  | "no_cost"
  | "unknown_airport"
  | "allocation_warning"
  | "payment_mismatch"
  | "fare_parts_mismatch"
  | "exchange_double_count"
  | "unlinked_exchange"
  | "broken_chain"
  | "ready_to_reconcile";

export interface Exception {
  kind: ExceptionKind;
  severity: "warn" | "info";
  title: string;
  detail?: string;
  date: string | null;
  segmentId?: string;
  activityId?: string;
  ticketId?: string;
  /** ids that together form a duplicate group */
  groupIds?: string[];
}

export interface ReconcileReport {
  exceptions: Exception[];
  counts: Record<ExceptionKind, number>;
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

const daysAgo = (date: string, today: string) =>
  Math.floor(
    (new Date(today + "T00:00:00").getTime() - new Date(date + "T00:00:00").getTime()) /
      86400000
  );

export function buildReconcileReport(
  data: EnrichedData,
  settings: Settings,
  /** the current instant as ISO, injectable so the arrival boundary can be
   *  checked instead of depending on the wall clock */
  nowOverride: string | null = null
): ReconcileReport {
  const today = nowOverride ? nowOverride.slice(0, 10) : localToday();
  const nowMs = nowOverride ? Date.parse(nowOverride) : Date.now();
  const exceptions: Exception[] = [];
  const ticketLabel = (t: TicketRow) =>
    [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") || "Ticket";
  const flown = data.segments.filter((s) => FLOWN_STATUSES.includes(s.status));
  const activityBySegment = new Map<string, ActivityRecord[]>();
  for (const a of data.activities) {
    if (!a.segment_id) continue;
    const arr = activityBySegment.get(a.segment_id) ?? [];
    arr.push(a);
    activityBySegment.set(a.segment_id, arr);
  }

  /* flown flights United never posted */
  for (const s of flown) {
    const hasPostings =
      s.pqp != null || s.award_miles != null || s.lifetime_miles != null;
    const hasActivity = (activityBySegment.get(s.id) ?? []).length > 0;
    const age = daysAgo(s.flight_date, today);
    // only a flight United owed credit for can be "missing" credit
    const ownProgramme = expectsMileagePlusCredit(s);
    if (ownProgramme && !hasPostings && !hasActivity && age >= settings.missing_posting_delay_days) {
      exceptions.push({
        kind: "missing_posting",
        severity: "warn",
        title: `${s.origin}→${s.destination} on ${s.flight_date} has no MileagePlus credit`,
        detail: `Flown ${age} days ago. Import your activity CSV, or claim missing credit with United.`,
        date: s.flight_date,
        segmentId: s.id,
      });
    }
    if (s.status === "flown_unreconciled" && (hasPostings || hasActivity)) {
      exceptions.push({
        kind: "ready_to_reconcile",
        severity: "info",
        title: `${s.origin}→${s.destination} on ${s.flight_date} has postings — mark it reconciled`,
        date: s.flight_date,
        segmentId: s.id,
      });
    }
  }

  /* statement rows that never found a flight */
  for (const a of data.activities) {
    if (!isFlightActivity(a.activity_type)) continue;
    if (a.segment_id) {
      if (a.match_status === "suggested") {
        exceptions.push({
          kind: "suggested_match",
          severity: "warn",
          title: `${a.description} — proposed match needs confirming`,
          detail: a.match_reason
            ? (JSON.parse(a.match_reason) as string[]).join(" · ")
            : undefined,
          date: a.activity_date,
          activityId: a.id,
          segmentId: a.segment_id,
        });
      }
      continue;
    }
    exceptions.push({
      kind: "unmatched_activity",
      severity: "warn",
      title: `${a.description} on ${a.activity_date} has no flight in the ledger`,
      detail:
        "United credited a flight the tracker doesn't know about — add it, or link it from here.",
      date: a.activity_date,
      activityId: a.id,
    });
  }

  /* duplicate flight segments (same date + route + flight number) —
     counting only the LIVE copies. Cancel-and-rebook and reissue chains
     deliberately leave a canceled coupon beside the flight that flew (same
     date, route, even flight number when rebooked identically); that pairing
     is honest history, not a double entry. */
  const segKey = (s: EnrichedSegment) =>
    [s.flight_date, s.origin, s.destination, (s.flight_number ?? "").trim()].join("|");
  const segGroups = new Map<string, EnrichedSegment[]>();
  for (const s of data.segments) {
    if (s.status === "canceled") continue;
    const arr = segGroups.get(segKey(s)) ?? [];
    arr.push(s);
    segGroups.set(segKey(s), arr);
  }
  for (const [, group] of segGroups) {
    if (group.length < 2) continue;
    const s = group[0];
    exceptions.push({
      kind: "duplicate_segment",
      severity: "warn",
      title: `${group.length} identical flights: ${s.origin}→${s.destination} ${s.marketing_carrier}${s.flight_number ?? ""} on ${s.flight_date}`,
      detail: "Same date, route and flight number — likely a double entry.",
      date: s.flight_date,
      segmentId: s.id,
      groupIds: group.map((g) => g.id),
    });
  }

  /* A ticket priced in another currency, still counted at 1:1. The rate is a
     historical fact this app can't look up — it has no network and the rate
     that matters is the one on the issue date — so it is asked for, never
     invented. Until then every total silently mixes currencies. */
  const reporting = (settings.reporting_currency || "USD").toUpperCase();
  for (const t of data.tickets) {
    const cur = (t.currency || reporting).toUpperCase();
    if (cur === reporting) continue;
    if (t.exchange_rate && t.exchange_rate !== 1) continue;
    if (!t.gross_total) continue;
    exceptions.push({
      kind: "unconverted_currency",
      severity: "warn",
      title: `${ticketLabel(t)} is priced in ${cur} but counted at 1:1`,
      detail: `${cur} ${t.gross_total.toFixed(2)} is being reported as ${t.gross_total.toFixed(2)} ${reporting}. Set the ticket's exchange rate to the one that applied on ${t.issue_date ?? "its issue date"}.`,
      date: t.issue_date,
      ticketId: t.id,
    });
  }

  /* The same eTicket number twice. Ticket identity IS the eTicket number, so
     this should be impossible — but it went unnoticed until the user spotted
     one by eye, and every such pair counts its money twice. */
  const ticketNo = (t: TicketRow) => (t.ticket_number ?? "").replace(/[\s-]/g, "");
  const ticketGroups = new Map<string, TicketRow[]>();
  for (const t of data.tickets) {
    const k = ticketNo(t);
    if (!k) continue;
    ticketGroups.set(k, [...(ticketGroups.get(k) ?? []), t]);
  }
  for (const [number, group] of ticketGroups) {
    if (group.length < 2) continue;
    const total = group.reduce((sum, t) => sum + (t.gross_total ?? 0), 0);
    const withFlights = group.filter(
      (t) => data.segments.some((s) => s.ticket_id === t.id)
    ).length;
    exceptions.push({
      kind: "duplicate_ticket",
      severity: "warn",
      title: `eTicket ${number} is in the ledger ${group.length} times`,
      detail: `One ticket, ${group.length} rows — ${fmt(total)} counted where ${fmt(group[0].gross_total ?? 0)} was spent${withFlights < group.length ? `, and ${group.length - withFlights} of them hold no flights` : ""}. Keep the row with the flights and delete the rest.`,
      date: group[0].issue_date,
      ticketId: group[0].id,
      groupIds: group.map((t) => t.id),
    });
  }

  /* duplicate statement rows */
  const actKey = (a: ActivityRecord) =>
    [
      a.activity_date,
      a.description.replace(/\s+/g, " ").trim().toUpperCase(),
      a.pqp ?? "",
      a.award_miles ?? "",
    ].join("|");
  const actGroups = new Map<string, ActivityRecord[]>();
  for (const a of data.activities) {
    const arr = actGroups.get(actKey(a)) ?? [];
    arr.push(a);
    actGroups.set(actKey(a), arr);
  }
  for (const [, group] of actGroups) {
    /* A `#2` suffix on the dedup key means the import saw this line twice in
       one statement file and kept both on purpose — United really does post a
       separate row per award ticket, so two identical redemptions on one day
       are the normal shape of a two-passenger award booking. Re-raising those
       here would be this file second-guessing a decision already made with
       the file in hand. What is left is rows that arrived by other routes. */
    const unexplained = group.filter((a) => !/#\d+$/.test(a.dedup_key ?? ""));
    if (unexplained.length < 2) continue;
    exceptions.push({
      kind: "duplicate_activity",
      severity: "warn",
      title: `${unexplained.length} identical activity rows: ${unexplained[0].description}`,
      detail: `Both dated ${unexplained[0].activity_date}. Keep one unless United really credited it twice.`,
      date: unexplained[0].activity_date,
      activityId: unexplained[0].id,
      groupIds: unexplained.map((g) => g.id),
    });
  }

  /* flown flights with no cost attached */
  const cutoff = settings.cost_tracking_start || null;
  for (const s of flown) {
    if (cutoff && s.flight_date < cutoff) continue;
    if (s.gross_cost === 0 && s.personal_cost === 0 && s.allocation_method === "none") {
      exceptions.push({
        kind: "no_cost",
        severity: "warn",
        title: `${s.origin}→${s.destination} on ${s.flight_date} has no cost recorded`,
        detail:
          "Link it to a ticket or set a manual cost (0 is fine for fully covered award travel).",
        date: s.flight_date,
        segmentId: s.id,
      });
    }
  }

  /* data problems */
  for (const s of data.segments) {
    if (s.distance_estimated && s.status !== "canceled") {
      exceptions.push({
        kind: "unknown_airport",
        severity: "warn",
        title: `${s.origin}→${s.destination} on ${s.flight_date}: unknown airport code`,
        detail: "Distance can't be calculated, so this flight is outside miles and CPM.",
        date: s.flight_date,
        segmentId: s.id,
      });
    }
  }
  const hasSuccessor = new Set(
    data.tickets.map((t) => t.predecessor_ticket_id).filter(Boolean) as string[]
  );
  for (const [ticketId, alloc] of Object.entries(data.allocations)) {
    const t = data.tickets.find((x) => x.id === ticketId);
    const label = t?.confirmation_code || t?.ticket_number || "Ticket";
    for (const w of alloc.warnings) {
      // A superseded ticket is *meant* to hold cost with nothing allocated —
      // its value moved to the successor. The chain already explains it.
      if (hasSuccessor.has(ticketId) && /All segments are canceled/.test(w)) continue;
      exceptions.push({
        kind: "allocation_warning",
        severity: "warn",
        title: `${label}: ${w}`,
        date: t?.issue_date ?? null,
        ticketId,
      });
    }
  }

  /* fare breakdown vs ticket total (§17: components must reconcile) */
  for (const t of data.tickets) {
    const parts = t.base_fare + t.surcharges + t.taxes + t.ancillary_fees;
    if (parts <= 0 || t.gross_total <= 0) continue;
    const diff = Math.round((parts - t.gross_total) * 100) / 100;
    if (Math.abs(diff) > 0.011) {
      exceptions.push({
        kind: "fare_parts_mismatch",
        severity: "warn",
        title: `${[t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") || "Ticket"}: fare parts add to ${parts.toFixed(2)} but the total is ${t.gross_total.toFixed(2)}`,
        detail: `Off by ${Math.abs(diff).toFixed(2)} — usually a leftover figure from an earlier edit. The total is what drives cost; the breakdown is for reference.`,
        date: t.issue_date,
        ticketId: t.id,
      });
    }
  }

  /* funding vs ticket total (§5.6) */
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const t of data.tickets) {
    /* Miles fund miles; the cash total reconciles against the cash methods
       only. Counting a miles payment as $0 of cash made every award ticket
       look completely unfunded. */
    const pays = data.payments.filter(
      (p) => p.ticket_id === t.id && p.payment_type !== "miles"
    );
    if (pays.length === 0) continue;
    if (pays.some((p) => p.amount == null)) continue;
    const paid = round2(pays.reduce((s, p) => s + (p.amount ?? 0), 0));
    const target = round2(data.allocations[t.id]?.gross_reporting ?? t.gross_total);
    if (Math.abs(paid - target) > 0.011) {
      exceptions.push({
        kind: "payment_mismatch",
        severity: "warn",
        title: `${ticketLabel(t)}: payments total ${paid.toFixed(2)} but the ticket is ${target.toFixed(2)}`,
        detail:
          "Add the missing funding source, or correct an amount — the ticket should reconcile to what paid for it.",
        date: t.issue_date,
        ticketId: t.id,
      });
    }
  }

  /* exchange chains: a superseded ticket must not keep charging CPM */
  const supersededBy = new Map<string, TicketRow>();
  for (const t of data.tickets) {
    if (t.predecessor_ticket_id) supersededBy.set(t.predecessor_ticket_id, t);
  }
  for (const [predId, successor] of supersededBy) {
    const pred = data.tickets.find((t) => t.id === predId);
    if (!pred) continue;
    const liveSegments = data.segments.filter(
      (s) => s.ticket_id === predId && s.status !== "canceled"
    );
    /**
     * A reissue can only void coupons that hadn't departed when it was issued,
     * so a leg that flew BEFORE the exchange flew on this ticket and earns its
     * share of the chain honestly — the first leg of a trip whose later legs
     * were rebooked is the normal case, not a fault. Only legs dated on or
     * after the successor's issue date were replaced rather than flown. With no
     * issue date on the successor there's no cut to apply, so every live leg
     * stays suspect.
     */
    const replacedOn = successor.issue_date;
    const suspect = replacedOn
      ? liveSegments.filter((s) => s.flight_date >= replacedOn)
      : liveSegments;
    if (suspect.length > 0) {
      const one = suspect.length === 1;
      const legs = suspect
        .map((s) => `${s.origin}→${s.destination} on ${s.flight_date}`)
        .join(", ");
      exceptions.push({
        kind: "exchange_double_count",
        severity: "warn",
        title: replacedOn
          ? `${ticketLabel(pred)} was exchanged into ${ticketLabel(successor)} on ${replacedOn}, but ${suspect.length} of its flights on or after that date ${one ? "is" : "are"} still active`
          : `${ticketLabel(pred)} was exchanged into ${ticketLabel(successor)} but still has ${suspect.length} active flight${one ? "" : "s"}`,
        detail: `${legs} — ${one ? "that leg" : "those legs"} couldn't have flown on this ticket after it was exchanged, so ${one ? "it is" : "they are"} taking a share of the chain's cost. Mark ${one ? "it" : "them"} canceled.`,
        date: pred.issue_date,
        ticketId: pred.id,
      });
    }
  }

  /* Funded by a credit, with an unlinked ticket in the ledger that the credit
     could have come from.
     A credit IS money — a ticket bought with one costs its face value, exactly
     like one bought with a card, and this tracker has no reason to trace where
     the credit came from. The ONLY thing linking buys is protection from
     counting the same dollars twice, and that can only happen when the source
     ticket is in the ledger holding cost of its own. Without such a candidate
     there is nothing to double count and nothing to say: flagging every
     credit-funded ticket turned 13 perfectly-costed tickets into a queue of
     chores about credits whose source predates the ledger entirely. */
  const superseded = new Set(
    data.tickets.map((t) => t.predecessor_ticket_id).filter(Boolean) as string[]
  );
  const flownByTicket = new Set(
    data.segments
      .filter((s) => FLOWN_STATUSES.includes(s.status) && s.ticket_id)
      .map((s) => s.ticket_id as string)
  );
  for (const t of data.tickets) {
    if (t.predecessor_ticket_id) continue;
    const creditPay = data.payments.find(
      (p) => p.ticket_id === t.id && CREDIT_PAYMENT_TYPES.includes(p.payment_type)
    );
    if (!creditPay) continue;
    // tickets still holding cost that no flight of their own is earning,
    // nearest first — the credit most likely came from the last one bought
    const sources = data.tickets
      .filter(
        (o) =>
          o.id !== t.id &&
          !superseded.has(o.id) &&
          (o.gross_total ?? 0) > 0 &&
          !flownByTicket.has(o.id) &&
          o.issue_date != null &&
          t.issue_date != null &&
          o.issue_date <= t.issue_date
      )
      .sort((a, b) => (b.issue_date ?? "").localeCompare(a.issue_date ?? ""));
    if (sources.length === 0) continue;
    const others = sources.length - 1;
    exceptions.push({
      kind: "unlinked_exchange",
      severity: "info",
      title: `${ticketLabel(t)} was paid with a ${PAYMENT_TYPE_LABELS[creditPay.payment_type].toLowerCase()} — link the ticket it came from`,
      detail: `${ticketLabel(sources[0])} holds cost with no flights of its own${others > 0 ? ` (and ${others === 1 ? "1 other does" : `${others} others do`} too)` : ""} — the credit may have come from it, and linking keeps those dollars from being counted twice.`,
      date: t.issue_date,
      ticketId: t.id,
    });
  }

  /* A reissue chain is a line: its money is counted once across the whole
     chain, which only works while each ticket has ONE successor. Writes
     refuse a fork now, but a backup restored from an older build can carry
     one, and it must not stay invisible — allocation keeps the earliest
     claimant in the line and the rest are allocated on their own, which
     spends the predecessor's value twice. */
  const claimants = new Map<string, TicketRow[]>();
  for (const t of data.tickets) {
    const pred = t.predecessor_ticket_id;
    if (!pred) continue;
    claimants.set(pred, [...(claimants.get(pred) ?? []), t]);
  }
  for (const [predId, claiming] of claimants) {
    if (claiming.length < 2) continue;
    const pred = data.tickets.find((t) => t.id === predId);
    exceptions.push({
      kind: "broken_chain",
      severity: "warn",
      title: `${claiming.length} tickets claim to be the reissue of ${pred ? ticketLabel(pred) : "one ticket"}`,
      detail:
        "A reissue chain is a line, so only one ticket can follow another. Until this is fixed the earliest claimant continues the chain and the others are costed on their own — which counts the original's value more than once. Clear the exchange link on the ones that don't belong.",
      date: pred?.issue_date ?? claiming[0].issue_date,
      ticketId: claiming[0].id,
      groupIds: claiming.map((t) => t.id),
    });
  }

  exceptions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const counts = exceptions.reduce(
    (acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<ExceptionKind, number>
  );
  return { exceptions, counts };
}
