/**
 * Receipt → ledger matching (mirrors mileageplus-import.ts): build a
 * reviewable preview of what an imported United email would create, fill in,
 * or conflict with. Nothing is written outside the preview's classification.
 *
 * Tickets match by confirmation code or eTicket number; segments match by
 * date + route. Receipts carry scheduled metadata (times, cabin, class, seat)
 * and costs — never posted PQP/award values (those come from the activity CSV).
 */
import type { ParsedReceipt, ReceiptSegment } from "./united-receipt";
import { CONSUMPTION_ITEM } from "./united-receipt";
import { hasArrived } from "./arrival";
import {
  effectiveCabin,
  CREDIT_PAYMENT_TYPES,
  FLOWN_STATUSES,
  PAYMENT_TYPE_LABELS,
  SegmentRow,
  TicketRow,
} from "./types";

const normTicketNo = (v: string | null | undefined) =>
  (v ?? "").replace(/[\s-]/g, "");

/** "0589" and "589" are the same flight. */
const normFlightNo = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return isFinite(n) ? String(n) : s.toUpperCase();
};

/** One compact line for a segment's booking-time projections. */
function projectionLabel(ps: ReceiptSegment): string {
  const bits: string[] = [];
  if (ps.projected_pqp != null) bits.push(`${ps.projected_pqp} PQP`);
  if (ps.projected_award_miles != null)
    bits.push(`${ps.projected_award_miles.toLocaleString()} mi`);
  return `projected ${bits.join(" · ")}`;
}

/** whole days between two YYYY-MM-DD dates */
export const dayDiff = (a: string, b: string) =>
  Math.round(
    (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000
  );

/**
 * Cross-document knowledge a single receipt can't have. A receipt is evidence
 * of *purchase*, never of *travel*: on its own it cannot tell a leg that flew
 * from one that was later reissued away or cancelled. Two other documents can,
 * and each carries a date that says exactly which coupons it voided:
 *
 *  - a **reissue** voids only coupons that hadn't departed when it was issued;
 *  - a **cancellation notice** voids only travel that hadn't departed when the
 *    notice was sent — it reprints the whole reservation, flown legs included,
 *    so the notice's own send date is the cut, not the legs it happens to list.
 */
export interface ReceiptBatchContext {
  /** normalized eTicket number → issue date of the ticket that replaced it */
  replacedAt: Map<string, string>;
  /** every eTicket number this import carries, ledger membership aside */
  ticketNumbers: Set<string>;
  cancellations: {
    confirmation: string | null;
    /** when the notice was sent: legs departing on/after this never flew */
    sentOn: string;
    /** the notice's printed date (the ticket's issue date) — for the
     *  lagged-email rule */
    issuedOn: string | null;
    /** "YYYY-MM-DD|ORG→DST" for every leg the notice lists */
    legs: Set<string>;
  }[];
  /**
   * eTicket number → the newest receipt carrying it. When United moves you to
   * another flight WITHOUT reissuing, it re-sends the whole receipt under the
   * SAME ticket number — so two such emails are two snapshots of one coupon,
   * not two flights. The older one is stale in every respect: same ticket,
   * same money, superseded itinerary.
   */
  reprints: Map<
    string,
    {
      /** the copy that acts — held by IDENTITY, not by date. Two copies of one
       *  receipt can share an email_date (a Gmail double-download gives byte
       *  identical files), and a date comparison then makes BOTH of them the
       *  winner: the ledger ends up with the same eTicket number twice, its
       *  money counted twice, and the flights on only one of them. */
      winner: ParsedReceipt;
      winnerSentOn: string;
      winnerLegs: Set<string>;
      winnerFlights: string;
    }
  >;
  /**
   * successor eTicket number → the predecessor inferred for it. United prints
   * "remaining value of your previous ticket numbers X", but X is often an
   * interim document you never received a receipt for, so the link can't be
   * made by number alone. When a ticket in the same booking is funded ENTIRELY
   * by carried-forward credit, says it's an exchange, and exactly one earlier
   * ticket in that booking isn't already superseded, that ticket is the
   * predecessor — otherwise the reissues look like separate purchases and the
   * booking's cost is counted once per ticket.
   */
  inferredPredecessor: Map<string, { ticketNumber: string; why: string }>;
  /**
   * A change notice ("…is processing") is a reissue with NO eTicket number, so
   * it can't name what it replaces and nothing can name it. Order every
   * document in a booking by date and the answer is simply the one before it.
   * Keyed `CONF@YYYY-MM-DD`; the value points at an eTicket number when the
   * predecessor has one, or at another such key when it is itself a notice.
   */
  changePredecessor: Map<string, { ticketNumber?: string; pnrDate?: string }>;
  /** `CONF@DATE` → the date a LATER change replaced that version. A notice has
   *  no ticket number, so `replacedAt` can't hold this. */
  noticeSupersededAt: Map<string, string>;
  /**
   * eTicket number → the receipt in THIS batch that reissued it. Unlike
   * `reprints` (one ticket number, re-sent) these are different tickets in one
   * chain, so the predecessor still has to be written — it holds the root fare
   * the chain's cost is computed from. Only its COUPONS stand down: you flew on
   * the reissue, so attaching the same leg to both queues one flight twice and
   * leaves it on whichever file happened to be applied last.
   */
  reissuedInBatch: Map<string, ReissuedBy>;
  /**
   * The same fact keyed by `CONF@DATE`, for a predecessor that has no eTicket
   * number to be keyed by. A change notice prints none, so a chain of notices
   * can only ever be addressed this way — and without it the coupons a notice
   * shares with its successor are written on both.
   */
  reissuedDocInBatch: Map<string, ReissuedBy>;
}

/**
 * A leg the successor lists, and which flight it lists for it. Date and route
 * alone cannot answer the question this is asked: a change that moves you from
 * UA1991 to UA1610 on the same day and route produces the same date+route key
 * for two genuinely different coupons. Matching the flight number too keeps
 * "carried over unchanged" apart from "rebooked", and only the first should
 * take the coupon off the predecessor. An empty string means the receipt
 * printed no flight number, which is a reason to fall back to date+route
 * rather than to guess.
 */
export interface ReissuedBy {
  byTicketNumber: string | null;
  legs: Map<string, Set<string>>;
}

export const EMPTY_BATCH: ReceiptBatchContext = {
  replacedAt: new Map(),
  ticketNumbers: new Set(),
  cancellations: [],
  reprints: new Map(),
  inferredPredecessor: new Map(),
  changePredecessor: new Map(),
  noticeSupersededAt: new Map(),
  reissuedInBatch: new Map(),
  reissuedDocInBatch: new Map(),
};

const legKey = (date: string, origin: string, destination: string) =>
  `${date}|${origin}→${destination}`;

/**
 * Fold every receipt in one import — plus the chains already linked in the
 * ledger — into the supersession facts each individual preview needs.
 */
export function buildBatchContext(
  parsedList: ParsedReceipt[],
  tickets: TicketRow[]
): ReceiptBatchContext {
  const replacedAt = new Map<string, string>();
  const noteReissue = (prevNo: string | null | undefined, issuedOn: string | null) => {
    const key = normTicketNo(prevNo);
    if (!key || !issuedOn) return;
    const known = replacedAt.get(key);
    // if a ticket was reissued more than once, the earliest reissue is the one
    // that voided the coupons
    if (!known || issuedOn < known) replacedAt.set(key, issuedOn);
  };

  const byId = new Map(tickets.map((t) => [t.id, t]));
  for (const t of tickets) {
    if (!t.predecessor_ticket_id) continue;
    noteReissue(byId.get(t.predecessor_ticket_id)?.ticket_number, t.issue_date);
  }
  for (const p of parsedList) {
    if (p.kind !== "cancellation") noteReissue(p.previous_ticket_number, p.issue_date);
  }

  const cancellations = parsedList
    .filter((p) => p.kind === "cancellation")
    .map((p) => ({
      confirmation: p.confirmation?.toUpperCase() ?? null,
      // no send date → a cut no leg can reach, so nothing is cancelled on a guess
      sentOn: p.email_date ?? "9999-12-31",
      // the notice's printed date — the TICKET's issue date, kept for the
      // lagged-email rule below
      issuedOn: p.issue_date,
      legs: new Set(
        p.segments.map((s) => legKey(s.flight_date, s.origin, s.destination))
      ),
    }));

  /* Documents that merely REFERENCE a ticket, as opposed to describing it: a
     cancellation names the ticket it voids, a purchase receipt names the
     ticket its extra belongs to. Counting one as a "copy" of the ticket once
     deadlocked a real booking: the upgrade receipt (newer) superseded the
     eTicket receipt as the acting copy, while its own plan said "import the
     eTicket receipt first" — and nobody created the ticket. */
  const referencesOnly = (p: ParsedReceipt) =>
    p.kind === "cancellation" ||
    p.kind === "ancillary_receipt" ||
    p.kind === "ancillary_refund";

  const ticketNumbers = new Set(
    parsedList
      .filter((p) => !referencesOnly(p))
      .map((p) => normTicketNo(p.ticket_number))
      .filter(Boolean)
  );

  /* Same eTicket number twice in one import = reprints of one ticket. The
     newest email describes the ticket as it stands; the rest are history. */
  const byTicketNo = new Map<string, ParsedReceipt[]>();
  for (const p of parsedList) {
    if (referencesOnly(p)) continue;
    const k = normTicketNo(p.ticket_number);
    if (k) byTicketNo.set(k, [...(byTicketNo.get(k) ?? []), p]);
  }
  const reprints = new Map<
    string,
    {
      winner: ParsedReceipt;
      winnerSentOn: string;
      winnerLegs: Set<string>;
      winnerFlights: string;
    }
  >();
  for (const [k, list] of byTicketNo) {
    if (list.length < 2) continue;
    const winner = list.reduce((best, p) =>
      (p.email_date ?? "") > (best.email_date ?? "") ? p : best
    );
    reprints.set(k, {
      winner,
      winnerSentOn: winner.email_date ?? "",
      winnerLegs: new Set(
        winner.segments.map((s) => legKey(s.flight_date, s.origin, s.destination))
      ),
      winnerFlights:
        winner.segments.map((s) => `${s.carrier}${s.flight_number}`).join(", ") ||
        "its current itinerary",
    });
  }

  /* Reissues whose printed "previous ticket" is a document we never received.
     Walked oldest-first so each inferred link removes its predecessor from the
     pool — a 3-ticket booking chains A → B → C rather than both pointing at A. */
  const known = new Map<string, { confirmation: string | null; issued: string | null }>();
  for (const t of tickets) {
    const k = normTicketNo(t.ticket_number);
    if (k) known.set(k, { confirmation: t.confirmation_code, issued: t.issue_date });
  }
  for (const p of parsedList) {
    if (p.kind === "cancellation") continue;
    const k = normTicketNo(p.ticket_number);
    if (k && !known.has(k)) known.set(k, { confirmation: p.confirmation, issued: p.issue_date });
  }
  const superseded = new Set<string>();
  for (const t of tickets) {
    if (!t.predecessor_ticket_id) continue;
    const k = normTicketNo(byId.get(t.predecessor_ticket_id)?.ticket_number);
    if (k) superseded.add(k);
  }
  for (const p of parsedList) {
    const k = normTicketNo(p.previous_ticket_number);
    if (k && known.has(k)) superseded.add(k);
  }

  const inferredPredecessor = new Map<string, { ticketNumber: string; why: string }>();
  const reissues = parsedList
    .filter(
      (p) =>
        p.kind !== "cancellation" &&
        p.previous_ticket_number != null &&
        !known.has(normTicketNo(p.previous_ticket_number)) &&
        p.confirmation != null &&
        p.issue_date != null &&
        p.payments.length > 0 &&
        p.payments.every((x) => CREDIT_PAYMENT_TYPES.includes(x.payment_type))
    )
    .sort((a, b) => (a.issue_date ?? "").localeCompare(b.issue_date ?? ""));

  for (const p of reissues) {
    const self = normTicketNo(p.ticket_number);
    const conf = p.confirmation!.toUpperCase();
    const candidates = [...known.entries()].filter(
      ([k, v]) =>
        k !== self &&
        !superseded.has(k) &&
        v.confirmation?.toUpperCase() === conf &&
        v.issued != null &&
        v.issued < p.issue_date!
    );
    if (candidates.length !== 1) continue;
    const [predNo] = candidates[0];
    superseded.add(predNo);
    /* Say WHERE the predecessor came from. The pool is the ledger plus the
       receipts being applied right now, so the answer is routinely "the file
       directly below this one" — and quoting only its eTicket number made a
       link to a sibling in the same batch read as a link to some unrelated
       ticket the user had to go and find. */
    const fromBatch = !tickets.some((t) => normTicketNo(t.ticket_number) === predNo);
    const origin = fromBatch ? "the other receipt here" : "already in your ledger";
    if (self)
      inferredPredecessor.set(self, {
        ticketNumber: predNo,
        why: `${origin}. It names ${p.previous_ticket_number}, which you don't have`,
      });
  }

  /* Change notices, chained by date within each booking. A notice supersedes
     whatever document in that PNR came immediately before it — and when that
     document has an eTicket number, feeding `replacedAt` lets the existing
     supersession rules cancel the legs the change left behind. */
  const changePredecessor = new Map<string, { ticketNumber?: string; pnrDate?: string }>();
  const noticeSupersededAt = new Map<string, string>();
  {
    const docKey = (conf: string, date: string) => `${conf}@${date}`;
    type Doc = { conf: string; date: string; ticketNumber: string | null; notice: boolean };
    const docs: Doc[] = [];
    for (const t of tickets) {
      if (!t.confirmation_code || !t.issue_date) continue;
      docs.push({
        conf: t.confirmation_code.toUpperCase(), date: t.issue_date,
        ticketNumber: t.ticket_number, notice: false,
      });
    }
    for (const p of parsedList) {
      if (p.kind === "cancellation") continue;
      const conf = p.confirmation?.toUpperCase();
      const notice = p.kind === "change_notice";
      const date = notice ? p.email_date : p.issue_date;
      if (!conf || !date) continue;
      // a ledger ticket already stands for this document
      const k = normTicketNo(p.ticket_number);
      if (k && tickets.some((t) => normTicketNo(t.ticket_number) === k)) continue;
      docs.push({ conf, date, ticketNumber: p.ticket_number, notice });
    }
    const byConf = new Map<string, Doc[]>();
    for (const d of docs) byConf.set(d.conf, [...(byConf.get(d.conf) ?? []), d]);
    for (const [, list] of byConf) {
      // notices last on a tie: a notice dated the same day as a ticket is the
      // change TO it, never the thing it replaced
      list.sort((a, b) => a.date.localeCompare(b.date) || Number(a.notice) - Number(b.notice));
      for (let i = 1; i < list.length; i++) {
        const cur = list[i];
        if (!cur.notice) continue;
        const prev = list[i - 1];
        changePredecessor.set(
          docKey(cur.conf, cur.date),
          prev.ticketNumber
            ? { ticketNumber: prev.ticketNumber }
            : { pnrDate: docKey(prev.conf, prev.date) }
        );
        // the predecessor's unflown legs died with the change
        noteReissue(prev.ticketNumber, cur.date);
        if (prev.notice) noticeSupersededAt.set(docKey(prev.conf, prev.date), cur.date);
      }
    }
  }

  /* Which receipts here reissue which others. Two sources, same conclusion:
     the printed "previous ticket number" when that document is also in the
     batch, and the links inferred just above when it isn't. Either way the
     predecessor's coupons were reissued onto the successor, and only the
     successor should carry them. */
  const reissuedInBatch: ReceiptBatchContext["reissuedInBatch"] = new Map();
  const reissuedDocInBatch: ReceiptBatchContext["reissuedDocInBatch"] = new Map();
  const reissuedBy = (by: ParsedReceipt): ReissuedBy => {
    const legs = new Map<string, Set<string>>();
    for (const s of by.segments) {
      const k = legKey(s.flight_date, s.origin, s.destination);
      const set = legs.get(k) ?? new Set<string>();
      set.add((s.flight_number ?? "").replace(/\D/g, ""));
      legs.set(k, set);
    }
    return { byTicketNumber: by.ticket_number ?? null, legs };
  };
  const noteReissuedBy = (predNo: string | null | undefined, by: ParsedReceipt) => {
    const k = normTicketNo(predNo);
    if (!k) return;
    reissuedInBatch.set(k, reissuedBy(by));
  };
  for (const p of parsedList) {
    if (p.kind === "cancellation") continue;
    const printed = normTicketNo(p.previous_ticket_number);
    if (printed && ticketNumbers.has(printed)) noteReissuedBy(printed, p);
    const inferred = inferredPredecessor.get(normTicketNo(p.ticket_number));
    if (inferred) noteReissuedBy(inferred.ticketNumber, p);
    /* A change notice reissues its predecessor's coupons exactly like a
       reissued ticket does, but the two links above both key on a printed
       ticket number and a notice prints neither its own nor its
       predecessor's. Address the predecessor however it can be addressed. */
    const conf = p.confirmation?.toUpperCase();
    const date = p.kind === "change_notice" ? p.email_date : p.issue_date;
    const prev = conf && date ? changePredecessor.get(`${conf}@${date}`) : undefined;
    if (prev?.ticketNumber) noteReissuedBy(prev.ticketNumber, p);
    else if (prev?.pnrDate) reissuedDocInBatch.set(prev.pnrDate, reissuedBy(p));
  }

  return {
    replacedAt, ticketNumbers, cancellations, reprints, inferredPredecessor,
    changePredecessor, noticeSupersededAt, reissuedInBatch, reissuedDocInBatch,
  };
}

/**
 * What status a leg the ledger has never seen should be created with. Past
 * dates default to flown, but only when no sibling document contradicts it.
 */
function proposedStatus(
  ps: ReceiptSegment,
  confirmation: string | null,
  ticketNo: string,
  batch: ReceiptBatchContext,
  todayStr: string,
  /** the current instant, for the scheduled-arrival boundary */
  nowMs: number,
  /** for a change notice: when a LATER change replaced this version */
  noticeCut?: string,
  /** the imported MileagePlus statement's date range, when one exists */
  coverage?: { from: string; to: string } | null,
  /** 0/false when the receipt credits another programme (stored as 0|1) */
  creditsMP?: number | boolean | null,
  /** the receipt's own issue date — a notice can only cancel tickets that
   *  existed when it was sent */
  ticketIssuedOn?: string | null,
  /** true when the receipt is an award ticket (miles redeemed) */
  awardTicket?: boolean
): { status: string; why: string | null; reason?: "supersession" | "coverage" } {
  if (noticeCut && ps.flight_date >= noticeCut)
    return {
      status: "canceled",
      reason: "supersession",
      why: `never flown — this booking changed again on ${noticeCut}, before this leg departed`,
    };
  const notice = batch.cancellations.find(
    (c) =>
      /* a notice WITH legs matches per-leg (confirmation merely compatible);
         a leg-less notice ("cancellation is complete") names only the
         booking, so it demands an exact confirmation match and covers every
         leg under it */
      (c.legs.size > 0
        ? (c.confirmation == null ||
            confirmation == null ||
            c.confirmation === confirmation) &&
          c.legs.has(legKey(ps.flight_date, ps.origin, ps.destination))
        : c.confirmation != null &&
          confirmation != null &&
          c.confirmation === confirmation &&
          /* United recycles six-character codes after a couple of years — a
             leg-less notice matches by code alone, so it may only cancel
             tickets from its own booking's era, not an old stranger's */
          (ticketIssuedOn == null ||
            (ticketIssuedOn <= c.sentOn &&
              dayDiff(c.sentOn, ticketIssuedOn) <= 400))) &&
      /* the send-date cut — plus the lagged-email case: a coupon issued
         ON/AFTER its own flight day (a same-day change), cancelled by an
         email at most a day later, never really flew. United has emailed a
         midnight cancellation the next morning, which made the flight look
         already-departed and immune. The printed date can't be the cut
         itself: it is the TICKET's issue date, months old on a reservation
         cancelled late in life. */
      (ps.flight_date >= c.sentOn ||
        (c.issuedOn != null &&
          c.issuedOn >= ps.flight_date &&
          dayDiff(c.sentOn, ps.flight_date) <= 1)) &&
      /* cancel-and-rebook under the SAME confirmation and flights: the old
         notice's leg list matches the new ticket's legs too, but a notice
         cancels only tickets that existed when it was sent — a coupon issued
         after it is the rebooking, not a target */
      (ticketIssuedOn == null || ticketIssuedOn <= c.sentOn)
  );
  if (notice)
    return {
      status: "canceled",
      reason: "supersession",
      why: `cancelled on ${notice.sentOn}, before it departed — per the cancellation notice in this import`,
    };

  const reissuedOn = ticketNo ? batch.replacedAt.get(ticketNo) : undefined;
  if (reissuedOn && ps.flight_date >= reissuedOn)
    return {
      status: "canceled",
      reason: "supersession",
      why: `never flown — this ticket was reissued on ${reissuedOn}, before this leg departed`,
    };

  /* United's own statement is authoritative inside its coverage: a past leg
     the activity import covers but never posted did not fly — cancelled,
     changed or no-show, on evidence the mailbox may simply lack (United
     sends many cancellations from addresses a receipts label never sees).
     The premise ("if it flew, it posted") holds only for United-marketed
     cash travel credited to MileagePlus: a ticket credited elsewhere, an
     award leg (no PQP/PQF to post, in most eras), or a partner-marketed
     flight (postings flaky enough to have their own "worth claiming"
     reconcile queue) may legitimately post nothing — all exempt. */
  if (
    coverage &&
    creditsMP !== false &&
    creditsMP !== 0 &&
    awardTicket !== true &&
    ps.carrier === "UA" &&
    ps.flight_date < todayStr &&
    ps.flight_date >= coverage.from &&
    ps.flight_date <= coverage.to
  )
    return {
      status: "canceled",
      reason: "coverage",
      why: `inside your MileagePlus statement's coverage (${coverage.from} → ${coverage.to}) yet United posted nothing for it — treated as never flown`,
    };

  /* The flown boundary is the SCHEDULED ARRIVAL plus a margin (see
     arrival.ts) — a leg whose printed arrival passed six hours ago has
     flown, even today; a red-eye still in the air has not, even yesterday's.
     Legs with no printed schedule fall back to the day rule: before today,
     not today. The asymmetry is the same either way: claiming an unflown
     flight flew corrupts everything downstream at once (miles, PQP, flown
     counts, cost per mile), while the opposite mistake costs one status
     flip a few hours later, or nothing at all once the statement posts. */
  return {
    status: hasArrived(ps, nowMs, todayStr) ? "flown_unreconciled" : "ticketed",
    why: null,
  };
}

export interface TicketPlan {
  action: "create" | "update" | "unchanged" | "conflict";
  ticketId?: string;
  existingLabel?: string;
  diffs: string[];
  fills: string[];
  /** why this row looks the way it does — shown, never applied */
  note?: string;
  /** field patch to apply (fills; on conflict resolved "receipt", also diffs) */
  data: Record<string, string | number | null>;
  /** overriding patch used only when the user picks "use receipt" on a conflict */
  conflictData: Record<string, string | number | null>;
}

export interface SegmentPlan {
  parsed: ReceiptSegment;
  action: "create" | "update" | "unchanged" | "conflict";
  segmentId?: string;
  existingLabel?: string;
  diffs: string[];
  fills: string[];
  /** why this row looks the way it does — shown, never applied */
  note?: string;
  data: Record<string, string | number | null>;
  conflictData: Record<string, string | number | null>;
}

export interface ReceiptPreview {
  parsed: ParsedReceipt;
  ticket: TicketPlan;
  segments: SegmentPlan[];
  /** funding rows to record; empty when the ticket already has payments */
  payments: ParsedReceipt["payments"];
  /** rows already on the ticket that are an EARLIER, poorer read of this same
   *  receipt — the same instrument now stated with its amount, or the same
   *  redemption now carrying its account. Left in place they read as a second
   *  funding source, which is how a 30,000-mile share sat beside its older
   *  bare copy and one seat showed 60,000 miles. Apply deletes them. */
  stalePayments: { id: string; label: string }[];
  /** predecessor ticket resolved from the receipt's "previous ticket" line */
  exchange: { predecessorId: string; label: string } | null;
  /** receipt names a previous ticket neither the ledger nor this import has */
  exchangeUnresolved: string | null;
  /** Still-unflown ledger legs on the ticket this receipt replaces, which the
   *  new itinerary does not carry. The reissue voided them, and no later
   *  document will ever say so — the abandoned route appears on nothing that
   *  comes after. Without this sweep the rule fired only when the replaced
   *  ticket's own receipt sat in the same import batch; a predecessor already
   *  in the ledger kept its dead legs "ticketed" forever.
   *
   *  "update" cancels on apply; "conflict" is the boundary day — a leg due
   *  the very day of the reissue may have flown that morning and simply
   *  never been marked, so the receipt's inference is a question there, not
   *  a verdict. */
  leftBehind: {
    segmentId: string;
    label: string;
    why: string;
    action: "update" | "conflict";
  }[];
  /** eTicket number to link as predecessor, resolved server-side once every
   *  ticket in the import exists — the predecessor may arrive in this batch, or
   *  already be in the ledger and only identifiable by inference */
  exchangePending: string | null;
  /** set when exchangePending came from inference rather than the printed
   *  number; the text explains what the inference rested on */
  exchangeInferred: string | null;
  /** extras from a purchase receipt (an upgrade, a paid seat), each destined
   *  to become a dated "extra purchase" adjustment on its ticket. "unchanged"
   *  means the EMD is already on the ticket; "orphan" means the ticket isn't
   *  in the ledger yet, and nothing will be written. */
  extras?: {
    ticketId: string | null;
    /** set instead of ticketId when the ticket is CREATED BY THIS BATCH —
     *  resolved to an id at apply time, after the creating file has run */
    ticketNumber?: string | null;
    /** the flight the receipt names, when it's in the ledger — the extra is
     *  pinned there, so allocation puts the money on that leg */
    segmentId: string | null;
    segmentLabel: string | null;
    /** the named flight, for pinning at apply time when the segment doesn't
     *  exist yet either */
    pin?: { flight_date: string; origin: string; destination: string } | null;
    action: "create" | "unchanged" | "orphan" | "pin";
    /** the adjustment already in the ledger, when this only adds its pin */
    adjustmentId?: string | null;
    label: string;
    reference: string | null;
    amount: number;
    effective_date: string | null;
  }[];
}

type Patch = Record<string, string | number | null>;

/** What the apply endpoint accepts — one reviewed preview, decisions folded in. */
export interface ApplyItem {
  ticket: {
    /** "none": write nothing on the ticket. The file may still carry flights or
     *  funding, and its ticket id may be absent entirely when another file in
     *  the same batch is the one creating that ticket. */
    action: "create" | "update" | "none";
    ticketId?: string;
    data: Patch;
  };
  segments: { action: "create" | "update"; segmentId?: string; data: Patch }[];
  payments: ParsedReceipt["payments"];
  /** payment rows to delete — earlier, poorer reads of this same receipt */
  stalePaymentIds?: string[];
  exchangePending: string | null;
  /** dated "extra purchase" adjustments to record on existing tickets — or,
   *  via ticketNumber, on a ticket this same batch creates */
  extras?: {
    /** set when the row exists and only its pin is missing */
    adjustmentId?: string | null;
    ticketId: string | null;
    ticketNumber?: string | null;
    pin?: { flight_date: string; origin: string; destination: string } | null;
    data: Patch;
  }[];
}

/** "use the receipt's value" / "keep what I entered", per conflict row */
export type ConflictDecision = "receipt" | "keep" | undefined;

/**
 * Fold a reviewed preview into the item the apply endpoint writes, or null when
 * the file has nothing left to do.
 *
 * This lives here, not in the modal, because it was a component-only detail
 * once and a real bug hid in it: every non-"create" plan was sent as "update",
 * so an inert older copy of a receipt — which by design has no ticket to update,
 * the newest copy having created it — failed with "Ticket to update no longer
 * exists" and took its segments down with it.
 */
export function buildApplyItem(
  p: ReceiptPreview,
  decisions: {
    ticket?: ConflictDecision;
    segment?: (index: number) => ConflictDecision;
    leftBehind?: (index: number) => ConflictDecision;
  } = {}
): ApplyItem | null {
  const ticket: ApplyItem["ticket"] =
    p.ticket.action === "create"
      ? { action: "create", data: p.ticket.data }
      : p.ticket.action === "unchanged"
        ? { action: "none", ticketId: p.ticket.ticketId, data: {} }
        : {
            action: "update",
            ticketId: p.ticket.ticketId,
            data: {
              ...p.ticket.data,
              ...(p.ticket.action === "conflict" && decisions.ticket === "receipt"
                ? p.ticket.conflictData
                : {}),
            },
          };

  const segments = p.segments.flatMap((s, i): ApplyItem["segments"] => {
    if (s.action === "create")
      return [{ action: "create" as const, data: s.data }];
    if (s.action === "unchanged" && Object.keys(s.data).length === 0) return [];
    const data = {
      ...s.data,
      ...(s.action === "conflict" && decisions.segment?.(i) === "receipt"
        ? s.conflictData
        : {}),
    };
    if (Object.keys(data).length === 0) return [];
    return [{ action: "update" as const, segmentId: s.segmentId, data }];
  });

  /* The legs the reissue left behind on its ledger predecessor: ordinary
     status updates by the time they reach the apply endpoint. A boundary-day
     leg ("conflict") writes whichever fact the user asserted: "Cancel it"
     cancels, "It flew" records the departure the ledger never heard about —
     because an answered question must leave a durable mark. A row still
     "ticketed" would ask the same question on every re-import, and an Apply
     that wrote nothing for an answered row reported "0 flights written" to
     a user who had just decided something. Undecided writes nothing (the
     modal blocks Apply while any question stands). */
  for (const [li, lb] of p.leftBehind.entries()) {
    const status =
      lb.action === "conflict"
        ? decisions.leftBehind?.(li) === "receipt"
          ? "canceled"
          : decisions.leftBehind?.(li) === "keep"
            ? "flown_unreconciled"
            : null
        : "canceled";
    if (status == null) continue;
    segments.push({
      action: "update" as const,
      segmentId: lb.segmentId,
      data: { status },
    });
  }

  const extras = (p.extras ?? [])
    .filter(
      (e) =>
        (e.action === "create" && (e.ticketId || e.ticketNumber)) ||
        (e.action === "pin" && e.adjustmentId)
    )
    .map((e) => ({
      adjustmentId: e.action === "pin" ? (e.adjustmentId ?? null) : null,
      ticketId: e.ticketId,
      ticketNumber: e.ticketNumber ?? null,
      pin: e.pin ?? null,
      data: {
        ticket_id: e.ticketId,
        segment_id: e.segmentId,
        type: "extra",
        amount: e.amount,
        effective_date: e.effective_date,
        notes: e.reference ? `${e.label} — EMD ${e.reference}` : e.label,
      } as Patch,
    }));

  const writesTicket =
    ticket.action === "create" || Object.keys(ticket.data).length > 0;
  if (
    !writesTicket &&
    segments.length === 0 &&
    p.payments.length === 0 &&
    p.stalePayments.length === 0 &&
    extras.length === 0 &&
    !p.exchangePending
  )
    return null;

  return {
    ticket,
    segments,
    payments: p.payments,
    stalePaymentIds: p.stalePayments.map((s) => s.id),
    exchangePending: p.exchangePending,
    extras,
  };
}

export function buildReceiptPreview(
  parsed: ParsedReceipt,
  tickets: TicketRow[],
  segments: SegmentRow[],
  existingPayments: {
    id?: string;
    ticket_id: string;
    payment_type?: string;
    amount?: number | null;
    award_miles_used?: number | null;
    reference?: string | null;
  }[] = [],
  batch: ReceiptBatchContext = EMPTY_BATCH,
  existingAdjustments: {
    id?: string;
    ticket_id: string;
    notes: string | null;
    segment_id?: string | null;
  }[] = [],
  /** min–max date range of the imported MileagePlus activity, when any */
  activityCoverage: { from: string; to: string } | null = null,
  /** the profile's traveler, from Settings — arms the whose-travel filter */
  myTraveler: { last: string; first?: string | null } | null = null,
  /** today, for the "has this flown yet" question — injectable so the rule
   *  can be checked instead of depending on the wall clock */
  todayOverride: string | null = null
): ReceiptPreview {
  /* Whose travel is it? A receipt that names travelers, none of whom is the
     profile's person, is someone else's booking that happens to live in the
     same mailbox — recognized, explained, and imported as nothing. Receipts
     that print no names, and profiles with no last name set, filter nothing;
     a multi-traveler booking that includes you imports normally. */
  const normName = (x: string) => x.toUpperCase().replace(/[^A-Z]/g, "");
  const names = parsed.traveler_names ?? [];
  if (
    myTraveler != null &&
    myTraveler.last.trim() !== "" &&
    names.length > 0 &&
    !names.some(
      (n) =>
        normName(n).includes(normName(myTraveler.last)) &&
        (!myTraveler.first?.trim() ||
          normName(n).includes(normName(myTraveler.first)))
    )
  ) {
    return {
      parsed,
      ticket: {
        action: "unchanged",
        diffs: [],
        fills: [],
        note: `booked for ${names.join(", ")} — not your travel, so nothing imports`,
        data: {},
        conflictData: {},
      },
      segments: [],
      payments: [],
      stalePayments: [],
      exchange: null,
      exchangeUnresolved: null,
      exchangePending: null,
      exchangeInferred: null,
      leftBehind: [],
      extras: [],
    };
  }
  /* An extras receipt (a paid upgrade, a seat) attaches to a ticket and never
     creates or reprices one. Each item becomes a dated "extra purchase"
     adjustment; the EMD reference stored in its notes is what makes replaying
     the same email inert. The flight it upgrades gets the PQP projection —
     only when it hasn't flown, and only when nothing projected there yet. */
  /* A refund of an extras purchase: money came BACK, so nothing may import as
     a cost. Consumption refunds change nothing (the purchase never entered
     the ledger); a refunded seat or upgrade that WAS imported gets a pointer
     to the ticket carrying it — the template names no eTicket, so the EMD
     reference in the adjustment's notes is the only way home. */
  if (parsed.kind === "ancillary_refund") {
    const refs = (parsed.ancillary_items ?? [])
      .map((i) => i.reference)
      .filter((r): r is string => r != null);
    const owner = refs
      .map((ref) => existingAdjustments.find((a) => (a.notes ?? "").includes(ref)))
      .find(Boolean);
    const ownerTicket = owner
      ? tickets.find((t) => t.id === owner.ticket_id)
      : undefined;
    return {
      parsed,
      ticket: {
        action: "unchanged",
        ticketId: ownerTicket?.id,
        existingLabel: ownerTicket
          ? (ownerTicket.ticket_number ?? ownerTicket.confirmation_code ?? "ticket")
          : undefined,
        diffs: [],
        fills: [],
        note: ownerTicket
          ? `This purchase sits on that ticket as an extra — record a matching refund adjustment there`
          : undefined,
        data: {},
        conflictData: {},
      },
      segments: [],
      payments: [],
      stalePayments: [],
      exchange: null,
      exchangeUnresolved: null,
      exchangePending: null,
      exchangeInferred: null,
      leftBehind: [],
      extras: [],
    };
  }

  if (parsed.kind === "ancillary_receipt") {
    const tno = normTicketNo(parsed.ticket_number);
    const target = tno
      ? tickets.find((t) => normTicketNo(t.ticket_number) === tno)
      : undefined;
    /* The receipt names the flight the extra was bought for — pin the money
       to that segment (flown or not: pinning is about WHERE cost belongs,
       unlike the PQP projection below, which is about what hasn't posted).
       An upgrade also TRAVELS with its coupon: reissue the ticket and the
       named leg is cancelled while the same flight departs under the new
       number, so a pin to the dead coupon would fall back to spreading the
       money over every leg — the exact smear pinning exists to prevent.
       Prefer a live leg on the ticket or anywhere in its chain, and only
       then the named ticket's own (possibly cancelled) copy. */
    /* the WHOLE chain, walked both ways: a three-ticket reissue leaves the
       upgrade's coupon two hops from the leg that finally flew, and a
       single-hop search would pin it to the dead root. Confirmation codes
       are a hint, not the structure — a chain can change PNR. */
    const chainIds = new Set<string>();
    if (target) {
      chainIds.add(target.id);
      const byId = new Map(tickets.map((t) => [t.id, t]));
      for (let cur = target; cur?.predecessor_ticket_id; ) {
        const prev = byId.get(cur.predecessor_ticket_id);
        if (!prev || chainIds.has(prev.id)) break;
        chainIds.add(prev.id);
        cur = prev;
      }
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of tickets)
          if (
            !chainIds.has(t.id) &&
            t.predecessor_ticket_id != null &&
            chainIds.has(t.predecessor_ticket_id)
          ) {
            chainIds.add(t.id);
            grew = true;
          }
      }
      const conf = target.confirmation_code?.toUpperCase();
      if (conf)
        for (const t of tickets)
          if (t.confirmation_code?.toUpperCase() === conf) chainIds.add(t.id);
    }
    const sameFlight = (s: SegmentRow, ps: ReceiptSegment) =>
      s.flight_date === ps.flight_date &&
      s.origin === ps.origin &&
      s.destination === ps.destination;
    const pinTo = parsed.segments
      .map(
        (ps) =>
          segments.find(
            (s) =>
              s.ticket_id != null &&
              chainIds.has(s.ticket_id) &&
              s.status !== "canceled" &&
              sameFlight(s, ps)
          ) ??
          segments.find((s) => s.ticket_id === target?.id && sameFlight(s, ps))
      )
      .find(Boolean);
    /* Consumption (Wi-Fi, club passes, inflight food) never becomes an
       adjustment: it's money spent ON the plane, not a change to the trip, so
       it belongs in neither cost nor cash flow. Only product changes — seats,
       upgrades, bags — go on. */
    const allItems = parsed.ancillary_items ?? [];
    const consumptionItems = allItems.filter((i) => CONSUMPTION_ITEM.test(i.label));
    const extras = allItems
      .filter((i) => !CONSUMPTION_ITEM.test(i.label))
      .map((item) => {
        const held =
          target != null && item.reference != null
            ? existingAdjustments.find(
                (a) => a.ticket_id === target.id && (a.notes ?? "").includes(item.reference!)
              )
            : undefined;
        const alreadyThere = held != null;
        /* Recorded, but without the pin this receipt can supply — an older
           import wrote it before the flight existed, or before pinning did.
           Inert replays are the rule; leaving money smeared across a trip
           when the document says which leg bought it is not worth the
           purity. Fill the blank, never overwrite a pin already there. */
        const needsPin = held != null && !held.segment_id && pinTo != null;
        /* No ticket in the ledger, but this very batch creates it: the
           eTicket receipt travels in the same mailbox drop. Resolve by
           number at apply time — after the creating file has run — and pin
           by the named flight then too. */
        const inBatch =
          target == null && tno !== "" && batch.ticketNumbers.has(tno);
        const named = parsed.segments[0];
        return {
          ticketId: target?.id ?? null,
          ticketNumber: inBatch ? parsed.ticket_number : null,
          segmentId: pinTo?.id ?? null,
          segmentLabel: pinTo
            ? `${pinTo.origin}→${pinTo.destination} ${pinTo.flight_date}`
            : inBatch && named
              ? `${named.origin}→${named.destination} ${named.flight_date}`
              : null,
          pin:
            pinTo == null && named
              ? {
                  flight_date: named.flight_date,
                  origin: named.origin,
                  destination: named.destination,
                }
              : null,
          adjustmentId: needsPin ? held!.id : null,
          action: (needsPin
            ? "pin"
            : alreadyThere
              ? "unchanged"
              : target || inBatch
                ? "create"
                : "orphan") as "create" | "unchanged" | "orphan" | "pin",
          label: item.label,
          reference: item.reference,
          amount: item.amount,
          effective_date: parsed.issue_date,
        };
      });
    const segPlans: SegmentPlan[] = [];
    for (const ps of parsed.segments) {
      if (ps.projected_pqp == null) continue;
      const match = segments.find(
        (s) =>
          s.flight_date === ps.flight_date &&
          s.origin === ps.origin &&
          s.destination === ps.destination &&
          (!target || s.ticket_id === target.id)
      );
      if (!match) continue;
      if (FLOWN_STATUSES.includes(match.status)) continue; // flown: PQP is history now, not a plan
      if (match.projected_pqp != null) continue; // never overwrite a receipt's projection
      segPlans.push({
        parsed: ps,
        action: "update",
        segmentId: match.id,
        existingLabel: `${match.origin}→${match.destination} ${match.flight_date}`,
        diffs: [],
        fills: [`projected PQP ≈${ps.projected_pqp} from the upgrade`],
        data: { projected_pqp: ps.projected_pqp },
        conflictData: {},
      });
    }
    return {
      parsed,
      ticket: {
        action: "unchanged",
        ticketId: target?.id,
        existingLabel: target
          ? (target.ticket_number ?? target.confirmation_code ?? "ticket")
          : undefined,
        diffs: [],
        fills: [],
        note:
          consumptionItems.length > 0 && extras.length === 0
            ? `${consumptionItems.map((i) => i.label).join(", ")}: onboard consumption — not part of the trip's cost, so nothing imports`
            : target
              ? undefined
              : tno !== "" && batch.ticketNumbers.has(tno)
                ? `Ticket ${parsed.ticket_number} arrives in this same import — the extra attaches to it`
                : `Ticket ${parsed.ticket_number ?? "?"} isn't in the ledger — import its eTicket receipt first, then re-import this purchase`,
        data: {},
        conflictData: {},
      },
      segments: segPlans,
      payments: [],
      stalePayments: [],
      exchange: null,
      exchangeUnresolved: null,
      exchangePending: null,
      exchangeInferred: null,
      leftBehind: [],
      extras,
    };
  }

  /* ------------------------------ ticket ------------------------------- */
  const isCancellation = parsed.kind === "cancellation";
  const conf = parsed.confirmation?.toUpperCase() ?? null;
  const tno = normTicketNo(parsed.ticket_number);
  /**
   * Ticket identity is the eTicket number, NOT the confirmation code: a
   * reissue chain keeps the same PNR across every ticket it produces, so
   * matching on the confirmation alone would silently overwrite one ticket in
   * the chain with another. The confirmation is only a fallback for sources
   * that don't print a ticket number (Chase Travel, booking confirmations).
   */
  const byTicketNumber = tno
    ? tickets.find((t) => normTicketNo(t.ticket_number) === tno)
    : undefined;
  const sameConfirmation = conf
    ? tickets.filter((t) => t.confirmation_code?.toUpperCase() === conf)
    : [];
  const isChangeNotice = parsed.kind === "change_notice";
  /* A change notice has no eTicket number, so its identity is the booking plus
     the date of the change — re-importing the same notice must find the ticket
     it already created, not mint a second one. */
  const noticeKey = conf && parsed.email_date ? `${conf}@${parsed.email_date}` : null;
  const existing = isChangeNotice
    ? sameConfirmation.find(
        (t) => !t.ticket_number && t.issue_date === parsed.email_date
      )
    : (byTicketNumber ??
      sameConfirmation.find(
        (t) => !tno || !t.ticket_number || normTicketNo(t.ticket_number) === tno
      ));
  // another ticket already carries this PNR — this is a reissue, not a dupe
  const siblingInChain =
    existing == null && sameConfirmation.length > 0 ? sameConfirmation[0] : null;

  /* The ledger ticket this one replaces, resolved early because the SEGMENT
     plans need it: a reissue moves the coupon, so a flight still hanging off
     the predecessor belongs on this ticket. Covers the inferred link too —
     United's printed "previous ticket" is often an interim document you never
     received a receipt for. */
  const changePrev = noticeKey ? batch.changePredecessor.get(noticeKey) : undefined;
  /* When a later change replaced this version, the legs it listed for dates
     after that change never flew on it — same cut a reissue applies. */
  const myNoticeCut = noticeKey ? batch.noticeSupersededAt.get(noticeKey) : undefined;
  const predecessorId = (() => {
    // a notice's predecessor may have no number at all — match it by PNR + date
    if (changePrev?.pnrDate) {
      const [pConf, pDate] = changePrev.pnrDate.split("@");
      return (
        tickets.find(
          (t) =>
            t.id !== existing?.id &&
            !t.ticket_number &&
            t.confirmation_code?.toUpperCase() === pConf &&
            t.issue_date === pDate
        )?.id ?? null
      );
    }
    const printed = parsed.previous_ticket_number
      ? normTicketNo(parsed.previous_ticket_number)
      : null;
    const inferred = tno ? batch.inferredPredecessor.get(tno)?.ticketNumber : undefined;
    const wanted = new Set(
      [printed, inferred ? normTicketNo(inferred) : null,
       changePrev?.ticketNumber ? normTicketNo(changePrev.ticketNumber) : null].filter(Boolean)
    );
    /* The ledger's own chain link is the fallback: on a re-import the
       printed "previous ticket" is often a number the ledger never had (a
       companion's coupon, an interim document), but the link it once
       inferred is sitting right on the existing ticket. */
    if (wanted.size === 0) return existing?.predecessor_ticket_id ?? null;
    return (
      tickets.find(
        (t) => t.id !== existing?.id && wanted.has(normTicketNo(t.ticket_number))
      )?.id ??
      existing?.predecessor_ticket_id ??
      null
    );
  })();

  /**
   * An older reprint of a ticket the import also carries a newer copy of is
   * inert. Acting on it would both duplicate the ticket (same eTicket number,
   * created twice) and drag the itinerary backwards — rewriting the flight that
   * flew into the flight it replaced.
   */
  const reprint = tno ? batch.reprints.get(tno) : undefined;
  /* A stale copy contributes nothing the winner already covers — but agency
     itineraries (ADTRAV) re-send only the trip that changed, so a leg the
     winner doesn't mention is not superseded, just unrepeated. Those legs are
     still imported, attached by ticket NUMBER since the winner is what creates
     the ticket row. */
  // every copy that ISN'T the winner is stale — including one sharing its date
  const staleReprint = reprint && reprint.winner !== parsed ? reprint : null;

  /** 1 when the traveller credited this ticket to MileagePlus, 0 to another
   *  programme, null when the document doesn't say. */
  const creditsMileagePlus =
    parsed.frequent_flyer_program == null
      ? null
      : parsed.frequent_flyer_program.toUpperCase() === "UA"
        ? 1
        : 0;

  const noteParts: string[] = [];
  if (parsed.miles_redeemed != null)
    noteParts.push(
      `Award ticket — ${parsed.miles_redeemed.toLocaleString()} miles redeemed`
    );
  if (parsed.local_fare != null)
    noteParts.push(
      `Fare issued abroad: ${parsed.local_fare.toLocaleString()} local currency = ${parsed.base_fare?.toFixed(2)} ${parsed.currency}`
    );
  if (parsed.previous_ticket_number)
    noteParts.push(
      `Exchange — residual of ticket ${parsed.previous_ticket_number} applied`
    );
  /* Worth keeping, but as an account fact: it is the balance of the whole
     credit bank, which can hold value from tickets this one never touched. */
  if (parsed.credit_balance != null)
    noteParts.push(
      `Future flight credit balance after this purchase: ${parsed.credit_balance.toFixed(2)} ${parsed.currency}`
    );
  if (isChangeNotice)
    noteParts.push(
      `Changed on ${parsed.email_date ?? "?"}: ${parsed.original_trip_total?.toFixed(2) ?? "?"} → ${parsed.gross_total?.toFixed(2) ?? "?"} ${parsed.currency}` +
        (parsed.residual_credit != null
          ? `, ${parsed.residual_credit.toFixed(2)} returned as future flight credit`
          : "") +
        (parsed.change_fee ? `, change fee ${parsed.change_fee.toFixed(2)}` : "")
    );
  const awardNote = noteParts.length > 0 ? noteParts.join(" · ") : null;

  const ticket: TicketPlan = {
    action: existing ? "unchanged" : "create",
    ticketId: existing?.id,
    existingLabel: existing
      ? [existing.confirmation_code, existing.ticket_number].filter(Boolean).join(" · ") ||
        "(untitled ticket)"
      : undefined,
    diffs: [],
    fills: [],
    data: {},
    conflictData: {},
  };

  if (!existing && isCancellation) {
    // nothing in the ledger to cancel
    ticket.action = "unchanged";
    ticket.data = {};
  } else if (!existing) {
    ticket.data = {
      confirmation_code: conf,
      ticket_number: parsed.ticket_number,
      issuing_carrier: parsed.issuing_carrier,
      issue_date: parsed.issue_date,
      currency: parsed.currency,
      base_fare: parsed.base_fare ?? 0,
      surcharges: parsed.surcharges ?? 0,
      taxes: parsed.taxes ?? 0,
      // an agency service fee is money the trip cost; without this the fare
      // parts stop summing to the total the moment a CTP receipt lands
      ancillary_fees: parsed.ancillary_fees ?? 0,
      gross_total: parsed.gross_total ?? 0,
      payment_method: parsed.payment_method,
      // what the chain allocator needs to tell new money from carried-forward
      // value; without it the chain has to infer it from face-value differences
      additional_collection: parsed.additional_collection,
      notes: awardNote,
    };
  } else {
    const fill = (
      field: string,
      current: string | number | null,
      incoming: string | number | null,
      label: string,
      opts: { fillOnly?: boolean } = {}
    ) => {
      if (incoming == null) return;
      const blank =
        current == null || current === "" || (typeof current === "number" && current === 0);
      if (blank) {
        if (typeof current === "number" && typeof incoming === "number" && current === incoming) return;
        ticket.fills.push(`${label} ${incoming}`);
        ticket.data[field] = incoming;
      } else if (
        !opts.fillOnly &&
        (typeof current === "number" && typeof incoming === "number"
          ? Math.abs(current - incoming) > 0.011
          : String(current).toUpperCase() !== String(incoming).toUpperCase())
      ) {
        ticket.diffs.push(`${label} ${current} → ${incoming}`);
        ticket.conflictData[field] = incoming;
      }
    };
    fill("ticket_number", existing.ticket_number, parsed.ticket_number, "eTicket #");
    fill("issue_date", existing.issue_date, parsed.issue_date, "Issued");
    fill("base_fare", existing.base_fare, parsed.base_fare, "Base fare");
    fill("surcharges", existing.surcharges, parsed.surcharges, "Surcharges");
    fill("taxes", existing.taxes, parsed.taxes, "Taxes");
    fill("ancillary_fees", existing.ancillary_fees, parsed.ancillary_fees, "Fees");
    fill("gross_total", existing.gross_total, parsed.gross_total, "Gross total");
    fill(
      "additional_collection",
      existing.additional_collection,
      parsed.additional_collection,
      "Additional collection"
    );
    fill("payment_method", existing.payment_method, parsed.payment_method, "Paid via", {
      fillOnly: true,
    });
    if (awardNote && !existing.notes) {
      ticket.fills.push("Notes");
      ticket.data.notes = awardNote;
    }
    ticket.action =
      ticket.diffs.length > 0 ? "conflict" : ticket.fills.length > 0 ? "update" : "unchanged";
  }

  /* ----------------------------- segments ------------------------------ */
  /* The OTHER tickets in this receipt's exchange chain. A predecessor's
     receipt must never claim its replacement's flights: cancel-and-rebook a
     day apart puts the old itinerary within ±1 day of the flown one, and the
     old receipt would steal the flown segment and drag its date backwards.
     Chain membership is shared predecessor-link ancestry over the ledger. */
  const chainmates = new Set<string>();
  if (existing) {
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const rootOf = (t: TicketRow): string => {
      let cur = t;
      const seen = new Set<string>();
      while (
        cur.predecessor_ticket_id != null &&
        byId.has(cur.predecessor_ticket_id) &&
        !seen.has(cur.id)
      ) {
        seen.add(cur.id);
        cur = byId.get(cur.predecessor_ticket_id)!;
      }
      return cur.id;
    };
    const myRoot = rootOf(existing);
    for (const t of tickets) {
      if (t.id !== existing.id && rootOf(t) === myRoot) chainmates.add(t.id);
    }
  }
  const claimed = new Set<string>();
  const today = new Date();
  /* The override doubles for tests: a full ISO instant exercises the
     scheduled-arrival boundary; a bare date pins now to that day's midnight
     UTC, which keeps date-only fixtures on the old day rule exactly. */
  const todayStr = todayOverride
    ? todayOverride.slice(0, 10)
    : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const nowMs = todayOverride
    ? todayOverride.includes("T")
      ? Date.parse(todayOverride)
      : Date.parse(`${todayOverride}T00:00:00Z`)
    : today.getTime();

  /* A leg-less cancellation names only the booking — its legs are whatever
     the ledger holds under that confirmation, run through the same rules
     (departed-before, reconciled-outranks, decisions for the rest). */
  let cancelSource = parsed.segments;
  if (isCancellation && cancelSource.length === 0 && sameConfirmation.length > 0) {
    /* same recycled-code guard as the batch side: the booking this notice
       cancels was issued in its own era, within roughly a year */
    const noticeDate = parsed.email_date ?? parsed.issue_date;
    const ids = new Set(
      sameConfirmation
        .filter(
          (t) =>
            t.issue_date == null ||
            noticeDate == null ||
            (t.issue_date <= noticeDate && dayDiff(noticeDate, t.issue_date) <= 400)
        )
        .map((t) => t.id)
    );
    cancelSource = segments
      .filter((sg) => sg.ticket_id != null && ids.has(sg.ticket_id))
      .map((sg) => ({
        carrier: sg.marketing_carrier,
        flight_number: sg.flight_number ?? "",
        origin: sg.origin,
        destination: sg.destination,
        flight_date: sg.flight_date,
        departure_time: null,
        arrival_time: null,
        cabin: null,
        booking_class: null,
        seat: null,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      }));
  }
  const plans: SegmentPlan[] = cancelSource.map((ps) => {
    const plan: SegmentPlan = {
      parsed: ps,
      action: "create",
      diffs: [],
      fills: [],
      data: {},
      conflictData: {},
    };

    /* What this leg WOULD be if created fresh — computed before matching,
       because a coupon the batch proves was voided (reissued away, or
       cancelled before departure) never flew, and therefore must never claim
       a segment recorded as flown. In a fresh ledger the flown rows come
       unowned from the activity import, so ownership can't protect them —
       this rule can: the flown row belongs to whichever receipt actually
       flew it, and the voided coupon gets its own leg, born canceled. */
    const proposed = proposedStatus(
      ps, conf, tno, batch, todayStr, nowMs, myNoticeCut, activityCoverage,
      creditsMileagePlus, parsed.issue_date, parsed.miles_redeemed != null
    );
    const voided =
      proposed.status === "canceled" && proposed.reason !== "coverage";
    // exact date first; else ±1 day (statements/imports often carry the
    // transaction date, receipts the true departure date)
    const candidates = segments
      .filter(
        (s) =>
          !claimed.has(s.id) &&
          s.origin === ps.origin &&
          s.destination === ps.destination &&
          Math.abs(dayDiff(s.flight_date, ps.flight_date)) <= 1 &&
          /* A cancellation may only touch its OWN booking's flights. Cancel-
             and-rebook puts the same route and date on a second ticket, and
             that one is not a target: the notice cancels the booking it
             names, not the itinerary. Only a segment whose owner RESOLVES to
             a different ticket is off-limits — unowned or unresolvable
             owners stay cancellable, so manually logged flights still can. */
          (isCancellation
            ? /* only its OWN booking's flights: unowned, unresolvable, or any
                 ticket under this confirmation (chain members share the PNR —
                 the reconciled-outranks rule still protects flown rows) */
              s.ticket_id == null ||
              (existing != null && s.ticket_id === existing.id) ||
              sameConfirmation.some((t) => t.id === s.ticket_id) ||
              !tickets.some((t) => t.id === s.ticket_id)
            : /* never another chain member's coupon — the replacement's
                 flight is its own; this receipt's leg is created fresh, and
                 the ledger-linked reissue rules void it as never flown. A
                 supersession-voided coupon never claims a flown row (though
                 a coverage-voided one may — the flown row is the evidence
                 that disproves coverage). And a coupon canceled for ANY
                 reason, coverage included, never claims a row owned by a
                 different ticket: if that flight flew, it flew as the other
                 ticket's coupon — a cancelled generation courting its
                 rebooking's flight put a "cancel it anyway?" decision on
                 travel that plainly happened. */
              !(s.ticket_id != null && chainmates.has(s.ticket_id)) &&
              !(voided && FLOWN_STATUSES.includes(s.status)) &&
              !(proposed.status === "canceled" &&
                s.ticket_id != null &&
                !(existing != null && s.ticket_id === existing.id)))
      )
      .sort((a, b) => {
        const rank = (s: SegmentRow) =>
          (s.flight_date === ps.flight_date ? 0 : 4) +
          (existing && s.ticket_id === existing.id ? 0 : s.ticket_id == null ? 1 : 2);
        return rank(a) - rank(b);
      });
    const seg = candidates[0];

    // A cancellation never adds flights — it only cancels ones you already
    // have. An unmatched leg just means the ledger never knew about it.
    if (isCancellation) {
      if (!seg) {
        /* If the same flight exists on a DIFFERENT ticket, say so: that is
           the rebooking, kept on purpose — not a missing match. (When both
           bookings arrive in one batch, the in-batch copy handles itself:
           segments created alongside their own cancellation notice are born
           canceled by the batch rules, and the rebooked ticket's are not.) */
        const other = segments.find(
          (s) =>
            s.origin === ps.origin &&
            s.destination === ps.destination &&
            Math.abs(dayDiff(s.flight_date, ps.flight_date)) <= 1 &&
            s.ticket_id != null &&
            (existing == null || s.ticket_id !== existing.id)
        );
        const otherTicket = other
          ? tickets.find((t) => t.id === other.ticket_id)
          : undefined;
        plan.action = "unchanged";
        plan.note = otherTicket
          ? `this flight belongs to ticket ${
              otherTicket.ticket_number ?? otherTicket.confirmation_code ?? "?"
            } — a different booking (the rebooking, most likely), which this cancellation leaves alone`
          : "no matching flight in the ledger — nothing to cancel";
        return plan;
      }
      claimed.add(seg.id);
      plan.segmentId = seg.id;
      plan.existingLabel = `${seg.origin}→${seg.destination} ${seg.marketing_carrier}${seg.flight_number ?? ""} on ${seg.flight_date}`;
      // A notice reprints the whole reservation, legs already behind you
      // included. It can only have cancelled travel that hadn't departed when
      // it was sent, so those legs aren't a decision to put to the user.
      const laggedEmail =
        parsed.issue_date != null &&
        parsed.email_date != null &&
        parsed.issue_date >= ps.flight_date &&
        dayDiff(parsed.email_date, ps.flight_date) <= 1;
      if (parsed.email_date && ps.flight_date < parsed.email_date && !laggedEmail) {
        plan.action = "unchanged";
        plan.note = `departed before this notice was sent on ${parsed.email_date} — not cancelled by it`;
      } else if (seg.status === "canceled") {
        plan.action = "unchanged";
      } else if (seg.status === "flown_reconciled") {
        /* United posted earnings for this flight — a cancelled coupon never
           posts, so whatever this notice cancelled, it wasn't this row.
           Cancel-and-rebook in a fresh ledger lands here: the activity
           import created the flown row unowned, and the notice's booking
           merely shares its route. Reconciliation outranks any receipt. */
        plan.action = "unchanged";
        plan.note =
          "flown and reconciled with United's own posting — a cancelled coupon never posts, so this is the rebooking's flight; nothing to cancel";
      } else if (FLOWN_STATUSES.includes(seg.status)) {
        // it was flown before the rest of the reservation was canceled
        plan.action = "conflict";
        plan.diffs.push(`recorded as ${seg.status} — cancel it anyway?`);
        plan.conflictData.status = "canceled";
      } else {
        plan.action = "update";
        plan.fills.push("status → canceled");
        plan.data.status = "canceled";
      }
      return plan;
    }

    if (!seg) {
      plan.action = "create";
      if (proposed.why) plan.note = proposed.why;
      plan.data = {
        marketing_carrier: ps.carrier,
        operating_carrier: ps.operating_carrier ?? null,
        /* The receipt names the programme this ticket was credited to, which
           is the only place it is ever stated: a United ticket credited to
           Miles & More looks United in every other respect. */
        ...(creditsMileagePlus == null ? {} : { credits_mileageplus: creditsMileagePlus }),
        flight_number: ps.flight_number,
        origin: ps.origin,
        destination: ps.destination,
        flight_date: ps.flight_date,
        departure_time: ps.departure_time,
        arrival_time: ps.arrival_time,
        cabin: effectiveCabin(ps.carrier, ps.booking_class, ps.cabin),
        booking_class: ps.booking_class,
        seat: ps.seat,
        status: proposed.status,
        ticket_id: "__TICKET__", // resolved server-side after the ticket upsert
        projected_pqp: ps.projected_pqp,
        projected_pqf: ps.projected_pqf,
        projected_award_miles: ps.projected_award_miles,
      };
      return plan;
    }

    claimed.add(seg.id);
    plan.segmentId = seg.id;
    plan.existingLabel = `${seg.origin}→${seg.destination} ${seg.marketing_carrier}${seg.flight_number ?? ""} on ${seg.flight_date}`;

    const fillSeg = (
      field: string,
      current: string | null,
      incoming: string | null,
      label: string,
      opts: { fillOnly?: boolean } = {}
    ) => {
      if (incoming == null) return;
      if (current == null || current === "") {
        plan.fills.push(`${label} ${incoming}`);
        plan.data[field] = incoming;
      } else if (!opts.fillOnly && current.toUpperCase() !== incoming.toUpperCase()) {
        plan.diffs.push(`${label} ${current} → ${incoming}`);
        plan.conflictData[field] = incoming;
      }
    };
    /**
     * United's posted activity is the authority on what actually flew (design
     * doc §1.3), and a reconciled flight's number came from that statement. So
     * a receipt naming a DIFFERENT flight on a reconciled segment is a
     * superseded booking state, not a correction — with same-day changes the
     * last receipt you happened to keep is often not the final one, and there
     * may be no receipt at all for the flight you ended up on. Keep the ticket
     * link (same ticket, same money) and leave the itinerary alone: its times,
     * seat and cabin describe a flight that didn't operate for you.
     */
    const supersededByPosting =
      seg.status === "flown_reconciled" &&
      seg.flight_number != null &&
      ps.flight_number != null &&
      normFlightNo(seg.flight_number) !== normFlightNo(ps.flight_number);

    if (supersededByPosting) {
      plan.note = `United posted ${seg.marketing_carrier ?? "UA"}${seg.flight_number} for this date and route — this receipt is for ${ps.carrier}${ps.flight_number}, an earlier booking state, so the flight details are left as posted`;
    } else {
      if (seg.flight_date !== ps.flight_date) {
        // receipt departure date is authoritative; matched ±1 day → user decides
        plan.diffs.push(`Flight date ${seg.flight_date} → ${ps.flight_date}`);
        plan.conflictData.flight_date = ps.flight_date;
      }
      /* A leg imported while it was still upcoming stays "ticketed" until
         something moves it, and nothing did: the matched path never looked
         at the status it would have proposed for a fresh row. So a flight
         imported the day before departure could sit as upcoming forever,
         quietly missing from every flown figure. Re-importing the same
         receipt now advances it — only ever from `ticketed`, never
         downgrading a flown or reconciled row, and only in the direction
         the batch can justify. */
      if (seg.status === "ticketed" && proposed.status !== "ticketed") {
        plan.fills.push(
          proposed.status === "canceled"
            ? "status → canceled"
            : "status → flown (its date has passed)"
        );
        plan.data.status = proposed.status;
        if (proposed.why) plan.note = proposed.why;
      }
      fillSeg("flight_number", seg.flight_number, ps.flight_number, "Flight #");
      /* A ticket says what you BOUGHT; a flown flight records what you
         FLEW, and between the two sits every upgrade. This receipt was
         written before the flight, so where it disagrees about cabin on a
         leg already flown, it is describing the booking that was later
         upgraded — asking "Economy or First?" about a trip that is over
         invites answering it wrong. Blanks still fill; disagreements say
         what happened and stop there. */
      const flownAlready = FLOWN_STATUSES.includes(seg.status);
      const receiptPredatesFlight =
        parsed.issue_date != null && parsed.issue_date <= ps.flight_date;
      const cabinIsHistory = flownAlready && receiptPredatesFlight;
      fillSeg(
        "cabin",
        seg.cabin,
        effectiveCabin(ps.carrier, ps.booking_class, ps.cabin),
        "Cabin",
        { fillOnly: cabinIsHistory }
      );
      fillSeg("booking_class", seg.booking_class, ps.booking_class, "Class", {
        fillOnly: cabinIsHistory,
      });
      if (
        cabinIsHistory &&
        seg.cabin &&
        effectiveCabin(ps.carrier, ps.booking_class, ps.cabin) &&
        seg.cabin !== effectiveCabin(ps.carrier, ps.booking_class, ps.cabin)
      )
        plan.note =
          `booked in ${effectiveCabin(ps.carrier, ps.booking_class, ps.cabin)}, flown in ${seg.cabin} — ` +
          "the cabin you flew stands; a receipt predates the upgrade";
      // scheduled times & seats drift with schedule changes — fill blanks only
      fillSeg("departure_time", seg.departure_time, ps.departure_time, "Departs", { fillOnly: true });
      fillSeg("arrival_time", seg.arrival_time, ps.arrival_time, "Arrives", { fillOnly: true });
      fillSeg("seat", seg.seat, ps.seat, "Seat", { fillOnly: true });
    }

    // accrual projections: estimates by definition — newest receipt wins,
    // shown as one combined fill, never conflicts, never touching posted fields
    const projChanged = (
      field: "projected_pqp" | "projected_pqf" | "projected_award_miles",
      current: number | null,
      incoming: number | null
    ) => {
      if (incoming == null || current === incoming) return false;
      plan.data[field] = incoming;
      return true;
    };
    const anyProj = [
      projChanged("projected_pqp", seg.projected_pqp, ps.projected_pqp),
      projChanged("projected_pqf", seg.projected_pqf, ps.projected_pqf),
      projChanged(
        "projected_award_miles",
        seg.projected_award_miles,
        ps.projected_award_miles
      ),
    ].some(Boolean);
    if (anyProj) plan.fills.push(projectionLabel(ps));

    // ticket attachment
    if (seg.ticket_id == null) {
      plan.fills.push("attach to this ticket");
      plan.data.ticket_id = "__TICKET__"; // resolved server-side after upsert
    } else if (existing && seg.ticket_id === existing.id) {
      // already attached correctly
    } else if (predecessorId && seg.ticket_id === predecessorId) {
      /* A reissue MOVES the coupon — the flight travels on this ticket now.
         That isn't a judgment call the way a rival ticket is, and leaving it
         behind strands a live leg on a superseded ticket: the chain then
         reports its cost against the ticket that was replaced, and the
         reconcile queue flags it as a double count. */
      plan.fills.push("move from the ticket this one replaces");
      plan.data.ticket_id = "__TICKET__";
    } else {
      plan.diffs.push("already attached to a different ticket");
      plan.conflictData.ticket_id = "__TICKET__";
    }

    plan.action =
      plan.diffs.length > 0 ? "conflict" : plan.fills.length > 0 ? "update" : "unchanged";
    return plan;
  });

  /* ------------------------ payments & exchange ------------------------ */

  // Don't duplicate funding rows a ticket already carries — but match row by
  // row, not all-or-nothing. A ticket paid three ways whose ledger holds only
  // one of them (an early parse that stopped at the first method) must still
  // gain the other two, or its funding reads as permanently short.
  const payKey = (p: {
    payment_type?: string;
    amount?: number | null;
    award_miles_used?: number | null;
    reference?: string | null;
  }) =>
    [
      p.payment_type,
      (p.reference ?? "").trim().toLowerCase(),
      p.amount ?? "",
      p.award_miles_used ?? "",
    ].join("|");
  const onFile = new Set(
    existing == null
      ? []
      : existingPayments.filter((p) => p.ticket_id === existing.id).map(payKey)
  );
  // a cancellation re-prints the original purchase summary; it isn't a new
  // payment and must not be recorded as one
  let payments = isCancellation
    ? []
    : parsed.payments.filter((p) => !onFile.has(payKey(p)));

  /* The mirror of the row-by-row match above: rows an EARLIER, poorer parse of
     this same receipt wrote. The method block used to import as amount-less
     rows ("Mileage Plus XXXXX652" as Other, the card with nothing on it) and
     the redemption as a bare miles row; a later parse states the same
     instruments with their data, and exact-key matching happily filed both
     renditions side by side — so re-importing a mailbox after any parser
     improvement DOUBLED funding instead of confirming it. A row with neither
     amount nor miles cannot be hand-entered (the API refuses it), and a bare
     miles row that repeats a now-attributed redemption to the mile is the same
     statement, so both are superseded, not second payments. */
  const normRef = (x: { reference?: string | null }) =>
    (x.reference ?? "").trim().toLowerCase();
  const stalePayments =
    existing == null || isCancellation
      ? []
      : existingPayments
          .filter((m) => m.ticket_id === existing.id && m.id != null)
          .filter((m) => {
            const mRef = normRef(m);
            const mAmt = m.amount ?? null;
            const mMiles = m.award_miles_used ?? null;
            return parsed.payments.some((b) => {
              const bRef = normRef(b);
              // the same named instrument, now carrying data this row lacks
              if (mRef !== "" && mRef === bRef)
                return (
                  mAmt == null &&
                  mMiles == null &&
                  (b.amount != null ||
                    b.award_miles_used != null ||
                    b.payment_type !== m.payment_type)
                );
              if (mRef === "") {
                // a bare method row, when the parse states that method
                if (mAmt == null && mMiles == null)
                  return (
                    b.payment_type === m.payment_type &&
                    (b.amount != null || b.award_miles_used != null)
                  );
                // a bare redemption, when the parse attributes the same miles
                if (mMiles != null && mAmt == null)
                  return (
                    b.payment_type === "miles" &&
                    b.award_miles_used === mMiles &&
                    bRef !== ""
                  );
              }
              return false;
            });
          })
          .map((m) => ({
            id: m.id as string,
            label:
              m.award_miles_used != null
                ? `${m.award_miles_used.toLocaleString()} miles`
                : (m.reference ??
                  (PAYMENT_TYPE_LABELS as Record<string, string>)[m.payment_type ?? "other"] ??
                  "payment"),
          }));
  if (stalePayments.length > 0)
    ticket.fills.push(
      `funding: ${stalePayments.length} row${stalePayments.length === 1 ? "" : "s"} from an earlier read of this receipt superseded (${stalePayments
        .map((s) => s.label)
        .join(", ")})`
    );
  /* The ticket's action was settled before funding was examined, so a file
     whose only work is payment rows — recording them or retiring stale ones —
     read as "unchanged" and the Apply button never counted it. */
  if (ticket.action === "unchanged" && (payments.length > 0 || stalePayments.length > 0))
    ticket.action = "update";

  if (payments.length > 0) {
    const label = payments
      .map((p) =>
        p.amount != null
          ? `${PAYMENT_TYPE_LABELS[p.payment_type]} ${p.amount.toFixed(2)}`
          : p.award_miles_used != null
            ? `${p.award_miles_used.toLocaleString()} miles`
            : PAYMENT_TYPE_LABELS[p.payment_type]
      )
      .join(" + ");
    ticket.fills.push(`funding: ${label}`);
  }

  let exchange: ReceiptPreview["exchange"] = null;
  let exchangeUnresolved: string | null = null;
  let exchangePending: string | null = null;
  let exchangeInferred: string | null = null;
  if (siblingInChain && !isCancellation) {
    ticket.fills.push(
      `same PNR as ${[siblingInChain.confirmation_code, siblingInChain.ticket_number].filter(Boolean).join(" · ")} — separate ticket in the reissue chain`
    );
  }
  /* A change notice never names what it replaces — the batch worked it out by
     date. Link it here, or defer when the predecessor is another document in
     this same import that has no id (or no eTicket number) yet. */
  if (isChangeNotice && changePrev && !existing?.predecessor_ticket_id) {
    if (predecessorId) {
      const prev = tickets.find((t) => t.id === predecessorId)!;
      exchange = {
        predecessorId,
        label:
          [prev.confirmation_code, prev.ticket_number].filter(Boolean).join(" · ") ||
          "(untitled ticket)",
      };
      ticket.fills.push(`change of ${exchange.label}`);
      ticket.data.predecessor_ticket_id = predecessorId;
    } else if (changePrev.ticketNumber) {
      exchangePending = changePrev.ticketNumber;
      ticket.fills.push(`change of ticket ${changePrev.ticketNumber}`);
    } else if (changePrev.pnrDate) {
      exchangePending = `pnr:${changePrev.pnrDate}`;
      ticket.fills.push(`change of the ${changePrev.pnrDate.split("@")[1]} version of this booking`);
    }
  }
  if (parsed.previous_ticket_number) {
    const prevNo = normTicketNo(parsed.previous_ticket_number);
    const prev = tickets.find(
      (t) => normTicketNo(t.ticket_number) === prevNo && t.id !== existing?.id
    );
    if (prev) {
      const alreadyLinked = existing?.predecessor_ticket_id === prev.id;
      if (!alreadyLinked) {
        exchange = {
          predecessorId: prev.id,
          label:
            [prev.confirmation_code, prev.ticket_number].filter(Boolean).join(" · ") ||
            prevNo,
        };
        ticket.fills.push(`exchange of ${exchange.label}`);
        ticket.data.predecessor_ticket_id = prev.id;
      }
    } else if (batch.ticketNumbers.has(prevNo)) {
      // arrives as another file in this same import — the link is deferred to
      // apply time, when both tickets have ids
      exchangePending = parsed.previous_ticket_number;
      ticket.fills.push(`exchange of ticket ${parsed.previous_ticket_number}`);
    } else {
      const guess = tno ? batch.inferredPredecessor.get(tno) : undefined;
      if (guess) {
        exchangePending = guess.ticketNumber;
        exchangeInferred = guess.why;
        ticket.fills.push(`exchange of ticket ${guess.ticketNumber}`);
      } else {
        exchangeUnresolved = parsed.previous_ticket_number;
      }
    }
  }
  if (!isCancellation && parsed.residual_credit != null && existing?.residual_credit == null) {
    ticket.fills.push(`residual credit ${parsed.residual_credit.toFixed(2)}`);
    ticket.data.residual_credit = parsed.residual_credit;
  }
  if (ticket.action === "unchanged" && ticket.fills.length > 0)
    ticket.action = "update";

  /* This ticket was reissued by another file in this batch. It still gets
     written — it is the chain's root and carries the fare the chain's cost is
     computed from — but the coupons the reissue also lists belong to the
     reissue. Queuing them here too writes one flight twice and leaves it on
     whichever file was applied last. A leg the successor does NOT list was
     dropped rather than reissued, so it stays here. */
  const reissuedByPeer =
    (tno ? batch.reissuedInBatch.get(tno) : undefined) ??
    (noticeKey ? batch.reissuedDocInBatch.get(noticeKey) : undefined);
  if (reissuedByPeer && !staleReprint) {
    for (const p of plans) {
      const onSuccessor = reissuedByPeer.legs.get(
        legKey(p.parsed.flight_date, p.parsed.origin, p.parsed.destination)
      );
      if (!onSuccessor) continue; // the successor dropped this leg; it stays here
      /* Same day and route, different flight: the successor rebooked it rather
         than carrying it, so this is still its own coupon — and an unflown one,
         which the replaced-leg rules downstream will mark canceled. */
      const mine = (p.parsed.flight_number ?? "").replace(/\D/g, "");
      if (mine && !onSuccessor.has("") && !onSuccessor.has(mine)) continue;
      p.action = "unchanged";
      p.diffs = [];
      p.fills = [];
      p.data = {};
      p.conflictData = {};
      p.note = `reissued onto ticket ${reissuedByPeer.byTicketNumber ?? "the later receipt here"} — the coupon is attached there`;
    }
  }

  if (staleReprint) {
    ticket.action = "unchanged";
    ticket.fills = [];
    ticket.diffs = [];
    ticket.data = {};
    ticket.conflictData = {};
    ticket.note = `older copy of ticket ${parsed.ticket_number} — the ${staleReprint.winnerSentOn} copy in this import supersedes it (now ${staleReprint.winnerFlights})`;
    payments = [];
    exchange = null;
    exchangePending = null;
    exchangeInferred = null;
    exchangeUnresolved = null;
    const ticketRef = `__TICKETNO__:${tno}`;
    for (const p of plans) {
      const covered = staleReprint.winnerLegs.has(
        legKey(p.parsed.flight_date, p.parsed.origin, p.parsed.destination)
      );
      if (covered) {
        p.action = "unchanged";
        p.diffs = [];
        p.fills = [];
        p.data = {};
        p.conflictData = {};
        p.note = "same coupon as the newer copy, on the flight it replaced — left alone";
        continue;
      }
      // the winner never mentions this leg, so the older copy is its only source
      if (p.data.ticket_id === "__TICKET__") p.data.ticket_id = ticketRef;
      if (p.conflictData.ticket_id === "__TICKET__") p.conflictData.ticket_id = ticketRef;
      p.note = "not in the newer copy of this ticket — imported from this one";
    }
  }

  /* The reissue's own logic, extended to the ledger: it voids the
     predecessor's coupons that hadn't departed when it was issued. Legs the
     new itinerary still lists are MOVED (the coupon-move rule above); legs it
     dropped are dead, and only this receipt will ever say so. Only
     "ticketed" rows are touched — anything flown, reconciled or already
     cancelled is history this receipt has no standing to rewrite. */
  const leftBehind: ReceiptPreview["leftBehind"] = [];
  const reissueCut = parsed.issue_date ?? parsed.email_date;
  if (predecessorId && reissueCut && !isCancellation && !staleReprint) {
    const carried = new Set(
      parsed.segments.map((ps) => legKey(ps.flight_date, ps.origin, ps.destination))
    );
    for (const seg of segments) {
      if (seg.ticket_id !== predecessorId) continue;
      if (seg.status !== "ticketed") continue;
      if (seg.flight_date < reissueCut) continue;
      if (carried.has(legKey(seg.flight_date, seg.origin, seg.destination))) continue;
      /* A leg some plan already spoke for is not left behind — it is the leg
         being moved. Coupon matching allows ±1 day (a reissue that slips
         SFO→IAH from the 16th to the 17th is the ordinary irregular-ops
         rebooking), and the date-keyed `carried` set above cannot see that:
         it holds the NEW date, the ledger row still carries the old one. Left
         unchecked the same row was queued twice in one apply — moved onto the
         new ticket, then cancelled by this sweep, which lands last and wins —
         so the one leg the traveller is actually going to fly ended up
         recorded as cancelled. `carried` still earns its place for a leg the
         itinerary lists that some OTHER ledger row claimed. */
      if (claimed.has(seg.id)) continue;
      /* The boundary day is a question, not a verdict: "ticketed" can simply
         mean nobody marked the morning's flight yet, and a same-day reissue
         cannot say which side of departure it landed on. Days strictly after
         the cut are certain — the leg hadn't flown when its coupons died. */
      const boundary = seg.flight_date === reissueCut;
      leftBehind.push({
        segmentId: seg.id,
        label: `${seg.origin}→${seg.destination} ${seg.marketing_carrier}${seg.flight_number ?? ""} on ${seg.flight_date}`,
        action: boundary ? "conflict" : "update",
        why: boundary
          ? `due to fly the very day its ticket was reissued (${reissueCut}) — "Cancel it" if the reissue replaced it, "It flew" if it departed first (recorded as flown, awaiting reconciliation)`
          : `never flown — its ticket was reissued on ${reissueCut}, before this leg departed, and the new itinerary doesn't carry it`,
      });
    }
  }

  return {
    parsed,
    ticket,
    leftBehind,
    segments: plans,
    payments,
    stalePayments,
    exchange,
    exchangeUnresolved,
    exchangePending,
    exchangeInferred,
  };
}
