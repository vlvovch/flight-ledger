import { handled, jsonError, jsonOk } from "@/lib/api";
import { transaction } from "@/lib/db";
import { parseEml } from "@/lib/eml";
import { MAX_BATCH_MESSAGES } from "@/lib/mbox";
import { buildBatchContext, buildReceiptPreview } from "@/lib/receipt-import";
import { parseUnitedEmail, preferTravelerTicket } from "@/lib/united-receipt";
import {
  createAdjustment,
  updateAdjustment,
  createPayment,
  deletePayment,
  createSegment,
  createTicket,
  getSegment,
  getSettings,
  getTicket,
  listActivities,
  listAdjustments,
  listPayments,
  listSegmentsRaw,
  listTickets,
  updateSegment,
  updateTicket,
  runAsActor,
} from "@/lib/repo";
import {
  prepareAdjustment,
  preparePayment,
  prepareSegment,
  prepareTicket,
} from "@/lib/validate";
import type { PaymentType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Patch = Record<string, string | number | null>;
interface ApplyItem {
  ticket: {
    /** "none" = write nothing on the ticket; the file still carries flights or
     *  funding. Its id may be absent entirely, because the ticket can be one
     *  another file in this same batch is creating — those segments attach by
     *  eTicket number instead. */
    action: "create" | "update" | "none";
    ticketId?: string;
    data: Patch;
  };
  segments: {
    action: "create" | "update";
    segmentId?: string;
    data: Patch;
  }[];
  payments?: {
    payment_type: PaymentType;
    amount: number | null;
    award_miles_used: number | null;
    reference: string | null;
  }[];
  /** payment rows to delete — earlier, poorer reads of this same receipt */
  stalePaymentIds?: string[];
  /** eTicket number of the ticket this one was reissued from, when that ticket
   *  is created by this same import and so has no id at preview time */
  exchangePending?: string | null;
  /** dated "extra purchase" adjustments (a paid upgrade, a seat) to record on
   *  existing tickets — or, via ticketNumber, on a ticket this same batch
   *  creates. EMD in the notes keeps re-imports inert */
  extras?: {
    /** set when the adjustment exists and only its pin is missing */
    adjustmentId?: string | null;
    ticketId: string | null;
    ticketNumber?: string | null;
    pin?: { flight_date: string; origin: string; destination: string } | null;
    data: Patch;
  }[];
}

export const POST = handled(async (req: Request) => {
  const body = await req.json();

  if (body.mode === "preview") {
    const emls = body.emls as { name: string; content: string }[];
    if (!Array.isArray(emls) || emls.length === 0)
      return jsonError("No .eml content received");
    // High enough that no real mailbox splits: cross-file reasoning (a
    // reissue deciding whether another email's leg flew) only works within
    // one batch, so splitting isn't just slow — it's wrong. The byte guard
    // is the actual backstop; the modal holds back the rest above the cap.
    if (emls.length > MAX_BATCH_MESSAGES)
      return jsonError("Too many messages in one import");
    if (emls.reduce((s, e) => s + String(e.content).length, 0) > 100 * 1024 * 1024)
      return jsonError(
        "That's over 100 MB of mail in one batch — export a narrower label (receipts only) and try again"
      );
    const tickets = listTickets();
    const segments = listSegmentsRaw();
    const payments = listPayments();
    // Parse everything first: whether a leg on one receipt actually flew can
    // depend on a reissue or cancellation that arrived as a *different* file,
    // so no preview can be built until the whole batch is known.
    const owner = getSettings();
    const ledgerTicketNumbers = new Set(
      tickets.map((t) => (t.ticket_number ?? "").replace(/[\s-]/g, "")).filter(Boolean)
    );
    const parsedFiles = emls.map(({ name, content }) => {
      try {
        const parsed = parseUnitedEmail(parseEml(String(content)));
        /* multi-traveler receipts: the ledger owner's eTicket, not whoever
           the airline printed first — unless the ledger already met this
           receipt under the companion's number */
        if (parsed)
          preferTravelerTicket(
            parsed, owner.member_first_name, owner.member_last_name, ledgerTicketNumbers
          );
        return parsed
          ? { name, parsed }
          : { name, error: "Not a recognized United receipt or booking confirmation" };
      } catch (e) {
        return { name, error: e instanceof Error ? e.message : "Parse failed" };
      }
    });
    const batch = buildBatchContext(
      parsedFiles.flatMap((f) => (f.parsed ? [f.parsed] : [])),
      tickets
    );
    const adjustments = listAdjustments();
    /* United's own statement is authoritative inside its date range: a past
       leg it covers but never posted did not fly. min–max of the imported
       activity is that range (import contiguous exports). */
    const activityDates = listActivities()
      .map((a) => a.activity_date)
      .filter(Boolean)
      .sort();
    const coverage =
      activityDates.length > 0
        ? { from: activityDates[0], to: activityDates[activityDates.length - 1] }
        : null;
    /* the whose-travel filter arms only when Settings names a last name */
    const st = getSettings();
    const myTraveler = st.member_last_name?.trim()
      ? {
          last: st.member_last_name.trim(),
          first: st.member_first_name?.trim() || null,
        }
      : null;
    const results = parsedFiles.map((f) =>
      f.parsed
        ? {
            name: f.name,
            preview: buildReceiptPreview(
              f.parsed,
              tickets,
              segments,
              payments,
              batch,
              adjustments,
              coverage,
              myTraveler
            ),
          }
        : f
    );
    return jsonOk({ results });
  }

  if (body.mode === "apply") {
    const items = body.items as ApplyItem[];
    if (!Array.isArray(items)) return jsonError("items must be an array");
    let ticketsCreated = 0;
    let ticketsUpdated = 0;
    let segmentsCreated = 0;
    let segmentsUpdated = 0;
    let paymentsRecorded = 0;
    let paymentsSuperseded = 0;
    let extrasRecorded = 0;
    let chainsLinked = 0;
    const errors: string[] = [];
    const pendingLinks: { ticketId: string; previousTicketNumber: string }[] = [];

    // Tickets must exist before anything can attach to them by number, so
    // creating items go first — an agency re-send that carries a leg the
    // newest copy omits attaches to the ticket that copy creates.
    const issued = (i: ApplyItem) => String(i.ticket.data?.issue_date ?? "");
    const ordered = [...items].sort(
      (a, b) =>
        (a.ticket.action === "create" ? 0 : 1) - (b.ticket.action === "create" ? 0 : 1) ||
        // …and oldest document first, so when several versions of one booking
        // claim the same flight, the newest is the one that keeps it
        issued(a).localeCompare(issued(b))
    );

    runAsActor("import:receipt", () =>
    transaction(() => {
      const normNo = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "");
      const ticketIdByNumber = () =>
        new Map(
          listTickets()
            .filter((t) => t.ticket_number)
            .map((t) => [normNo(t.ticket_number), t.id])
        );

      for (const item of ordered) {
        let ticketId: string | null = null;

        if (item.ticket.action === "create") {
          const p = prepareTicket(item.ticket.data);
          if (!p.ok) {
            errors.push(`Ticket: ${p.error}`);
            continue;
          }
          ticketId = createTicket(p.values);
          ticketsCreated++;
        } else if (item.ticket.action === "none") {
          ticketId = item.ticket.ticketId ?? null;
        } else {
          ticketId = item.ticket.ticketId ?? null;
          if (!ticketId || !getTicket(ticketId)) {
            errors.push("Ticket to update no longer exists");
            continue;
          }
          if (Object.keys(item.ticket.data).length > 0) {
            const p = prepareTicket(item.ticket.data, true);
            if (!p.ok) {
              errors.push(`Ticket: ${p.error}`);
              continue;
            }
            updateTicket(ticketId, p.values);
            ticketsUpdated++;
          }
        }

        if (item.exchangePending && ticketId)
          pendingLinks.push({
            ticketId,
            previousTicketNumber: item.exchangePending,
          });

        for (const ex of item.extras ?? []) {
          /* a row that exists and only lacks its pin: fill that blank rather
             than writing a second copy of the same purchase */
          if (ex.adjustmentId) {
            const segId = ex.data.segment_id;
            if (segId != null) {
              updateAdjustment(ex.adjustmentId, { segment_id: segId });
              extrasRecorded++;
            }
            continue;
          }
          /* the ticket may have been created moments ago by another file in
             this same batch — creates run first, so the number resolves now */
          const ticketIdForExtra =
            ex.ticketId ??
            (ex.ticketNumber
              ? (ticketIdByNumber().get(normNo(ex.ticketNumber)) ?? null)
              : null);
          if (!ticketIdForExtra || !getTicket(ticketIdForExtra)) {
            errors.push("Extra purchase: its ticket no longer exists");
            continue;
          }
          /* pin to the named flight — the segment, too, may be minutes old */
          let segmentId = ex.data.segment_id ?? null;
          if (segmentId == null && ex.pin) {
            segmentId =
              listSegmentsRaw().find(
                (sg) =>
                  sg.ticket_id === ticketIdForExtra &&
                  sg.flight_date === ex.pin!.flight_date &&
                  sg.origin === ex.pin!.origin &&
                  sg.destination === ex.pin!.destination
              )?.id ?? null;
          }
          const p = prepareAdjustment({
            ...ex.data,
            ticket_id: ticketIdForExtra,
            segment_id: segmentId,
          });
          if (!p.ok) {
            errors.push(`Extra purchase: ${p.error}`);
            continue;
          }
          createAdjustment(p.values);
          extrasRecorded++;
        }

        for (const pay of item.payments ?? []) {
          const p = preparePayment(
            {
              ticket_id: ticketId,
              payment_type: pay.payment_type,
              amount: pay.amount,
              award_miles_used: pay.award_miles_used,
              reference: pay.reference,
            },
            false,
            { allowMethodOnly: true }
          );
          if (!p.ok) {
            errors.push(`Payment: ${p.error}`);
            continue;
          }
          createPayment(p.values);
          paymentsRecorded++;
        }

        /* Rows a poorer parse of this same receipt wrote — superseded by the
           rows above, and left in place they double the funding. The ticket
           check keeps a stale preview from reaching into someone else's rows. */
        for (const staleId of item.stalePaymentIds ?? []) {
          const row = listPayments().find((x) => x.id === staleId);
          if (!row || row.ticket_id !== ticketId) continue;
          deletePayment(staleId);
          paymentsSuperseded++;
        }

        for (const s of item.segments) {
          // "__TICKET__" placeholder → the ticket we just created/updated
          const data: Patch = { ...s.data };
          if (data.ticket_id === "__TICKET__") data.ticket_id = ticketId;
          if (typeof data.ticket_id === "string" && data.ticket_id.startsWith("__TICKETNO__:")) {
            const want = data.ticket_id.slice("__TICKETNO__:".length);
            data.ticket_id = ticketIdByNumber().get(normNo(want)) ?? null;
          }
          const label = `${data.origin ?? ""}${data.origin ? "→" : ""}${data.destination ?? "segment"}`;
          if (s.action === "create") {
            const p = prepareSegment(data);
            if (!p.ok) {
              errors.push(`${label}: ${p.error}`);
              continue;
            }
            createSegment(p.values);
            segmentsCreated++;
          } else {
            if (!s.segmentId || !getSegment(s.segmentId)) {
              errors.push(`${label}: matched flight no longer exists`);
              continue;
            }
            if (Object.keys(data).length === 0) continue;
            const p = prepareSegment(data, true);
            if (!p.ok) {
              errors.push(`${label}: ${p.error}`);
              continue;
            }
            updateSegment(s.segmentId, p.values);
            segmentsUpdated++;
          }
        }
      }

      // Reissue chains that arrived whole: both ends only have ids now, so the
      // predecessor links are made after every ticket in the batch is written.
      if (pendingLinks.length > 0) {
        const norm = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "");
        const all = listTickets();
        const byNumber = new Map(
          all.filter((t) => t.ticket_number).map((t) => [norm(t.ticket_number), t])
        );
        /* A change notice's predecessor may be another notice, which has no
           eTicket number at all — those are identified by booking + date. */
        const byPnrDate = new Map(
          all
            .filter((t) => !t.ticket_number && t.confirmation_code && t.issue_date)
            .map((t) => [`${t.confirmation_code!.toUpperCase()}@${t.issue_date}`, t])
        );
        for (const link of pendingLinks) {
          const prev = link.previousTicketNumber.startsWith("pnr:")
            ? byPnrDate.get(link.previousTicketNumber.slice(4).toUpperCase())
            : byNumber.get(norm(link.previousTicketNumber));
          const self = getTicket(link.ticketId);
          if (!prev || !self || prev.id === self.id) continue;
          if (self.predecessor_ticket_id) continue; // already linked
          updateTicket(self.id, { predecessor_ticket_id: prev.id });
          chainsLinked++;
        }
      }
    }));

    return jsonOk({
      ok: true,
      ticketsCreated,
      ticketsUpdated,
      segmentsCreated,
      segmentsUpdated,
      paymentsRecorded,
      paymentsSuperseded,
      extrasRecorded,
      chainsLinked,
      errors,
    });
  }

  return jsonError('mode must be "preview" or "apply"');
});
