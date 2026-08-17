import {
  AdjustmentRow,
  AllocationMethod,
  GROSS_INCREASING_TYPES,
  GROSS_REDUCING_TYPES,
  NON_ALLOCABLE_STATUSES,
  SegmentRow,
  TicketAllocation,
  TicketRow,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Distribute `total` across items proportionally to `weights`, rounding to
 * cents with largest-remainder correction so the parts sum exactly to the
 * rounded total (design doc §19.4 invariant).
 */
export function distribute(total: number, weights: number[]): number[] {
  const t = round2(total);
  const wSum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (wSum <= 0 || t === 0) return weights.map(() => 0);
  const rawCents = weights.map((w) => (t * 100 * w) / wSum);
  const floors = rawCents.map((c) => Math.floor(c));
  let remainder = Math.round(t * 100) - floors.reduce((s, c) => s + c, 0);
  const order = rawCents
    .map((c, i) => ({ frac: c - Math.floor(c), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out.map((c) => c / 100);
}

/**
 * Allocate a ticket's cost across its segments.
 *
 * Accounting rules (kept deliberately explicit — design doc §1.3 "no silent
 * accounting decisions"):
 *  - Gross spend  = gross_total × exchange_rate + extra purchases − refunds
 *  - Personal     = gross spend − all other adjustments (reimbursements,
 *                   statement credits, employer payments, corrections)
 *  - Canceled/refunded segments receive no allocation.
 *  - Manual per-segment amounts are honored first; the remainder is split
 *    PQP-weighted when every remaining segment has PQP, else
 *    distance-weighted, else equally (§7.2 hierarchy).
 *  - Personal cost follows each segment's share of gross.
 */
/**
 * Extras split two ways. One PINNED to a specific live flight (the upgrade
 * receipt names its leg) lands whole on that flight — gross and personal
 * alike, since a reimbursement is presumed to cover the fare before it covers
 * extras. One with no flight (or whose flight was canceled) joins the pooled
 * cost and spreads like the fare does.
 */
function splitExtras(
  adjustments: AdjustmentRow[],
  activeIds: Set<string>
): { pinned: AdjustmentRow[]; pooled: number; stray: number } {
  const extras = adjustments.filter((a) => GROSS_INCREASING_TYPES.includes(a.type));
  const pinned = extras.filter(
    (a) => a.segment_id != null && activeIds.has(a.segment_id)
  );
  const loose = extras.filter(
    (a) => !(a.segment_id != null && activeIds.has(a.segment_id))
  );
  return {
    pinned,
    pooled: round2(loose.reduce((s, a) => s + a.amount, 0)),
    stray: loose.filter((a) => a.segment_id != null).length,
  };
}

export function allocateTicket(
  ticket: TicketRow,
  segments: SegmentRow[],
  adjustments: AdjustmentRow[]
): TicketAllocation {
  const warnings: string[] = [];
  const grossReporting = round2(ticket.gross_total * (ticket.exchange_rate || 1));

  const refunds = round2(
    adjustments
      .filter((a) => GROSS_REDUCING_TYPES.includes(a.type))
      .reduce((s, a) => s + a.amount, 0)
  );
  const activeIds = new Set(
    segments.filter((s) => !NON_ALLOCABLE_STATUSES.includes(s.status)).map((s) => s.id)
  );
  const { pinned, pooled: pooledExtras, stray } = splitExtras(adjustments, activeIds);
  if (stray > 0)
    warnings.push(
      `${stray} extra purchase${stray === 1 ? " is" : "s are"} pinned to a canceled or missing flight — spread across the ticket instead.`
    );
  const pinnedTotal = round2(pinned.reduce((s, a) => s + a.amount, 0));
  const otherAdjustments = round2(
    adjustments
      .filter(
        (a) =>
          !GROSS_REDUCING_TYPES.includes(a.type) &&
          !GROSS_INCREASING_TYPES.includes(a.type)
      )
      .reduce((s, a) => s + a.amount, 0)
  );

  let grossAllocable = round2(grossReporting + pooledExtras - refunds);
  if (grossAllocable < 0) {
    warnings.push(
      `Refunds (${refunds.toFixed(2)}) exceed ticket gross (${grossReporting.toFixed(2)}); gross clamped to 0.`
    );
    grossAllocable = 0;
  }

  /* Reimbursements offset the pooled cost (the fare) first; only what they
     can't cover spills into pinned extras. Work pays the fare, you pay the
     upgrade — the assumption is stated in accounting.md, and an explicit
     larger reimbursement still clamps everything to zero. */
  let personalTotal = round2(grossAllocable - otherAdjustments);
  let overflow = 0;
  if (personalTotal < 0) {
    overflow = -personalTotal;
    personalTotal = 0;
  }
  let pinnedPersonal = round2(pinnedTotal - overflow);
  if (pinnedPersonal < 0) {
    warnings.push(
      `Reimbursements/credits (${otherAdjustments.toFixed(2)}) exceed net ticket cost (${round2(grossAllocable + pinnedTotal).toFixed(2)}); personal cost clamped to 0.`
    );
    pinnedPersonal = 0;
  }

  const perSegment: TicketAllocation["perSegment"] = {};
  for (const s of segments) perSegment[s.id] = { gross: 0, personal: 0, method: "none" };

  const active = segments.filter(
    (s) => !NON_ALLOCABLE_STATUSES.includes(s.status)
  );

  let method: AllocationMethod = "none";

  if (active.length === 0) {
    if (grossAllocable > 0 && segments.length > 0) {
      warnings.push(
        "All segments are canceled/refunded but the ticket still has net cost; nothing allocated."
      );
    }
  } else {
    const manual = active.filter((s) => s.manual_cost != null);
    const auto = active.filter((s) => s.manual_cost == null);
    const manualSum = round2(manual.reduce((s, m) => s + (m.manual_cost as number), 0));
    if (manualSum > grossAllocable + 0.005) {
      warnings.push(
        `Manual segment amounts (${manualSum.toFixed(2)}) exceed net ticket cost (${grossAllocable.toFixed(2)}).`
      );
    }
    for (const m of manual) {
      perSegment[m.id] = {
        gross: round2(m.manual_cost as number),
        personal: 0,
        method: "manual",
      };
    }
    const remainder = Math.max(0, round2(grossAllocable - manualSum));

    if (auto.length > 0) {
      let weights: number[];
      if (auto.every((s) => s.pqp != null) && auto.some((s) => (s.pqp as number) > 0)) {
        method = "pqp";
        weights = auto.map((s) => s.pqp as number);
      } else if (
        auto.every((s) => s.distance_miles != null) &&
        auto.some((s) => (s.distance_miles as number) > 0)
      ) {
        method = "distance";
        weights = auto.map((s) => s.distance_miles as number);
      } else {
        method = "equal";
        weights = auto.map(() => 1);
      }
      const shares = distribute(remainder, weights);
      auto.forEach((s, i) => {
        perSegment[s.id] = { gross: shares[i], personal: 0, method };
      });
    } else if (manual.length > 0) {
      method = "manual";
      if (remainder > 0.005) {
        warnings.push(
          `${remainder.toFixed(2)} of ticket cost is not covered by manual segment amounts.`
        );
      }
    }

    // Personal cost follows gross shares; if gross is fully refunded/zero,
    // fall back to even distribution across active segments.
    const grossShares = active.map((s) => perSegment[s.id].gross);
    const totalGrossShares = grossShares.reduce((s, g) => s + g, 0);
    const personalShares =
      totalGrossShares > 0
        ? distribute(personalTotal, grossShares)
        : distribute(personalTotal, active.map(() => 1));
    active.forEach((s, i) => {
      perSegment[s.id].personal = personalShares[i];
    });
  }

  // pinned extras land whole on their own flight, after the pooled split —
  // only a reimbursement overflow (factor < 1) thins them
  if (pinnedTotal > 0) {
    const factor = pinnedPersonal / pinnedTotal;
    for (const p of pinned) {
      const cell = perSegment[p.segment_id as string];
      cell.gross = round2(cell.gross + p.amount);
      cell.personal = round2(cell.personal + p.amount * factor);
    }
  }

  return {
    ticketId: ticket.id,
    method,
    gross_reporting: grossReporting,
    /* A ticket standing on its own cost its face, on its issue date. Refunds
       are not netted off here: they came back on their own date and are their
       own event on the timeline. */
    cashAt: grossReporting,
    refunds,
    gross_allocable: round2(grossAllocable + pinnedTotal),
    other_adjustments: otherAdjustments,
    personal_total: round2(personalTotal + pinnedPersonal),
    perSegment,
    warnings,
  };
}

/* --------------------------- exchange chains ---------------------------- */

/**
 * Cost allocation across a reissue chain (design doc §6.5).
 *
 * A chain is one economic event, not N purchases: each reissue is funded by
 * the previous ticket's value plus whatever new money United collected, so
 * summing face values would count the same dollars once per ticket. The cash
 * a chain actually consumed is
 *
 *     root face value
 *   + additional collection on each reissue   (new money)
 *   − residual credit handed back             (value returned to you)
 *
 * and that total belongs to the flights the chain ultimately flew — wherever
 * in the chain they sit. Superseded flights are canceled and take no share,
 * so a rerouted leg costs nothing while the flight that replaced it carries
 * the fare.
 *
 * `additional_collection` comes from the receipt when United prints it; when
 * it doesn't, the difference between consecutive face values is the same
 * number (verified against real reissues) and is used as the fallback.
 */
export function allocateChain(
  chain: TicketRow[], // root first
  segmentsByTicket: Map<string, SegmentRow[]>,
  adjustmentsByTicket: Map<string, AdjustmentRow[]>
): Record<string, TicketAllocation> {
  /** ticketId null = concerns the whole chain, so every member shows it */
  const warnings: { ticketId: string | null; text: string }[] = [];
  const warn = (text: string, ticketId: string | null = null) =>
    warnings.push({ ticketId, text });
  const faceOf = (t: TicketRow) => round2(t.gross_total * (t.exchange_rate || 1));

  let chainCash = 0;
  let residualsInferred = 0;
  /* What each member cost in NEW money, at its own issue date, so a cash-flow
     view can place the chain on a timeline instead of on one date. The
     decomposition has to live here rather than be re-derived: the additional
     collection and the residual are usually INFERRED from consecutive face
     values, and a second implementation of that inference would be a second
     answer waiting to disagree. Summed, these equal chainCash — asserted in
     the selftest, because that is exactly the sort of thing a later edit here
     would silently break. */
  const contribution = new Map<string, number>();
  const add = (id: string, v: number) =>
    contribution.set(id, round2((contribution.get(id) ?? 0) + v));
  chain.forEach((t, i) => {
    if (i === 0) {
      chainCash += faceOf(t);
      add(t.id, faceOf(t));
      return;
    }
    const printed = t.additional_collection;
    const diff = round2(faceOf(t) - faceOf(chain[i - 1]));
    if (printed != null) {
      chainCash += printed;
      add(t.id, printed);
      return;
    }
    if (diff > 0) {
      chainCash += diff;
      add(t.id, diff);
      warn(
        `${label(t)}: no "additional collection" on the receipt — inferred ${diff.toFixed(2)} from the fare difference.`,
        t.id
      );
      return;
    }
    /**
     * The mirror image of an inferred collection: a reissue onto a CHEAPER
     * ticket returns the difference as a future flight credit, so it is not
     * money this trip consumed. United's printed fare rules still carry the
     * legacy "no residual value" language, but in practice the credit comes
     * back (confirmed against this ledger's own reissues), and the receipt
     * prints neither outcome — so the difference is inferred as a credit.
     * An explicit `residual_credit` always wins, including a deliberate 0 for
     * the rare fare that really does forfeit it.
     */
    if (diff < 0 && t.residual_credit == null) {
      residualsInferred += -diff;
      add(t.id, diff); // negative: this reissue handed value back
    }
  });
  const residualsRecorded = round2(
    chain.reduce((s, t) => s + (t.residual_credit ?? 0), 0)
  );
  /* Recorded residuals come off the member that recorded them, so the credit
     lands in the month it was actually handed back rather than the chain's. */
  for (const t of chain) if (t.residual_credit) add(t.id, -t.residual_credit);
  residualsInferred = round2(residualsInferred);
  const residuals = round2(residualsRecorded + residualsInferred);
  chainCash = round2(chainCash - residuals);

  const allAdjustments = chain.flatMap((t) => adjustmentsByTicket.get(t.id) ?? []);
  const refunds = round2(
    allAdjustments
      .filter((a) => GROSS_REDUCING_TYPES.includes(a.type))
      .reduce((s, a) => s + a.amount, 0)
  );
  /* one allocation across every still-live segment in the chain */
  const allSegments = chain.flatMap((t) => segmentsByTicket.get(t.id) ?? []);
  const active = allSegments.filter(
    (s) => !NON_ALLOCABLE_STATUSES.includes(s.status)
  );
  const { pinned, pooled: pooledExtras, stray } = splitExtras(
    allAdjustments,
    new Set(active.map((s) => s.id))
  );
  if (stray > 0)
    warn(
      `${stray} extra purchase${stray === 1 ? " is" : "s are"} pinned to a canceled or missing flight — spread across the chain instead.`
    );
  const pinnedTotal = round2(pinned.reduce((s, a) => s + a.amount, 0));
  const otherAdjustments = round2(
    allAdjustments
      .filter(
        (a) =>
          !GROSS_REDUCING_TYPES.includes(a.type) &&
          !GROSS_INCREASING_TYPES.includes(a.type)
      )
      .reduce((s, a) => s + a.amount, 0)
  );

  let grossAllocable = round2(chainCash + pooledExtras - refunds);
  if (grossAllocable < 0) {
    warn(
      `Refunds (${refunds.toFixed(2)}) exceed the chain's cost (${chainCash.toFixed(2)}); gross clamped to 0.`
    );
    grossAllocable = 0;
  }
  // fare first, extras last — same overflow rule as the single-ticket path
  let personalTotal = round2(grossAllocable - otherAdjustments);
  let overflow = 0;
  if (personalTotal < 0) {
    overflow = -personalTotal;
    personalTotal = 0;
  }
  let pinnedPersonal = round2(pinnedTotal - overflow);
  if (pinnedPersonal < 0) {
    warn(
      `Reimbursements/credits (${otherAdjustments.toFixed(2)}) exceed the chain's net cost; personal cost clamped to 0.`
    );
    pinnedPersonal = 0;
  }
  const perSegment: TicketAllocation["perSegment"] = {};
  for (const s of allSegments) perSegment[s.id] = { gross: 0, personal: 0, method: "none" };

  let method: AllocationMethod = "none";
  if (active.length > 0) {
    const manual = active.filter((s) => s.manual_cost != null);
    const auto = active.filter((s) => s.manual_cost == null);
    const manualSum = round2(
      manual.reduce((s, m) => s + (m.manual_cost as number), 0)
    );
    for (const m of manual) {
      perSegment[m.id] = { gross: round2(m.manual_cost as number), personal: 0, method: "manual" };
    }
    const remainder = Math.max(0, round2(grossAllocable - manualSum));

    if (auto.length > 0) {
      let weights: number[];
      if (auto.every((s) => s.pqp != null) && auto.some((s) => (s.pqp as number) > 0)) {
        method = "pqp";
        weights = auto.map((s) => s.pqp as number);
      } else if (
        auto.every((s) => s.distance_miles != null) &&
        auto.some((s) => (s.distance_miles as number) > 0)
      ) {
        method = "distance";
        weights = auto.map((s) => s.distance_miles as number);
      } else {
        method = "equal";
        weights = auto.map(() => 1);
      }
      const shares = distribute(remainder, weights);
      auto.forEach((s, i) => {
        perSegment[s.id] = { gross: shares[i], personal: 0, method };
      });
    } else if (manual.length > 0) {
      method = "manual";
    }

    const grossShares = active.map((s) => perSegment[s.id].gross);
    const totalGross = grossShares.reduce((s, g) => s + g, 0);
    const personalShares =
      totalGross > 0
        ? distribute(personalTotal, grossShares)
        : distribute(personalTotal, active.map(() => 1));
    active.forEach((s, i) => {
      perSegment[s.id].personal = personalShares[i];
    });
  } else if (grossAllocable > 0) {
    warn(
      "Every flight in this exchange chain is canceled, but the chain still has cost; nothing allocated."
    );
  }

  if (pinnedTotal > 0) {
    const factor = pinnedPersonal / pinnedTotal;
    for (const p of pinned) {
      const cell = perSegment[p.segment_id as string];
      cell.gross = round2(cell.gross + p.amount);
      cell.personal = round2(cell.personal + p.amount * factor);
    }
  }

  /* Report the same chain-level figures on each ticket so the UI can explain
     where the money went, while segment shares stay in one place. */
  const out: Record<string, TicketAllocation> = {};
  for (const t of chain) {
    const own = segmentsByTicket.get(t.id) ?? [];
    const ownShares: TicketAllocation["perSegment"] = {};
    for (const s of own) ownShares[s.id] = perSegment[s.id];
    out[t.id] = {
      ticketId: t.id,
      method,
      gross_reporting: faceOf(t),
      cashAt: contribution.get(t.id) ?? 0,
      refunds,
      gross_allocable: round2(grossAllocable + pinnedTotal),
      other_adjustments: otherAdjustments,
      personal_total: round2(personalTotal + pinnedPersonal),
      perSegment: ownShares,
      // Chain membership is a fact about the ticket, not a fault: it rides in
      // `chain` below, which the ticket panel renders. Putting it in `warnings`
      // too filed it under "costs that don't reconcile" once per member and
      // duplicated the line the panel already shows. Warnings about one ticket
      // land only on that ticket, for the same reason.
      warnings: warnings
        .filter((w) => w.ticketId == null || w.ticketId === t.id)
        .map((w) => w.text),
      chain: {
        ticketIds: chain.map((c) => c.id),
        cash: chainCash,
        residuals,
        residualsInferred,
      },
    };
  }
  return out;
}

const label = (t: TicketRow) =>
  [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") || "Ticket";

/**
 * Allocation for a segment with no ticket: manual cost or nothing.
 * (Flown segments with no cost at all get flagged by the issues engine.)
 */
export function standaloneAllocation(segment: SegmentRow): {
  gross: number;
  personal: number;
  method: AllocationMethod;
} {
  if (NON_ALLOCABLE_STATUSES.includes(segment.status)) {
    return { gross: 0, personal: 0, method: "none" };
  }
  if (segment.manual_cost != null) {
    const v = round2(segment.manual_cost);
    return { gross: v, personal: v, method: "manual" };
  }
  return { gross: 0, personal: 0, method: "none" };
}
