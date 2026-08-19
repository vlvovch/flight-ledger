"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, MoveRight } from "lucide-react";
import AirportInput from "./AirportInput";
import { Confirm, ErrorNote, Field, Modal } from "./ui";
import Link from "next/link";
import { api, fmtInt, fmtMoney, todayStr } from "@/lib/format";
import {
  fleetRegistryReady,
  loadFleetRegistry,
  typeForTail,
  type LearnedFleet,
} from "@/lib/fleet";
import { expectsMileagePlusCredit } from "@/lib/types";
import type { EnrichedSegment, SegmentRow, TicketRow } from "@/lib/types";

/* Roughly cheapest first — a picker's order, not a ranking. It used to claim a
   ranking, and that claim is false on United: "First" here is the domestic
   narrowbody front cabin, a recliner, while Polaris — recorded as Business —
   is the lie-flat long-haul cabin above it. This ledger holds a SFO-BUR First
   and a SFO-KIX Business, and they are not one rung apart.

   No order survives the other airlines either. Lufthansa First sits above
   Lufthansa Business, the exact inverse, and most carriers have no First at
   all. These are the airline's own marketing words, kept as the document wrote
   them.

   Grouping is fine — summarizeFareClasses groups on exactly these labels. What
   nothing should attempt is a RANK. An earlier version of this comment sent
   anyone wanting one to the IATA cabin tier off the booking class; that was
   wrong, and this ledger is the counterexample: PZ carries nine domestic First
   segments AND a Polaris Business one, so the class does not separate the two
   products either. The airline files them that way, so no normalization
   recovers an order that was never in the data.

   Basic Economy is its own entry rather than a fare within Economy: it earns
   differently and can't be changed, which is exactly what a cost-per-mile
   ledger wants to tell apart. */
const CABINS = ["", "Basic Economy", "Economy", "Premium Plus", "Business", "First"];
const STATUSES = [
  ["ticketed", "Ticketed"],
  ["flown_unreconciled", "Flown (unreconciled)"],
  ["flown_reconciled", "Flown (reconciled)"],
  ["canceled", "Canceled"],
  ["missed", "Missed"],
] as const;

type FormState = {
  origin: string;
  destination: string;
  flight_date: string;
  departure_time: string;
  arrival_time: string;
  marketing_carrier: string;
  flight_number: string;
  operating_carrier: string;
  cabin: string;
  booking_class: string;
  seat: string;
  aircraft: string;
  tail_number: string;
  status: string;
  purpose: string;
  ticket_id: string;
  pqp: string;
  pqf: string;
  award_miles: string;
  lifetime_miles: string;
  credits_mileageplus: string;
  manual_cost: string;
  notes: string;
};

function toForm(seg?: EnrichedSegment | SegmentRow | null): FormState {
  return {
    origin: seg?.origin ?? "",
    destination: seg?.destination ?? "",
    flight_date: seg?.flight_date ?? todayStr(),
    departure_time: seg?.departure_time ?? "",
    arrival_time: seg?.arrival_time ?? "",
    marketing_carrier: seg?.marketing_carrier ?? "UA",
    flight_number: seg?.flight_number ?? "",
    operating_carrier: seg?.operating_carrier ?? "",
    cabin: seg?.cabin ?? "",
    booking_class: seg?.booking_class ?? "",
    seat: seg?.seat ?? "",
    aircraft: seg?.aircraft ?? "",
    tail_number: seg?.tail_number ?? "",
    status: seg?.status ?? "ticketed",
    purpose: seg?.purpose ?? "",
    ticket_id: seg?.ticket_id ?? "",
    pqp: seg?.pqp != null ? String(seg.pqp) : "",
    pqf: seg?.pqf != null ? String(seg.pqf) : "",
    award_miles: seg?.award_miles != null ? String(seg.award_miles) : "",
    lifetime_miles: seg?.lifetime_miles != null ? String(seg.lifetime_miles) : "",
    credits_mileageplus:
      seg?.credits_mileageplus != null ? String(seg.credits_mileageplus) : "",
    manual_cost: seg?.manual_cost != null ? String(seg.manual_cost) : "",
    notes: seg?.notes ?? "",
  };
}

/** null when blank so PATCH clears fields; numbers pass through as strings for the API to coerce */
function toPayload(f: FormState) {
  const nn = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    origin: f.origin,
    destination: f.destination,
    flight_date: f.flight_date,
    departure_time: nn(f.departure_time),
    arrival_time: nn(f.arrival_time),
    marketing_carrier: nn(f.marketing_carrier) ?? "UA",
    flight_number: nn(f.flight_number),
    operating_carrier: nn(f.operating_carrier),
    cabin: nn(f.cabin),
    booking_class: nn(f.booking_class),
    seat: nn(f.seat),
    aircraft: nn(f.aircraft),
    tail_number: nn(f.tail_number),
    status: f.status,
    purpose: nn(f.purpose),
    ticket_id: nn(f.ticket_id),
    pqp: nn(f.pqp),
    pqf: nn(f.pqf),
    award_miles: nn(f.award_miles),
    lifetime_miles: nn(f.lifetime_miles),
    credits_mileageplus: nn(f.credits_mileageplus),
    manual_cost: nn(f.manual_cost),
    notes: nn(f.notes),
  };
}

export default function FlightForm({
  segment,
  defaults,
  tickets,
  currency = "USD",
  fleet,
  onClose,
  onSaved,
}: {
  segment?: EnrichedSegment | null; // editing when set
  defaults?: Partial<FormState>; // for "add another"
  tickets: TicketRow[];
  /** reporting currency — allocated costs are already converted into it */
  currency?: string;
  /** what your own flights have said each tail was, and when (lib/fleet) */
  fleet?: LearnedFleet;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...toForm(segment), ...defaults });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /* Did THIS form fill the aircraft box, or did a person type it? An
     existing flight counts as autofilled when its aircraft is exactly what
     the registry would say for its tail and date — otherwise editing the
     tail of a saved flight would keep the old aeroplane's name forever. */
  const [autofilled, setAutofilled] = useState(
    () =>
      !!segment?.tail_number &&
      !!segment?.aircraft &&
      segment.aircraft ===
        typeForTail(segment.tail_number, { date: segment.flight_date })
  );

  /* The FAA registry is ~1.3 MB and most sessions never type a tail, so it
     is fetched on demand rather than shipped in the first load. Ask for it
     when this form opens; the state flip re-renders the hint once it lands. */
  const [registryReady, setRegistryReady] = useState(fleetRegistryReady);
  useEffect(() => {
    if (registryReady) return;
    let alive = true;
    void loadFleetRegistry().then(() => alive && setRegistryReady(true));
    return () => {
      alive = false;
    };
  }, [registryReady]);

/* That test ran before the registry existed in memory, so a saved flight
     whose aeroplane WAS derived looked hand-typed — and changing its tail
     would then keep the old model forever. Re-judge once the registry
     lands, and only in the direction that admits a value was derived. */
  useEffect(() => {
    if (!registryReady || autofilled || !segment?.tail_number || !segment?.aircraft)
      return;
    if (
      segment.aircraft ===
      typeForTail(segment.tail_number, { date: segment.flight_date })
    )
      setAutofilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryReady]);

  /* A registration answers differently for different dates — the same mark
     can be a DC-10 in 2005 and an A321 today — so moving the flight's date
     re-asks the question. Only a box this form filled is rewritten; a
     hand-typed aeroplane is never touched. */
  useEffect(() => {
    if (!form.tail_number) return;
    const known = typeForTail(form.tail_number, {
      date: form.flight_date || undefined,
      learned: fleet,
    });
    /* Decide OUTSIDE the updater. React may run an updater later, or more
       than once, so a flag set inside it and read on the next line is a
       guess — and that guess left filled boxes marked as hand-typed.
       `form` is this render's state, which is exactly what we need. */
    const mayWrite = form.aircraft.trim() === "" || autofilled;
    if (!mayWrite) return;
    /* No answer for this date is itself an answer: moving a flight into a
       period where the mark wore nothing must CLEAR the old aeroplane,
       not leave last year's model sitting under the new date. */
    const next = known ?? "";
    if (form.aircraft !== next) setForm((f) => ({ ...f, aircraft: next }));
    setAutofilled(known != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.flight_date, registryReady]);

  const [distance, setDistance] = useState<number | null>(
    segment?.distance_miles ?? null
  );

  const set = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) =>
      setForm((f) => ({ ...f, [k]: v })),
    []
  );

  // live great-circle preview once both endpoints look like codes
  useEffect(() => {
    const { origin, destination } = form;
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      setDistance(null);
      return;
    }
    let stale = false;
    api<{ distance: number | null }>(
      `/api/airports?from=${origin}&to=${destination}`
    )
      .then((r) => !stale && setDistance(r.distance))
      .catch(() => !stale && setDistance(null));
    return () => {
      stale = true;
    };
  }, [form.origin, form.destination]); // eslint-disable-line react-hooks/exhaustive-deps

  const flightDatePast = form.flight_date <= todayStr();
  // default status follows the date for new entries
  useEffect(() => {
    if (segment) return;
    set("status", flightDatePast ? "flown_unreconciled" : "ticketed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightDatePast, segment]);

  const save = async (addAnother: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (segment) {
        await api(`/api/flights/${segment.id}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(form)),
        });
      } else {
        await api(`/api/flights`, {
          method: "POST",
          body: JSON.stringify(toPayload(form)),
        });
      }
      onSaved();
      if (addAnother) {
        setForm((f) => ({
          ...toForm(null),
          flight_date: f.flight_date,
          marketing_carrier: f.marketing_carrier,
          ticket_id: f.ticket_id,
          purpose: f.purpose,
          cabin: f.cabin,
          status: f.status,
          // chain: previous destination becomes next origin
          origin: f.destination,
        }));
        setDistance(null);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await api(`/api/flights/${segment!.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const ticketLabel = (t: TicketRow) =>
    [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") ||
    "(untitled ticket)";

  /* What the app would decide on its own — shown as the checkbox's position
     while the field is still on automatic, so the tick always reflects what is
     actually believed rather than an arbitrary default. */
  const creditsInferred = useMemo(
    () =>
      expectsMileagePlusCredit({
        credits_mileageplus: null,
        issuing_carrier:
          segment && "issuing_carrier" in segment ? segment.issuing_carrier : null,
        ticket_id: form.ticket_id || null,
        ticket_is_award:
          segment && "ticket_is_award" in segment ? segment.ticket_is_award : false,
        operating_carrier: form.operating_carrier || null,
        marketing_carrier: form.marketing_carrier || "UA",
      }),
    [segment, form.ticket_id, form.operating_carrier, form.marketing_carrier]
  );

  /* What the MileagePlus tick currently says — the user's answer if they gave
     one, else the inference. Nothing in this panel should suggest a figure for
     a flight that credits somewhere else: MileagePlus posts nothing for it, so
     "≈ 1 PQF" is not a hint, it's a wrong guess. */
  const creditsMileagePlus =
    form.credits_mileageplus === ""
      ? creditsInferred
      : form.credits_mileageplus === "1";
  const noneExpected = !creditsMileagePlus;

  const postedAny = useMemo(
    () =>
      [form.pqp, form.pqf, form.award_miles, form.lifetime_miles].some(
        (v) => v.trim() !== ""
      ),
    [form.pqp, form.pqf, form.award_miles, form.lifetime_miles]
  );

  return (
    <Modal
      title={segment ? "Edit flight" : "Log flight"}
      subtitle={
        segment
          ? `${segment.origin} → ${segment.destination} · ${segment.flight_date}`
          : "One nonstop segment per entry"
      }
      onClose={onClose}
      wide
    >
      <ErrorNote error={error} />

      {/* route strip */}
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3 rounded-lg border border-line bg-well p-3.5">
        <Field label="From">
          <AirportInput
            value={form.origin}
            onChange={(v) => set("origin", v)}
            autoFocus={!segment}
          />
        </Field>
        <MoveRight className="mb-2.5 text-mute" size={18} />
        <Field label="To">
          <AirportInput
            value={form.destination}
            onChange={(v) => set("destination", v)}
            placeholder="SFO"
          />
        </Field>
        <div className="mb-0.5 min-w-[92px] text-right">
          <div className="t-label !text-[9.5px]">Distance</div>
          <div className="t-num text-[17px] text-s-miles">
            {distance != null ? `${fmtInt(distance)} mi` : "— mi"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
        <Field label="Date" className="col-span-2 sm:col-span-1">
          <input
            type="date"
            className="field t-num"
            value={form.flight_date}
            onChange={(e) => set("flight_date", e.target.value)}
          />
        </Field>
        <Field label={flightDatePast ? "Departed" : "Departs"}>
          <input
            type="time"
            className="field t-num"
            value={form.departure_time}
            onChange={(e) => set("departure_time", e.target.value)}
          />
        </Field>
        <Field label={flightDatePast ? "Arrived" : "Arrives"}>
          <input
            type="time"
            className="field t-num"
            value={form.arrival_time}
            onChange={(e) => set("arrival_time", e.target.value)}
          />
        </Field>
        <Field label="Status">
          <select
            className="field"
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          >
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Airline">
          <input
            className="field uppercase"
            value={form.marketing_carrier}
            maxLength={3}
            onChange={(e) => set("marketing_carrier", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Flight #">
          <input
            className="field t-num"
            value={form.flight_number}
            placeholder="1949"
            onChange={(e) => set("flight_number", e.target.value)}
          />
        </Field>
        <Field label="Operated by" hint="If different (e.g. NH)">
          <input
            className="field uppercase"
            value={form.operating_carrier}
            maxLength={3}
            onChange={(e) => set("operating_carrier", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Purpose">
          <select
            className="field"
            value={form.purpose}
            onChange={(e) => set("purpose", e.target.value)}
          >
            <option value="">Infer from ticket</option>
            <option value="business">Business</option>
            <option value="personal">Personal</option>
          </select>
        </Field>

        <Field label="Cabin">
          <select
            className="field"
            value={form.cabin}
            onChange={(e) => set("cabin", e.target.value)}
          >
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {c || "—"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fare class">
          <input
            className="field uppercase"
            value={form.booking_class}
            maxLength={2}
            placeholder="K"
            onChange={(e) => set("booking_class", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Seat">
          <input
            className="field uppercase"
            value={form.seat}
            placeholder="21F"
            onChange={(e) => set("seat", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Tail number">
          <input
            className="field uppercase"
            value={form.tail_number}
            placeholder="N27901"
            onChange={(e) => {
              const tail = e.target.value.toUpperCase();
              // (the same derivation runs on a date change — see the effect)
              /* Every keystroke is a lookup, and a half-typed tail can be a
                 real one: "N129H" is a DC-3 on the way to "N129HQ", an E175.
                 So a value this field filled itself is replaceable — only a
                 type you typed by hand is protected. */
              const known = typeForTail(tail, {
                date: form.flight_date || undefined,
                learned: fleet,
              });
              /* Only claim the box when we actually write it. Marking it
                 "autofilled" merely because the lookup succeeded meant a
                 hand-typed aeroplane survived one keystroke and was then
                 silently replaced on the next. */
              const mayWrite = form.aircraft.trim() === "" || autofilled;
              setForm((f) => ({
                ...f,
                tail_number: tail,
                aircraft: mayWrite ? (known ?? "") : f.aircraft,
              }));
              if (mayWrite) setAutofilled(known != null);
            }}
          />
        </Field>
        <Field label="Aircraft" className="col-span-2">
          <input
            className="field"
            value={form.aircraft}
            placeholder="B737-900"
            onChange={(e) => {
              setAutofilled(false); // typed by hand: no lookup may overwrite it
              set("aircraft", e.target.value);
            }}
          />
          <p className="mt-1 text-[11px] text-mute">
            {((): string => {
              void registryReady; // re-read once the registry is in memory
              const known = form.tail_number
                ? typeForTail(form.tail_number, {
                    date: form.flight_date || undefined,
                    learned: fleet,
                  })
                : null;
              return known
                ? `${form.tail_number.toUpperCase()} was a ${known} on this date.`
                : "Filled from the tail number — the FAA registry, or your own earlier flights.";
            })()}
          </p>
        </Field>

        <Field label="Ticket" className="col-span-2 sm:col-span-4">
          <div className="flex items-center gap-2 sm:max-w-[calc(50%-0.5rem)]">
            <select
              className="field min-w-0 flex-1"
              value={form.ticket_id}
              onChange={(e) => set("ticket_id", e.target.value)}
            >
              <option value="">No ticket (or set manual cost)</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {ticketLabel(t)}
                </option>
              ))}
            </select>
            {form.ticket_id && (
              <Link
                href={`/tickets?ticket=${form.ticket_id}`}
                className="btn btn-ghost shrink-0 !px-2.5"
                title="Open this ticket — fares, payments and adjustments"
              >
                Open <ExternalLink size={12} />
              </Link>
            )}
          </div>
          {/* What this flight costs, said as a sentence. The ticket says what
              the TRIP cost; a leg's own share is computed by allocation, and
              a pinned extra (an upgrade bought for this flight) is already
              inside that figure — a bare "$495.36" can't explain the $299
              sitting in it. Shown only while the selection still matches
              what was allocated: changing the dropdown re-costs the flight
              on save, and stale numbers under a changed picker would lie. */}
          {segment && form.ticket_id === (segment.ticket_id ?? "") && (
            <p className="mt-1.5 text-[11.5px] text-mute">
              {segment.allocation_method === "none"
                ? "No cost is allocated to this flight yet."
                : (() => {
                    const money = (n: number) => fmtMoney(n, currency);
                    const extras = segment.pinned_extras;
                    const extrasTotal = extras.reduce((a, x) => a + x.amount, 0);
                    const parts = [`${money(segment.gross_cost)} of this ticket`];
                    if (extras.length > 0)
                      parts.push(
                        `: ${money(segment.gross_cost - extrasTotal)} fare share plus ${extras
                          .map((x) => `${money(x.amount)} for the ${x.label.toLowerCase()}`)
                          .join(" and ")}`
                      );
                    if (segment.award_miles_spent != null)
                      parts.push(`, plus ${fmtInt(segment.award_miles_spent)} miles`);
                    const yours =
                      segment.personal_cost === segment.gross_cost
                        ? ""
                        : segment.personal_cost === 0
                          ? " Reimbursed in full."
                          : ` ${money(segment.personal_cost)} of that is personal cost.`;
                    return `${parts.join("")}.${yours}`;
                  })()}
            </p>
          )}
        </Field>
      </div>

      {/* MileagePlus posted values */}
      <div className="mt-4 rounded-lg border border-line bg-well p-3.5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="t-label !text-[10px]">MileagePlus posted values</span>
          <span className="text-[11px] text-mute">
            {/* Not "credited elsewhere" — that implies a choice, and on a
                Delta flight MileagePlus was never on offer. Just the fact. */}
            {noneExpected
              ? "Earns no MileagePlus credit"
              : postedAny
                ? "United-posted figures — these override estimates"
                : "Blank = not posted yet; lifetime miles assume ≈ distance until then (enter 0 if none earned)"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[1fr_.5fr_1fr_1fr_auto] sm:items-end">
          <Field label="PQP">
            <input
              className="field t-num"
              inputMode="decimal"
              placeholder={
                noneExpected
                  ? "—"
                  : segment?.projected_pqp != null
                    ? `≈ ${segment.projected_pqp}`
                    : ""
              }
              value={form.pqp}
              onChange={(e) => set("pqp", e.target.value)}
            />
          </Field>
          <Field label="PQF">
            <input
              className="field t-num"
              inputMode="decimal"
              placeholder={
                noneExpected
                  ? "—"
                  : segment?.projected_pqf != null
                    ? `≈ ${segment.projected_pqf}`
                    : "1"
              }
              value={form.pqf}
              onChange={(e) => set("pqf", e.target.value)}
            />
          </Field>
          <Field label="Award miles">
            <input
              className="field t-num"
              inputMode="numeric"
              placeholder={
                noneExpected
                  ? "—"
                  : segment?.projected_award_miles != null
                    ? `≈ ${segment.projected_award_miles}`
                    : ""
              }
              value={form.award_miles}
              onChange={(e) => set("award_miles", e.target.value)}
            />
          </Field>
          <Field label="Lifetime miles">
            <input
              className="field t-num"
              inputMode="numeric"
              placeholder={
                noneExpected
                  ? "—"
                  : distance != null &&
                      (form.status === "flown_unreconciled" ||
                        form.status === "flown_reconciled")
                    ? form.award_miles.trim() === "0"
                      ? "≈ 0 (award)"
                      : (form.operating_carrier || form.marketing_carrier || "UA") === "UA"
                        ? `≈ ${Math.round(distance)}`
                        : "≈ 0 (non-UA)"
                    : ""
              }
              value={form.lifetime_miles}
              onChange={(e) => set("lifetime_miles", e.target.value)}
            />
          </Field>
          {/* A tick, not a three-way select: the only question is whether this
              flight credited to MileagePlus. Left alone it stays on the
              inferred answer (stored NULL, so it keeps following the ticket and
              carrier); touching it pins the user's own answer. */}
          <label
            className="flex cursor-pointer items-center gap-2 whitespace-nowrap pb-2"
            title={
              form.credits_mileageplus === ""
                ? `Worked out from the ticket and carrier: ${creditsInferred ? "credits to MileagePlus" : "credits elsewhere"}. Tick or untick to set it yourself.`
                : "Set by you — clear the flight's other postings to revert to automatic"
            }
          >
            <input
              type="checkbox"
              className="accent-[var(--color-s-miles)]"
              checked={
                form.credits_mileageplus === ""
                  ? creditsInferred
                  : form.credits_mileageplus === "1"
              }
              onChange={(e) => set("credits_mileageplus", e.target.checked ? "1" : "0")}
            />
            <span className="t-label !text-[10px]">MileagePlus</span>
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field
          label="Manual cost override"
          hint="Reporting currency. Overrides this segment's share of the ticket."
        >
          <input
            className="field t-num"
            inputMode="decimal"
            /* The placeholder shows the share being overridden — you can't
               judge an override against a number you can't see. Only while
               no override is saved: once one is in effect, gross_cost IS the
               override, and presenting it as "auto" would be circular. */
            placeholder={
              segment &&
              segment.manual_cost == null &&
              segment.allocation_method !== "none"
                ? `Auto from ticket — ${fmtMoney(segment.gross_cost, currency)}`
                : "Auto from ticket"
            }
            value={form.manual_cost}
            onChange={(e) => set("manual_cost", e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <input
            className="field"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {segment && (
          <button
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            Delete
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {!segment && (
            <button className="btn btn-ghost" onClick={() => save(true)} disabled={busy}>
              Save + add leg
            </button>
          )}
          <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? "Saving…" : "Save flight"}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          message={`Delete flight ${segment!.origin} → ${segment!.destination} on ${segment!.flight_date}?`}
          detail="This cannot be undone."
          onConfirm={del}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
