"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, MailOpen, Plus, Search, Trash2 } from "lucide-react";
import ReceiptImportModal from "@/components/ReceiptImportModal";
import type {
  AdjustmentRow,
  EnrichedSegment,
  PaymentRow,
  SegmentStatus,
  TicketAllocation,
  TicketRow,
} from "@/lib/types";
import { NON_ALLOCABLE_STATUSES, PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from "@/lib/types";
import { ADJUSTMENT_CHOICES, ADJUSTMENT_LABELS, METHOD_LABELS, api, fmtInt, fmtMoney, spanLabel, todayStr } from "@/lib/format";
import {
  Confirm,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Panel,
  StatusChip,
} from "@/components/ui";
import { C } from "@/components/charts";

/** Coupons that were bought but never flown — shown, but dimmed. */
const UNTAKEN_STATUSES: SegmentStatus[] = ["canceled", "missed"];
const wasTaken = (s: EnrichedSegment) => !UNTAKEN_STATUSES.includes(s.status);

/** One run of connecting flights. `taken[i]` covers the hop codes[i]→codes[i+1]. */
type Leg = { codes: string[]; taken: boolean[] };

/**
 * A ticket's flights as a path: SFO → IAH → SFO rather than three codes the
 * eye has to reassemble. Consecutive segments that connect are chained into
 * one leg; a gap (returning from somewhere you didn't fly to) starts a new
 * one, so an open-jaw reads as two legs instead of one impossible route.
 *
 * A canceled or missed coupon stays in the path but is marked untaken, so the
 * superseded half of an exchange reads as history rather than vanishing —
 * dropping it silently left a chain member showing a route it no longer had.
 */
function routeLegs(segments: EnrichedSegment[]): Leg[] {
  const legs: Leg[] = [];
  for (const s of orderedByDate(segments)) {
    const last = legs[legs.length - 1];
    if (last && last.codes[last.codes.length - 1] === s.origin) {
      last.codes.push(s.destination);
      last.taken.push(wasTaken(s));
    } else {
      legs.push({ codes: [s.origin, s.destination], taken: [wasTaken(s)] });
    }
  }
  return legs;
}

/**
 * An airport dims only when nothing that touches it was flown; an arrow dims
 * with its own hop. Dimming a code that one live flight still reaches would
 * read as "never went there".
 */
function RouteLine({ legs, max = 2 }: { legs: Leg[]; max?: number }) {
  const shown = legs.slice(0, max);
  return (
    <>
      {shown.map((leg, li) => (
        <span key={li}>
          {li > 0 && <span className="text-mute">{"  ·  "}</span>}
          {leg.codes.map((code, i) => {
            // the hops on either side of this airport, ignoring the ends
            const touching = [leg.taken[i - 1], leg.taken[i]].filter((v) => v !== undefined);
            const dim = !touching.some(Boolean);
            return (
              <span key={i}>
                {i > 0 && <span className={leg.taken[i - 1] ? "" : "text-mute"}> → </span>}
                <span className={dim ? "text-mute" : ""}>{code}</span>
              </span>
            );
          })}
        </span>
      ))}
      {legs.length > shown.length && (
        <span className="text-mute"> +{legs.length - shown.length}</span>
      )}
    </>
  );
}

function orderedByDate(segments: EnrichedSegment[]): EnrichedSegment[] {
  return [...segments].sort((a, b) => (a.flight_date ?? "").localeCompare(b.flight_date ?? ""));
}

/**
 * The coupons that set the ticket's DATES. A canceled or refunded one was
 * never flown, so it must not stretch the travel window: one ticket here read
 * "+197d" purely because a canceled segment sat seven months after the flight
 * that happened. The route still shows those coupons — dimmed, see RouteLine —
 * because knowing an exchange dropped a leg is worth seeing; only the span
 * pretends they aren't there. If every coupon was dropped, keep them all
 * rather than claiming the ticket has no dates at all.
 */
function itinerary(segments: EnrichedSegment[]): EnrichedSegment[] {
  const live = segments.filter((s) => !NON_ALLOCABLE_STATUSES.includes(s.status));
  return live.length > 0 ? live : segments;
}

/**
 * When the flights happened: the departure, and how far the last one runs
 * from it. Two ISO dates joined by a dash put four dash glyphs in a row
 * ("2026-05-10 – 05-14") and the truncated half reads as its own date format,
 * so the closing date is given as a duration instead — which also removes the
 * special case for a trip that crosses New Year.
 */
function travelSpan(segments: EnrichedSegment[]): string | null {
  const dates = orderedByDate(itinerary(segments))
    .map((s) => s.flight_date)
    .filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) return first;
  const days = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000);
  return `${first} ${spanLabel(days)}`;
}

interface TicketFull extends TicketRow {
  allocation: TicketAllocation;
  adjustments: AdjustmentRow[];
  payments: PaymentRow[];
  segments: EnrichedSegment[];
  predecessor_label: string | null;
  successor_id: string | null;
  successor_label: string | null;
}

/** Where a linked-to row should sit from the top of the viewport, in px. */
const LANDING_OFFSET = 96;

export default function TicketsPage() {
  const [tickets, setTickets] = useState<TicketFull[] | null>(null);
  const [flights, setFlights] = useState<EnrichedSegment[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [year, setYear] = useState<string>("all");
  const [q, setQ] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editTicket, setEditTicket] = useState<TicketFull | null>(null);
  /** the ticket a Reconcile link asked for, lit until it has been seen */
  const [landed, setLanded] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<{ tickets: TicketFull[] }>("/api/tickets").then((r) => setTickets(r.tickets));
    api<{ flights: EnrichedSegment[] }>("/api/flights").then((r) => setFlights(r.flights));
    api<{ settings: { reporting_currency: string } }>("/api/settings").then((r) =>
      setCurrency(r.settings.reporting_currency)
    );
  }, []);
  useEffect(refresh, [refresh]);

  const unattached = useMemo(
    () => flights.filter((f) => !f.ticket_id),
    [flights]
  );

  /* Arriving from Reconcile as /tickets?ticket=<id>. That exception is about
     one ticket out of 146, so land on it — expanded, in view and briefly lit —
     rather than at the top of the list. Read from the URL directly rather than
     through useSearchParams, which would force this page out of static
     rendering for a query string only ever set by an internal link. Filters
     are reset because the target may sit outside the year the list opens on. */
  useEffect(() => {
    if (!tickets) return;
    const want = new URLSearchParams(window.location.search).get("ticket");
    if (!want || !tickets.some((t) => t.id === want)) return;
    setYear("all");
    setQ("");
    setOpen((prev) => new Set(prev).add(want));
    setLanded(want);
  }, [tickets]);

  /* Landing on a row is a race against the page, not a single action. The row
     may not be mounted on the commit that sets `landed` (the second fetch and
     the filter reset each re-render the list), and the router puts a fresh
     navigation back at the top AFTER our effects run — a one-shot scroll gets
     silently undone. So re-assert every frame until the row has held still in
     view, and give up on a deadline rather than looping forever. Instant, not
     smooth: a smooth scroll animates over frames and any reset cancels it.
     Timers rather than requestAnimationFrame, which is suspended entirely in a
     background tab — the landing would then depend on the window having focus. */
  useEffect(() => {
    if (!landed) return;
    let tries = 0;
    let settled = 0;
    let tick: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const box = document
        .querySelector<HTMLElement>(`[data-landing-id="${landed}"]`)
        ?.getBoundingClientRect();
      /* Anchor the row's TOP just below the header, not its middle: an
         expanded row is taller than the viewport, so centring it puts the
         header line — the part that identifies it — off the top of screen. */
      if (box) {
        const want = Math.max(0, window.scrollY + box.top - LANDING_OFFSET);
        if (Math.abs(window.scrollY - want) > 4) {
          window.scrollTo({ top: want });
          settled = 0;
        } else settled += 1;
      }
      if (settled < 3 && tries++ < 30) tick = setTimeout(attempt, 50);
    };
    attempt();
    const clear = setTimeout(() => setLanded(null), 2600);
    return () => {
      clearTimeout(tick);
      clearTimeout(clear);
    };
  }, [landed]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label = (t: TicketRow) =>
    [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") || "Untitled ticket";

  /** Coupons on this ticket that took a share of the fare. */
  const shareCount = (t: TicketFull) =>
    t.segments.filter((s) => t.allocation.perSegment[s.id]).length;

  const years = useMemo(() => {
    const ys = new Set(
      (tickets ?? []).map((t) => (t.issue_date ?? t.created_at ?? "").slice(0, 4)).filter(Boolean)
    );
    return [...ys].sort().reverse();
  }, [tickets]);

  /**
   * Filtering happens per GROUP, and a group survives if ANY member matches.
   * A chain is one purchase whose cost is shared across it, so showing half of
   * one would print a total against tickets that don't add up to it. ZZ0006's
   * members are issued a year apart, so "2025" would otherwise tear it in two.
   */
  const matchesFilters = useCallback(
    (members: TicketFull[]) => {
      if (
        year !== "all" &&
        !members.some((t) => (t.issue_date ?? t.created_at ?? "").startsWith(year))
      )
        return false;
      const needle = q.trim().toUpperCase();
      if (!needle) return true;
      return members.some((t) =>
        [
          t.confirmation_code,
          t.ticket_number,
          t.notes,
          ...t.segments.flatMap((s) => [s.origin, s.destination, s.flight_date]),
        ]
          .filter(Boolean)
          .some((v) => String(v).toUpperCase().includes(needle))
      );
    },
    [year, q]
  );

  /**
   * Tickets that belong together are shown together. The grouping key is the
   * reissue CHAIN wherever one exists — that's the authoritative link the cost
   * math already uses, and a reissue can be handed a new record locator — with
   * the confirmation code as the fallback that still catches tickets from one
   * booking that were never chain-linked. Everything else stays a lone row.
   */
  const groups = useMemo(() => {
    if (tickets == null) return null;
    const byKey = new Map<string, TicketFull[]>();
    const keyOf = (t: TicketFull) => {
      const chain = t.allocation.chain;
      if (chain) return `chain:${[...chain.ticketIds].sort().join(",")}`;
      if (t.confirmation_code) return `pnr:${t.confirmation_code.toUpperCase()}`;
      return `solo:${t.id}`;
    };
    for (const t of tickets) {
      const k = keyOf(t);
      byKey.set(k, [...(byKey.get(k) ?? []), t]);
    }
    return [...byKey.entries()]
      .map(([key, members]) => {
        // A member holding no coupons of its own is a shell: the money is on
        // it, the flights are on a sibling. Sorting purely by issue date put
        // that shell on top, so a group led with "no flights of its own" and
        // you had to look past it to find the itinerary. Flights first, shells
        // after; within each, newest issue date, matching the rest of the
        // page. The chain's own order is still spelled out inside each ticket
        // ("Issued against…" / "Value rolled into…").
        // A reissue is routinely written the same day as the ticket it
        // replaces — ZZ0012's two are both 2024-09-12 — so issue date alone
        // leaves the comparator returning 0 and the order falling out of
        // whatever sequence the rows arrived in. The chain already knows its
        // own sequence (`ticketIds` runs root first), so a tie resolves to
        // later-in-the-chain first, which is what "newest" means here.
        const chainIdx = new Map(
          (members.find((t) => t.allocation.chain)?.allocation.chain?.ticketIds ?? []).map(
            (id, i) => [id, i] as const
          )
        );
        const ordered = [...members].sort(
          (a, b) =>
            (a.segments.length === 0 ? 1 : 0) - (b.segments.length === 0 ? 1 : 0) ||
            (b.issue_date ?? "").localeCompare(a.issue_date ?? "") ||
            (chainIdx.get(b.id) ?? -1) - (chainIdx.get(a.id) ?? -1) ||
            (b.ticket_number ?? "").localeCompare(a.ticket_number ?? "")
        );
        const chain = ordered.find((t) => t.allocation.chain)?.allocation.chain;
        return {
          key,
          members: ordered,
          isChain: chain != null,
          confirmation: ordered.find((t) => t.confirmation_code)?.confirmation_code ?? null,
          // What the group actually flew. A reissue can leave the flights on
          // the ticket it replaced, so the member you can reimburse may show
          // none of its own — the header is where they always appear. Only
          // flown coupons: the header's own sentence says "the flights that
          // flew", and a chain carries every superseded itinerary too, which
          // together read as a jumble of routes nobody took.
          flownSegments: ordered.flatMap((t) => t.segments.filter(wasTaken)),
          // a chain divides its cash across every coupon it holds, wherever
          // those coupons sit among its members
          splitAcross: ordered.reduce(
            (n, t) => n + t.segments.filter((s) => t.allocation.perSegment[s.id]).length,
            0
          ),
          // a chain spent its cash once; unlinked tickets are separate purchases
          total: chain
            ? chain.cash
            : ordered.reduce((s, t) => s + t.allocation.personal_total, 0),
          // the page stays in issue-date order by the group's newest ticket
          sortDate: members.reduce((max, t) => (t.issue_date ?? "") > max ? (t.issue_date ?? "") : max, ""),
        };
      })
      .filter((g) => matchesFilters(g.members))
      .sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }, [tickets, matchesFilters]);

  /* Drop receipts anywhere on this page, not only inside the import dialog.
     Two things this has to get right:
      - dragenter/dragleave fire for every element the pointer crosses, so a
        plain boolean flickers as you move over the page. Depth counting is
        what makes the overlay stable.
      - a file dropped ANYWHERE the app doesn't handle makes the browser
        navigate to it, throwing away whatever you were doing. So the window
        swallows stray drops even when they miss. */
  /* the listeners are bound once, so they read "is the dialog open?" through a
     ref rather than closing over a stale value */
  const importOpen = useRef(false);
  useEffect(() => {
    importOpen.current = showImport;
  }, [showImport]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      // the dialog has its own drop zone; don't put an overlay over it
      if (!importOpen.current) setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // never let the browser open the file over the app
      depth = 0;
      setDragging(false);
      /* With the dialog open it owns the drop — handling it here too would
         run one drop through two handlers. Default is still prevented above,
         so a miss can't navigate away from a batch mid-review. */
      if (importOpen.current) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setDropped(files);
      setShowImport(true);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1100px]">
      {dragging && !showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,11,22,0.72)] p-8 backdrop-blur-[2px]">
          <div className="pointer-events-none flex flex-col items-center rounded-lg border border-dashed border-s-miles bg-[var(--tint-accent)] px-16 py-14 text-center">
            <MailOpen size={30} className="mb-3 text-s-miles" />
            <p className="t-display text-[20px] leading-none text-ink">
              Drop receipts to import
            </p>
            <p className="mt-2 text-[12.5px] text-mute">
              United, American, Alaska, Lufthansa, Amex Travel, Chase, ADTRAV and
              CWT emails saved as .eml — several at once is fine
            </p>
          </div>
        </div>
      )}
      <header className="reveal mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label mb-1 text-s-miles">Fares, adjustments & cost allocation</div>
          <h1 className="t-display text-[30px] leading-none text-ink">Tickets</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowImport(true)}>
            <MailOpen size={14} /> Import receipts
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New ticket
          </button>
        </div>
      </header>

      {/* Same bar as Flights — a 111-row list needs the same two controls, and
          learning one page's filters should carry to the other. */}
      {tickets != null && tickets.length > 12 && (
        <div className="reveal relative z-30 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              className="field !w-[240px] !py-1.5 !pl-8 text-[12.5px]"
              placeholder="Search code, eTicket, route…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="field !w-auto !py-1.5 text-[12.5px]"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="t-num text-[11.5px] text-mute">
            {(groups ?? []).reduce((n, g) => n + g.members.length, 0)} of {tickets.length} tickets
          </span>
          {(year !== "all" || q.trim()) && (
            <button
              className="btn btn-ghost !py-1.5 !text-[11.5px]"
              onClick={() => {
                setYear("all");
                setQ("");
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {tickets == null ? (
        <div className="t-label p-8">Loading…</div>
      ) : tickets.length === 0 ? (
        <Panel className="reveal">
          <EmptyState
            title="No tickets recorded"
            body="Create a ticket with the fare you paid and attach its flights — cost is allocated per segment for CPM."
            action={
              <button className="btn btn-primary" onClick={() => setShowNew(true)}>
                <Plus size={14} /> New ticket
              </button>
            }
          />
        </Panel>
      ) : (groups ?? []).length === 0 ? (
        /* Filtered down to nothing is not the same as owning no tickets: the
           first is undone by clearing the filter, and offering "New ticket"
           here would answer a question nobody asked. */
        <Panel className="reveal">
          <EmptyState
            title="No tickets match"
            body={`Nothing ${year === "all" ? "" : `issued in ${year} `}matches${q.trim() ? ` “${q.trim()}”` : ""}. Search covers confirmation codes, eTicket numbers and routes.`}
            action={
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setYear("all");
                  setQ("");
                }}
              >
                Clear filters
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="stagger space-y-3">
          {(groups ?? []).map((g) => (
            <Panel key={g.key} accent={C.gross}>
              {g.members.length > 1 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-[color-mix(in_oklab,var(--color-s-gross)_7%,transparent)] px-4 py-2.5">
                  <span className="t-num text-[13.5px] font-medium text-ink">
                    {g.confirmation ?? "Same booking"}
                  </span>
                  {g.flownSegments.length > 0 && (
                    <span className="t-num text-[13px] text-ink2">
                      <RouteLine legs={routeLegs(g.flownSegments)} max={3} />
                    </span>
                  )}
                  <span
                    className="chip !text-[9px]"
                    style={{
                      color: C.gross,
                      borderColor: `color-mix(in oklab, ${C.gross} 45%, transparent)`,
                      background: `color-mix(in oklab, ${C.gross} 10%, transparent)`,
                    }}
                  >
                    {g.isChain ? "Exchange chain" : "Same booking"}
                  </span>
                  <span className="text-[11.5px] text-mute">
                    {g.members.length} tickets ·{" "}
                    {g.isChain ? (
                      <>
                        <span className="text-ink2">{fmtMoney(g.total, currency)}</span> spent
                        in total, shared by the flights that flew — not once per ticket
                      </>
                    ) : (
                      <>
                        <span className="text-ink2">{fmtMoney(g.total, currency)}</span>{" "}
                        combined
                      </>
                    )}
                  </span>
                </div>
              )}
              {g.members.map((t) => (
                <div
                  key={t.id}
                  data-landing-id={t.id}
                  className={`border-b border-line last:border-b-0 transition-colors duration-500 ${
                    landed === t.id ? "bg-[var(--tint-accent)]" : ""
                  }`}
                >
                  <TicketHeaderRow
                    t={t}
                    currency={currency}
                    isOpen={open.has(t.id)}
                    inGroup={g.members.length > 1}
                    /* How many coupons the fare was actually divided between.
                       A chain splits across the whole chain, so its members all
                       report the chain-wide count; anything else answers for
                       itself. Below two, no division happened and naming the
                       method describes an event that never occurred. */
                    splitAcross={g.isChain ? g.splitAcross : shareCount(t)}
                    label={label}
                    onToggle={() => toggle(t.id)}
                    onEdit={() => setEditTicket(t)}
                  />
                  {open.has(t.id) && (
                    <TicketDetail
                      ticket={t}
                      currency={currency}
                      unattached={unattached}
                      onChanged={refresh}
                    />
                  )}
                </div>
              ))}
            </Panel>
          ))}
        </div>
      )}

      {(showNew || editTicket) && (
        <TicketForm
          ticket={editTicket}
          allTickets={tickets ?? []}
          unattached={unattached}
          reporting={currency}
          onClose={() => {
            setShowNew(false);
            setEditTicket(null);
          }}
          onSaved={refresh}
        />
      )}

      {showImport && (
        <ReceiptImportModal
          initialFiles={dropped ?? undefined}
          onClose={() => {
            setShowImport(false);
            setDropped(null);
          }}
          onApplied={refresh}
        />
      )}
    </div>
  );
}

/**
 * One ticket's summary row. Inside a group the shared confirmation code moves
 * to the group header, so the row shows only what distinguishes this ticket —
 * and a chain member reports what IT consumed, never the chain's total, which
 * would otherwise appear once per row and read as several purchases.
 */
function TicketHeaderRow({
  t,
  currency,
  isOpen,
  inGroup,
  splitAcross,
  label,
  onToggle,
  onEdit,
}: {
  t: TicketFull;
  currency: string;
  isOpen: boolean;
  inGroup: boolean;
  splitAcross: number;
  label: (t: TicketRow) => string;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const alloc = t.allocation;
  const ownPersonal = alloc.chain
    ? t.segments.reduce((sum, s) => sum + (alloc.perSegment[s.id]?.personal ?? 0), 0)
    : alloc.personal_total;
  // Inside a group the confirmation code is already on the group header, so
  // repeating it on every member is noise.
  const codes = inGroup
    ? (t.ticket_number ?? "")
    : [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ");
  const legs = routeLegs(t.segments);
  const flown = travelSpan(t.segments);
  return (
    <div
      className="flex cursor-pointer flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5"
      onClick={onToggle}
    >
      <ChevronDown
        size={15}
        className={`shrink-0 text-mute transition-transform ${isOpen ? "" : "-rotate-90"}`}
      />
      {/* Fixed, not content-sized: a variable-width identity block shifts every
          money column with it, and figures you cannot scan down a straight
          edge are figures you have to read one at a time. */}
      <div className="w-[300px] max-w-full shrink-0">
        <div className="t-num truncate text-[14.5px] font-medium text-ink">
          {legs.length > 0 ? (
            <RouteLine legs={legs} />
          ) : (
            <span className="text-mute">{label(t)}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-mute">
          {legs.length > 0 ? (
            <>
              {flown ?? t.issue_date ?? "—"}
              {codes && <span className="t-num ml-2">· {codes}</span>}
            </>
          ) : (
            // In a chain the flights are on a sibling ticket, not missing.
            <>issued {t.issue_date ?? "—"} · {inGroup ? "no flights of its own" : "no flights attached"}</>
          )}
        </div>
      </div>
      {/* Every ticket in the ledger is "active" — a chip repeating the default
          98 times is a legend, not information. It appears when the status is
          something you'd actually want to catch. */}
      {t.status !== "active" && <StatusChip status={t.status} />}
      <TicketStat
        label={alloc.chain ? `Face ${t.currency}` : `Gross ${t.currency}`}
        value={fmtMoney(t.gross_total, t.currency)}
        hint={
          alloc.chain
            ? "Face value — the amount printed on this ticket. A reissue is printed for the whole itinerary, including the value carried over from the ticket it replaced, so face values overlap and must never be added up. Use it to match this row against the receipt."
            : undefined
        }
      />
      {t.currency !== currency && (
        <TicketStat label={`= ${currency}`} value={fmtMoney(alloc.gross_reporting, currency)} />
      )}
      <TicketStat
        label={alloc.chain ? "This ticket" : "Personal"}
        value={fmtMoney(ownPersonal, currency)}
        hint={
          alloc.chain
            ? "This ticket's share of the money the chain actually cost — what its own flights consumed. These do add up, to the chain total above."
            : undefined
        }
      />
      {/* The method answers "how was the fare divided between the flights?".
          With one flight — 62 of 98 tickets here — nothing was divided, and
          "PQP-weighted" names a calculation that never ran. */}
      {splitAcross > 1 && (
        <span
          className="chip !text-[9.5px]"
          style={{
            color: "var(--color-ink2)",
            borderColor: "var(--color-line2)",
            background: "var(--color-well)",
          }}
          title={`The fare was split across ${splitAcross} flights using this rule.`}
        >
          {METHOD_LABELS[alloc.method]}
        </span>
      )}
      <button
        className="btn btn-ghost ml-auto !py-1.5"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        Edit
      </button>
    </div>
  );
}

function TicketStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-[84px]" title={hint}>
      <div className={`t-label !text-[9px] ${hint ? "cursor-help decoration-dotted underline-offset-4 hover:underline" : ""}`}>
        {label}
      </div>
      <div className="t-num mt-0.5 text-[13.5px] text-ink2">{value}</div>
    </div>
  );
}

/* ------------------------- expanded ticket detail ------------------------ */

function TicketDetail({
  ticket,
  currency,
  unattached,
  onChanged,
}: {
  ticket: TicketFull;
  currency: string;
  unattached: EnrichedSegment[];
  onChanged: () => void;
}) {
  const t = ticket;
  const alloc = t.allocation;
  const [attachId, setAttachId] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fareParts = [
    ["Base fare", t.base_fare],
    ["Surcharges", t.surcharges],
    ["Taxes & fees", t.taxes],
    ["Ancillary", t.ancillary_fees],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];

  const attach = async () => {
    if (!attachId) return;
    try {
      await api(`/api/flights/${attachId}`, {
        method: "PATCH",
        body: JSON.stringify({ ticket_id: t.id }),
      });
      setAttachId("");
      setShowAttach(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Attach failed");
    }
  };

  const detach = async (segId: string) => {
    try {
      await api(`/api/flights/${segId}`, {
        method: "PATCH",
        body: JSON.stringify({ ticket_id: null }),
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detach failed");
    }
  };

  return (
    <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
      <ErrorNote error={error} />

      {(t.predecessor_label || t.successor_label || t.residual_credit != null) && (
        <div className="rounded-md border border-line bg-well px-3.5 py-2">
          <h3 className="t-label mb-1 !text-[10px]">Exchange chain</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink2">
            {t.predecessor_label && (
              <span>
                Issued against{" "}
                <span className="t-num text-ink">{t.predecessor_label}</span>
              </span>
            )}
            {t.successor_label && (
              <span>
                Value rolled into{" "}
                <span className="t-num text-ink">{t.successor_label}</span>
              </span>
            )}
            {t.residual_credit != null && (
              <span className="text-mute">
                {fmtMoney(t.residual_credit, currency)} returned as credit
              </span>
            )}
            {alloc.chain && (
              <span className="text-mute">
                {fmtMoney(alloc.chain.cash, currency)} actual cash across{" "}
                {alloc.chain.ticketIds.length} tickets, shared by the flights that flew
              </span>
            )}
            {alloc.chain && alloc.chain.residualsInferred > 0 && (
              <span
                className="cursor-help text-mute decoration-dotted underline-offset-4 hover:underline"
                title="This reissue is cheaper than the ticket it replaced and the receipt prints no credit line, so the difference is treated as a future flight credit rather than money this trip spent. Enter an explicit residual credit on the ticket to override — including 0 if this fare really did forfeit it."
              >
                {fmtMoney(alloc.chain.residualsInferred, currency)} credit inferred from
                the cheaper reissue
              </span>
            )}
          </div>
        </div>
      )}

      {alloc.warnings.length > 0 && (
        <div className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[var(--tint-warning)] px-3 py-2">
          {alloc.warnings.map((w, i) => (
            <p key={i} className="text-[12px] text-[var(--ink-warning)]">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* fare + adjustments */}
        <div>
          <h3 className="t-label mb-2 !text-[10px]">Fare & adjustments</h3>
          <div className="rounded-md border border-line bg-well px-3.5 py-2.5">
            {/* The summary row leads with when the flights FLEW, since that is
                what you navigate by; the purchase date still matters when
                matching a receipt, so it lives here. */}
            <Row name="Issued" value={t.issue_date ?? "—"} muted={!t.issue_date} />
            {fareParts.length > 0 ? (
              fareParts.map(([name, v]) => (
                <Row key={name} name={name} value={fmtMoney(v, t.currency)} />
              ))
            ) : (
              <Row name="Fare detail" value="not itemized" muted />
            )}
            <Row name={`Gross total (${t.currency})`} value={fmtMoney(t.gross_total, t.currency)} strong />
            {t.currency !== currency && (
              <Row
                name={`× ${t.exchange_rate} → ${currency}`}
                value={fmtMoney(alloc.gross_reporting, currency)}
                muted
              />
            )}
            {/* Always rendered, "—" when nil. These used to appear only once
                something was recorded, so ticking Reimbursed inserted a row
                here and pushed every control below it — including the tick the
                pointer was still on — down by its height. A ledger whose rows
                come and go cannot be clicked accurately. */}
            <Row
              name="Refunds"
              value={
                alloc.refunds > 0 ? `− ${fmtMoney(alloc.refunds, currency)}` : "—"
              }
              muted={alloc.refunds === 0}
            />
            <Row
              name="Reimbursements & credits"
              value={
                alloc.other_adjustments > 0
                  ? `− ${fmtMoney(alloc.other_adjustments, currency)}`
                  : "—"
              }
              muted={alloc.other_adjustments === 0}
            />
            {/* For a chain member, personal_total is the WHOLE chain's cost —
                the same figure on every ticket in it. Showing it here as this
                ticket's "Personal cost" contradicted the row above and read as
                personal > gross; the chain total belongs in the panel above. */}
            <Row
              name={alloc.chain ? "This ticket's share" : "Personal cost"}
              value={fmtMoney(
                alloc.chain
                  ? t.segments.reduce(
                      (sum, s) => sum + (alloc.perSegment[s.id]?.personal ?? 0),
                      0
                    )
                  : alloc.personal_total,
                currency
              )}
              strong
            />
          </div>

          <PaymentEditor ticket={t} currency={currency} onChanged={onChanged} />
          <AdjustmentEditor ticket={t} currency={currency} onChanged={onChanged} />
        </div>

        {/* allocation */}
        <div>
          <h3 className="t-label mb-2 !text-[10px]">
            Cost allocation — {METHOD_LABELS[alloc.method]}
          </h3>
          {t.segments.length === 0 ? (
            <p className="rounded-md border border-dashed border-line2 px-3 py-4 text-[12.5px] text-mute">
              No flights attached yet — attach below and each segment gets its share
              of the fare (manual → PQP → distance → equal).
            </p>
          ) : (
            <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Flight</th>
                  <th className="!text-right">PQP</th>
                  <th className="!text-right">Dist</th>
                  <th className="!text-right">Gross share</th>
                  <th className="!text-right">Personal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {t.segments.map((s) => {
                  const share = alloc.perSegment[s.id];
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="t-num text-ink2">{s.flight_date}</span>
                        <span className="t-num ml-2 text-ink">
                          {s.origin}→{s.destination}
                        </span>
                        {share?.method === "manual" && (
                          <span className="ml-1.5 text-[9.5px] uppercase tracking-wider text-s-gross">
                            manual
                          </span>
                        )}
                      </td>
                      <td className="num text-ink2">{s.pqp != null ? fmtInt(s.pqp) : "—"}</td>
                      <td className="num text-ink2">
                        {s.distance_miles != null ? fmtInt(s.distance_miles) : "?"}
                      </td>
                      <td className="num">{fmtMoney(share?.gross ?? 0, currency)}</td>
                      <td className="num">{fmtMoney(share?.personal ?? 0, currency)}</td>
                      <td className="w-8 !py-1 text-right">
                        <button
                          className="rounded p-1 text-mute transition-colors hover:bg-[var(--tint-critical)] hover:text-[var(--ink-critical)]"
                          title="Detach from ticket"
                          onClick={() => detach(s.id)}
                        >
                          <Link2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}

          {/* Only an empty ticket needs a prompt; otherwise attaching more is an
              optional action, not a missing piece. */}
          {t.segments.length === 0 || showAttach ? (
            <div className="mt-2.5 flex items-center gap-2">
              <select
                className="field !py-1.5 text-[12.5px]"
                value={attachId}
                onChange={(e) => setAttachId(e.target.value)}
                autoFocus={showAttach}
              >
                <option value="">Choose a flight…</option>
                {unattached.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.flight_date} · {f.origin}→{f.destination} {f.marketing_carrier}
                    {f.flight_number ?? ""}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost !py-1.5" onClick={attach} disabled={!attachId}>
                Attach
              </button>
              {t.segments.length > 0 && (
                <button
                  className="text-[11.5px] text-mute transition-colors hover:text-ink2"
                  onClick={() => {
                    setShowAttach(false);
                    setAttachId("");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <button
              className="mt-2 text-[11.5px] text-mute transition-colors hover:text-s-miles"
              onClick={() => setShowAttach(true)}
            >
              + Attach another flight
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  name,
  value,
  strong,
  muted,
}: {
  name: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between py-1 ${
        strong ? "border-t border-line font-medium text-ink" : muted ? "text-mute" : "text-ink2"
      }`}
    >
      <span className="text-[12.5px]">{name}</span>
      <span className="t-num text-[13px]">{value}</span>
    </div>
  );
}

/* ---------------------------- payments editor ---------------------------- */

function PaymentEditor({
  ticket,
  currency,
  onChanged,
}: {
  ticket: TicketFull;
  currency: string;
  onChanged: () => void;
}) {
  const [type, setType] = useState("card");
  const [amount, setAmount] = useState("");
  const [miles, setMiles] = useState("");
  const [reference, setReference] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Miles fund miles, not the cash side of an award ticket — counting a miles
     payment as $0 of cash made every award ticket read as fully unfunded. The
     cash total reconciles against the cash methods only. */
  const cashPayments = ticket.payments.filter((p) => p.payment_type !== "miles");
  const known = cashPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const unknownCount = cashPayments.filter((p) => p.amount == null).length;
  const target = ticket.allocation.gross_reporting;
  const gap = Math.round((target - known) * 100) / 100;
  // only meaningful once every payment carries an amount
  const reconciles =
    cashPayments.length > 0 && unknownCount === 0 && Math.abs(gap) <= 0.011;

  const add = async () => {
    setError(null);
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          ticket_id: ticket.id,
          payment_type: type,
          amount: amount === "" ? null : amount,
          award_miles_used: miles === "" ? null : miles,
          currency,
          reference: reference || null,
        }),
      });
      setAmount("");
      setMiles("");
      setReference("");
      setAdding(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/payments/${id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="mt-3">
      <h3 className="t-label mb-1.5 !text-[10px]">Paid with</h3>
      <ErrorNote error={error} />
      {ticket.payments.length === 0 ? (
        <p className="text-[11.5px] text-mute">
          Not recorded — add it to check the ticket against its funding sources.
        </p>
      ) : (
        <ul>
          {ticket.payments.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-1.5 last:border-0"
            >
              <span className="text-[12px] text-ink2">
                {PAYMENT_TYPE_LABELS[p.payment_type] ?? p.payment_type}
              </span>
              {p.reference && (
                <span className="max-w-[150px] truncate text-[11px] text-mute">
                  {p.reference}
                </span>
              )}
              <span className="t-num ml-auto text-[12.5px] text-ink">
                {p.award_miles_used != null
                  ? `${fmtInt(p.award_miles_used)} mi`
                  : ""}
                {p.award_miles_used != null && p.amount != null ? " + " : ""}
                {p.amount != null ? fmtMoney(p.amount, p.currency || currency) : ""}
                {p.amount == null && p.award_miles_used == null && (
                  <span className="text-mute">amount not stated</span>
                )}
              </span>
              <button
                className="rounded p-1 text-mute transition-colors hover:bg-[var(--tint-critical)] hover:text-[var(--ink-critical)]"
                onClick={() => remove(p.id)}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {ticket.payments.length > 0 && (target > 0 || cashPayments.length > 0) && (
        <p className="mt-1 text-[11px]">
          {reconciles ? (
            <span className="text-[var(--ink-good)]">
              ✓ funding matches the ticket total
            </span>
          ) : unknownCount > 0 ? (
            <span className="text-mute">
              {unknownCount} payment{unknownCount === 1 ? "" : "s"} without a stated
              amount — can’t reconcile against the total
            </span>
          ) : cashPayments.length === 0 ? (
            <span className="text-[var(--ink-warning)]">
              ⚠ only miles recorded — nothing on file covers the{" "}
              {fmtMoney(target, currency)} of taxes and fees
            </span>
          ) : (
            <span className="text-[var(--ink-warning)]">
              ⚠ funding is {fmtMoney(Math.abs(gap), currency)}{" "}
              {gap > 0 ? "short of" : "over"} the {fmtMoney(target, currency)} total
            </span>
          )}
        </p>
      )}

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="field !w-auto !py-1.5 text-[12px]"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            className="field t-num !w-[100px] !py-1.5 text-[12px]"
            placeholder={`Amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {type === "miles" && (
            <input
              className="field t-num !w-[110px] !py-1.5 text-[12px]"
              placeholder="Miles used"
              inputMode="numeric"
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
            />
          )}
          <input
            className="field !w-[130px] !py-1.5 text-[12px]"
            placeholder="Reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <button
            className="btn btn-ghost !py-1.5"
            onClick={add}
            disabled={amount === "" && miles === ""}
          >
            Add
          </button>
          <button
            className="text-[11.5px] text-mute hover:text-ink2"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="mt-1.5 text-[11.5px] text-mute transition-colors hover:text-s-miles"
          onClick={() => setAdding(true)}
        >
          + Add payment
        </button>
      )}
    </div>
  );
}

/* --------------------------- adjustments editor -------------------------- */

function AdjustmentEditor({
  ticket,
  currency,
  onChanged,
}: {
  ticket: TicketFull;
  currency: string;
  onChanged: () => void;
}) {
  const [type, setType] = useState("reimbursement");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [payer, setPayer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* "In full" means the whole reimbursable cost — gross less any refund — NOT
     what is left after reimbursing it. `personal_total` erodes to 0 the moment
     a reimbursement lands, so using it made the ticket offer to reimburse
     "$0.00" of itself the instant it was ticked. */
  const fullAmount = ticket.allocation.gross_allocable;
  const reimbursements = ticket.adjustments.filter((a) => a.type === "reimbursement");
  const reimbursed = reimbursements.length > 0;
  const reimbursedSoFar = reimbursements.reduce((a, r) => a + r.amount, 0);
  const inFull = Math.abs(reimbursedSoFar - fullAmount) <= 0.011;

  /* A chain spends its cash once, so it can only be reimbursed once. Every
     member reports the same chain total, so offering the control on each of
     them invites recording that total two or three times over. It belongs on
     the ticket the value ended up in — the last of the chain (`ticketIds` runs
     root first). */
  const chain = ticket.allocation.chain;
  const finalInChain = chain ? chain.ticketIds[chain.ticketIds.length - 1] : null;
  const supersededMember = finalInChain != null && finalInChain !== ticket.id;

  /* Ticking the box records the reimbursement with no payer and no date, and
     these fields are the only place to add them — so when exactly one
     reimbursement exists they EDIT it. They used to post a new row, which was
     invisible until you pressed Add and got a second $461.53 against the same
     ticket. The pre-filled full amount made the form look like an edit of the
     row above it; now it is one. Two or more reimbursements (a split payment)
     are ambiguous, so those fall back to adding. */
  const editing =
    type === "reimbursement" && reimbursements.length === 1 ? reimbursements[0] : null;

  /* The amount starts at the whole cost rather than empty: a partial is the
     rare case, and starting from the full figure makes it an edit instead of a
     lookup. The percentage beside it says what the edit came to. */
  useEffect(() => {
    setAmount(
      editing ? editing.amount.toFixed(2) : fullAmount ? fullAmount.toFixed(2) : ""
    );
    setDate(editing?.effective_date ?? "");
    setPayer(editing?.payer ?? "");
  }, [fullAmount, editing?.id, editing?.amount, editing?.effective_date, editing?.payer]);
  const share = (() => {
    const n = Number(amount);
    if (!fullAmount || !isFinite(n) || amount.trim() === "") return null;
    return Math.round((n / fullAmount) * 100);
  })();

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/adjustments", { method: "POST", body: JSON.stringify(body) });
      setPayer("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  /** ticking the box: work paid for all of it, today, no further questions */
  const reimburse = () =>
    post({ ticket_id: ticket.id, type: "reimbursement", amount: fullAmount });

  /** unticking says it wasn't reimbursed after all — so the rows that said it
   *  was have to go. They stay listed above until then, so nothing vanishes
   *  without having been visible. */
  const unreimburse = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const a of reimbursements) {
        await api(`/api/adjustments/${a.id}`, { method: "DELETE" });
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`/api/adjustments/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            amount,
            effective_date: date || null,
            payer: payer || null,
          }),
        });
      } else {
        await api("/api/adjustments", {
          method: "POST",
          body: JSON.stringify({
            ticket_id: ticket.id,
            type,
            amount,
            effective_date: date || null,
            payer: payer || null,
          }),
        });
        setPayer("");
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  /* Nothing typed yet that differs from what is stored — the button would be a
     no-op, so it says so by being unavailable rather than by doing nothing. */
  const dirty = editing
    ? amount !== editing.amount.toFixed(2) ||
      (date || null) !== editing.effective_date ||
      (payer || null) !== editing.payer
    : true;

  const remove = async (id: string) => {
    try {
      await api(`/api/adjustments/${id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* On a superseded member none of this can ever be used, and its own
     "Value rolled into …" line already says where it went — so rather than
     showing a permanently dead form, show nothing. Anything already recorded
     against it still lists, so no data hides. */
  if (supersededMember && ticket.adjustments.length === 0) return null;

  return (
    <div className="mt-3">
      <ErrorNote error={error} />
      {/* The common case is "work paid for all of this", so it's one tick — and
          the tick says which amount it means, in every state. */}
      {supersededMember ? null : (
      <>
      {/* Order matters here: the tick and the Add button sit ABOVE the list of
          what's recorded, so adding a row grows the panel downwards and neither
          control moves out from under the pointer that just clicked it. */}
      <label className="flex cursor-pointer items-center gap-2 py-1">
        <input
          type="checkbox"
          className="accent-[var(--color-s-miles)]"
          checked={reimbursed}
          disabled={busy}
          onChange={(e) => (e.target.checked ? reimburse() : unreimburse())}
        />
        <span className="text-[12.5px] text-ink2">Reimbursed</span>
        {reimbursed && !inFull && (
          <span className="t-num text-[11.5px] text-mute">
            {fmtMoney(reimbursedSoFar, currency)} of {fmtMoney(fullAmount, currency)}
          </span>
        )}
      </label>

      {/* Inert until the box is ticked: an active form under "not reimbursed"
          invites you to contradict the line above it. Real `disabled`, not just
          dimming, so it is skipped by tab and by a screen reader too. */}
      <div
        className={`mt-3 border-t border-line pt-2.5 transition-opacity ${
          reimbursed ? "" : "opacity-40"
        }`}
      >
        <div className="t-label mb-2 !text-[9px] text-mute">
          {editing ? "Edit reimbursement" : "Add adjustment"}
        </div>
        {/* This panel is ~460px wide, which five controls in a row cannot share
            — they wrapped into a ragged pile. Two deliberate columns instead. */}
        <div className="grid grid-cols-2 gap-2">
          <select
            className="field !py-1.5 text-[12px]"
            value={type}
            disabled={!reimbursed}
            onChange={(e) => setType(e.target.value)}
          >
            {ADJUSTMENT_CHOICES.map((v) => (
              <option key={v} value={v}>
                {ADJUSTMENT_LABELS[v]}
              </option>
            ))}
          </select>
          <div className="relative">
            <input
              className="field t-num !py-1.5 pr-11 text-[12px]"
              inputMode="decimal"
              value={amount}
              disabled={!reimbursed}
              onChange={(e) => setAmount(e.target.value)}
            />
            {share != null && (
              <span className="t-num pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-mute">
                {share}%
              </span>
            )}
          </div>
          <input
            type="date"
            className="field t-num !py-1.5 text-[12px]"
            value={date}
            disabled={!reimbursed}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="field !py-1.5 text-[12px]"
            placeholder="Payer"
            value={payer}
            disabled={!reimbursed}
            onChange={(e) => setPayer(e.target.value)}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            className="btn btn-ghost !py-1.5"
            onClick={save}
            disabled={busy || !reimbursed || !dirty}
          >
            {editing ? "Save" : <><Plus size={12} /> Add</>}
          </button>
        </div>
      </div>
      {ticket.adjustments.length > 0 && (
        <ul className="mt-3 border-t border-line pt-2">
          {ticket.adjustments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-1.5 last:border-0"
            >
              <span className="text-[12px] text-ink2">{ADJUSTMENT_LABELS[a.type]}</span>
              {a.payer && <span className="text-[11px] text-mute">{a.payer}</span>}
              <span className="t-num ml-auto text-[12.5px] text-ink">
                − {fmtMoney(a.amount, currency)}
              </span>
              <span className="t-num text-[11px] text-mute">{a.effective_date ?? ""}</span>
              <button
                className="rounded p-1 text-mute transition-colors hover:bg-[var(--tint-critical)] hover:text-[var(--ink-critical)]"
                onClick={() => remove(a.id)}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-mute">
        Refunds reduce gross &amp; personal cost; reimbursements reduce personal only.
      </p>
      </>
      )}
    </div>
  );
}

/* ------------------------------ ticket form ------------------------------ */

function TicketForm({
  ticket,
  allTickets,
  unattached,
  reporting,
  onClose,
  onSaved,
}: {
  ticket: TicketFull | null;
  allTickets: TicketFull[];
  unattached: EnrichedSegment[];
  reporting: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  /* Several at once, because a ticket almost never buys one leg. The detail
     panel attaches one flight to a ticket that already exists; this is the
     other half — the flights were logged first and the receipt arrived later,
     which is the order that produced 31% of flown miles carrying no cost. */
  const [attach, setAttach] = useState<Set<string>>(new Set());
  const [attachQuery, setAttachQuery] = useState("");
  const [f, setF] = useState({
    confirmation_code: ticket?.confirmation_code ?? "",
    ticket_number: ticket?.ticket_number ?? "",
    issuing_carrier: ticket?.issuing_carrier ?? "UA",
    issue_date: ticket?.issue_date ?? todayStr(),
    currency: ticket?.currency ?? "USD",
    exchange_rate: ticket ? String(ticket.exchange_rate) : "1",
    base_fare: ticket ? String(ticket.base_fare || "") : "",
    surcharges: ticket ? String(ticket.surcharges || "") : "",
    taxes: ticket ? String(ticket.taxes || "") : "",
    ancillary_fees: ticket ? String(ticket.ancillary_fees || "") : "",
    gross_total: ticket ? String(ticket.gross_total || "") : "",
    payment_method: ticket?.payment_method ?? "",
    status: ticket?.status ?? "active",
    predecessor_ticket_id: ticket?.predecessor_ticket_id ?? "",
    residual_credit: ticket?.residual_credit != null ? String(ticket.residual_credit) : "",
    notes: ticket?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const partsSum = useMemo(() => {
    const n = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
    return (
      Math.round(
        (n(f.base_fare) + n(f.surcharges) + n(f.taxes) + n(f.ancillary_fees)) * 100
      ) / 100
    );
  }, [f.base_fare, f.surcharges, f.taxes, f.ancillary_fees]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const nn = (s: string) => (s.trim() === "" ? null : s.trim());
    const num = (s: string) => (s.trim() === "" ? 0 : s.trim());
    const payload = {
      confirmation_code: nn(f.confirmation_code),
      ticket_number: nn(f.ticket_number),
      issuing_carrier: nn(f.issuing_carrier),
      issue_date: nn(f.issue_date),
      currency: f.currency.trim().toUpperCase() || "USD",
      exchange_rate: f.exchange_rate.trim() === "" ? 1 : f.exchange_rate.trim(),
      base_fare: num(f.base_fare),
      surcharges: num(f.surcharges),
      taxes: num(f.taxes),
      ancillary_fees: num(f.ancillary_fees),
      gross_total: num(f.gross_total),
      payment_method: nn(f.payment_method),
      status: f.status,
      predecessor_ticket_id: nn(f.predecessor_ticket_id),
      residual_credit: nn(f.residual_credit),
      notes: nn(f.notes),
    };
    try {
      if (ticket) {
        await api(`/api/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        const created = await api<{ id: string }>(`/api/tickets`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        /* Sequential, and the ticket already exists by now: a flight that
           fails to attach leaves a real ticket with fewer flights on it,
           which the ledger can show and you can fix. Attaching first and
           creating after could strand flights against nothing. */
        for (const id of attach) {
          await api(`/api/flights/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ ticket_id: created.id }),
          });
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await api(`/api/tickets/${ticket!.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Modal
      title={ticket ? "Edit ticket" : "New ticket"}
      subtitle="Record what you actually paid; flights attach to it for allocation"
      onClose={onClose}
      wide
    >
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
        <Field label="Confirmation" className="col-span-1">
          <input
            className="field t-num uppercase"
            value={f.confirmation_code}
            placeholder="ABC123"
            autoFocus={!ticket}
            onChange={(e) => set("confirmation_code", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Ticket number" className="col-span-2 sm:col-span-1">
          <input
            className="field t-num"
            value={f.ticket_number}
            placeholder="016 2345678901"
            onChange={(e) => set("ticket_number", e.target.value)}
          />
        </Field>
        <Field label="Issued by">
          <input
            className="field uppercase"
            maxLength={3}
            value={f.issuing_carrier}
            onChange={(e) => set("issuing_carrier", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Issue date">
          <input
            type="date"
            className="field t-num"
            value={f.issue_date}
            onChange={(e) => set("issue_date", e.target.value)}
          />
        </Field>

        <Field label="Status">
          <select className="field" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="exchanged">Exchanged</option>
            <option value="refunded">Refunded</option>
            <option value="voided">Voided</option>
          </select>
        </Field>
        <Field label="Payment method">
          <input
            className="field"
            value={f.payment_method}
            placeholder="Visa …6411"
            onChange={(e) => set("payment_method", e.target.value)}
          />
        </Field>

        <Field
          label="Exchange of"
          className="col-span-2"
          hint="The ticket whose value funded this one"
        >
          <select
            className="field"
            value={f.predecessor_ticket_id}
            onChange={(e) => set("predecessor_ticket_id", e.target.value)}
          >
            <option value="">Not an exchange</option>
            {allTickets
              .filter((x) => x.id !== ticket?.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {[x.confirmation_code, x.ticket_number].filter(Boolean).join(" · ") ||
                    "(untitled)"}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Residual credit" hint="Value returned when issued">
          <input
            className="field t-num"
            inputMode="decimal"
            value={f.residual_credit}
            onChange={(e) => set("residual_credit", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-well p-3.5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="t-label !text-[10px]">Fare breakdown</span>
          <span className="text-[11px] text-mute">
            Optional detail — the gross total is what counts
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {(
            [
              ["base_fare", "Base fare"],
              ["surcharges", "Surcharges"],
              ["taxes", "Taxes & fees"],
              ["ancillary_fees", "Ancillary"],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                className="field t-num"
                inputMode="decimal"
                value={f[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-3">
          <Field label={`Gross total (${f.currency || "USD"})`} className="w-44">
            <input
              className="field t-num"
              inputMode="decimal"
              value={f.gross_total}
              onChange={(e) => set("gross_total", e.target.value)}
            />
          </Field>
          {partsSum > 0 && Number(f.gross_total || 0) !== partsSum && (
            <button
              className="btn btn-ghost mb-0.5 !py-1.5 !text-[11px]"
              onClick={() => set("gross_total", String(partsSum))}
            >
              Use sum {fmtMoney(partsSum, f.currency || "USD")}
            </button>
          )}
          <div className="ml-auto flex gap-3">
            <Field label="Currency" className="w-20">
              <input
                className="field t-num uppercase"
                maxLength={3}
                value={f.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
              />
            </Field>
            {/* Name the actual pair. "Rate → reporting" made you decode two
                abstractions to find out it wanted EUR → USD. Compared against
                the reporting currency, not a hardcoded USD — otherwise
                switching the ledger to EUR would hide the field on exactly the
                tickets that then need it. */}
            {f.currency !== reporting && (
              <Field label={`${f.currency || "???"} → ${reporting}`} className="w-28">
                <input
                  className="field t-num"
                  inputMode="decimal"
                  value={f.exchange_rate}
                  onChange={(e) => set("exchange_rate", e.target.value)}
                  title={`How many ${reporting} one ${f.currency || "unit"} was worth on the issue date.`}
                />
              </Field>
            )}
          </div>
        </div>
      </div>

      {/* Create only. On an existing ticket the detail panel already attaches
          flights, and two controls for one act is one too many. */}
      {!ticket && (
        <div className="mt-4">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="t-label !text-[9px]">
              Attach flights{attach.size > 0 && ` · ${attach.size} selected`}
            </span>
            {unattached.length > 6 && (
              <input
                className="field !w-[170px] !py-1 text-[11.5px]"
                placeholder="Filter by route or date"
                value={attachQuery}
                onChange={(e) => setAttachQuery(e.target.value)}
              />
            )}
          </div>
          {unattached.length === 0 ? (
            <p className="text-[12px] text-mute">
              Every flight already has a ticket. Log flights first and they will be
              offered here.
            </p>
          ) : (
            <div className="max-h-[170px] overflow-y-auto rounded-md border border-line">
              {unattached
                .filter((seg) => {
                  const q = attachQuery.trim().toUpperCase();
                  if (!q) return true;
                  return [
                    seg.flight_date,
                    seg.origin,
                    seg.destination,
                    `${seg.marketing_carrier}${seg.flight_number ?? ""}`,
                  ].some((v) => String(v).toUpperCase().includes(q));
                })
                .map((seg) => {
                  const on = attach.has(seg.id);
                  return (
                    <label
                      key={seg.id}
                      className={`flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 text-[12px] transition-colors last:border-b-0 ${
                        on ? "bg-[var(--tint-accent-weak)] text-ink" : "text-ink2"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--color-s-miles)]"
                        checked={on}
                        onChange={() =>
                          setAttach((prev) => {
                            const next = new Set(prev);
                            if (next.has(seg.id)) next.delete(seg.id);
                            else next.add(seg.id);
                            return next;
                          })
                        }
                      />
                      <span className="t-num">{seg.flight_date}</span>
                      <span className="t-num">
                        {seg.origin}→{seg.destination}
                      </span>
                      <span className="text-mute">
                        {seg.marketing_carrier}
                        {seg.flight_number ?? ""}
                      </span>
                      {seg.distance_miles != null && (
                        <span className="t-num ml-auto text-[11px] text-mute">
                          {fmtInt(seg.distance_miles)} mi
                        </span>
                      )}
                    </label>
                  );
                })}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <Field label="Notes">
          <input className="field" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {ticket && (
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save ticket"}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          message={`Delete this ticket?`}
          detail="Its adjustments are removed; attached flights lose their cost allocation but stay in the ledger."
          onConfirm={del}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
