/**
 * United email parsing: extracts ticket + itinerary data from the two formats
 * the airline sends (2026 layouts, fixtures in fixtures/):
 *  - "eTicket Itinerary and Receipt for Confirmation XXXXXX" (Receipts@) —
 *    full fare breakdown, ticket number, per-segment class/times/seats.
 *  - "Your United Airlines booking confirmation – XXXXXX" (notifications@) —
 *    fare/taxes/total, itinerary; sent before ticketing.
 *
 * Deliberately NOT extracted: the "MileagePlus Accrual Details" table — those
 * are pre-flight projections; posted PQP/award miles come only from the
 * activity CSV import (design doc §1.3: authoritative data wins).
 *
 * Pure functions over the flattened email text (see eml.ts); every value the
 * parser couldn't find stays null and is surfaced as a warning, never guessed.
 */
import { ParsedEml, htmlToText } from "./eml";
import { CREDIT_PAYMENT_TYPES, PaymentType } from "./types";

/** Recognize a funding method from the words United prints for it. */
function classifyPayment(text: string): PaymentType {
  const s = text.toLowerCase();
  // a Miscellaneous Document (MCO) on a reissue IS the prior ticket's residual
  // value carried forward — the same thing United elsewhere calls a credit
  if (/future flight credit|previous ticket balance|ffc|miscellaneous document|mco\b/.test(s))
    return "future_flight_credit";
  if (/travel certificate|electronic travel cert|etc\b/.test(s))
    return "travel_certificate";
  if (/travelbank/.test(s)) return "travelbank";
  if (/gift card/.test(s)) return "gift_card";
  // United writes the programme both ways — "MileagePlus XXXXX999" on one
  // receipt, "Mileage Plus XXXXX999" on another — and the spaced form was
  // falling through to "other", so an award ticket's own miles didn't read as
  // miles
  if (/mileage\s*plus|miles/.test(s)) return "miles";
  if (/visa|master|amex|american express|discover|card ending|ending in/.test(s))
    return "card";
  if (/cash|check/.test(s)) return "cash";
  return "other";
}

export interface ReceiptSegment {
  carrier: string;
  /** who actually flies it, when the document says — a codeshare's marketing
   *  carrier tells you nothing about which airline's metal you are on */
  operating_carrier?: string | null;
  flight_number: string;
  origin: string;
  destination: string;
  flight_date: string; // YYYY-MM-DD (departure)
  departure_time: string | null; // HH:MM
  arrival_time: string | null;
  cabin: string | null; // Economy | Premium Plus | Business | First
  booking_class: string | null; // T, L, XN …
  seat: string | null;
  /** booking-time projections from the "MileagePlus Accrual Details" table —
   *  planning data for not-yet-flown segments, never posted values */
  projected_pqp: number | null;
  projected_pqf: number | null;
  projected_award_miles: number | null;
}

export interface ParsedReceipt {
  kind:
    | "eticket_receipt"
    | "booking_confirmation"
    | "chase_travel"
    | "adtrav"
    | "ctp"
    | "aa_receipt"
    | "delta_receipt"
    | "azul"
    | "latam"
    | "sas"
    | "wizz"
    | "southwest"
    | "kiwi"
    | "capital_one"
    | "lufthansa"
    | "cwt"
    | "alaska"
    | "amex_travel"
    | "change_notice"
    | "cancellation"
    | "ancillary_receipt"
    | "ancillary_refund"
    | "schema_markup";
  confirmation: string | null;
  ticket_number: string | null;
  /** the airline that issued the ticket — not every receipt here is United's */
  issuing_carrier: string;
  issue_date: string | null;
  /** when the email itself was sent — distinct from `issue_date`, which is the
   *  ticket's purchase date. A receipt re-sent later (or a cancellation notice,
   *  which reprints the original purchase summary) carries an old issue_date
   *  and a current send date; the send date is what dates the *event*. */
  email_date: string | null;
  currency: string;
  base_fare: number | null; // in `currency` (the receipt's total currency)
  /** Fare as printed in the currency of sale, when the ticket was issued
   *  abroad and the receipt also shows an "Equivalent Airfare". United omits
   *  the currency code on that line, so only the amount is captured. */
  local_fare: number | null;
  surcharges: number | null;
  taxes: number | null;
  /** agency service fees and the like — money the trip cost that isn't fare or
   *  tax. The tickets table has always had the column; only the parsers were
   *  missing it, so a CTP service fee had nowhere to land. */
  ancillary_fees: number | null;
  gross_total: number | null; // cash price of the ticket (award: the cash part)
  miles_redeemed: number | null; // award tickets
  payment_method: string | null;
  /** structured funding sources (design doc §8.6); amount is null when the
   *  receipt names a method without splitting the total across methods */
  payments: {
    payment_type: PaymentType;
    amount: number | null;
    award_miles_used: number | null;
    reference: string | null;
  }[];
  /** ticket whose residual value was applied here (exchange/reissue) */
  previous_ticket_number: string | null;
  /** value returned as a fresh credit when this ticket was issued */
  residual_credit: number | null;
  /** United's running future-flight-credit balance after this transaction.
   *  An account fact, not a ticket fact — it may include credit from other
   *  cancelled tickets entirely, so it never funds the chain arithmetic. */
  credit_balance: number | null;
  /** new money collected on a reissue, beyond the credit carried forward */
  additional_collection: number | null;
  /** change notices only: what the booking was worth BEFORE this change.
   *  Printed as "Original trip", and the arithmetic that validates the credit. */
  original_trip_total: number | null;
  /** change notices only: the change fee, 0 when United prints "No fee" */
  change_fee: number | null;
  /**
   * The programme the traveller credited this ticket to, as its 2-letter code,
   * from "Frequent Flyer: UA-XXXXX999" / "LH-XXXXXXXXXXXX777". This is the only
   * place a document ever states it outright — a United ticket credited to
   * Miles & More looks United in every other respect, so nothing else can tell.
   */
  frequent_flyer_program: string | null;
  /** extras bought after ticketing (an upgrade, a paid seat), each on its own
   *  EMD — the reference is what makes re-importing the same receipt inert */
  ancillary_items?: { label: string; reference: string | null; amount: number }[];
  travelers: number;
  /** traveler names as printed (LAST/FIRST), when the document shows them */
  traveler_names?: string[];
  /** traveler → eTicket pairs, in printed order, when the document states
   *  them; lets the import prefer the ledger owner's ticket over whoever the
   *  airline happened to alphabetize first */
  traveler_tickets?: { name: string; ticket_number: string }[];
  segments: ReceiptSegment[];
  warnings: string[];
}

/* ------------------------------- helpers ------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Fri, Jul 10, 2026" | "Jul 11, 2026" | "July 11, 2026" → 2026-07-10 */
function parseLongDate(s: string): string | null {
  const m = s.match(/([A-Z][a-z]{2,8})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

/** "07:35 PM" → "19:35"; "3:00 PM" → "15:00" */
function parse12h(t: string, ampm: string): string {
  const [h, min] = t.split(":").map(Number);
  let hh = h % 12;
  if (/pm/i.test(ampm)) hh += 12;
  return `${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const num = (s: string) => Number(s.replace(/,/g, ""));

/**
 * Some receipts print a flight date with no year at all ("Mon, Apr 11").
 * Resolve it against the email's own date: the first candidate year that
 * doesn't put the flight before the booking that produced it.
 */
function resolveYear(month: number, day: number, emailDate: string | null): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const base = Number((emailDate ?? "").slice(0, 4)) || new Date().getUTCFullYear();
  for (const y of [base, base + 1]) {
    const candidate = `${y}-${mm}-${dd}`;
    if (!emailDate || candidate >= emailDate) return candidate;
  }
  return `${base}-${mm}-${dd}`;
}

/** Ticket-number prefix → the airline whose stock it is issued on. */
function carrierFromTicket(ticket: string | null): string | null {
  const stock: Record<string, string> = {
    "001": "AA", "005": "CO", "006": "DL", "012": "NW", "016": "UA",
    "027": "AS", "037": "US", "125": "BA", "172": "SN", "220": "LH",
    "230": "OS", "232": "LX", "235": "TK", "057": "AF", "074": "KL",
  };
  const k = (ticket ?? "").replace(/[\s-]/g, "").slice(0, 3);
  return stock[k] ?? null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeCabin(raw: string): string | null {
  const s = raw.toLowerCase();
  if (s.includes("polaris") || s.includes("business") || s.includes("delta one"))
    return "Business";
  if (s.includes("premium plus") || s.includes("premium select")) return "Premium Plus";
  if (s.includes("first")) return "First";
  /* Before the plain economy test, which "basic economy" also satisfies —
     matching economy first would quietly file every basic fare as Economy and
     erase the distinction at the point of import. */
  if (s.includes("basic economy") || /\bbasic\b/.test(s)) return "Basic Economy";
  if (s.includes("premium economy")) return "Premium Plus";
  if (s.includes("economy")) return "Economy";
  /* Delta's economy brands: "Delta Main Classic (U)", "Delta Comfort+ (W)" —
     Comfort+ is an extra-legroom economy seat, not a cabin of its own. */
  if (s.includes("delta main") || s.includes("main cabin") || s.includes("comfort"))
    return "Economy";
  return null;
}

/* --------------------------- format detection --------------------------- */

/** The email's own send date, normalized. */
function emlDate(eml: ParsedEml): string | null {
  return eml.date
    ? parseLongDate(
        // "Mon, 6 Apr 2026 12:00:00" and "6 Apr 2026 12:00:00" both occur
        eml.date.replace(/^(?:\w{3},\s*)?(\d{1,2})\s+(\w{3})\s+(\d{4}).*/, "$2 $1, $3")
      )
    : null;
}

function parseByTextFormat(eml: ParsedEml): ParsedReceipt | null {
  const flat = eml.html ? htmlToText(eml.html) : (eml.text ?? "");
  if (!flat.trim()) return null;
  const lines = flat.split("\n").map((l) => l.trim());
  const emailDate = emlDate(eml);

  /* "Thanks for your purchase with United" — an extras receipt (upgrade,
     seat), NOT a ticket. Tested before everything else because its "Flight 1
     of 1" line would otherwise trip the eTicket detector and the $299 would
     masquerade as the ticket's fare. The SUBJECT is the test (also read out
     of a forwarded header block): the tempting body phrase "A receipt of your
     purchase is shown below" is boilerplate the eTicket receipt shares. */
  if (
    /Thanks for your purchase with United/i.test(eml.subject ?? "") ||
    // pre-2022 subject for the very same receipt layout
    /Receipt for Ancillary Purchase with United/i.test(eml.subject ?? "") ||
    lines.some((l) =>
      /^Subject:\s*(?:Thanks for your purchase|Receipt for Ancillary Purchase) with United/i.test(l)
    )
  ) {
    return parseUnitedPurchase(lines, emailDate);
  }
  /* "Your United purchase is being refunded" — the same layout again, but the
     money came BACK. It must never look like a purchase (an extras row would
     charge the refund as a cost), let alone a ticket. */
  if (
    /Your United purchase is being refunded/i.test(eml.subject ?? "") ||
    lines.some((l) => /^Your purchase was refunded\b/i.test(l))
  ) {
    return parseUnitedPurchase(lines, emailDate, true);
  }
  /* "Your flight cancellation is complete" — from notifications@united.com,
     a different pipeline than receipts@: it prints NO itinerary, only the
     confirmation and the fact of cancellation (and, on award bookings, the
     miles redeposit). It cancels the booking's future, not listed legs. */
  if (
    /Your flight cancellation is complete/i.test(eml.subject ?? "") ||
    lines.some((l) => /Your reservation,?\s*[A-Z0-9]{6}\s*,? was canceled/i.test(l))
  ) {
    return parseCancellationComplete(lines, emailDate);
  }
  /* "You've successfully canceled your reservation (EFXPYF)" — receipts@
     sends this one in the full eTicket layout, itinerary and all, so before
     it was recognised it imported as a BOOKING: it created the very flights
     it was announcing the end of, and they went on to look flown.
     It reprints the cancelled itinerary, but its scope is the word in its
     own subject — the reservation — and a re-accommodated booking holds
     older legs under the same code that died with it (a nonstop re-routed
     via a hub keeps the confirmation and changes the ticket). So the legs
     are dropped and the notice is left naming the booking, which cancels
     everything under it that had not yet departed. */
  if (
    /successfully cancell?ed your reservation/i.test(eml.subject ?? "") ||
    lines.some((l) => /^We've processed your cancellation\b/i.test(l))
  ) {
    const parsed = parseEticketReceipt(lines, emailDate);
    parsed.kind = "cancellation";
    parsed.segments = [];
    return parsed;
  }
  // Cancellations reuse the receipt layout, so this test must come first.
  if (
    /has been canceled|has been cancelled/i.test(eml.subject ?? "") ||
    lines.some((l) => /^Your reservation has been cancel/i.test(l))
  ) {
    const parsed = parseEticketReceipt(lines, emailDate);
    parsed.kind = "cancellation";
    return parsed;
  }
  if (
    /@(?:[\w.-]+\.)?mytrips\.americanexpress\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /booking with American Express Travel/i.test(l))
  ) {
    return parseAmexTravel(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?alaskaair\.com/i.test(eml.from ?? "") ||
    /* post-merger, the same document arrives from hawaiianairlines.com in
       Hawaiian dress — Alaska ticket stock, Alaska layout bones */
    /@(?:[\w.-]+\.)?hawaiianairlines\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^Summary of airfare charges$/i.test(l))
  ) {
    return parseAlaska(lines, emailDate, eml.subject ?? "");
  }
  if (
    /@(?:[\w.-]+\.)?mycwt\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^CWT TRIP LOCATOR:/i.test(l))
  ) {
    return parseCwt(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?lufthansa\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^Lufthansa booking code:?$/i.test(l))
  ) {
    return parseLufthansa(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?aa\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^Your trip confirmation and receipt$/i.test(l))
  ) {
    return parseAaReceipt(lines, emailDate);
  }
  /* The sender domain alone is NOT the test: Delta's confirmation emails come
     from the same address, carry no charges, and should fall through to the
     schema.org markup fallback. Only the receipt layout belongs here. */
  if (
    /^Your Flight Receipt/i.test(eml.subject ?? "") ||
    (/@(?:[\w.-]+\.)?delta\.com/i.test(eml.from ?? "") &&
      lines.some((l) => /^TICKET AMOUNT$/.test(l)))
  ) {
    return parseDelta(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?voeazul[\w.-]*\.com\.br/i.test(eml.from ?? "") ||
    /^Reserva [A-Z0-9]{6} realizada com sucesso/i.test(eml.subject ?? "")
  ) {
    return parseAzul(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?latam\.com/i.test(eml.from ?? "") ||
    (lines.some((l) => /^Código de reserva:?$/i.test(l)) &&
      lines.some((l) => /LATAM/.test(l)))
  ) {
    return parseLatam(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?flysas\.com/i.test(eml.from ?? "") ||
    lines.some(
      (l) =>
        /^Bokningsreferens:/i.test(l) ||
        /^This is your Electronic Ticket Itinerary and Receipt\.?$/i.test(l)
    )
  ) {
    return parseSas(lines, emailDate, eml.attachments.length);
  }
  /* Wizz and Kiwi arrive forwarded, so their detectors read the original
     sender out of the forwarded header block in the BODY — the envelope From
     is whoever forwarded it. */
  if (
    /@(?:[\w.-]+\.)?wizzair\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /@(?:[\w.-]+\.)?wizzair\.com/i.test(l))
  ) {
    return parseWizz(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?kiwi\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /tickets@kiwi\.com/i.test(l))
  ) {
    return parseKiwi(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?capitalonebooking\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^Here are your Capital One Travel and airline confirmation codes/i.test(l))
  ) {
    return parseCapitalOne(lines, emailDate);
  }
  if (
    /@(?:[\w.-]+\.)?southwest\.com/i.test(eml.from ?? "") ||
    (lines.some((l) => /^Confirmation #\s*[A-Z0-9]{6}$/i.test(l)) &&
      lines.some((l) => /Southwest Airlines/i.test(l)))
  ) {
    return parseSouthwest(lines, emailDate);
  }
  /* "…is processing" is the interim notice for a CHANGE, and it reuses none of
     the receipt layout — test it before the itinerary formats below. */
  if (
    /reservation for .* is processing/i.test(eml.subject ?? "") ||
    lines.some((l) => /^We.re processing your reservation/i.test(l))
  ) {
    return parseChangeNotice(lines, emailDate);
  }
  if (/eTicket Itinerary and Receipt/i.test(eml.subject ?? "") || lines.some((l) => /^Flight \d+ of \d+/.test(l))) {
    return parseEticketReceipt(lines, emailDate);
  }
  if (/booking confirmation/i.test(eml.subject ?? "") || lines.some((l) => /United confirmation number/i.test(l))) {
    return parseBookingConfirmation(lines, emailDate);
  }
  if (
    /adtrav\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^RezID:/i.test(l) || /ADTRAV Travel Management/i.test(l))
  ) {
    return parseAdtrav(lines, emailDate);
  }
  if (
    /ctptravelservices\.com/i.test(eml.from ?? "") ||
    lines.some((l) => /^Collegiate Travel Planners$/i.test(l))
  ) {
    return parseCtp(lines, emailDate);
  }
  if (
    /chasetravel\.com/i.test(eml.from ?? "") ||
    /Travel Reservation Center/i.test(eml.subject ?? "") ||
    lines.some((l) => /choosing Chase Travel/i.test(l))
  ) {
    return parseChaseTravel(lines, emailDate);
  }
  return null;
}

/** "DOE/JANE", "DOE/JANE MS" — the LAST/FIRST pax lines most documents
 *  print. Whose travel a receipt records is a fact worth carrying: bookings
 *  made for someone else are not this ledger's flights. */
function collectTravelerNames(lines: string[]): string[] {
  const names = new Set<string>();
  for (const l of lines) {
    const m = l.match(
      /^([A-Z]+(?: [A-Z]+)*\/[A-Z]+(?: [A-Z]+)*?)(?:\s+(?:MR|MRS|MS|DR))?$/
    );
    if (m) names.add(m[1]);
    if (names.size >= 9) break;
  }
  return [...names];
}

export function parseUnitedEmail(eml: ParsedEml): ParsedReceipt | null {
  const parsed = parseByTextFormat(eml);
  if (parsed && parsed.traveler_names == null) {
    const flat = eml.html ? htmlToText(eml.html) : (eml.text ?? "");
    parsed.traveler_names = collectTravelerNames(
      flat.split("\n").map((l) => l.trim())
    );
  }
  /* The markup is read whether or not a text format matched.

     No match: it becomes the document — the airline's own embedded schema.org
     FlightReservation block (the Gmail/Outlook email-markup standard), which
     carries the itinerary but never the money. Last in line deliberately, so
     every text format above, which can read fares, gets first claim. This is
     what lets an airline nobody wrote a parser for still land its flights.

     Match: it becomes a WITNESS. The airline has now stated the itinerary
     twice in one email — once as text for people, once as data for machines —
     and if the two disagree, either their template drifted or our parser did.
     Both are worth a warning, neither is worth a block: the text parser stays
     authoritative, because it is the one that reads money. */
  const markup = parseSchemaMarkup(eml, emlDate(eml));
  if (!parsed) return markup;
  /* A quoted or forwarded copy ("Re: Fwd: eTicket Itinerary and Receipt…")
     carries the boilerplate that trips the eTicket detector, but the quoting
     mangles every line the parser reads. A parse that found NOTHING — no
     confirmation, no ticket number, no money, no flights — is a husk, not a
     document: creating an empty ticket from it helps nobody. The markup, if
     any survived the forwarding, is still worth reading. */
  if (
    parsed.kind === "eticket_receipt" &&
    parsed.confirmation == null &&
    parsed.ticket_number == null &&
    parsed.gross_total == null &&
    parsed.segments.length === 0
  ) {
    return markup;
  }
  appendMarkupCrossCheck(parsed, markup);
  /* A parser that read the money but recognized no itinerary is a template
     drifting out from under its reader. The airline stated the flights twice
     in this very email; when the text side came up empty, take the machine
     side rather than filing a ticket with no flights — and say so, because
     markup carries no seat, class or cabin and the difference shows. */
  if (parsed.segments.length === 0 && markup && markup.segments.length > 0) {
    parsed.segments = markup.segments;
    parsed.warnings.push(
      "Flight details were read from the email's machine-readable markup — the receipt text didn't list them in a layout this app knows."
    );
  }
  return parsed;
}

/**
 * A receipt listing several travelers records the FIRST one's eTicket, which
 * is whoever the airline happened to print on top — a companion, as often as
 * not. When the ledger owner's name (Settings) is among the travelers, their
 * block's number is the one this ledger should carry: money and flights are
 * per-person either way, but the eTicket number is the ticket's identity,
 * and a companion's identity on the owner's ledger misfiles every later
 * document that names it. Called by the import route, which is the layer
 * that knows whose ledger this is; the parser stays a pure reading.
 */
export function preferTravelerTicket(
  parsed: ParsedReceipt,
  ownerFirst: string | null | undefined,
  ownerLast: string | null | undefined,
  ledgerTicketNumbers?: Set<string>
): void {
  const pairs = parsed.traveler_tickets;
  if (!pairs || pairs.length < 2 || !ownerFirst || !ownerLast) return;
  /* Identity continuity outranks retroactive correctness: a ticket the
     ledger already recorded under the companion's number stays there —
     swapping on a re-import would stop matching the existing row and fork
     the chain into a duplicate. Only tickets the ledger hasn't met yet get
     the owner's number. */
  const tno = (s: string | null) => (s ?? "").replace(/[\s-]/g, "");
  if (parsed.ticket_number && ledgerTicketNumbers?.has(tno(parsed.ticket_number))) return;
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
  /* Documents print LAST/FIRST, sometimes with middle names trailing — but
     only a WHOLE first name matches: an owner "ANN" must never claim
     "SMITH/ANNA", so a bare prefix doesn't count. Exact match first (so
     printed order can't matter when both spellings appear), then the
     middle-name shape, where the boundary space keeps ANNA out of ANN. */
  const want = norm(`${ownerLast}/${ownerFirst}`);
  const mine =
    pairs.find((p) => norm(p.name) === want) ??
    pairs.find((p) => norm(p.name).startsWith(want + " "));
  if (!mine || parsed.ticket_number === mine.ticket_number) return;
  parsed.ticket_number = mine.ticket_number;
  parsed.warnings.push(
    `Several travelers on this receipt — recorded your own eTicket ${mine.ticket_number}, not the first one listed.`
  );
}

/** Agency documents key on the airline's locator, but their markup may carry
 *  the agency's own — comparing those would resurrect the exact trap the
 *  agency-locator rule exists to avoid. */
const AGENCY_KINDS = new Set([
  "chase_travel",
  "adtrav",
  "ctp",
  "amex_travel",
  "cwt",
  "kiwi",
  "capital_one",
]);

/** "0447" and "447" are the same flight. */
const sameFlightNo = (a: string, b: string): boolean => {
  const na = Number(a);
  const nb = Number(b);
  return isFinite(na) && isFinite(nb) ? na === nb : a === b;
};

/**
 * Hold a text-parsed receipt against the same email's markup.
 *
 * Only CONTRADICTIONS on matched legs warn — same date and route, different
 * flight number or departure time. Set differences stay silent by design:
 * change notices are forward-looking (a flown leg is simply absent), and
 * multi-ticket emails list legs one side may not carry, so "the markup has a
 * leg the text doesn't" is normal life, not a discrepancy. Exported for the
 * selftest.
 */
export function appendMarkupCrossCheck(
  parsed: ParsedReceipt,
  markup: ParsedReceipt | null
): void {
  if (!markup) return;
  if (
    parsed.confirmation &&
    markup.confirmation &&
    parsed.confirmation !== markup.confirmation &&
    !AGENCY_KINDS.has(parsed.kind)
  ) {
    parsed.warnings.push(
      `The email's own machine-readable markup names confirmation ${markup.confirmation}, the document text ${parsed.confirmation} — worth a look.`
    );
  }
  for (const m of markup.segments) {
    const t = parsed.segments.find(
      (s) =>
        s.flight_date === m.flight_date &&
        s.origin === m.origin &&
        s.destination === m.destination
    );
    if (!t) continue;
    if (t.flight_number && m.flight_number && !sameFlightNo(t.flight_number, m.flight_number)) {
      parsed.warnings.push(
        `${m.origin}→${m.destination} ${m.flight_date}: the text reads flight ${t.flight_number}, the email's own markup says ${m.flight_number} — worth a look.`
      );
    } else if (
      t.departure_time &&
      m.departure_time &&
      t.departure_time !== m.departure_time
    ) {
      parsed.warnings.push(
        `${m.origin}→${m.destination} ${m.flight_date}: departure ${t.departure_time} in the text, ${m.departure_time} in the email's own markup — worth a look.`
      );
    }
  }
}

/* ------------------------- Collegiate Travel -------------------------- */

/** "10MAY 2023" → 2023-05-10 */
function parseGdsDate(s: string): string | null {
  const m = s.match(/(\d{1,2})([A-Z]{3})\s*(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Collegiate Travel Planners — a university travel desk, and the third agency
 * format after ADTRAV and CWT to print TWO booking references. "Agency
 * Reference Number: ZGPDYH" is CTP's own filing number; "United Airlines
 * Confirmation number is ZZ0014" is the record locator United knows, and the
 * only one that will match the airline's own receipt for the same trip.
 *
 * Every field sits on the line after its label, and the fare block itemises
 * the ticket and the agency's service fee as separate charges to the same
 * card — the fee is real money this trip cost, so it lands in ancillary_fees
 * and the total is CTP's own "Total Amount".
 */
function parseCtp(lines: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "ctp",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  const dense = lines.map((l) => l.trim()).filter(Boolean);
  const after = (i: number) => dense[i + 1] ?? "";
  let agencyRef: string | null = null;
  let serviceFee: number | null = null;
  let totalTickets: number | null = null;
  let cardRef: string | null = null;

  for (let i = 0; i < dense.length; i++) {
    const l = dense[i];

    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Agency Reference Number:\s*([A-Z0-9]{5,7})$/i))) {
      agencyRef = m[1].toUpperCase();
    } else if ((m = l.match(/Confirmation number is\s*([A-Z0-9]{5,7})\b/i))) {
      // the airline's own locator always wins over the agency's
      out.confirmation = m[1].toUpperCase();
    } else if ((m = l.match(/^Ticket Nbr:\s*(\d{13})\b/i))) {
      out.ticket_number = m[1];
      const amt = l.match(/Amount:\s*([\d,]+\.\d{2})/i);
      if (amt) totalTickets = num(amt[1]);
    } else if ((m = l.match(/^Date issued:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i))) {
      out.issue_date ??= parseSlashDate(m[1]);
    } else if ((m = l.match(/^Base:\s*([\d,]+\.\d{2})/i))) {
      out.base_fare = num(m[1]);
      // "US Tax: 30.63 USD XT Tax: 29.80 USD" — every tax on the line, summed
      let taxes = 0;
      for (const t of l.matchAll(/Tax:\s*([\d,]+\.\d{2})/gi)) taxes += num(t[1]);
      if (taxes > 0) out.taxes = round2(taxes);
    } else if ((m = l.match(/^Charged to:\s*([A-Z]{2})\*+(\d{4})$/i))) {
      cardRef ??= `${gdsCard(m[1])} ending in ${m[2]}`;
    } else if (/^Service fee:/i.test(l)) {
      // its amount is on the "Document Nbr: … Amount: 4.75" line below
      for (let j = i + 1; j < Math.min(i + 5, dense.length); j++) {
        const fee = dense[j].match(/^Document Nbr:.*Amount:\s*([\d,]+\.\d{2})/i);
        if (fee) {
          serviceFee = num(fee[1]);
          break;
        }
      }
    } else if ((m = l.match(/^Total Amount:\s*([\d,]+\.\d{2})$/i))) {
      out.gross_total = num(m[1]);
    } else if ((m = l.match(/^Frequent Flyer Number:$/i))) {
      const v = after(i);
      if (/^UA/i.test(v)) out.frequent_flyer_program = "UA";
    } else if (/^Passengers\s*:$/i.test(l)) {
      out.travelers = 1;
    } else if (/^AIR$/i.test(l)) {
      const seg = readCtpLeg(dense, i);
      if (seg) out.segments.push(seg);
    }
  }

  if (serviceFee != null) out.ancillary_fees = serviceFee;
  out.gross_total ??= totalTickets;
  if (cardRef) {
    out.payment_method = cardRef;
    out.payments.push({
      payment_type: "card",
      amount: out.gross_total,
      award_miles_used: null,
      reference: cardRef,
    });
  }
  if (agencyRef && out.confirmation && agencyRef !== out.confirmation) {
    warnings.push(
      `Booked through Collegiate Travel Planners (agency ref ${agencyRef}) — keyed on United's locator ${out.confirmation}`
    );
  } else if (agencyRef && !out.confirmation) {
    out.confirmation = agencyRef;
    warnings.push(
      `Only CTP's agency reference ${agencyRef} is printed — United's own locator isn't in this email, so this may not match the airline's receipt`
    );
  }
  if (out.segments.length === 0) warnings.push("No flights found in this itinerary");
  return out;
}

/** One "AIR" block: date, flight, route, times, seat, cabin. */
function readCtpLeg(dense: string[], start: number): ReceiptSegment | null {
  const block = dense.slice(start + 1, start + 40);
  const stop = block.findIndex((l) => /^AIR$/i.test(l));
  const b = stop === -1 ? block : block.slice(0, stop);

  const flightDate = parseGdsDate(b[0] ?? "");
  const fno = b.map((l) => l.match(/^Flight Number\s*:\s*(\d{1,4})$/i)).find(Boolean);
  if (!flightDate || !fno) return null;

  // "(IAH)" then the city on the next line; origin first, destination second
  const codes = b.map((l) => l.match(/^\(([A-Z]{3})\)$/)).filter(Boolean);
  if (codes.length < 2) return null;
  const dep = b.map((l) => l.match(/^Depart\s*:\s*(\d{1,2}:\d{2})\s*(AM|PM)$/i)).find(Boolean);
  const arr = b.map((l) => l.match(/^Arrive\s*:\s*(\d{1,2}:\d{2})\s*(AM|PM)$/i)).find(Boolean);
  const cabinLine = b.find((l) =>
    /^(BASIC ECONOMY|ECONOMY|PREMIUM ECONOMY|BUSINESS|FIRST)$/i.test(l)
  );
  const seatIdx = b.findIndex((l) => /^Seats?:$/i.test(l));
  const seat = seatIdx >= 0 ? (b[seatIdx + 1] ?? "").match(/^(\d{1,3}[A-Z])$/i) : null;

  return {
    carrier: "UA",
    flight_number: String(Number(fno[1])),
    origin: codes[0]![1],
    destination: codes[1]![1],
    flight_date: flightDate,
    departure_time: dep ? parse12h(dep[1], dep[2]) : null,
    arrival_time: arr ? parse12h(arr[1], arr[2]) : null,
    cabin: cabinLine ? normalizeCabin(cabinLine) : null,
    booking_class: null,
    seat: seat ? seat[1].toUpperCase() : null,
    projected_pqp: null,
    projected_pqf: null,
    projected_award_miles: null,
  };
}

/* ------------------------------ ADTRAV -------------------------------- */

/** GDS card scheme code → its name. Every agency format prints these. */
function gdsCard(scheme: string): string {
  const names: Record<string, string> = {
    VI: "Visa", AX: "American Express", CA: "Mastercard", MC: "Mastercard",
    DI: "Discover", DC: "Diners Club", JC: "JCB", TP: "Air travel card",
  };
  return names[scheme?.toUpperCase()] ?? scheme;
}

/** "VI-4002" → "Visa ending in 4002" */
function adtravCard(code: string): string {
  const [scheme, last] = code.split("-");
  const name = gdsCard(scheme);
  return last ? `${name} ending in ${last}` : name;
}

/** "1/14/2025 8:29 PM" → 2025-01-14 */
function parseSlashDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * ADTRAV / RezDesk corporate itineraries (LBNL and other managed programmes).
 * Like Chase Travel this is an agency document, so the value that ties it to
 * the ledger is the **Airline Booking Reference**, not the agency's own
 * "Booking Locator" or RezID. Fares arrive as one invoiced total with no
 * fare/tax split, and the same ticket is re-sent whenever the airline moves a
 * flight — those re-sends carry only the affected trip, not the whole ticket.
 */
function parseAdtrav(lines: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "adtrav",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 1,
    segments: [],
    warnings,
  };

  /* The flattened HTML puts a blank line between every value, so labels and
     the values that follow them are only adjacent once blanks are dropped —
     the same shape as the Chase Travel layout. */
  const rows = lines.filter((l) => l !== "");
  const at = (i: number) => rows[i] ?? "";
  let agencyLocator: string | null = null;
  let rezId: string | null = null;
  let segDate: string | null = null;
  let cur: ReceiptSegment | null = null;
  const push = () => {
    if (cur && cur.origin && cur.destination) out.segments.push(cur);
    cur = null;
  };

  for (let i = 0; i < rows.length; i++) {
    const l = at(i);

    const loc = l.match(/^Booking Locator:\s*([A-Z0-9]{5,7})$/i);
    if (loc) agencyLocator = loc[1].toUpperCase();
    const rez = l.match(/^RezID:\s*(\S+)$/i);
    if (rez) rezId = rez[1];

    // the airline's own PNR — what United's own emails and the ledger use
    const air = l.match(/^Airline Booking Reference:\s*([A-Z0-9]{5,7})$/i);
    if (air && !out.confirmation) out.confirmation = air[1].toUpperCase();

    const tkt = l.match(/^Ticket\s*#?\s*:?\s*(\d{13})/);
    if (tkt && !out.ticket_number) out.ticket_number = tkt[1];
    const tkt2 = l.match(/^Ticket\s+(\d{13})\s+Issued\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (tkt2) {
      out.ticket_number ??= tkt2[1];
      out.issue_date ??= parseSlashDate(tkt2[2]);
    }
    if (/^Date Ticketed\/Confirmed$/i.test(l)) out.issue_date ??= parseSlashDate(at(i + 1));

    const paid = l.match(/Charged To\s+([A-Z]{2}-?[\dX*]+)/i);
    if (paid && !out.payment_method) out.payment_method = adtravCard(paid[1]);

    if (/^Total Invoiced Charges$/i.test(l)) {
      const m = at(i + 1).match(/\$?([\d,]+\.\d{2})/);
      if (m) out.gross_total = num(m[1]);
    }
    if (out.gross_total == null && /^Total Charges/i.test(l)) {
      const m = at(i + 1).match(/\$?([\d,]+\.\d{2})/);
      if (m) out.gross_total = num(m[1]);
    }

    // "Thursday, March 6, 2025" heads each day's flights
    if (/^[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}$/.test(l)) {
      push();
      segDate = parseLongDate(l);
      continue;
    }

    // "UA 2206" on its own line starts a segment
    const fl = l.match(/^([A-Z0-9]{2})\s+(\d{1,4})$/);
    if (fl && segDate) {
      push();
      cur = {
        carrier: fl[1].toUpperCase(),
        flight_number: String(Number(fl[2])),
        origin: "", destination: "", flight_date: segDate,
        departure_time: null, arrival_time: null, cabin: null,
        booking_class: null, seat: null,
        projected_pqp: null, projected_pqf: null, projected_award_miles: null,
      };
      continue;
    }
    if (!cur) continue;

    if (/^Depart$/i.test(l)) {
      const t = at(i + 1).match(/-\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
      if (t) cur.departure_time = parse12h(t[1], t[2]);
      const a = at(i + 2).match(/^([A-Z]{3})\s*-\s*/);
      if (a) cur.origin = a[1];
    }
    if (/^Arrive$/i.test(l)) {
      const t = at(i + 1).match(/-\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
      if (t) cur.arrival_time = parse12h(t[1], t[2]);
      const a = at(i + 2).match(/^([A-Z]{3})\s*-\s*/);
      if (a) cur.destination = a[1];
    }
    const seat = l.match(/^Seat:\s*(\S+)$/i);
    if (seat) cur.seat = seat[1].toUpperCase();
    const cls = l.match(/^Class:\s*(.+?)\s*\(([A-Z])\)$/i);
    if (cls) {
      cur.cabin = normalizeCabin(cls[1]);
      cur.booking_class = cls[2].toUpperCase();
    }
  }
  push();

  if (!out.confirmation && agencyLocator) {
    out.confirmation = agencyLocator;
    warnings.push(
      `No airline booking reference printed — using ADTRAV's own locator ${agencyLocator}, which won't match United's emails.`
    );
  }
  if (out.gross_total != null) {
    out.payments = [
      {
        payment_type: out.payment_method ? classifyPayment(out.payment_method) : "other",
        amount: out.gross_total,
        award_miles_used: null,
        reference: out.payment_method,
      },
    ];
  }
  const ref = [
    rezId ? `RezID ${rezId}` : null,
    agencyLocator && agencyLocator !== out.confirmation
      ? `ADTRAV locator ${agencyLocator}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  warnings.push(
    `Booked through ADTRAV${ref ? ` (${ref})` : ""} — the invoice gives one total with no fare/tax split, so only the total is recorded.`
  );

  finishCommon(out, emailDate, warnings);
  return out;
}

/* --------------------------- Chase Travel ------------------------------ */

/**
 * Chase Travel (and the Ultimate Rewards travel portal) books flights on the
 * airline's behalf: there is no eTicket number, and the value that ties the
 * booking to the airline — and to this ledger — is the "Airline confirmation"
 * PNR. Per-leg dates aren't printed beside the flights; they appear as
 * origin/destination/date-range triples in the cancellation-rules section.
 */
/**
 * Chase Travel as it was written through 2023: labels on one line, values on
 * the next, and three different reference numbers in the header. Only ONE of
 * them belongs to the airline — "Flight Confirmation #" is the PNR United
 * knows you by. The "Trip ID" and "Agency Reference #" are Chase's own filing
 * numbers; keying on either splits a booking from the airline's own receipt
 * for the same trip.
 *
 * Leg dates print without a year ("Tue, Jan 16"), so they resolve forward from
 * the email's date — a December confirmation for a January flight is next
 * year, and reading it as this year files the trip 12 months in the past.
 */
function parseChaseEarly(
  dense: string[],
  out: ParsedReceipt,
  warnings: string[],
  emailDate: string | null
): {
  tripId: string | null;
  tripTotal: number | null;
  billedToCard: number | null;
  cardRef: string | null;
} {
  let tripId: string | null = null;
  let tripTotal: number | null = null;
  let billedToCard: number | null = null;
  let cardRef: string | null = null;
  let pointsValue: number | null = null;
  let pointsUsed: number | null = null;

  /** the value printed under a label, skipping the label line itself */
  const after = (i: number) => dense[i + 1] ?? "";
  const MONEY = /^\$([\d,]+\.\d{2})$/;
  const DAY = /^[A-Z][a-z]{2},\s*([A-Z][a-z]{2})\s+(\d{1,2})$/;

  for (let i = 0; i < dense.length; i++) {
    const l = dense[i];
    if (/^Trip ID:?$/i.test(l)) {
      const v = after(i);
      if (/^[A-Z0-9]{6,14}$/i.test(v)) tripId = v.toUpperCase();
    } else if (/^Flight Confirmation\s*#?$/i.test(l)) {
      const v = after(i);
      if (/^[A-Z0-9]{5,7}$/i.test(v)) out.confirmation = v.toUpperCase();
    } else if (/^Total$/i.test(l)) {
      const m = after(i).match(MONEY);
      if (m && tripTotal == null) tripTotal = num(m[1]);
    } else if (/^Amount Billed to Card:?$/i.test(l)) {
      const m = after(i).match(MONEY);
      if (m) billedToCard = num(m[1]);
      const maybeCard = dense[i + 2] ?? "";
      const digits = maybeCard.match(/(\d{4})\s*$/);
      if (/^[X\-\s]*\d{4}$/i.test(maybeCard) && digits)
        cardRef = `Card ending in ${digits[1]}`;
    } else if (/^Points Redeemed:?$/i.test(l)) {
      const v = after(i).replace(/,/g, "");
      if (/^\d+$/.test(v)) pointsUsed = Number(v);
    } else if (/^Points Value Redeemed:?$/i.test(l)) {
      const m = after(i).match(MONEY);
      if (m) pointsValue = num(m[1]);
    } else if (/^(\d+)\s*Ticket\(s\)/i.test(l)) {
      out.travelers = Math.max(out.travelers, Number(l.match(/^(\d+)/)![1]));
    }
  }

  /* Flights. The itinerary ends at the passenger table — past it, "United
     Airlines 2628" appears again as prose and would be read as a second leg. */
  const end = dense.findIndex((l) =>
    /^(Passenger Information|Rules and Policies|Payment Summary)$/i.test(l)
  );
  const body = end === -1 ? dense : dense.slice(0, end);

  for (let i = 0; i < body.length; i++) {
    const fm = body[i].match(/^([A-Z]{2})\s?(\d{1,4})$/);
    // an airline name sits directly above the flight number in this layout
    if (!fm || !/[A-Za-z]{3}/.test(body[i - 1] ?? "")) continue;

    const rest = body.slice(i + 1, i + 22);
    const codes = rest.filter((l) => /^[A-Z]{3}$/.test(l));
    if (codes.length < 2) continue;
    const times = [...rest.join("\n").matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
    const day = rest.map((l) => l.match(DAY)).find(Boolean);
    const month = day ? MONTHS[day[1].slice(0, 3).toLowerCase()] : null;
    if (!month) {
      warnings.push(`No date printed for ${codes[0]}→${codes[1]} — add it manually`);
      continue;
    }
    const cabinLine = rest.find((l) =>
      /^(Basic Economy|Economy|Premium Economy|Premium Plus|Business|First)$/i.test(l)
    );
    const cls = rest.map((l) => l.match(/^[A-Za-z ]+\(([A-Z])\)$/)).find(Boolean);

    out.segments.push({
      carrier: fm[1].toUpperCase(),
      flight_number: String(Number(fm[2])),
      origin: codes[0],
      destination: codes[1],
      flight_date: resolveYear(month, Number(day![2]), emailDate),
      departure_time: times[0] ? parse12h(times[0][1], times[0][2]) : null,
      arrival_time: times[1] ? parse12h(times[1][1], times[1][2]) : null,
      cabin: cabinLine ? normalizeCabin(cabinLine) : null,
      booking_class: cls ? cls[1].toUpperCase() : null,
      seat: null,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  /* Points are money here: Chase prints what they were worth, and the card was
     billed only the remainder. Recording just the card would leave the ticket
     looking part-funded. */
  if (pointsValue != null && pointsValue > 0) {
    out.payments.push({
      payment_type: "other",
      amount: pointsValue,
      award_miles_used: null,
      reference: `Chase points${pointsUsed ? ` (${pointsUsed.toLocaleString()})` : ""}`,
    });
  }

  return { tripId, tripTotal, billedToCard, cardRef };
}

function parseChaseTravel(lines: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "chase_travel",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: emailDate,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  let tripId: string | null = null;
  let tripTotal: number | null = null;
  let billedToCard: number | null = null;
  let cardRef: string | null = null;
  // Ultimate Rewards points spent on the booking. NOT airline miles — they
  // never touch miles_redeemed, whose award semantics don't apply here.
  let pointsRedeemed: number | null = null;
  // the cash part of a points-priced trip ("53,934 points + $98.29")
  let tripCash: number | null = null;

  /* Per-leg dates live in the cancellation-rules section as origin /
     destination / "date - date" triples. Scan the text with blank lines
     removed, since the layout separates every value with one. */
  const dense = lines.filter((l) => l !== "");
  const legDates = new Map<string, string>(); // "OGG|SFO" → YYYY-MM-DD
  const RANGE_RE =
    /^([A-Z][a-z]{2},\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\s*[-–—]\s*([A-Z][a-z]{2},\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})$/;
  let tripStart: string | null = null;
  for (let i = 0; i < dense.length; i++) {
    const range = dense[i].match(RANGE_RE);
    if (!range) continue;
    const depart = parseLongDate(range[1]);
    if (!depart) continue;
    if (tripStart == null) tripStart = depart;
    const a = dense[i - 2]?.match(/^([A-Z]{3})$/);
    const b = dense[i - 1]?.match(/^([A-Z]{3})$/);
    if (a && b) legDates.set(`${a[1]}|${b[1]}`, depart);
  }

  /* The 2023-and-earlier layout is a different document, not a variant: every
     value sits on the line AFTER its label, flights are grouped under
     "Departing Flight" instead of "Flight 1:", and leg dates carry no year.
     Detected by its own headings and scanned separately, then rejoining the
     shared payment tail below. */
  const isEarlyLayout = dense.some((l) => /^Flight Confirmation\s*#?$/i.test(l));
  if (isEarlyLayout) {
    const early = parseChaseEarly(dense, out, warnings, emailDate);
    tripId = early.tripId;
    tripTotal = early.tripTotal;
    billedToCard = early.billedToCard;
    cardRef = early.cardRef;
  }

  for (let i = 0; !isEarlyLayout && i < lines.length; i++) {
    const line = lines[i];

    // "Trip ID: 1016516703" inline, "Trip ID # THX4DS5PC" mid-sentence, or
    // the label alone with the value on the next line — and the newer IDs are
    // alphanumeric, so the shape test is "has a digit", not "is a number"
    const trip = line.match(/Trip ID:?\s*#?\s*([A-Z0-9]{6,})\b/i);
    if (trip && /\d/.test(trip[1])) {
      tripId ??= trip[1].toUpperCase();
      continue;
    }
    const airlineConf = line.match(/^Airline confirmation:?\s*([A-Z0-9]{5,7})$/i);
    if (airlineConf) {
      out.confirmation = airlineConf[1].toUpperCase();
      continue;
    }
    if (/^Traveler\s*\d+:?$/i.test(line)) {
      out.travelers += 1;
      continue;
    }

    /* flight block */
    const fm = line.match(/^Flight\s+(\d+):/i);
    if (!fm) continue;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^Flight\s+\d+:/i.test(lines[j]) || /^Traveler\s*\d+:?$/i.test(lines[j]))
        break;
      if (lines[j] === "") continue;
      block.push(lines[j]);
      if (block.length > 24) break;
    }

    const times = [...block.join("\n").matchAll(/(\d{1,2}:\d{2})\s*(am|pm)/gi)];
    const codes = block.filter((l) => /^[A-Z]{3}$/.test(l));
    const flightNo = block
      .map((l) => l.match(/^([A-Z]{2})\s?(\d{1,4})$/))
      .find(Boolean);
    if (codes.length < 2 || !flightNo) {
      warnings.push(`Couldn't read flight ${fm[1]} — skipped`);
      continue;
    }
    const origin = codes[0];
    const destination = codes[1];
    let flightDate = legDates.get(`${origin}|${destination}`) ?? null;
    if (!flightDate && out.segments.length === 0 && tripStart) {
      // first leg of the trip: the trip's own start date is a safe stand-in
      flightDate = tripStart;
      warnings.push(
        `${origin}→${destination}: no per-leg date printed — using the trip start ${tripStart}`
      );
    }
    if (!flightDate) {
      warnings.push(
        `No date found for ${origin}→${destination} — add this flight manually`
      );
      continue;
    }
    const cabinLine = block.find((l) =>
      /^(Basic Economy|Economy|Premium Economy|Premium Plus|Business|First)$/i.test(l)
    );
    const classLine = block
      .map((l) => l.match(/class\s+([A-Z])$/i))
      .find(Boolean);
    const aircraft = block.find((l) => /^(Boeing|Airbus|Embraer|Bombardier)\b/i.test(l));

    out.segments.push({
      carrier: flightNo[1].toUpperCase(),
      flight_number: String(Number(flightNo[2])),
      origin,
      destination,
      flight_date: flightDate,
      departure_time: times[0] ? parse12h(times[0][1], times[0][2]) : null,
      arrival_time: times[1] ? parse12h(times[1][1], times[1][2]) : null,
      cabin: cabinLine ? normalizeCabin(cabinLine) : null,
      booking_class: classLine ? classLine[1].toUpperCase() : null,
      seat: null,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  /* The payment summary, read off the blank-stripped lines: raw-line
     adjacency varies between sends of the SAME layout (blank lines between a
     label and its value), which is how "Trip total" was being missed. */
  if (!isEarlyLayout) {
    for (let i = 0; i < dense.length; i++) {
      const l = dense[i];
      if (/^Trip total$/i.test(l)) {
        const near = [dense[i - 1], dense[i + 1]];
        const cash = near.find((x) => /^\$[\d,]+\.\d{2}$/.test(x ?? ""));
        if (cash) tripTotal = num(cash.replace("$", ""));
        // a points-priced trip states its total as "53,934 points + $98.29"
        const mixed = near
          .map((x) => x?.match(/^([\d,]+)\s*(?:points|pts)\s*\+\s*\$([\d,]+\.\d{2})$/i))
          .find(Boolean);
        if (mixed) {
          pointsRedeemed ??= Math.round(num(mixed[1]));
          tripCash = num(mixed[2]);
        }
        continue;
      }
      const pts = l.match(/^([\d,]+)\s*(?:pts|points)$/i);
      if (pts && /^Points redeemed$/i.test(dense[i - 1] ?? "")) {
        pointsRedeemed = Math.round(num(pts[1]));
        continue;
      }
      const billed = l.match(/^Billed to card\s*\$?([\d,]+\.\d{2})$/i);
      if (billed) billedToCard = num(billed[1]);
      else if (/^Billed to card$/i.test(l) && /^\$[\d,]+\.\d{2}$/.test(dense[i + 1] ?? ""))
        billedToCard = num(dense[i + 1].replace("$", ""));
      const card = l.match(
        /^((?:Visa|Mastercard|Master Card|Amex|American Express|Discover)\s+ending in\s+\d{4})$/i
      );
      if (card) cardRef ??= card[1];
    }
  }

  /* The newest layout drops "Flight N:" headings for Depart:/Return: bounds:
       Depart : Mon, Nov 25, 2024 (arrive Tue, Nov 26, 2024)
       11:35 am / EWR / 03:55 pm / NRT / … / NH 6453 / operated by United …
     A one-stop bound prints BOTH flight numbers but only the stop's code, in
     parentheses with the layover ("(TPE — 22h 15m)") — the two legs are split
     around the stop, and the second leg's own date isn't printed, which is
     said out loud rather than guessed silently. */
  const isBoundStart = (l: string) => /^(?:Depart|Return)\s*:/i.test(l);
  const OP_CARRIERS: [RegExp, string][] = [
    [/united/i, "UA"],
    [/delta/i, "DL"],
    [/american airlines|envoy|american eagle/i, "AA"],
    [/aeromexico/i, "AM"],
    [/china airlines/i, "CI"],
    [/all nippon|\bana\b/i, "NH"],
    [/alaska|horizon air/i, "AS"],
    [/lufthansa/i, "LH"],
    [/skywest|republic|mesa|endeavor|gojet|commutair/i, ""],
  ];
  const opCode = (name: string): string | null => {
    for (const [re, code] of OP_CARRIERS) if (re.test(name)) return code || null;
    return null;
  };
  for (let i = 0; !isEarlyLayout && i < dense.length; i++) {
    if (!isBoundStart(dense[i])) continue;
    let dateStr = dense[i]
      .replace(/^(?:Depart|Return)\s*:\s*/i, "")
      .replace(/\s*\(arrive[^)]*\)\s*$/i, "");
    if (!parseLongDate(dateStr))
      dateStr = (dense[i + 1] ?? "").replace(/\s*\(arrive[^)]*\)\s*$/i, "");
    const boundDate = parseLongDate(dateStr);
    if (!boundDate) continue;

    const codes: string[] = [];
    const times: string[] = [];
    const flights: { carrier: string; number: string; operating: string | null }[] = [];
    const stops: string[] = [];
    let brand: string | null = null;
    let cls: string | null = null;
    for (let j = i + 1; j < dense.length; j++) {
      const l = dense[j];
      if (
        isBoundStart(l) ||
        /^Traveler\s*\d+/i.test(l) ||
        /^Payment summary$/i.test(l) ||
        /^Important flight/i.test(l)
      )
        break;
      if (/^[A-Z]{3}$/.test(l)) codes.push(l);
      const t = l.match(/^(\d{1,2}:\d{2})\s*(am|pm)$/i);
      if (t) times.push(parse12h(t[1], t[2]));
      const fl = l.match(/^([A-Z][A-Z0-9])\s+(\d{1,4})$/);
      if (fl) flights.push({ carrier: fl[1], number: String(Number(fl[2])), operating: null });
      const op = l.match(/^operated by\s+(.+)$/i);
      if (op && flights.length) flights[flights.length - 1].operating = opCode(op[1]);
      const stop = l.match(/^\(([A-Z]{3})\s*[—–-]/);
      if (stop) stops.push(stop[1]);
      // "Fare:" / "Delta Main Basic" — or the brand folded into the label
      // ("Main Cabin Fare:"), or just "Economy class (K)" / "economy class E"
      const brandLabel = l.match(/^(.+?)\s*Fare:$/i);
      if (brandLabel) brand ??= brandLabel[1];
      if (/^Fare:$/i.test(l) && dense[j + 1]) brand ??= dense[j + 1];
      const classLine = l.match(/class\s*\(?([A-Z])\)?$/i);
      if (classLine) {
        cls ??= classLine[1].toUpperCase();
        brand ??= l.replace(/\s*class\s*\(?[A-Z]\)?$/i, "");
      }
    }
    if (codes.length < 2 || flights.length === 0) continue;
    const cabin = brand ? normalizeCabin(brand) : null;
    const seg = (
      f: (typeof flights)[number],
      origin: string,
      destination: string,
      dep: string | null,
      arr: string | null
    ) =>
      out.segments.push({
        carrier: f.carrier,
        flight_number: f.number,
        operating_carrier: f.operating,
        origin,
        destination,
        flight_date: boundDate,
        departure_time: dep,
        arrival_time: arr,
        cabin,
        booking_class: cls,
        seat: null,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      });
    if (flights.length === 1) {
      seg(flights[0], codes[0], codes[1], times[0] ?? null, times[1] ?? null);
    } else if (flights.length === 2 && stops.length === 1) {
      seg(flights[0], codes[0], stops[0], times[0] ?? null, null);
      seg(flights[1], stops[0], codes[1], null, times[1] ?? null);
      warnings.push(
        `${flights[1].carrier} ${flights[1].number} leaves ${stops[0]} after a layover — its own date isn't printed, so it carries the bound's ${boundDate}; check it`
      );
    } else {
      warnings.push(
        `Couldn't split the ${codes[0]}→${codes[1]} bound into legs (${flights.length} flights, ${stops.length} stops printed) — add them manually`
      );
    }
  }

  const travelers = Math.max(1, out.travelers);
  const share = (v: number) => Math.round((v / travelers) * 100) / 100;
  if (pointsRedeemed != null) {
    /* Points bookings follow the award-ticket rule: the cash actually billed
       is the ledger cost, and the points are noted, not priced — Ultimate
       Rewards points aren't dollars, and inventing an exchange rate would
       quietly decide what they're worth. */
    const cash = billedToCard ?? tripCash ?? 0;
    out.gross_total = share(cash);
    if (cash > 0) {
      out.payments.push({
        payment_type: "card",
        amount: out.gross_total,
        award_miles_used: null,
        reference: cardRef,
      });
      out.payment_method = cardRef ?? "Card";
    }
    out.payments.push({
      payment_type: "other",
      amount: null,
      award_miles_used: null,
      reference: `${pointsRedeemed.toLocaleString()} Chase points`,
    });
    const pointsStr = `${pointsRedeemed.toLocaleString()} Chase points`;
    if (cash > 0 && tripTotal != null && tripTotal > cash) {
      warnings.push(
        `Trip priced ${tripTotal.toFixed(2)} ${out.currency} — ${pointsStr} covered ${(tripTotal - cash).toFixed(2)}, and the ${cash.toFixed(2)} billed to the card is recorded as the ticket's cost`
      );
    } else if (cash > 0) {
      warnings.push(
        `Priced at ${pointsStr} + ${cash.toFixed(2)} ${out.currency} — the cash part is recorded as the ticket's cost`
      );
    } else {
      warnings.push(
        `The whole ${tripTotal != null ? `${tripTotal.toFixed(2)} ${out.currency} ` : ""}trip was covered by ${pointsStr} — recorded at 0.00 cash cost, with the points noted rather than priced`
      );
    }
    if (travelers > 1)
      warnings.push(
        `${travelers} travelers on this booking — recorded your share of the cash`
      );
  } else {
    const total = tripTotal ?? billedToCard;
    if (total != null) {
      out.gross_total = share(total);
      if (travelers > 1) {
        warnings.push(
          `${travelers} travelers on this booking — recorded your share (${out.gross_total.toFixed(2)} ${out.currency}) of the ${total.toFixed(2)} ${out.currency} trip total`
        );
      }
      if (billedToCard != null) {
        out.payments.push({
          payment_type: "card",
          amount: out.gross_total,
          award_miles_used: null,
          reference: cardRef,
        });
        out.payment_method = cardRef ?? "Card";
      }
    }
  }
  // Chase doesn't itemize fare vs tax, so the breakdown stays empty rather
  // than being invented — the total is what drives cost.
  if (tripId) {
    warnings.push(
      `Booked through Chase Travel (Trip ID ${tripId}) — no eTicket number or fare breakdown in this email`
    );
  }

  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------- American Express Travel --------------------- */

/**
 * Amex Travel's "Your Flight to San Francisco. Trip ID: 4923-8870". An OTA, so
 * the rule Chase Travel established applies again: key on the airline's
 * "RECORD LOCATOR", never the Amex "Trip ID" in the subject — that locator is
 * Amex's own and matches nothing the airline ever sends you.
 *
 * Its flight blocks are almost entirely unlabelled. The airline is a NAME on
 * its own line with the number beneath it, the times are a range on one line
 * ("1:55pm - 4:03pm"), the route is split over two ("Seattle WA, SEA -" /
 * "San Francisco CA, SFO"), and the date carries no year. There is no fare
 * class letter anywhere — only a cabin — so booking_class stays null rather
 * than being invented.
 */
function parseAmexTravel(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "amex_travel",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: emailDate,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 1,
    segments: [],
    warnings,
  };

  const amountOf = (l: string | undefined) => {
    const m = l?.match(/^\$\s*([\d,]+\.\d{2})$/);
    return m ? num(m[1]) : null;
  };
  /** "Sat, November 19" / "Sat, Nov 19" — no year */
  const dateOf = (l: string) => {
    const m = l.match(/^[A-Z][a-z]{2},\s+([A-Z][a-z]{2,8})\s+(\d{1,2})$/);
    const month = m ? MONTHS[m[1].slice(0, 3).toLowerCase()] : null;
    return m && month ? resolveYear(month, Number(m[2]), emailDate) : null;
  };
  /** "Seattle WA, SEA -" → SEA */
  const codeOf = (l: string | undefined) =>
    l?.match(/,\s*([A-Z]{3})\s*-?\s*$/)?.[1] ?? null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^RECORD LOCATOR$/i.test(l)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{5,7}$/.test(next)) out.confirmation ??= next;
    }
    if (/^Ticket Number$/i.test(l) && /^\d{10,16}$/.test(lines[i + 1] ?? ""))
      out.ticket_number ??= lines[i + 1];
    if (/^Total$/i.test(l)) out.gross_total ??= amountOf(lines[i + 1]);
    if (/^Taxes? (?:&|and) Fees$/i.test(l)) out.taxes ??= amountOf(lines[i + 1]);
    // "1 Adult" heads the per-traveler base fare
    const pax = l.match(/^(\d+)\s+Adults?$/i);
    if (pax) {
      out.travelers = Number(pax[1]);
      out.base_fare ??= amountOf(lines[i + 1]);
    }
    if (/^Card Type:?$/i.test(l)) {
      const brand = lines[i + 1];
      // the masked number sits under its own label: "XXXX-XXXXXX-X4001 (Blue)"
      const numAt = lines.slice(i, i + 6).findIndex((x) => /^Card Number:?$/i.test(x));
      const last4 =
        numAt >= 0
          ? (lines[i + numAt + 1]?.match(/(\d{4})(?:\s*\([^)]*\))?\s*$/)?.[1] ?? null)
          : null;
      if (brand && !/^Card Number/i.test(brand)) {
        out.payment_method = last4 ? `${brand} ending in ${last4}` : brand;
        out.payments.push({
          payment_type: classifyPayment(out.payment_method),
          amount: null,
          award_miles_used: null,
          reference: out.payment_method,
        });
      }
    }

    /* ---- a flight: airline NAME, then the number on its own line ---- */
    const carrier = operatorCode(l);
    if (!carrier || !/^\d{1,4}$/.test(lines[i + 1] ?? "")) continue;
    const flightNo = String(Number(lines[i + 1]));
    let date: string | null = null;
    for (let b = i - 1; b >= 0 && b > i - 6; b--) {
      const d = dateOf(lines[b]);
      if (d) {
        date = d;
        break;
      }
    }
    let departure: string | null = null;
    let arrival: string | null = null;
    let origin: string | null = null;
    let destination: string | null = null;
    let cabin: string | null = null;
    let seat: string | null = null;
    for (let j = i + 2; j < Math.min(i + 14, lines.length); j++) {
      const x = lines[j];
      if (dateOf(x) || operatorCode(x)) break; // the next leg
      const times = x.match(
        /^(\d{1,2}:\d{2})\s*(am|pm)\s*-\s*(\d{1,2}:\d{2})\s*(am|pm)$/i
      );
      if (times) {
        departure = parse12h(times[1], times[2]);
        arrival = parse12h(times[3], times[4]);
        continue;
      }
      const c = codeOf(x);
      if (c) {
        if (!origin) origin = c;
        else destination ??= c;
        continue;
      }
      const cab = x.match(/^\|?\s*(Basic Economy|Economy|Premium Economy|Business|First)\b/i);
      if (cab) cabin ??= normalizeCabin(cab[1]);
      const st = x.match(/^Seat:\s*(\d{1,2}[A-Z])$/i);
      if (st) seat ??= st[1];
    }
    if (!date || !origin || !destination) continue;
    out.segments.push({
      carrier,
      operating_carrier: null,
      flight_number: flightNo,
      origin,
      destination,
      flight_date: date,
      departure_time: departure,
      arrival_time: arrival,
      cabin,
      // Amex prints a cabin but never the fare class — don't invent one
      booking_class: null,
      seat,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
    i += 1;
  }

  if (!out.confirmation)
    warnings.push(
      "No airline record locator found — an Amex Trip ID won't match an airline receipt"
    );
  out.issuing_carrier =
    carrierFromTicket(out.ticket_number) ?? out.segments[0]?.carrier ?? "UA";
  if (out.base_fare == null && out.gross_total != null && out.taxes != null)
    out.base_fare = round2(out.gross_total - out.taxes);
  if (out.payments.length === 1 && out.gross_total != null)
    out.payments[0].amount = out.gross_total;
  if (out.segments.length === 0) warnings.push("No flights found in this booking");
  finishCommon(out, emailDate, warnings);
  return out;
}

/* ---------------------------- Alaska Airlines --------------------------- */

/** Alaska's cabin words, which are its own. */
function alaskaCabin(word: string): string | null {
  const w = word.toLowerCase();
  if (/first/.test(w)) return "First";
  if (/premium/.test(w)) return "Premium Economy";
  if (/coach|main|saver/.test(w)) return "Economy";
  return normalizeCabin(word);
}

/**
 * Alaska's "Your confirmation receipt: ZZ0017 for your flight to Seattle on
 * 4/11/22." Two things about it are unlike every other format here.
 *
 * ITS DATES CARRY NO YEAR. Flight blocks print "Mon, Apr 11" and nothing more,
 * so the year is resolved against the email's own date — the first candidate
 * year that doesn't put the flight before the booking.
 *
 * AND THE BOOKING CODE MAY BE ONLY IN THE SUBJECT. On a codeshare Alaska drops
 * its own "Confirmation code:" block and prints the OPERATING airline's instead
 * ("Confirmation Code: B67284" under a Hawaiian-operated leg). Keying on that
 * would file an Alaska ticket under Hawaiian's locator — the same trap the
 * agency formats set with their own trip IDs — so the subject's code wins and a
 * code found inside a flight block is never used.
 */
function parseAlaska(
  raw: string[],
  emailDate: string | null,
  subject: string
): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "alaska",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "AS",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  /* "Your confirmation receipt: ZZ0017 for your flight to Seattle on 4/11/22."
     The hybrid says "Your flight is booked: ZZ0042 to Honolulu on 08/15/2026"
     instead; both carry the code where it is safest, the subject. */
  out.confirmation =
    subject.match(/confirmation receipt:?\s*([A-Z0-9]{5,7})\b/i)?.[1]?.toUpperCase() ??
    subject.match(/flight is booked:?\s*([A-Z0-9]{5,7})\b/i)?.[1]?.toUpperCase() ??
    null;
  if (!out.confirmation) {
    // the standalone block, used only when it isn't inside a flight
    const at = lines.findIndex((l) => /^Confirmation code:?$/i.test(l));
    const code = at >= 0 ? lines[at + 1] : undefined;
    if (code && /^[A-Z0-9]{5,7}$/.test(code)) out.confirmation = code;
  }

  /** "Mon, Apr 11" — no year, so it comes from the booking date */
  const withYear = (l: string): string | null => {
    const m = l.match(/^[A-Z][a-z]{2},\s+([A-Z][a-z]{2})\s+(\d{1,2})$/);
    const month = m ? MONTHS[m[1].toLowerCase()] : null;
    return m && month ? resolveYear(month, Number(m[2]), emailDate) : null;
  };
  const amountOf = (l: string | undefined) => {
    const m = l?.match(/^\$([\d,]+\.\d{2})$/);
    return m ? num(m[1]) : null;
  };

  /* ------------------------------ charges ------------------------------ */
  const tickets: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const tkt = l.match(/^Ticket\s+(\d{10,16})$/i);
    if (tkt) tickets.push(tkt[1]);
    // per-person figures: the ledger holds this traveler's own share
    if (/^Base fare and surcharges$/i.test(l)) out.base_fare ??= amountOf(lines[i + 1]);
    if (/^Taxes and other fees$/i.test(l)) out.taxes ??= amountOf(lines[i + 1]);
    if (/^Per-person total$/i.test(l)) out.gross_total ??= amountOf(lines[i + 1]);
    /* "Nonrefundable fare of $172.60 was charged to the Visa card with number
       ************4003 held by … on Mar 29, 2022." — also "to be charged to".
       The hybrid says "$409.82 to be charged to the VISA card with number
       VI8930 held by …": no "fare of", and the number wears a scheme prefix
       instead of asterisks. */
    const charge =
      l.match(
        /fare of \$[\d,]+\.\d{2}\s+(?:was|is|to be)?\s*charged to the ([A-Za-z ]+?) card with number\s*\*+(\d{4})/i
      ) ??
      l.match(
        /^\$[\d,]+\.\d{2}\s+(?:was|is|to be|will be)\s+charged to the ([A-Za-z ]+?) card with number\s+[A-Z]{0,2}(\d{4})\b/i
      );
    if (charge && !out.payment_method) {
      out.payment_method = `${charge[1].trim()} ending in ${charge[2]}`;
      out.payments.push({
        payment_type: classifyPayment(out.payment_method),
        amount: null,
        award_miles_used: null,
        reference: out.payment_method,
      });
    }
    const on = l.match(/\bon ([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\.?$/);
    if (on && /charged to the/i.test(l)) out.issue_date ??= parseLongDate(on[1]);
  }
  out.ticket_number = tickets[0] ?? null;
  out.travelers = Math.max(1, tickets.length);
  if (tickets.length > 1)
    warnings.push(
      `${tickets.length} tickets on this receipt (${tickets.join(", ")}) — only the first is recorded`
    );
  if (out.payments.length === 1 && out.gross_total != null)
    out.payments[0].amount = out.gross_total;

  /* ----------------------------- itinerary ----------------------------- */
  const stopsBlock = (l: string) =>
    /^Summary of airfare charges$/i.test(l) || /^Flight\s+\d{1,4}\b/i.test(l);
  for (let i = 0; i < lines.length; i++) {
    /* The hybrid's head is "Flight 1 · Sat Aug 15" — the number is an
       ORDINAL, not a flight number; the real one arrives two lines later as
       "AS 1064 · Boeing 717-200". A date in the head is what tells the two
       layouts apart, so the classic reader below can never misread an
       ordinal as flight 1. */
    const hy = lines[i].match(
      /^Flight\s+\d{1,2}\s*[.·]\s*[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})$/
    );
    if (hy) {
      const month = MONTHS[hy[1].toLowerCase()];
      const date = month ? resolveYear(month, Number(hy[2]), emailDate) : null;
      let carrier: string | null = null;
      let number: string | null = null;
      let operating: string | null = null;
      let origin: string | null = null;
      let destination: string | null = null;
      let departure: string | null = null;
      let arrival: string | null = null;
      let seat: string | null = null;
      let bookingClass: string | null = null;
      let cabin: string | null = null;
      for (let j = i + 1; j < lines.length && !stopsBlock(lines[j]); j++) {
        const l = lines[j];
        const code = l.match(/^([A-Z]{2})\s+(\d{1,4})\s*[.·]\s*\S/);
        if (code && !carrier) {
          carrier = code[1];
          number = code[2];
          continue;
        }
        const op = l.match(/^Flight operated by ([A-Za-z ]+?)(?:\s+as\b|\.|$)/i);
        if (op) {
          operating = operatorCode(op[1]) ?? operating;
          continue;
        }
        if (/^[A-Z]{3}$/.test(l)) {
          if (!origin) origin = l;
          else destination ??= l;
          continue;
        }
        const t = l.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
        if (t) {
          if (!departure) departure = parse12h(t[1], t[2]);
          else arrival ??= parse12h(t[1], t[2]);
          continue;
        }
        /* "14F · Class: L COACH" — the first traveler's line is the ledger
           owner's, matching the first ticket being the one recorded */
        const sc = l.match(/^(\d{1,3}[A-K])\s*[.·]\s*Class:\s*([A-Z])\b\s*(.*)$/i);
        if (sc && !seat) {
          seat = sc[1].toUpperCase();
          bookingClass = sc[2].toUpperCase();
          if (sc[3]) cabin = alaskaCabin(sc[3].trim());
        }
      }
      if (carrier && number && date && origin && destination) {
        out.segments.push({
          carrier,
          operating_carrier: operating,
          flight_number: number,
          origin,
          destination,
          flight_date: date,
          departure_time: departure,
          arrival_time: arrival,
          cabin,
          booking_class: bookingClass,
          seat,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }
    // "Flight 119" or "Flight 528 (Alaska 8241)"
    const head = lines[i].match(/^Flight\s+(\d{1,4})(?:\s*\(([A-Za-z]+)\s+(\d{1,4})\))?$/i);
    if (!head) continue;
    const flownBy = operatorCode(lines[i - 1] ?? "");
    /* A codeshare prints "Flight 528 (Alaska 8241)": Hawaiian flies it, Alaska
       sold it. Marketing is who sold the seat, operating is whose metal it is. */
    const marketing = head[2] ? operatorCode(head[2]) : flownBy;
    const number = head[3] ?? head[1];
    if (!marketing) continue;

    let date: string | null = null;
    let departure: string | null = null;
    let arrival: string | null = null;
    let origin: string | null = null;
    let destination: string | null = null;
    let seat: string | null = null;
    let cabin: string | null = null;
    let bookingClass: string | null = null;
    let operating = head[2] ? flownBy : null;
    for (let j = i + 1; j < lines.length && !stopsBlock(lines[j]); j++) {
      const l = lines[j];
      const d = withYear(l);
      if (d) {
        date ??= d;
        continue;
      }
      const t = l.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
      if (t) {
        if (!departure) departure = parse12h(t[1], t[2]);
        else arrival ??= parse12h(t[1], t[2]);
        continue;
      }
      if (/^[A-Z]{3}$/.test(l)) {
        if (!origin) origin = l;
        else destination ??= l;
        continue;
      }
      // "Seat: 28D, Class: S (Coach)" — or "Seat: † Class: V (Main)"
      const cls = l.match(/Class:\s*([A-Z])\s*\(([^)]+)\)/);
      if (cls) {
        bookingClass ??= cls[1];
        cabin ??= alaskaCabin(cls[2]);
      }
      const st = l.match(/^Seat:\s*(\d{1,2}[A-Z])\b/);
      if (st) seat ??= st[1];
      const op = l.match(/^Flight Operated by\s+(.+?)\.?$/i);
      if (op) operating ??= operatorCode(op[1]);
    }
    if (!date || !origin || !destination) continue;
    out.segments.push({
      carrier: marketing,
      operating_carrier: operating,
      flight_number: String(Number(number)),
      origin,
      destination,
      flight_date: date,
      departure_time: departure,
      arrival_time: arrival,
      cabin,
      booking_class: bookingClass,
      seat,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  if (out.gross_total == null && out.base_fare != null && out.taxes != null)
    out.gross_total = round2(out.base_fare + out.taxes);
  if (out.segments.length === 0) warnings.push("No flights found in this receipt");
  finishCommon(out, emailDate, warnings);
  return out;
}

/* --------------------------------- CWT ---------------------------------- */

/**
 * CWT (Carlson Wagonlit) "Trip document (e-ticket receipt)" — a corporate
 * agency document, so the same rule as ADTRAV and Chase Travel applies: key on
 * the AIRLINE's "Booking Reference", never CWT's own trip locator, or the
 * ticket won't match anything else in the ledger.
 *
 * Its itinerary is labelled rather than positional — DEPARTURE / ARRIVAL /
 * Seat: / Class: / Operated by: — but the values are scattered over several
 * lines each ("Fri, Mar 18" | "4:02pm" | "Oakland" | "(OAK)"), so each leg is
 * read as the block between one DEPARTURE and the next.
 */
function parseCwt(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "cwt",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 1,
    segments: [],
    warnings,
  };

  /** "10 Mar 22" → 2022-03-10 */
  const shortDate = (l: string | undefined) => {
    const m = l?.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{2})$/);
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase()];
    return month
      ? `20${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`
      : null;
  };
  const timeOf = (l: string | undefined) => {
    const m = l?.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    return m ? parse12h(`${m[1]}:${m[2]}`, m[3]) : null;
  };
  const codeOf = (l: string | undefined) => l?.match(/^\(([A-Z]{3})\)$/)?.[1] ?? null;
  const amountOf = (l: string | undefined) => {
    const m = l?.match(/^([\d,]+\.\d{2})$/);
    return m ? num(m[1]) : null;
  };

  /* ------------------------------ header ------------------------------- */
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // the AIRLINE's record locator, not "CWT TRIP LOCATOR"
    const pnr = l.match(/^Booking Reference:\s*([A-Z0-9]{5,7})$/i);
    if (pnr && !out.confirmation) out.confirmation = pnr[1].toUpperCase();
    // "Ticket: SURNAME FORENAME 0069999999999 DL" — name, number, carrier
    const tkt = l.match(/^Ticket:\s+.*?\b(\d{13})\b(?:\s+([A-Z]{2}))?/);
    if (tkt) {
      out.ticket_number ??= tkt[1];
      if (tkt[2]) out.issuing_carrier = tkt[2];
    }
    if (/^Issued:?$/i.test(l)) out.issue_date ??= shortDate(lines[i + 1]);
    if (/^Base:?$/i.test(l)) {
      out.currency = /^[A-Z]{3}$/.test(lines[i + 1] ?? "") ? lines[i + 1] : out.currency;
      out.base_fare ??= amountOf(lines[i + 2]) ?? amountOf(lines[i + 1]);
    }
    if (/^Taxes:?$/i.test(l)) out.taxes ??= amountOf(lines[i + 1]);
    if (/^Total Ticket:?$/i.test(l))
      out.gross_total ??= amountOf(lines[i + 2]) ?? amountOf(lines[i + 1]);
    // "Form of payment: VIxxxxxxxxxxxx1234 FORENAME SURNAME" — GDS code + last 4
    const fop = l.match(/^Form of payment:\s*([A-Z]{2})x+(\d{4})/i);
    if (fop && !out.payment_method) {
      out.payment_method = `${gdsCard(fop[1])} ending in ${fop[2]}`;
      out.payments.push({
        payment_type: "card",
        amount: null,
        award_miles_used: null,
        reference: out.payment_method,
      });
    }
  }
  if (!out.confirmation) {
    const locator = lines
      .find((l) => /^CWT TRIP LOCATOR:/i.test(l))
      ?.split(":")[1]
      ?.trim();
    if (locator) {
      out.confirmation = locator.toUpperCase();
      warnings.push(
        `No airline booking reference found — using CWT's trip locator ${locator}, which won't match an airline receipt`
      );
    }
  }

  /* ----------------------------- itinerary ----------------------------- */
  const starts = lines.reduce<number[]>((acc, l, i) => {
    if (/^DEPARTURE$/i.test(l)) acc.push(i);
    return acc;
  }, []);
  for (let n = 0; n < starts.length; n++) {
    const start = starts[n];
    const stop = n + 1 < starts.length ? starts[n + 1] : lines.length;
    /* the year lives on the day header above the block; the block itself
       prints only "Fri, Mar 18" */
    let date: string | null = null;
    for (let b = start; b >= 0 && b > start - 25; b--) {
      const d = parseLongDate(lines[b]);
      if (d) {
        date = d;
        break;
      }
    }
    let carrier: string | null = null;
    let flightNo: string | null = null;
    for (let b = start - 1; b >= 0 && b > start - 25; b--) {
      if (/^[A-Z]{2}$/.test(lines[b]) && /^\d{1,4}$/.test(lines[b + 1] ?? "")) {
        carrier = lines[b];
        flightNo = String(Number(lines[b + 1]));
        break;
      }
    }
    if (!date || !carrier || !flightNo) continue;

    let departure: string | null = null;
    let arrival: string | null = null;
    let origin: string | null = null;
    let destination: string | null = null;
    let seat: string | null = null;
    let cabin: string | null = null;
    let bookingClass: string | null = null;
    let operating: string | null = null;
    let seenArrival = false;
    for (let j = start + 1; j < stop; j++) {
      const l = lines[j];
      if (/^ARRIVAL$/i.test(l)) {
        seenArrival = true;
        continue;
      }
      const t = timeOf(l);
      if (t) {
        if (!seenArrival) departure ??= t;
        else arrival ??= t;
      }
      const c = codeOf(l);
      if (c) {
        if (!seenArrival) origin ??= c;
        else destination ??= c;
      }
      if (/^Seat:?$/i.test(l) && /^\d{1,2}[A-Z]$/.test(lines[j + 1] ?? ""))
        seat = lines[j + 1];
      if (/^Class:?$/i.test(l)) {
        const cls = lines[j + 1]?.match(/^(.*?)\s*\(([A-Z])\)$/);
        if (cls) {
          cabin = normalizeCabin(cls[1]);
          bookingClass = cls[2];
        }
      }
      if (/^Operated by:?$/i.test(l)) operating = operatorCode(lines[j + 1] ?? "");
    }
    if (!origin || !destination) continue;
    out.segments.push({
      carrier,
      operating_carrier: operating,
      flight_number: flightNo,
      origin,
      destination,
      flight_date: date,
      departure_time: departure,
      arrival_time: arrival,
      cabin,
      booking_class: bookingClass,
      seat,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  if (out.gross_total == null && out.base_fare != null && out.taxes != null)
    out.gross_total = round2(out.base_fare + out.taxes);
  /* One form of payment against a stated total isn't a split to guess at — the
     card paid all of it. Elsewhere the amount stays null precisely because the
     document names several methods without saying who paid what. */
  if (out.payments.length === 1 && out.payments[0].amount == null && out.gross_total != null)
    out.payments[0].amount = out.gross_total;
  if (out.segments.length === 0) warnings.push("No flights found in the trip itinerary");
  finishCommon(out, emailDate, warnings);
  return out;
}

/* ------------------------------ Lufthansa ------------------------------- */

/** Airline names printed under "operated by:", as IATA codes. */
const OPERATOR_CODES: [RegExp, string][] = [
  [/^united/i, "UA"],
  [/^lufthansa cityline/i, "CL"],
  [/^lufthansa/i, "LH"],
  [/^swiss/i, "LX"],
  [/^austrian/i, "OS"],
  [/^brussels/i, "SN"],
  [/^eurowings discover|^discover airlines/i, "4Y"],
  [/^eurowings/i, "EW"],
  [/^air dolomiti/i, "EN"],
  [/^edelweiss/i, "WK"],
  [/^air canada/i, "AC"],
  [/skywest/i, "OO"],
  [/envoy/i, "MQ"],
  [/republic/i, "YX"],
  [/endeavor/i, "9E"],
  [/air wisconsin/i, "ZW"],
  [/mesa airlines/i, "YV"],
  [/^psa /i, "OH"],
  [/^piedmont/i, "PT"],
  [/^delta/i, "DL"],
  [/^american/i, "AA"],
  [/^alaska/i, "AS"],
  [/^hawaiian/i, "HA"],
  [/^horizon/i, "QX"],
];

/** Match an "operated by" name to its IATA code, or null when unrecognized. */
const operatorCode = (name: string) =>
  OPERATOR_CODES.find(([re]) => re.test(name.replace(/^[/\s]+/, "")))?.[1] ?? null;

/**
 * Lufthansa's "Booking details | Departure: … | SFO-KBP". A booking
 * confirmation carrying the ticket number and the full price, so it stands in
 * for a receipt.
 *
 * Its own conventions, none of which the other parsers share:
 *  - dates are European — "Mon. 20 December 2021: San Francisco – Munich";
 *  - times are 24-hour with a unit, "13:30 h", and an arrival past midnight
 *    carries "+1" rather than saying so in the date;
 *  - every leg names its OPERATING carrier in words ("operated by: United
 *    Airlines"), which on a Lufthansa ticket is the only way to know whose
 *    metal you are on;
 *  - the price is a flattened table: headers, then Adult / fare / taxes /
 *    passenger count / total.
 */
function parseLufthansa(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "lufthansa",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "LH",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  /** "Mon. 20 December 2021: San Francisco – Munich" → 2021-12-20 */
  const euDate = (l: string) => {
    const m = l.match(/\b(\d{1,2})\.?\s+([A-Z][a-z]{2,8})\s+(\d{4})/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  };
  /** "13:30 h" / "09:30 h +1" → ["09:30", true] */
  const lhTime = (l: string | undefined): [string, boolean] | null => {
    const m = l?.match(/^(\d{1,2}:\d{2})\s*h(\s*\+(\d))?$/i);
    return m ? [m[1].padStart(5, "0"), m[3] != null] : null;
  };
  const airport = (l: string | undefined) => l?.match(/\(([A-Z]{3})\)$/)?.[1] ?? null;
  const money = (l: string | undefined) => {
    const m = l?.match(/^([A-Z]{3})\s*([\d,]+\.\d{2})$/);
    return m ? { currency: m[1], amount: num(m[2]) } : null;
  };
  const addDays = (date: string, days: number) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const isDayHeader = (l: string) =>
    /^[A-Z][a-z]{2}\.?\s+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\s*:/.test(l);

  let currentDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Lufthansa booking code:?$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{5,7}$/.test(next)) out.confirmation = next;
      continue;
    }
    if (/^Ticket number:?$/i.test(line)) {
      const next = lines[i + 1]?.replace(/[\s-]/g, "");
      if (next && /^\d{10,16}$/.test(next)) out.ticket_number = next;
      continue;
    }
    // day header: "Mon. 20 December 2021: San Francisco – Munich"
    if (isDayHeader(line)) {
      currentDate = euDate(line) ?? currentDate;
      continue;
    }

    /* price table: Adult / fare / taxes / passengers / total */
    if (/^Adults?$|^Child|^Infant/i.test(line)) {
      const fare = money(lines[i + 1]);
      const tax = money(lines[i + 2]);
      const pax = Number(lines[i + 3]);
      if (fare && tax && out.base_fare == null) {
        out.currency = fare.currency;
        out.base_fare = fare.amount;
        out.taxes = tax.amount;
        if (Number.isFinite(pax) && pax > 0) out.travelers = pax;
      }
      continue;
    }
    if (/^Total Price for all Passengers$/i.test(line)) {
      const total = money(lines[i + 1]);
      if (total) {
        out.currency = total.currency;
        // the ledger holds this traveler's own share, as elsewhere
        out.gross_total =
          out.travelers > 1 ? round2(total.amount / out.travelers) : total.amount;
      }
      continue;
    }

    /* ---- itinerary: depart / origin / arrive / destination / flight ---- */
    const dep = lhTime(line);
    if (!dep || !currentDate) continue;
    const origin = airport(lines[i + 1]);
    if (!origin) continue;
    let k = i + 2;
    while (k < lines.length && !lhTime(lines[k])) k++;
    const arr = lhTime(lines[k]);
    const destination = airport(lines[k + 1]);
    if (!arr || !destination) continue;
    let flight: RegExpMatchArray | null = null;
    let operating: string | null = null;
    let cabin: string | null = null;
    let bookingClass: string | null = null;
    /* Read the leg's detail block up to the next leg or the next day — NEVER
       to a fixed line count. A branded fare spells the class over three lines
       ("Class/Fare:" / "Economy Class/" / "Economy Light" / "(M)") instead of
       one ("Economy Class (U)"), and a scan that runs to a cap looking for the
       one-line form marches straight over the following leg's departure time,
       silently importing a two-leg booking as one flight. */
    let j = k + 2;
    const limit = Math.min(lines.length, k + 30);
    for (; j < limit; j++) {
      const l = lines[j];
      if (lhTime(l) || isDayHeader(l)) break;
      const f = l.match(/^([A-Z]{2})\s*(\d{1,4})$/);
      if (f && !flight) flight = f;
      if (/^operated by:?$/i.test(l)) {
        const name = lines[j + 1] ?? "";
        operating = operatorCode(name);
        if (!operating && name)
          warnings.push(`Unrecognized operating carrier "${name}" — left blank`);
      }
      const oneLine = l.match(/^(.*?)\s*Class\s*\(([A-Z])\)$/i);
      if (oneLine) {
        cabin = normalizeCabin(oneLine[1]);
        bookingClass = oneLine[2];
        continue;
      }
      // "Economy Class/" on its own — the fare brand and letter follow
      if (/Class/i.test(l) && cabin == null) cabin = normalizeCabin(l);
      const letterOnly = l.match(/^\(([A-Z])\)$/);
      if (letterOnly) bookingClass = letterOnly[1];
      if (flight && bookingClass) break; // the block has everything it holds
    }
    /* Only ever skip lines this block actually consumed. Running past the last
       leg swallowed the price table that follows the itinerary; running past a
       malformed block would swallow anything. */
    if (flight) i = Math.max(i, j - 1);
    if (!flight) continue;
    out.segments.push({
      carrier: flight[1],
      operating_carrier: operating,
      flight_number: String(Number(flight[2])),
      origin,
      destination,
      flight_date: currentDate,
      departure_time: dep[0],
      arrival_time: arr[0],
      cabin,
      booking_class: bookingClass,
      seat: null,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  if (out.travelers === 0) out.travelers = 1;
  if (out.gross_total == null && out.base_fare != null && out.taxes != null)
    out.gross_total = round2(out.base_fare + out.taxes);
  if (out.segments.length === 0) warnings.push("No flights found in the itinerary");
  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------------- Delta --------------------------------- */

/**
 * Delta's "Your Flight Receipt" (DeltaAirLines@t.delta.com). No schema.org
 * markup, so the text is all there is — and the text splits every flight
 * across three places that have to be knitted back together:
 *
 *  - The flight block prints the date WITHOUT A YEAR ("Sun, 08MAR") and the
 *    cities by NAME ("NYC-KENNEDY"), not code.
 *  - The Checked Bag Allowance table prints the same flight as
 *    "Sun 08 Mar 2026 JFK-SFO" — year and airport codes, but no times.
 *    Matching the two on day+month completes the segment; a flight the bag
 *    table can't pin down unambiguously is reported, not guessed.
 *  - Seats live in their own FLIGHT/SEAT table ("DELTA 670" / "45C"), keyed
 *    by flight number ("Seat Assigned After Check-In" when there is none).
 *
 * The money is conventional: Base Fare, itemized taxes (each with its IATA
 * code), TICKET AMOUNT — every amount as "$212.82 CAD", so the currency rides
 * on the amounts themselves: a YUL departure bills in CAD on the same layout.
 */
function parseDelta(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "delta_receipt",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "DL",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  const moneyLine = (l: string | undefined) =>
    l?.match(/^\$([\d,]+\.\d{2})\s*([A-Z]{3})$/) ?? null;
  const CARD_BRANDS: Record<string, string> = {
    VI: "Visa",
    MC: "Mastercard",
    CA: "Mastercard",
    AX: "American Express",
    DS: "Discover",
    DC: "Diners Club",
    JC: "JCB",
  };

  const seatByFlight = new Map<string, string>();
  /** "Sun 08 Mar 2026 JFK-SFO", keyed by "08MAR" for the year-less blocks */
  const bagRoutes = new Map<
    string,
    { date: string; origin: string; destination: string }[]
  >();
  const blocks: {
    key: string;
    flightNo: string;
    cabin: string | null;
    cls: string | null;
    depTime: string | null;
    arrTime: string | null;
  }[] = [];

  let inTaxes = false;
  let taxLabel = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Confirmation Number$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{6}$/.test(next)) out.confirmation = next;
      continue;
    }
    const tkt = line.match(/^Ticket #:\s*(\d{13})$/i);
    if (tkt) {
      out.ticket_number = tkt[1];
      continue;
    }
    // "Issue Date: 20FEB26"
    const issued = line.match(/^Issue Date:\s*(\d{2})([A-Z]{3})(\d{2})$/i);
    if (issued) {
      const month = MONTHS[issued[2].toLowerCase()];
      if (month)
        out.issue_date = `20${issued[3]}-${String(month).padStart(2, "0")}-${issued[1]}`;
      continue;
    }
    if (/^SkyMiles #\d/i.test(line)) {
      out.frequent_flyer_program = "DL";
      continue;
    }
    if (/^Name:/i.test(line)) {
      out.travelers += 1;
      continue;
    }

    // "METHOD OF PAYMENT" / "VI************ 1234" / "$546.80 USD"
    if (/^METHOD OF PAYMENT$/i.test(line)) {
      const card = lines[i + 1]?.match(/^([A-Z]{2})\*+\s*(\d{4})$/);
      const amt = moneyLine(lines[i + 2]);
      if (card) {
        const brand = CARD_BRANDS[card[1]] ?? card[1];
        out.payment_method = `${brand} ending in ${card[2]}`;
        out.payments.push({
          payment_type: classifyPayment(out.payment_method),
          amount: amt ? num(amt[1]) : null,
          award_miles_used: null,
          reference: out.payment_method,
        });
      }
      continue;
    }

    if (/^Base Fare$/i.test(line)) {
      const m = moneyLine(lines[i + 1]);
      if (m) {
        out.base_fare = num(m[1]);
        out.currency = m[2];
        i += 1;
      }
      continue;
    }
    if (/^Taxes, Fees and Charges$/i.test(line)) {
      inTaxes = true;
      continue;
    }
    if (/^TICKET AMOUNT$/i.test(line)) {
      inTaxes = false;
      const m = moneyLine(lines[i + 1]);
      if (m) {
        out.gross_total = num(m[1]);
        out.currency = m[2];
        i += 1;
      }
      continue;
    }
    if (inTaxes) {
      const m = moneyLine(line);
      if (m) {
        // "(YQ)" and "(YR)" are carrier-imposed surcharges; the rest is taxes
        const surcharge = /\((?:YQ|YR)\)|surcharge/i.test(taxLabel);
        const key = surcharge ? "surcharges" : "taxes";
        out[key] = Math.round(((out[key] ?? 0) + num(m[1])) * 100) / 100;
      } else taxLabel = line;
      continue;
    }

    // FLIGHT/SEAT table: "DELTA 670" / "45C"
    const seatRow = line.match(/^DELTA\s+(\d{1,4})$/i);
    if (seatRow && /^\d{1,3}[A-Z]$/.test(lines[i + 1] ?? "")) {
      seatByFlight.set(String(Number(seatRow[1])), lines[i + 1]);
      continue;
    }

    // bag table: "Sun 08 Mar 2026 JFK-SFO"
    const bag = line.match(
      /^[A-Z][a-z]{2}\s+(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})\s+([A-Z]{3})-([A-Z]{3})$/
    );
    if (bag) {
      const month = MONTHS[bag[2].toLowerCase()];
      if (month) {
        const key = `${bag[1].padStart(2, "0")}${bag[2].toUpperCase()}`;
        const list = bagRoutes.get(key) ?? [];
        list.push({
          date: `${bag[3]}-${String(month).padStart(2, "0")}-${bag[1].padStart(2, "0")}`,
          origin: bag[4],
          destination: bag[5],
        });
        bagRoutes.set(key, list);
      }
      continue;
    }

    // flight block: "Sun, 08MAR" / DEPART / ARRIVE / "DELTA 670" /
    // "Delta Main Classic (U)" / "NYC-KENNEDY" / "05:25PM" / "SAN FRANCISCO"
    // / "09:00PM" — a codeshare stars the flight ("DELTA 5449*") and explains
    // the star in a footnote the parser doesn't need
    const day = line.match(/^[A-Z][a-z]{2},\s*(\d{2})([A-Z]{3})$/);
    if (
      day &&
      /^DEPART$/i.test(lines[i + 1] ?? "") &&
      /^ARRIVE$/i.test(lines[i + 2] ?? "")
    ) {
      const flight = lines[i + 3]?.match(/^DELTA\s+(\d{1,4})\*?$/i);
      const cab = lines[i + 4]?.match(/^(.*?)\s*\(([A-Z])\)$/);
      const dep = lines[i + 6]?.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
      const arr = lines[i + 8]?.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
      if (flight) {
        blocks.push({
          key: `${day[1]}${day[2].toUpperCase()}`,
          flightNo: String(Number(flight[1])),
          cabin: cab ? normalizeCabin(cab[1]) : null,
          cls: cab?.[2] ?? null,
          depTime: dep ? parse12h(dep[1], dep[2]) : null,
          arrTime: arr ? parse12h(arr[1], arr[2]) : null,
        });
        i += 8;
      }
      continue;
    }
  }

  for (const b of blocks) {
    const routes = bagRoutes.get(b.key) ?? [];
    const sameDay = blocks.filter((o) => o.key === b.key);
    // Codes come from the bag table, so the pairing must be one-to-one: a
    // same-day connection prints ONE bag line for the whole fare component,
    // and handing its endpoints to both legs would invent a nonstop.
    if (routes.length !== 1 || sameDay.length !== 1) {
      warnings.push(
        `Couldn't read the airports for flight DL${b.flightNo} (${b.key.slice(0, 2)} ${b.key.slice(2)}) — add it manually`
      );
      continue;
    }
    out.segments.push({
      carrier: "DL",
      flight_number: b.flightNo,
      origin: routes[0].origin,
      destination: routes[0].destination,
      flight_date: routes[0].date,
      departure_time: b.depTime,
      arrival_time: b.arrTime,
      cabin: b.cabin,
      booking_class: b.cls,
      seat: seatByFlight.get(b.flightNo) ?? null,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }

  if (out.travelers === 0) out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------------- Azul ---------------------------------- */

/** "R$ 577,50" / "1.234,56" — Brazilian format: dot thousands, comma decimals. */
const brNum = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** "54 000" / "3 132" — space (or NBSP) as the thousands separator. */
const spacedNum = (s: string) => Number(s.replace(/[  ]/g, ""));

/** A fresh all-null ParsedReceipt — every parser fills in what its document
 *  actually states and not a field more. */
function emptyReceipt(
  kind: ParsedReceipt["kind"],
  issuingCarrier: string,
  emailDate: string | null,
  warnings: string[]
): ParsedReceipt {
  return {
    kind,
    confirmation: null,
    ticket_number: null,
    issuing_carrier: issuingCarrier,
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };
}

/**
 * Azul's "Reserva TQJWFX realizada com sucesso" (noreply@voeazul-news.com.br),
 * in Portuguese, in two layouts that differ in one telling way: one prints
 * the flight datetime as "02/03/2026 - 13:20", the other as "02/03 • 13:20" —
 * the same booking with and without a year. Day comes FIRST in both (02/03 is
 * March 2nd), and the year-less form resolves against the email's own date.
 *
 * The money reconciles: Tarifa Total + seat charge + Serviços = Total da
 * Passagem, all in "R$" (BRL). Payment can be PIX — an instant bank transfer,
 * not a card — so the method is recorded as printed.
 */
function parseAzul(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("azul", "AD", emailDate, warnings);
  out.currency = "BRL";

  const money = (l: string | undefined) => l?.match(/^R\$\s*([\d.,]+)$/) ?? null;
  let payMethod: string | null = null;
  let pendingSeat: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Seu código de reserva é:?$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{6}$/.test(next)) out.confirmation = next;
      continue;
    }

    // "VCP" / "São Paulo, Viracopos-Campinas" / "02/03/2026 - 13:20" /
    // "Voo 4849" / "FLN" / "Florianopolis, …" / "02/03/2026 - 14:35"
    const voo = line.match(/^Voo\s+(\d{1,4})$/i);
    if (voo && /^[A-Z]{3}$/.test(lines[i - 3] ?? "") && /^[A-Z]{3}$/.test(lines[i + 1] ?? "")) {
      const dt = (l: string | undefined) =>
        l?.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?\s*[-•]\s*(\d{2}:\d{2})$/) ?? null;
      const dep = dt(lines[i - 1]);
      const arr = dt(lines[i + 3]);
      if (dep) {
        out.segments.push({
          carrier: "AD",
          flight_number: String(Number(voo[1])),
          origin: lines[i - 3],
          destination: lines[i + 1],
          flight_date: dep[3]
            ? `${dep[3]}-${dep[2]}-${dep[1]}`
            : resolveYear(Number(dep[2]), Number(dep[1]), emailDate),
          departure_time: dep[4],
          arrival_time: arr?.[4] ?? null,
          cabin: null,
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }

    // "Batman da Silva" / "1 incluída" / "6C"
    if (/incluída/i.test(line) && /^\d{1,3}[A-Z]$/.test(lines[i + 1] ?? "")) {
      pendingSeat = lines[i + 1];
      continue;
    }

    const val = money(lines[i + 1]);
    if (val) {
      if (/^Tarifa Total$/i.test(line)) out.base_fare = brNum(val[1]);
      else if (/^Assento\b/i.test(line) || /^Serviços$/i.test(line))
        out.ancillary_fees =
          Math.round(((out.ancillary_fees ?? 0) + brNum(val[1])) * 100) / 100;
      else if (/^Total da Passagem$/i.test(line)) out.gross_total = brNum(val[1]);
      else if (/^Total da compra$/i.test(line)) out.gross_total ??= brNum(val[1]);
    }
    if (/^(PIX|Boleto|Cartão(?: de crédito)?)$/i.test(line)) payMethod = line;
  }

  if (pendingSeat && out.segments.length === 1) out.segments[0].seat = pendingSeat;
  if (payMethod) {
    out.payment_method = payMethod;
    out.payments.push({
      payment_type: classifyPayment(payMethod),
      amount: out.gross_total,
      award_miles_used: null,
      reference: payMethod,
    });
  }
  out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------------- LATAM --------------------------------- */

const PT_MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/**
 * LATAM's Portuguese purchase confirmation ("Você já comprou sua viagem…").
 * The itinerary is positional around the flight line (LA3357): date, time,
 * city, "(FLN)" above it; the same four below for the arrival. Dates are
 * Portuguese ("16 de mar. de 2026"). Money is a single "Total: BRL 632,86" —
 * the receipt says the breakdown travels as a PDF attachment, which this
 * importer doesn't read, so only the total lands and a note explains why.
 */
function parseLatam(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("latam", "LA", emailDate, warnings);
  out.currency = "BRL";

  const ptDate = (l: string | undefined): string | null => {
    const m = l?.match(/^(\d{1,2}) de ([a-zç]{3})\.? de (\d{4})$/i);
    const month = m ? PT_MONTHS[m[2].toLowerCase()] : null;
    return m && month
      ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`
      : null;
  };
  const paren = (l: string | undefined) => l?.match(/^\(([A-Z]{3})\)$/)?.[1] ?? null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Código de reserva:?$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{6}$/.test(next)) out.confirmation = next;
      continue;
    }

    // "16 de mar. de 2026" / "11:45" / "Florianópolis" / "(FLN)" / "LA3357" /
    // "16 de mar. de 2026" / "13:10" / "São Paulo" / "(GRU)"
    const flight = line.match(/^([A-Z]{2})(\d{1,4})$/);
    if (flight && paren(lines[i - 1]) && paren(lines[i + 4])) {
      const date = ptDate(lines[i - 4]);
      if (date) {
        out.segments.push({
          carrier: flight[1],
          flight_number: String(Number(flight[2])),
          origin: paren(lines[i - 1])!,
          destination: paren(lines[i + 4])!,
          flight_date: date,
          departure_time: lines[i - 3]?.match(/^\d{1,2}:\d{2}$/) ? lines[i - 3] : null,
          arrival_time: lines[i + 2]?.match(/^\d{1,2}:\d{2}$/) ? lines[i + 2] : null,
          cabin: null,
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }

    if (/^Total:?$/i.test(line)) {
      const m = lines[i + 1]?.match(/^([A-Z]{3})\s*([\d.,]+)$/);
      if (m) {
        out.currency = m[1];
        out.gross_total = brNum(m[2]);
      }
    }
  }

  if (out.gross_total != null)
    warnings.push(
      "LATAM sends the fare breakdown as a PDF attachment, which this importer doesn't read — only the total is recorded"
    );
  out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* --------------------------------- SAS ---------------------------------- */

const SV_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};

/**
 * SAS sends two documents. The Swedish "bokningsbekräftelse" carries the whole
 * trip: legs are "Stockholm ARN - London LHR" route lines whose NEXT line is a
 * time range (a summary line in the same shape is followed by the date
 * instead — that's how the two are told apart), with the flight in a
 * "… | SK 533 | SAS" details line. The money block prices an award —
 * "Flygning" 54 000 p (points) against "Skatter och avgifter" in SEK — and a
 * party of two divides to one traveler's share like every other
 * multi-traveler receipt here.
 *
 * The English "Electronic Ticket Itinerary and Receipt" email is the other
 * document: a courtesy note whose entire content — itinerary and money —
 * lives in a PDF attachment this importer doesn't read. It is recognized
 * precisely so the import can say that, instead of "unrecognized file".
 */
function parseSas(
  raw: string[],
  emailDate: string | null,
  attachments: number
): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("sas", "SK", emailDate, warnings);
  out.currency = "SEK";

  if (!lines.some((l) => /^Bokningsreferens:/i.test(l))) {
    warnings.push(
      `SAS sent the actual ticket as a PDF attachment${attachments ? ` (${attachments} attached)` : ""}, which this importer doesn't read — the itinerary and amounts are in the PDF, so enter the ticket manually`
    );
    out.travelers = 1;
    finishCommon(out, emailDate, warnings);
    return out;
  }

  let currentDate: string | null = null;
  let cabin: string | null = null;
  let inTaxes = false;
  let sawTotal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const conf = line.match(/^Bokningsreferens:\s*([A-Z0-9]{6})$/i);
    if (conf) {
      out.confirmation = conf[1].toUpperCase();
      continue;
    }

    // "28 okt 2025"
    const d = line.match(/^(\d{1,2}) ([a-z]{3}) (\d{4})$/i);
    const month = d ? SV_MONTHS[d[2].toLowerCase()] : null;
    if (d && month) {
      currentDate = `${d[3]}-${String(month).padStart(2, "0")}-${d[1].padStart(2, "0")}`;
      continue;
    }

    const cab = normalizeCabin(line);
    if (cab && line === line.toUpperCase() && line.length <= 20) {
      cabin = cab;
      continue;
    }

    // "Stockholm ARN - London LHR" is a leg only when the NEXT line is its
    // times — the trip-summary line in the same shape is followed by a date.
    const route = line.match(/^(.+?)\s+([A-Z]{3})\s+-\s+(.+?)\s+([A-Z]{3})$/);
    const times = lines[i + 1]?.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (route && times) {
      let carrier: string | null = null;
      let flightNo: string | null = null;
      for (let j = i + 2; j < Math.min(i + 4, lines.length); j++) {
        const fl = lines[j]?.match(/\|\s*([A-Z]{2})\s*(\d{1,4})\s*\|/);
        if (fl) {
          carrier = fl[1];
          flightNo = String(Number(fl[2]));
          break;
        }
      }
      if (carrier && flightNo && currentDate) {
        out.segments.push({
          carrier,
          flight_number: flightNo,
          origin: route[2],
          destination: route[4],
          flight_date: currentDate,
          departure_time: times[1],
          arrival_time: times[2],
          cabin,
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }

    if (/^Skatter och avgifter$/i.test(line)) {
      inTaxes = true;
      continue;
    }
    if (/^Totalt betalt belopp$/i.test(line)) {
      sawTotal = true;
      continue;
    }
    const points = line.match(/^([\d  ]+)\s*p$/);
    if (points && inTaxes) {
      out.miles_redeemed = spacedNum(points[1]);
      continue;
    }
    const amount = line.match(/^([\d  ]+(?:[.,]\d{2})?)\s*([A-Z]{3})$/);
    if (amount && inTaxes) {
      const v = spacedNum(amount[1].replace(",", "."));
      out.currency = amount[2];
      if (sawTotal) out.gross_total = v;
      else out.taxes = v;
      continue;
    }
  }

  // "JOHN TEST" / "Bonusprogram" — one Bonusprogram row per traveler
  out.travelers = Math.max(1, lines.filter((l) => /^Bonusprogram$/i.test(l)).length);
  if (out.travelers > 1) {
    const share = (v: number | null) =>
      v == null ? null : Math.round((v / out.travelers) * 100) / 100;
    out.gross_total = share(out.gross_total);
    out.taxes = share(out.taxes);
    if (out.miles_redeemed != null)
      out.miles_redeemed = Math.round(out.miles_redeemed / out.travelers);
    warnings.push(
      `${out.travelers} travelers on this booking — recorded your share of the points and the ${out.currency} amounts`
    );
  }
  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------------- Wizz ---------------------------------- */

/**
 * Wizz Air's "Your travel itinerary: GW8PSD" — usually forwarded, so the
 * detector reads the wizzair.com address out of the forwarded header block in
 * the body, never trusting the envelope From. Dates are day-first
 * ("14/05/2026"), and departure and arrival share one line. The charges table
 * prints one "Fare price" line per passenger plus an administration fee, and
 * the grand total is their sum — a party of two divides to one traveler's
 * share on import.
 */
function parseWizz(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("wizz", "W6", emailDate, warnings);
  out.currency = "EUR";

  const fares: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(?:Flight c|C)onfirmation code:?$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{6}$/.test(next)) out.confirmation ??= next;
      continue;
    }
    if (/^Booking date:?$/i.test(line)) {
      const m = lines[i + 1]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) out.issue_date = `${m[3]}-${m[2]}-${m[1]}`;
      continue;
    }

    // "Flight Number: W9 5362" … "Barcelona El Prat - Terminal 2 (BCN)" /
    // "London Luton (LTN)" / "14/05/2026 09:35 14/05/2026 11:00"
    const flight = line.match(/^Flight Number:\s*([A-Z0-9]{2})\s*(\d{1,4})$/i);
    if (flight) {
      const codes: string[] = [];
      let dep: RegExpMatchArray | null = null;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const c = lines[j].match(/\(([A-Z]{3})\)$/);
        if (c && codes.length < 2) codes.push(c[1]);
        dep ??= lines[j].match(
          /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/
        );
        if (codes.length === 2 && dep) break;
      }
      if (codes.length === 2 && dep) {
        out.segments.push({
          carrier: flight[1],
          flight_number: String(Number(flight[2])),
          origin: codes[0],
          destination: codes[1],
          flight_date: `${dep[3]}-${dep[2]}-${dep[1]}`,
          departure_time: dep[4],
          arrival_time: dep[8],
          cabin: "Economy", // "All Wizz flights are economy-class only."
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }

    const fare = line.match(/^Fare price\s+([\d.,]+)$/i);
    if (fare) {
      fares.push(num(fare[1]));
      continue;
    }
    const admin = line.match(/^Administration fee\s+([\d.,]+)$/i);
    if (admin) {
      out.ancillary_fees = num(admin[1]);
      continue;
    }
    if (/^Grand total$/i.test(line)) {
      const v = lines[i + 1]?.match(/^([\d.,]+)$/);
      const c = lines[i + 2]?.match(/^([A-Z]{3})$/);
      if (v) out.gross_total = num(v[1]);
      if (c) out.currency = c[1];
      continue;
    }
  }

  if (out.segments.length) out.issuing_carrier = out.segments[0].carrier;
  if (fares.length) {
    out.base_fare = Math.round(fares.reduce((s, v) => s + v, 0) * 100) / 100;
    // one "Fare price" line per passenger
    out.travelers = fares.length;
  }
  if (out.travelers > 1) {
    const share = (v: number | null) =>
      v == null ? null : Math.round((v / out.travelers) * 100) / 100;
    out.base_fare = share(out.base_fare);
    out.ancillary_fees = share(out.ancillary_fees);
    out.gross_total = share(out.gross_total);
    warnings.push(
      `${out.travelers} travelers on this booking — recorded your share of the ${out.currency} amounts`
    );
  }
  if (out.travelers === 0) out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* ------------------------------ Southwest ------------------------------- */

/**
 * Southwest's trip emails ("…itinerary.", "Your 11/01 trip … is all set.").
 * Two shapes: the full itinerary with numbered "Flight N:" blocks, and a
 * pre-trip reminder carrying only a route summary. NEITHER carries any money —
 * Southwest bills on a separate purchase receipt not present in any public
 * corpus — so the import scaffolds the flights and says exactly why the
 * ticket has no amounts, the same honesty rule as the markup fallback.
 */
function parseSouthwest(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("southwest", "WN", emailDate, warnings);

  let currentDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const conf = line.match(/^Confirmation #\s*([A-Z0-9]{6})$/i);
    if (conf) {
      out.confirmation = conf[1].toUpperCase();
      continue;
    }
    const issued = line.match(/^Confirmation date:\s*(\d{2}\/\d{2}\/\d{4})$/i);
    if (issued) {
      out.issue_date = parseSlashDate(issued[1]);
      continue;
    }
    if (/^PASSENGER$/i.test(line)) {
      out.travelers += 1;
      continue;
    }
    // "Friday, 09/30/2022"
    const day = line.match(/^[A-Z][a-z]+day,\s*(\d{2}\/\d{2}\/\d{4})$/);
    if (day) {
      currentDate = parseSlashDate(day[1]);
      continue;
    }
    // "FLIGHT" / "# 114" / "DEPARTS" / "OAK 03:00 PM" / … / "ARRIVES" / "LAS 04:30 PM"
    const no = line.match(/^#\s*(\d{1,4})$/);
    if (no && /^FLIGHT$/i.test(lines[i - 1] ?? "") && currentDate) {
      const stop = (label: string) => {
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          if (new RegExp(`^${label}$`, "i").test(lines[j])) {
            const m = lines[j + 1]?.match(/^([A-Z]{3})\s+(\d{1,2}:\d{2})\s*(AM|PM)$/i);
            if (m) return { code: m[1], time: parse12h(m[2], m[3]) };
          }
        }
        return null;
      };
      const dep = stop("DEPARTS");
      const arr = stop("ARRIVES");
      if (dep && arr) {
        out.segments.push({
          carrier: "WN",
          flight_number: String(Number(no[1])),
          origin: dep.code,
          destination: arr.code,
          flight_date: currentDate,
          departure_time: dep.time,
          arrival_time: arr.time,
          cabin: null,
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }
  }

  warnings.push(
    "Southwest bills on a separate purchase receipt — this email carries only the itinerary, so no amounts are recorded"
  );
  // Pre-empt the generic "amounts are per passenger" note: there are no
  // amounts here for it to be about.
  if (out.travelers > 1)
    warnings.push(
      `${out.travelers} passengers on this itinerary — your share of any cost will come from the purchase receipt, not this email`
    );
  if (out.travelers === 0) out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* -------------------------------- Kiwi ---------------------------------- */

/**
 * Kiwi.com's OTA confirmation. The email itself explains why there is nothing
 * to import: the carriers' locators live in Kiwi's app, the payment is
 * "successful" with no amount printed, and the itinerary is two city names.
 * Kiwi's own nine-digit booking number is an agency locator, which matches
 * nothing in this ledger (the agency-locator rule). The format is recognized
 * precisely so the import can say all that instead of "unrecognized file".
 */
function parseKiwi(raw: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  const out = emptyReceipt("kiwi", "", emailDate, warnings);
  warnings.push(
    "Kiwi.com's confirmation names no airline locator, no flights and no amounts — the airline's own receipt is the document worth importing"
  );
  out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

/* ---------------------------- Capital One Travel ------------------------ */

/**
 * Capital One Travel's flight receipt (capitalone@capitalonebooking.com).
 * An agency document with a twist: a "multiple itineraries" trip is really
 * TWO tickets — separate airline locators for the outbound and the return
 * ("LMTRZQ" out, "KZUAUU" back) — and Capital One's own "H-H-…" code is an
 * agency locator, which matches nothing (the agency-locator rule).
 *
 * The fare details are per traveler and reconcile exactly: base + taxes per
 * person, plus the seat-selection total split across the party, equals each
 * share of the "Total US$469.04". A card benefit ("Annual Travel Credit
 * Applied −$300.00") reduces what the card was charged, not what the ticket
 * cost — it is reported like a statement credit, never netted out of the
 * fare.
 */
function parseCapitalOne(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("capital_one", "", emailDate, warnings);

  const money = (l: string | undefined) =>
    l?.match(/^-?(?:US)?\$([\d,]+\.\d{2})$/) ?? null;

  const airlineConfs: string[] = [];
  const baseFares: number[] = [];
  const taxFees: number[] = [];
  let seatTotal: number | null = null;
  let cardPaid: number | null = null;
  let cardName: string | null = null;
  let creditApplied: number | null = null;
  let creditName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "Your confirmation codes": airline-name / code pairs, then Capital
    // One's own "H-H-G4K8NY7KW4" — the agency locator, skipped on purpose
    if (/^[A-Z0-9]{6}$/.test(line) && i > 0 && /Airlines?|Air\b/i.test(lines[i - 1])) {
      airlineConfs.push(line);
      continue;
    }

    // "Outbound to Chicago" / "Basic Economy" / "July 15, 2026" / … /
    // "American Airlines - AA3100" / city / LGA / "9:44 a.m." / … / ORD / "11:30 a.m."
    if (/^(?:Outbound to|Return to)\s+/i.test(line)) {
      let cabin: string | null = null;
      let date: string | null = null;
      let flight: { carrier: string; number: string } | null = null;
      const codes: string[] = [];
      const times: string[] = [];
      for (let j = i + 1; j < lines.length && j < i + 20; j++) {
        const l = lines[j];
        if (/^(?:Outbound to|Return to)\s+/i.test(l) || /^Fare Details$/i.test(l)) break;
        cabin ??= normalizeCabin(l);
        date ??= parseLongDate(l);
        const fl = l.match(/-\s*([A-Z][A-Z0-9])\s?(\d{1,4})$/);
        if (fl && !flight) flight = { carrier: fl[1], number: String(Number(fl[2])) };
        if (/^[A-Z]{3}$/.test(l)) codes.push(l);
        const t = l.match(/^(\d{1,2}:\d{2})\s*([ap])\.?m\.?$/i);
        if (t) times.push(parse12h(t[1], t[2] + "m"));
      }
      if (flight && date && codes.length >= 2) {
        out.segments.push({
          carrier: flight.carrier,
          flight_number: flight.number,
          origin: codes[0],
          destination: codes[1],
          flight_date: date,
          departure_time: times[0] ?? null,
          arrival_time: times[1] ?? null,
          cabin,
          booking_class: null,
          seat: null,
          projected_pqp: null,
          projected_pqf: null,
          projected_award_miles: null,
        });
      }
      continue;
    }

    if (/^Base Fare:?$/i.test(line)) {
      const m = money(lines[i + 1]);
      if (m) baseFares.push(num(m[1]));
      continue;
    }
    if (/^Taxes and Fees:?$/i.test(line)) {
      const m = money(lines[i + 1]);
      if (m) taxFees.push(num(m[1]));
      continue;
    }
    if (/^Seat Selection$/i.test(line)) {
      const m = money(lines[i + 1]);
      if (m) seatTotal ??= num(m[1]);
      continue;
    }
    if (/^Total$/i.test(line)) {
      const m = money(lines[i + 1]);
      if (m) out.gross_total ??= num(m[1]);
      continue;
    }
    const card = line.match(/^Card Payment from\s+(.+)$/i);
    if (card) {
      cardName = card[1];
      const m = money(lines[i + 1]);
      if (m) cardPaid = num(m[1]);
      continue;
    }
    const credit = line.match(/^(.+Credit)\s+Applied$/i);
    if (credit) {
      creditName = credit[1];
      const m = money(lines[i + 1]);
      if (m) creditApplied = num(m[1]);
      continue;
    }
  }

  out.confirmation = airlineConfs[0] ?? null;
  if (airlineConfs.length > 1) {
    warnings.push(
      `Separate tickets per direction — airline confirmations ${airlineConfs.join(", ")}; recorded under ${airlineConfs[0]}, so match the return's documents to ${airlineConfs.slice(1).join(", ")} yourself`
    );
  }
  if (out.segments.length) out.issuing_carrier = out.segments[0].carrier;

  // fare details print once per traveler, and they are each traveler's share
  out.travelers = Math.max(1, baseFares.length);
  const share = (v: number) => Math.round((v / out.travelers) * 100) / 100;
  if (baseFares.length) out.base_fare = baseFares[0];
  if (taxFees.length) out.taxes = taxFees[0];
  if (seatTotal != null) out.ancillary_fees = share(seatTotal);
  if (out.gross_total != null && out.travelers > 1) {
    const whole = out.gross_total;
    out.gross_total = share(whole);
    warnings.push(
      `${out.travelers} travelers on this booking — recorded your share (${out.gross_total.toFixed(2)} ${out.currency}) of the ${whole.toFixed(2)} ${out.currency} total`
    );
  }
  if (cardPaid != null && cardName) {
    out.payment_method = cardName;
    out.payments.push({
      payment_type: "card",
      amount: share(cardPaid),
      award_miles_used: null,
      reference: cardName,
    });
  }
  if (creditApplied != null) {
    out.payments.push({
      payment_type: "other",
      amount: share(creditApplied),
      award_miles_used: null,
      reference: creditName ?? "Travel credit",
    });
    warnings.push(
      `A ${creditApplied.toFixed(2)} ${out.currency} ${creditName ?? "travel credit"} reduced the card charge, not the ticket's price — record it as a statement credit if you track it`
    );
  }

  finishCommon(out, emailDate, warnings);
  return out;
}

/* --------------------------- American Airlines -------------------------- */

/**
 * American's "Your trip confirmation (IAH - CMI)" — itinerary and receipt in
 * one email. A non-United ticket still belongs in this ledger: it costs money
 * and flies miles. It simply earns no MileagePlus credit, which the rest of the
 * app already handles for any non-UA carrier.
 *
 * Its itinerary blocks are anchored on the flight line, because everything
 * around it moves: a codeshare inserts "Operated by Envoy Air" / "as American
 * Eagle" between the flight and its destination, and only the FIRST leg of each
 * day carries a date.
 *
 *   IAH / Houston George Bush / 11:44 AM / AA 1636 / ORD / Chicago O'Hare /
 *   2:20 PM / Seat: / Class: / Economy / (O) / Meals:
 */
function parseAaReceipt(raw: string[], emailDate: string | null): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "aa_receipt",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "AA",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  const isCode = (l: string | undefined) => !!l && /^[A-Z]{3}$/.test(l);
  const asTime = (l: string | undefined) => {
    const m = l?.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
    return m ? parse12h(m[1], m[2]) : null;
  };

  let currentDate: string | null = null;
  const tickets: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Issued:?$/i.test(line)) out.issue_date ??= parseLongDate(lines[i + 1] ?? "");
    else if (/^Confirmation code:?$/i.test(line)) {
      const next = lines[i + 1];
      if (next && /^[A-Z0-9]{5,7}$/.test(next)) out.confirmation = next;
    } else {
      // the receipt variant prints it inline: "Record Locator: EIKCON"
      const rl = line.match(/^Record Locator:\s*([A-Z0-9]{5,7})$/i);
      if (rl) out.confirmation ??= rl[1].toUpperCase();
    }
    const d = parseLongDate(line);
    if (d && /^[A-Z][a-z]+day,/.test(line)) currentDate = d;

    // "New ticket (0017900000001)" — one per traveler
    const tkt = line.match(/^(?:New|Reissued) ticket\s*\((\d[\d-]{9,})\)/i);
    if (tkt) {
      tickets.push(tkt[1].replace(/-/g, ""));
      // the amount and its breakdown follow on the next two lines
      out.gross_total ??= moneyOf(lines[i + 1]);
      const parts = lines[i + 2]?.match(
        /\$([\d,]+\.\d{2})\s*\+\s*Taxes[^$]*\$([\d,]+\.\d{2})/i
      );
      if (parts && out.base_fare == null) {
        out.base_fare = num(parts[1]);
        out.taxes = num(parts[2]);
      }
      continue;
    }
    if (/^Total cost$/i.test(line)) out.gross_total = moneyOf(lines[i + 1]) ?? out.gross_total;

    /* "Paid Seat (SFO-DFW)" / "$10.21" / "Document #: (0010642578625)" — an
       extra bought with the ticket, issued as its own document. "Total cost"
       includes it, so it must be in the parts too, or the sum check cries
       wolf over the receipt's own arithmetic. */
    if (/^Document #:/i.test(line)) {
      const amt = moneyOf(lines[i - 1]);
      const what = lines[i - 2];
      if (amt != null && what && !/^\$/.test(what)) {
        out.ancillary_fees =
          Math.round(((out.ancillary_fees ?? 0) + amt) * 100) / 100;
        warnings.push(
          `${what} bought with the ticket for ${amt.toFixed(2)} ${out.currency} — counted as an extra, not fare`
        );
      }
      continue;
    }

    /* payment: "MasterCard" / "( ending 4005 )" / "$488.20" */
    if (/^Your payment$/i.test(line)) {
      const brand = lines[i + 1];
      const last4 = lines[i + 2]?.match(/ending\s*(\d{4})/i);
      const amount = moneyOf(lines[i + 3]);
      if (brand) {
        out.payment_method = last4 ? `${brand} ending in ${last4[1]}` : brand;
        out.payments.push({
          payment_type: classifyPayment(out.payment_method),
          amount,
          award_miles_used: null,
          reference: out.payment_method,
        });
      }
    }

    /* ---- itinerary, anchored on the flight line ---- */
    const flight = line.match(/^([A-Z]{2})\s*(\d{1,4})$/);
    if (!flight || !isCode(lines[i - 3]) || !currentDate) continue;
    const departure = asTime(lines[i - 1]);
    if (!departure) continue;
    let k = i + 1;
    while (k < lines.length && /^(Operated by|as )/i.test(lines[k])) k++;
    if (!isCode(lines[k])) continue;
    const arrival = asTime(lines[k + 2]);
    let cabin: string | null = null;
    let bookingClass: string | null = null;
    let seat: string | null = null;
    for (let j = k + 3; j < Math.min(k + 10, lines.length); j++) {
      if (/^Seat:$/i.test(lines[j]) && /^\d{1,2}[A-Z]$/.test(lines[j + 1] ?? ""))
        seat = lines[j + 1];
      if (/^Class:$/i.test(lines[j])) {
        cabin = normalizeCabin(lines[j + 1] ?? "");
        bookingClass = lines[j + 2]?.match(/^\(([A-Z])\)$/)?.[1] ?? null;
      }
      if (/^Meals:$/i.test(lines[j])) break;
    }
    out.segments.push({
      carrier: flight[1],
      flight_number: String(Number(flight[2])),
      origin: lines[i - 3],
      destination: lines[k],
      flight_date: currentDate,
      departure_time: departure,
      arrival_time: arrival,
      cabin,
      booking_class: bookingClass,
      seat,
      projected_pqp: null,
      projected_pqf: null,
      projected_award_miles: null,
    });
    i = k;
  }

  out.ticket_number = tickets[0] ?? null;
  out.travelers = Math.max(1, tickets.length);
  if (tickets.length > 1)
    warnings.push(
      `${tickets.length} tickets on this receipt (${tickets.join(", ")}) — only the first is recorded`
    );

  finishCommon(out, emailDate, warnings);
  return out;
}

/** "$488.20" → 488.2 */
function moneyOf(l: string | undefined): number | null {
  const m = l?.match(/^\$([\d,]+\.\d{2})$/);
  return m ? num(m[1]) : null;
}

/* ------------------------- reservation change --------------------------- */

/**
 * "Your United reservation for <city> is processing" — the interim notice sent
 * when a booking is CHANGED, before the reissued eTicket. It is a reissue
 * document in everything but name:
 *
 *   New trip                $1,184.08     ← what the booking is worth now
 *   Taxes and fees difference   $0.00
 *   Original trip          -$1,215.26     ← what it was worth before
 *   Change fee                 No fee
 *   Total amount paid           $0.00     ← new money collected
 *   Total credit               $31.18     ← value handed back
 *
 * Two things make it different from every other format here:
 *  - it carries NO eTicket number, so the booking is identified by its
 *    confirmation code plus the date of the change;
 *  - its "Trip summary" lists the itinerary GOING FORWARD, so a leg that has
 *    already flown is simply absent — never treat that as a cancellation.
 *
 * Unlike the eTicket receipt's "Total Credit" (which is the whole credit
 * bank's balance), this one is checkable: original − new − taxes difference
 * must equal it, and only then is it recorded as a residual.
 */
function parseChangeNotice(raw: string[], emailDate: string | null): ParsedReceipt {
  /* Labels and their values are only adjacent once blank lines are dropped —
     the same flattening quirk that Chase Travel and ADTRAV hit. */
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "change_notice",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: emailDate,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  const money = (s: string) => {
    const m = s.match(/-?\s*\$([\d,]+\.\d{2})/);
    return m ? num(m[1]) : null;
  };
  /** the first money line at or after `i`, skipping "1 adult (18-64)" etc. */
  const valueAfter = (i: number) => {
    for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
      const v = money(lines[k]);
      if (v != null) return v;
    }
    return null;
  };

  let taxDiff: number | null = null;
  let totalCredit: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Confirmation number:?$/i.test(line)) {
      const next = lines[i + 1]?.trim();
      if (next && /^[A-Z0-9]{5,7}$/.test(next)) out.confirmation = next;
      continue;
    }
    if (/^New trip$/i.test(line)) out.gross_total ??= valueAfter(i);
    else if (/^Taxes and fees difference$/i.test(line)) taxDiff ??= valueAfter(i);
    else if (/^Original trip$/i.test(line)) out.original_trip_total ??= valueAfter(i);
    else if (/^Change fee$/i.test(line))
      out.change_fee ??= /no fee/i.test(lines[i + 1] ?? "") ? 0 : valueAfter(i);
    else if (/^Total amount paid$/i.test(line)) out.additional_collection ??= valueAfter(i);
    else if (/^Total credit$/i.test(line)) totalCredit ??= valueAfter(i);
  }

  /* Only trust the credit when the document's own arithmetic backs it. */
  if (totalCredit != null) {
    const expected =
      out.original_trip_total != null && out.gross_total != null
        ? out.original_trip_total - out.gross_total + (taxDiff ?? 0)
        : null;
    if (expected != null && Math.abs(expected - totalCredit) <= 0.011) {
      out.residual_credit = totalCredit;
    } else {
      out.credit_balance = totalCredit;
      warnings.push(
        `Credit of ${totalCredit.toFixed(2)} doesn't match the change (${out.original_trip_total?.toFixed(2) ?? "?"} → ${out.gross_total?.toFixed(2) ?? "?"}) — recorded as a balance, not a residual`
      );
    }
  }
  // "Total amount paid: 0.00" just means the credit covered it
  if (out.additional_collection === 0) out.additional_collection = null;

  /* ------------------------------ itinerary ----------------------------- */
  const start = lines.findIndex((l) => /^Trip summary$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^Travelers$/i.test(l));
  if (start >= 0) {
    const stop = end > start ? end : lines.length;
    for (let i = start + 1; i < stop; i++) {
      const date = parseLongDate(lines[i]);
      const flight = lines[i + 1]?.match(/^([A-Z]{2})\s*(\d{1,4})$/);
      if (!date || !flight) continue;
      /* Scan to the "Duration:" line collecting times and airports in order —
         United sprinkles "+1 day arrival" / "Over Night" markers through this
         block (sometimes twice), so fixed offsets don't survive contact. */
      const times: string[] = [];
      const codes: string[] = [];
      let k = i + 2;
      for (; k < stop && !/^Duration:/i.test(lines[k]); k++) {
        const t = lines[k].match(/^(\d{1,2}:\d{2})\s*(am|pm)$/i);
        if (t) times.push(parse12h(t[1], t[2]));
        const c = lines[k].match(/\(([A-Z]{3})\)\s*$/);
        if (c) codes.push(c[1]);
      }
      if (times.length < 2 || codes.length < 2) continue;
      const cls = lines[k + 1]?.match(/^(.*?)\s*\(([A-Z])\)$/);
      out.segments.push({
        carrier: flight[1],
        flight_number: String(Number(flight[2])),
        origin: codes[0],
        destination: codes[1],
        flight_date: date,
        departure_time: times[0],
        arrival_time: times[1],
        cabin: cls ? normalizeCabin(cls[1]) : null,
        booking_class: cls ? cls[2] : null,
        seat: null,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      });
      i = k;
    }
  }

  /* seats: "IAH to SFO" / "10F" / optional "Economy Plus®" */
  if (end > 0) {
    for (let i = end; i < lines.length; i++) {
      const route = lines[i].match(/^([A-Z]{3}) to ([A-Z]{3})$/);
      if (!route) continue;
      const seat = lines[i + 1]?.match(/^(\d{1,2}[A-Z])$/);
      if (!seat) continue;
      const leg = out.segments.find(
        (s) => s.origin === route[1] && s.destination === route[2]
      );
      if (leg) leg.seat = seat[1];
    }
    out.travelers = lines
      .slice(end + 1)
      .filter((l) => /^[A-Z][A-Z' -]+ [A-Z][A-Z' -]+$/.test(l) && l.length < 60).length;
  }
  if (out.travelers === 0) out.travelers = 1;

  if (!out.confirmation) warnings.push("No confirmation number found");
  if (out.gross_total == null) warnings.push("No new trip total found");
  if (out.segments.length === 0) warnings.push("No flights found in the trip summary");
  return out;
}

/* --------------------------- eTicket receipt ---------------------------- */

/**
 * Ancillary spend that earns PQP, per the MileagePlus programme terms: seat
 * purchases (Economy Plus, preferred seats, seat assignments) and paid
 * upgrades. Wi-Fi, bags, United Club, inflight purchases and fees do NOT —
 * they cost money (so they still land as extras) but project no PQP. The
 * test is the item's own label, because every one of these arrives on the
 * same receipt template.
 */
// "upsell" is United's own word for a paid cabin bump at booking or
// check-in — the statement posts it as "Day of departure upgrade", 1 PQP
// per dollar, same as any upgrade purchase
export const PQP_EARNING_ITEM = /upgrade|upsell|seat|economy plus/i;

/**
 * PQP eligibility is one axis; whether something is TRIP COST at all is
 * another. Wi-Fi, United Club passes and inflight food are consumption that
 * happens to occur on a plane — a $17 coffee-shop purchase at 35,000 feet.
 * They alter nothing about the travel product, so they stay out of cost,
 * CPM and cash flow entirely: the receipt is recognized, the preview says
 * why, and nothing imports. Bags and priority boarding are NOT consumption —
 * they change the product, so they remain trip cost (merely PQP-ineligible).
 * The test is deliberately conservative: anything unmatched stays cost.
 */
export const CONSUMPTION_ITEM = /wi-?fi|united club|club pass|inflight|in-flight/i;

/** Does this item's label describe PQP-earning spend? Two traps guard the
 *  simple regex: consumption ("Inflight Wi-Fi ... Upgrade" contains
 *  "upgrade" but a Wi-Fi tier bump earns nothing), and FEES — a "Mp
 *  Pluspoint Regular Upgrade Fee" is a co-pay on an award upgrade, not a
 *  purchase, and projects nothing. */
export function pqpEarningItem(label: string): boolean {
  return (
    PQP_EARNING_ITEM.test(label) &&
    !CONSUMPTION_ITEM.test(label) &&
    !/\bfee\b/i.test(label)
  );
}

/** The PQP an extras receipt should project: eligible ITEMS only — never the
 *  receipt total, which can include taxes (a 35.99 seat assignment with 2.70
 *  tax earns PQP on the 35.99). */
export function pqpEligibleAncillary(
  items: { label: string; amount: number }[]
): number {
  return Math.round(
    items.filter((i) => pqpEarningItem(i.label)).reduce((s, i) => s + i.amount, 0)
  );
}

/**
 * United's "Thanks for your purchase with United" — the receipt for an extra
 * bought AFTER ticketing: a Premium Cabin Upgrade, a seat assignment, Wi-Fi.
 * It is not a ticket and must never look like one: it names the underlying
 * eTicket it belongs to, and each item carries its own EMD reference number.
 * The import turns each item into a dated "extra purchase" adjustment on that
 * ticket — fare untouched, cash dated to the purchase day, and the EMD makes
 * a re-import find its own row and do nothing.
 *
 * Seat and upgrade purchases also earn PQP (≈1 per eligible dollar), so the
 * segment carries that as a projection — planning data like every other
 * projected_* figure, replaced by the truth when the activity CSV shows what
 * posted. Ineligible items (Wi-Fi, bags) still cost money and still import;
 * they simply project nothing, and the receipt's note says so.
 */
/**
 * "Your flight cancellation is complete" — the notifications@united.com
 * confirmation that a cancellation went through. Unlike the receipt-layout
 * cancellation it prints no itinerary and no money: identity is the
 * confirmation code alone, and the effect is on the BOOKING — every leg the
 * ledger (or the batch) holds under that confirmation that hadn't departed
 * when the notice was sent.
 */
function parseCancellationComplete(
  raw: string[],
  emailDate: string | null
): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt("cancellation", "UA", emailDate, warnings);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(
      /Your reservation,?\s*([A-Z][A-Z0-9]{5})\s*,? was canceled/i
    );
    if (m) {
      out.confirmation = m[1].toUpperCase();
      break;
    }
    if (/^Confirmation number:$/i.test(lines[i])) {
      const next = (lines[i + 1] ?? "").match(/^([A-Z][A-Z0-9]{5})$/);
      if (next) {
        out.confirmation = next[1];
        break;
      }
    }
  }
  if (out.confirmation) {
    warnings.push(
      `The notice prints no itinerary — it cancels booking ${out.confirmation}'s not-yet-flown legs (refund or miles redeposit per the email)`
    );
  } else {
    warnings.push(
      "No confirmation number found — there is nothing to attach this cancellation to"
    );
  }
  out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

function parseUnitedPurchase(
  raw: string[],
  emailDate: string | null,
  refund = false
): ParsedReceipt {
  const lines = raw.filter((l) => l !== "");
  const warnings: string[] = [];
  const out = emptyReceipt(
    refund ? "ancillary_refund" : "ancillary_receipt",
    "UA",
    emailDate,
    warnings
  );
  out.ancillary_items = [];

  let flight: { carrier: string; number: string } | null = null;
  let flightDate: string | null = null;
  let codes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "Flight 1 of 1 UA1210" / "Sat, Dec 10, 2022 Sat, Dec 10, 2022" /
    // "Seattle, WA, US (SEA) Houston, TX, US (IAH)"
    const fl = line.match(/^Flight \d+ of \d+\s+([A-Z]{2})\s?(\d{1,4})$/);
    if (fl) {
      flight = { carrier: fl[1], number: String(Number(fl[2])) };
      continue;
    }
    if (flight && !flightDate) {
      const d = parseLongDate(line);
      if (d) {
        flightDate = d;
        continue;
      }
    }
    if (flight && codes.length < 2) {
      const found = [...line.matchAll(/\(([A-Z]{3})\)/g)].map((m) => m[1]);
      if (found.length >= 2) codes = found.slice(0, 2);
    }

    const tkt = line.match(/eTicket number:\s*(\d{13})/i);
    if (tkt) {
      out.ticket_number = tkt[1];
      continue;
    }
    const pay = line.match(/^Method of payment:\s*(.+)$/i);
    if (pay) {
      out.payment_method = pay[1].trim();
      continue;
    }
    const purchased = line.match(/^Date of purchase:\s*(.+)$/i);
    if (purchased) {
      out.issue_date = parseLongDate(purchased[1]);
      continue;
    }
    // "Premium Cabin Upgrade (Reference Number: 0169814730802): 299.00 USD"
    // — but the Wi-Fi variant of this template writes the item amount BARE
    // ("16.99", only the Total line carries "USD"), so the currency is
    // optional here and the Total line remains its authority.
    // the refund notice writes "( Refunded Reference Number: ...)"
    const item = line.match(
      /^(.+?)\s*\(\s*(?:Refunded\s+)?Reference Number:\s*(\d{10,14})\):\s*([\d,]+\.\d{2})(?:\s*([A-Z]{3}))?$/
    );
    if (item) {
      out.ancillary_items.push({
        label: item[1].trim(),
        reference: item[2],
        amount: num(item[3]),
      });
      if (item[4]) out.currency = item[4];
      continue;
    }
    const total = line.match(/^Total:\s*([\d,]+\.\d{2})\s*([A-Z]{3})$/);
    if (total) {
      out.gross_total = num(total[1]);
      out.currency = total[2];
      continue;
    }
  }

  out.ancillary_fees = out.gross_total;
  if (out.payment_method && !refund) {
    out.payments.push({
      payment_type: classifyPayment(out.payment_method),
      amount: out.gross_total,
      award_miles_used: null,
      reference: out.payment_method,
    });
  }
  const pqpEligible = pqpEligibleAncillary(out.ancillary_items);
  const consumption = out.ancillary_items.filter((i) =>
    CONSUMPTION_ITEM.test(i.label)
  );
  const costItems = out.ancillary_items.filter(
    (i) => !CONSUMPTION_ITEM.test(i.label)
  );
  const ineligible = costItems.filter((i) => !pqpEarningItem(i.label));
  if (flight && flightDate && codes.length === 2) {
    out.segments.push({
      carrier: flight.carrier,
      flight_number: flight.number,
      origin: codes[0],
      destination: codes[1],
      flight_date: flightDate,
      departure_time: null,
      arrival_time: null,
      cabin: null,
      booking_class: null,
      seat: null,
      // eligible items only, ≈1 PQP per dollar — never the receipt total,
      // which can include taxes and non-earning items; a refund projects nothing
      projected_pqp: !refund && pqpEligible > 0 ? pqpEligible : null,
      projected_pqf: null,
      projected_award_miles: null,
    });
  }
  if (refund) {
    if (consumption.length > 0) {
      warnings.push(
        `${consumption.map((i) => i.label).join(", ")} was refunded — onboard consumption was never in the ledger's cost, so nothing changes`
      );
    }
    if (costItems.length > 0) {
      warnings.push(
        `${costItems.map((i) => i.label).join(", ")} was refunded — if its purchase was imported as an extra, record a matching refund adjustment on that ticket`
      );
    }
    out.travelers = 1;
    finishCommon(out, emailDate, warnings);
    return out;
  }
  if (consumption.length > 0) {
    warnings.push(
      `${consumption.map((i) => i.label).join(", ")}: onboard consumption — money spent on the plane, not a change to the trip. It stays out of cost and cash flow${
        costItems.length > 0 ? "; the other items import normally" : ", and nothing imports"
      }`
    );
  }
  if (ineligible.length > 0) {
    warnings.push(
      `${ineligible.map((i) => i.label).join(", ")} earns no PQP — ${
        pqpEligible > 0
          ? `only the seat and upgrade purchases (${pqpEligible.toFixed(0)}) are projected`
          : "nothing is projected"
      }`
    );
  }
  if (out.ticket_number) {
    warnings.push(
      `An extra bought for ticket ${out.ticket_number} — imports as a dated "extra purchase" on that ticket, not as a ticket of its own`
    );
  } else if (costItems.length > 0 || out.ancillary_items.length === 0) {
    // consumption-only receipts legitimately carry no eTicket — the
    // consumption warning is the whole story there
    warnings.push(
      "No eTicket number found — there is no ticket to attach this purchase to"
    );
  }
  out.travelers = 1;
  finishCommon(out, emailDate, warnings);
  return out;
}

function parseEticketReceipt(lines: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  // receipt-wide totals (all travelers) and per-passenger award price, used
  // only when the receipt omits "Total Per Passenger"
  let combinedTotal: number | null = null;
  let combinedMiles: number | null = null;
  let perPassengerMiles: number | null = null;
  // "Additional Purchase Summary" — extras (seat assignments and the like)
  // bought as their own transaction, sometimes on a different card
  let inAdditionalPurchase = false;
  let additionalPurchaseTotal: number | null = null;
  const additionalPurchaseItems: string[] = [];
  const out: ParsedReceipt = {
    kind: "eticket_receipt",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  let lastPax: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* "Additional Purchase Summary" opens a separate card: an extra bought as
       its own transaction, with its own payment method, its own tax lines and
       its own Total — none of it part of this ticket's fare. Before this
       guard, the card's tax line bled into `taxes` (making the breakdown
       "fail" to sum to a total it was never part of) and its card overwrote
       the ticket's payment method. Everything after the header is the extras
       card followed by boilerplate, so from here the loop only prices the
       card for the note below and ignores the rest. */
    if (inAdditionalPurchase) {
      const t = line.match(/^Total:\s*([\d,]+\.\d{2})\s*[A-Z]{3}$/i);
      if (t) {
        additionalPurchaseTotal =
          Math.round(((additionalPurchaseTotal ?? 0) + num(t[1])) * 100) / 100;
        continue;
      }
      // "Basic Economy Seat Assignment (Reference Number: 0164306206467): 35.99"
      const bare = line.replace(/\s*\(Reference Number:[^)]*\)/i, "");
      const item = bare.match(/^([A-Za-z][^:]{2,79}?):\s*[\d,]+\.\d{2}$/);
      if (item && !/Tax|Fee|Charge|Surcharge|Total|payment/i.test(item[1]))
        additionalPurchaseItems.push(item[1].trim());
      continue;
    }
    if (/^Additional Purchase Summary$/i.test(line)) {
      inAdditionalPurchase = true;
      continue;
    }

    // seats appear inline on traveler lines ("… Seats: DEN-IAH 28A"), which
    // also match other patterns below — scan before any early-continue
    for (const sm of line.matchAll(/([A-Z]{3})-([A-Z]{3})\s+(\d{1,3}[A-Z])\b/g)) {
      const seg = out.segments.find(
        (s) => s.origin === sm[1] && s.destination === sm[2] && s.seat == null
      );
      if (seg) seg.seat = sm[3];
    }

    if (/^Confirmation Number:?$/i.test(line)) {
      const next = lines.slice(i + 1, i + 4).find((l) => /^[A-Z0-9]{6}$/.test(l));
      if (next) out.confirmation = next;
      continue;
    }
    const confInline = line.match(/^Confirmation Number:?\s+([A-Z0-9]{6})$/i);
    if (confInline) {
      out.confirmation = confInline[1];
      continue;
    }

    // Flight 1 of 2 UA1976 Class: United Economy (T)
    const fm = line.match(/^Flight\s+\d+\s+of\s+\d+\s+([A-Z]{2})\s?(\d{1,4})\s+Class:\s*(.*)$/);
    if (fm) {
      const classText = fm[3];
      const clsM = classText.match(/\(([A-Z]{1,2})\)/);
      // following non-empty lines: dates, times, route (blank-tolerant)
      const following = lines.slice(i + 1, i + 8).filter((l) => l !== "");
      const dateLine = following[0] ?? "";
      const timeLine = following[1] ?? "";
      const routeLine = following[2] ?? "";
      const dates = [...dateLine.matchAll(/([A-Z][a-z]{2},\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/g)];
      const times = [...timeLine.matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
      const codes = [...routeLine.matchAll(/\(([A-Z]{3})\)/g)];
      const flightDate = dates[0] ? parseLongDate(dates[0][1]) : null;
      if (!flightDate || codes.length < 2) {
        warnings.push(`Couldn't fully read segment "${line}" — skipped`);
        continue;
      }
      out.segments.push({
        carrier: fm[1],
        flight_number: String(Number(fm[2])),
        origin: codes[0][1],
        destination: codes[1][1],
        flight_date: flightDate,
        departure_time: times[0] ? parse12h(times[0][1], times[0][2]) : null,
        arrival_time: times[1] ? parse12h(times[1][1], times[1][2]) : null,
        cabin: normalizeCabin(classText),
        booking_class: clsM ? clsM[1] : null,
        seat: null,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      });
      continue;
    }

    /* "Frequent Flyer: UA-XXXXX999 Premier Platinum" — or LH-, AC-, NH-… The
       first traveller's is the one whose share this ledger records. */
    const ff = line.match(/Frequent Flyer:\s*([A-Z]{2})-/i);
    if (ff && !out.frequent_flyer_program)
      out.frequent_flyer_program = ff[1].toUpperCase();

    /* "VOVCHENKO/VOLODYMYR" — the pax line above each eTicket number, held
       so the number a line or two down knows whose it is */
    const pax = line.match(
      /^([A-Z]+(?: [A-Z]+)*\/[A-Z]+(?: [A-Z]+)*?)(?:\s+(?:MR|MRS|MS|DR))?$/
    );
    if (pax) lastPax = pax[1];

    const etkt = line.match(/eTicket number:\s*(\d{13,14})/i);
    if (etkt) {
      if (lastPax) {
        (out.traveler_tickets ??= []).push({ name: lastPax, ticket_number: etkt[1] });
        lastPax = null;
      }
      if (!out.ticket_number) out.ticket_number = etkt[1];
      out.travelers += 1;
      continue;
    }

    const purchase = line.match(/^Date of purchase:\s*(.+)$/i);
    if (purchase) {
      out.issue_date = parseLongDate(purchase[1]) ?? out.issue_date;
      continue;
    }

    // "Method of payment: Future flight credit: 468.80 USD" — the method may
    // carry its own amount; continuation lines name additional methods.
    const method = line.match(/^Method of payment:\s*(.+)$/i);
    if (method) {
      const raw = method[1].trim();
      const amountM = raw.match(/:\s*([\d,]+\.\d{2})\s*([A-Z]{3})?$/);
      const label = raw.replace(/:\s*[\d,.]+\s*[A-Z]{3}?$/, "").trim();
      out.payments.push({
        payment_type: classifyPayment(label),
        amount: amountM ? num(amountM[1]) : null,
        award_miles_used: null,
        reference: label,
      });
      let pay = label;
      // subsequent funding lines, e.g. "Visa ending in 4004"
      for (const nextL of lines.slice(i + 1, i + 6)) {
        if (nextL === "") continue;
        /* United stacks extra methods on unlabelled rows right below, and they
           are not a fixed vocabulary — "Miscellaneous Document", "PayPal" and
           the like all appear. Anything with a colon is the next labelled
           field (date of purchase, a tax line), so that ends the block; a bare
           short line is another method. */
        const isMethod =
          classifyPayment(nextL) !== "other" || (!nextL.includes(":") && nextL.length <= 60);
        if (!isMethod) break;
        pay += ` · ${nextL}`;
        out.payments.push({
          payment_type: classifyPayment(nextL),
          amount: null,
          award_miles_used: null,
          reference: nextL,
        });
      }
      out.payment_method = pay;
      continue;
    }

    // "An additional amount of 230.71 USD for the difference in fare was
    // charged…" — award reissues print the same sentence with NO currency
    // code ("An additional amount of 266.40  for the difference"), and
    // requiring one is how a real 266.40 collection went unrecorded.
    const addColl = line.match(
      /^An additional amount of\s*([\d,]+\.\d{2})\s*(?:[A-Z]{3}\s+)?for the difference/i
    );
    if (addColl) {
      out.additional_collection = num(addColl[1]);
      continue;
    }

    /* "Total Credit: 546.81 USD" is the balance of your future-flight-credit
       BANK after this transaction — NOT the value this ticket handed back.
       It can carry credit from an entirely unrelated cancelled ticket: the
       user's ZZ0007 receipt prints 546.81 against a 192.38 fare, which as a
       "residual" made the exchange chain total −362.80. The residual of an
       exchange is inferred from the drop in face value instead. */
    const credit = line.match(/^Total Credit:\s*([\d,]+\.\d{2})\s*[A-Z]{3}$/i);
    if (credit) {
      out.credit_balance = num(credit[1]);
      continue;
    }

    // Tickets issued abroad print the fare in the currency of sale and add an
    // "Equivalent Airfare" in the receipt's currency; only the latter belongs
    // in the ledger (and sums with the taxes to the total).
    const airfare = line.match(/^Airfare:\s*([\d,]+\.?\d*)$/i);
    if (airfare) {
      out.local_fare = num(airfare[1]);
      continue;
    }
    const equivalent = line.match(/^Equivalent Airfare:\s*([\d,]+\.?\d*)$/i);
    if (equivalent) {
      out.base_fare = num(equivalent[1]);
      continue;
    }

    // "Remaining value of your previous ticket numbers 016… was applied…"
    const prevTicket = line.match(
      /previous ticket numbers?\s+(\d{13,14})/i
    );
    if (prevTicket) {
      out.previous_ticket_number = prevTicket[1];
      continue;
    }

    // "U.S. Transportation Tax: 30.56", "…Surcharge: 128.00" — label: amount.
    // Labels carry slashes, ampersands and digits ("Switzerland Airport
    // Passenger/Security Charge", "9/11 Security Fee"), so keep the character
    // class wide and let the required keyword do the filtering.
    const taxline = line.match(
      /^([A-Za-z][A-Za-z0-9.()/&,' -]{2,79}?(?:Tax|Fee|Charge|Surcharge)[A-Za-z0-9.()/&,' -]*):\s*([\d,]+\.\d{2})$/
    );
    // "1st bag charge" heads the baggage-allowance table; "Italy Security Bag
    // Charge" is a genuine tax, so exclude the table headers, not the word.
    if (
      taxline &&
      !/Total|per passenger/i.test(taxline[1]) &&
      !/^\d+(st|nd|rd|th)\s+bag/i.test(taxline[1].trim())
    ) {
      const round2 = (n: number) => Math.round(n * 100) / 100;
      if (/surcharge/i.test(taxline[1])) {
        out.surcharges = round2((out.surcharges ?? 0) + num(taxline[2]));
      } else {
        out.taxes = round2((out.taxes ?? 0) + num(taxline[2]));
      }
      continue;
    }

    // "Total Per Passenger: 468.80 USD" | "Total Per Passenger: 12,700 miles + 5.60 USD"
    const total = line.match(/^Total Per Passenger:\s*(?:([\d,]+(?:\.\d+)?)\s*miles\s*\+\s*)?([\d,]+\.?\d*)\s*([A-Z]{3})$/i);
    if (total) {
      if (total[1]) out.miles_redeemed = Math.round(num(total[1]));
      out.gross_total = num(total[2]);
      out.currency = total[3].toUpperCase();
      continue;
    }

    // "Total: 25,400 miles + 11.20 USD" — the whole receipt (all travelers).
    // Some award receipts print only this line.
    const grand = line.match(/^Total:\s*(?:([\d,]+(?:\.\d+)?)\s*miles\s*\+\s*)?([\d,]+\.?\d*)\s*([A-Z]{3})$/i);
    if (grand) {
      combinedTotal = num(grand[2]);
      combinedMiles = grand[1] ? Math.round(num(grand[1])) : null;
      out.currency = grand[3].toUpperCase();
      continue;
    }

    // award pricing, always per passenger
    const memberPrice = line.match(
      /^(?:Special member price|Member price|Award price):\s*([\d,]+(?:\.\d+)?)\s*miles$/i
    );
    if (memberPrice) {
      perPassengerMiles = Math.round(num(memberPrice[1]));
      continue;
    }

  }

  // Resolve the ticket cost to ONE passenger's share: the ledger holds the
  // user's own flights, so a party-of-N receipt must not charge CPM N times.
  const travelers = Math.max(1, out.travelers);
  /* The "additional amount ... for the difference in fare" is printed for the
     whole reservation, like the Total it adjusts — 266.40 on a two-traveler
     reissue is 133.20 of the user's money. */
  if (out.additional_collection != null && travelers > 1)
    out.additional_collection =
      Math.round((out.additional_collection / travelers) * 100) / 100;
  /* …and "was charged" is not always a charge. On the real rebooking the
     printed 266.40 plus the new 11.20 in taxes equalled the original's 277.60
     to the cent: the "collection" was paid FROM the applied previous-ticket
     value, and the card saw nothing. The receipt alone cannot tell the two
     apart, so when both lines are present the figure imports with a warning —
     an explicit 0 on the ticket records "no new money" if the statement
     agrees. */
  if (out.additional_collection != null && out.previous_ticket_number != null)
    warnings.push(
      `The ${out.additional_collection.toFixed(2)} additional collection sits beside an applied previous-ticket value — United sometimes pays it from that value rather than charging anew. Verify against the card statement; set Additional collection to 0 on the ticket if no new money moved.`
    );
  if (out.gross_total == null && combinedTotal != null) {
    out.gross_total = Math.round((combinedTotal / travelers) * 100) / 100;
    if (combinedMiles != null)
      out.miles_redeemed = Math.round(combinedMiles / travelers);
    if (travelers > 1) {
      warnings.push(
        `${travelers} travelers on this receipt — recorded your share (${out.gross_total.toFixed(2)} ${out.currency}${
          out.miles_redeemed != null ? ` + ${out.miles_redeemed.toLocaleString()} miles` : ""
        }) of the ${combinedTotal.toFixed(2)} ${out.currency}${
          combinedMiles != null ? ` + ${combinedMiles.toLocaleString()} miles` : ""
        } total`
      );
    }
  }
  // an explicit per-passenger award price beats any division
  if (perPassengerMiles != null) out.miles_redeemed = perPassengerMiles;

  // Fill in what the receipt implies but doesn't state per method: miles go to
  // the MileagePlus payment, and a lone cash method must cover the remainder.
  if (out.miles_redeemed != null) {
    const milesPayment = out.payments.find((p) => p.payment_type === "miles");
    if (milesPayment) milesPayment.award_miles_used = out.miles_redeemed;
    else
      out.payments.push({
        payment_type: "miles",
        amount: null,
        award_miles_used: out.miles_redeemed,
        reference: null,
      });
  }
  if (out.gross_total != null) {
    const known = out.payments.reduce((s, p) => s + (p.amount ?? 0), 0);
    const unknownCash = out.payments.filter(
      (p) => p.amount == null && p.payment_type !== "miles"
    );
    if (unknownCash.length === 1) {
      const remainder = Math.round((out.gross_total - known) * 100) / 100;
      if (remainder >= 0) unknownCash[0].amount = remainder;
    }
  }

  // Say what was on the extras card and that it isn't in the ticket's cost —
  // the receipt's own Total excludes it, so the ledger does too.
  if (additionalPurchaseTotal != null) {
    const what = additionalPurchaseItems.length
      ? ` (${additionalPurchaseItems.join(", ")})`
      : "";
    warnings.push(
      `A separate purchase${what} of ${additionalPurchaseTotal.toFixed(2)} ${out.currency} is also on this receipt — bought on its own, so it isn't counted in this ticket's cost`
    );
  }

  parseAccrualTable(lines, out);
  finishCommon(out, emailDate, warnings);
  return out;
}

/**
 * "MileagePlus Accrual Details" — booking-time projections. Two-line rows:
 *   Fri, Jul 10, 2026 1976 Houston, TX, US (IAH) to
 *   San Francisco, CA, US (SFO) 1744 218 1        ← award, PQP, PQF
 * Matched to segments by flight number + date.
 */
function parseAccrualTable(lines: string[], out: ParsedReceipt): void {
  const start = lines.findIndex((l) => /^MileagePlus Accrual Details$/i.test(l));
  if (start === -1) return;
  const section = lines
    .slice(start + 1, start + 40)
    .filter((l) => l !== "");
  for (let i = 0; i < section.length; i++) {
    if (/^MileagePlus accrual totals/i.test(section[i])) break;
    const a = section[i].match(
      /^([A-Z][a-z]{2},\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\s+(\d{1,4})\s+.*\([A-Z]{3}\)\s+to$/
    );
    const b = section[i + 1]?.match(
      /\([A-Z]{3}\)\s+(-?[\d,]+)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)$/
    );
    if (!a || !b) continue;
    const date = parseLongDate(a[1]);
    const flightNo = String(Number(a[2]));
    const seg = out.segments.find(
      (s) => s.flight_number === flightNo && s.flight_date === date
    );
    if (seg) {
      seg.projected_award_miles = num(b[1]);
      seg.projected_pqp = num(b[2]);
      seg.projected_pqf = Number(b[3]);
    }
    i++;
  }
}

/* ------------------------- booking confirmation ------------------------- */

function parseBookingConfirmation(lines: string[], emailDate: string | null): ParsedReceipt {
  const warnings: string[] = [];
  const out: ParsedReceipt = {
    kind: "booking_confirmation",
    confirmation: null,
    ticket_number: null,
    issuing_carrier: "UA",
    issue_date: emailDate,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: 0,
    segments: [],
    warnings,
  };

  let currentDate: string | null = null;
  let pendingTimes: [string, string] | null = null;
  let pendingCodes: string[] = [];
  let lastPax: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const conf = line.match(/United confirmation number\s*:?\s*([A-Z0-9]{6})/i);
    if (conf) {
      out.confirmation = conf[1];
      continue;
    }
    const fare = line.match(/^Fare\s*\$?([\d,]+\.?\d*)$/i);
    if (fare) {
      out.base_fare = num(fare[1]);
      continue;
    }
    const taxes = line.match(/^Taxes and Fees\s*\$?([\d,]+\.?\d*)$/i);
    if (taxes) {
      out.taxes = num(taxes[1]);
      continue;
    }
    const total = line.match(/^Total\s*\$?([\d,]+\.?\d*)$/i);
    if (total) {
      out.gross_total = num(total[1]);
      continue;
    }
    const pay = line.match(/^Credit card payment:\s*\$?([\d,]+\.?\d*)\s*\(([^)]+)\)/i);
    if (pay) {
      out.payment_method = pay[2];
      out.payments.push({
        payment_type: "card",
        amount: num(pay[1]),
        award_miles_used: null,
        reference: pay[2],
      });
      continue;
    }
    /* "Frequent Flyer: UA-XXXXX999 Premier Platinum" — or LH-, AC-, NH-… The
       first traveller's is the one whose share this ledger records. */
    const ff = line.match(/Frequent Flyer:\s*([A-Z]{2})-/i);
    if (ff && !out.frequent_flyer_program)
      out.frequent_flyer_program = ff[1].toUpperCase();

    /* "VOVCHENKO/VOLODYMYR" — the pax line above each eTicket number, held
       so the number a line or two down knows whose it is */
    const pax = line.match(
      /^([A-Z]+(?: [A-Z]+)*\/[A-Z]+(?: [A-Z]+)*?)(?:\s+(?:MR|MRS|MS|DR))?$/
    );
    if (pax) lastPax = pax[1];

    const etkt = line.match(/eTicket number:\s*(\d{13,14})/i);
    if (etkt) {
      if (lastPax) {
        (out.traveler_tickets ??= []).push({ name: lastPax, ticket_number: etkt[1] });
        lastPax = null;
      }
      if (!out.ticket_number) out.ticket_number = etkt[1];
      out.travelers += 1;
      continue;
    }

    // itinerary scanning: a date line, then a times line, then two airport codes,
    // then "UA 893" / "United Economy" lines complete the leg
    const dateM = line.match(/^([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/);
    if (dateM && parseLongDate(dateM[1])) {
      currentDate = parseLongDate(dateM[1]);
      continue;
    }
    const times = [...line.matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
    if (times.length >= 2) {
      pendingTimes = [parse12h(times[0][1], times[0][2]), parse12h(times[1][1], times[1][2])];
      pendingCodes = [];
      continue;
    }
    const code = line.match(/^([A-Z]{3})\b/);
    if (code && pendingTimes && pendingCodes.length < 2 && !MONTHS[code[1].toLowerCase()?.slice(0, 3)]) {
      pendingCodes.push(code[1]);
      continue;
    }
    const flightNo = line.match(/^([A-Z]{2})\s?(\d{1,4})$/);
    if (flightNo && pendingTimes && pendingCodes.length === 2 && currentDate) {
      out.segments.push({
        carrier: flightNo[1],
        flight_number: String(Number(flightNo[2])),
        origin: pendingCodes[0],
        destination: pendingCodes[1],
        flight_date: currentDate,
        departure_time: pendingTimes[0],
        arrival_time: pendingTimes[1],
        cabin: null, // filled by the "United Economy" line below when present
        booking_class: null,
        seat: null,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      });
      pendingTimes = null;
      pendingCodes = [];
      continue;
    }
    const cabin = line.match(/^United (Basic Economy|Economy|Premium Plus|Business|First|Polaris.*)$/i);
    if (cabin && out.segments.length > 0) {
      const last = out.segments[out.segments.length - 1];
      if (last.cabin == null) last.cabin = normalizeCabin(line);
      continue;
    }
    // "SFO to ICN: 34F"
    for (const sm of line.matchAll(/([A-Z]{3})\s+to\s+([A-Z]{3}):\s*(\d{1,2}[A-Z])\b/g)) {
      const seg = out.segments.find(
        (s) => s.origin === sm[1] && s.destination === sm[2] && s.seat == null
      );
      if (seg) seg.seat = sm[3];
    }
  }

  finishCommon(out, emailDate, warnings);
  return out;
}

/* ------------------------------ validation ------------------------------ */

/**
 * A reissue receipt names its funding methods without splitting the total
 * across them, but states the split in prose two lines apart: "An additional
 * amount of X was charged to <card>" and "Remaining value of your previous
 * ticket … was applied to this purchase". Given the total and that additional
 * collection, both shares are arithmetic, not a guess — so fill them in rather
 * than storing two amount-less rows.
 */
export function splitReissueFunding(out: ParsedReceipt) {
  if (out.additional_collection == null || out.gross_total == null) return;
  if (out.payments.length !== 2) return;
  if (out.payments.some((p) => p.amount != null || p.award_miles_used != null)) return;
  const credit = out.payments.find((p) => CREDIT_PAYMENT_TYPES.includes(p.payment_type));
  const charge = out.payments.find(
    (p) => p !== credit && (p.payment_type === "card" || p.payment_type === "cash")
  );
  if (!credit || !charge) return;
  const applied = Math.round((out.gross_total - out.additional_collection) * 100) / 100;
  if (applied <= 0) return;
  charge.amount = out.additional_collection;
  credit.amount = applied;
}

function finishCommon(out: ParsedReceipt, emailDate: string | null, warnings: string[]) {
  splitReissueFunding(out);
  out.email_date = emailDate;
  if (!out.issue_date) out.issue_date = emailDate;
  // domestic receipts have no "Equivalent Airfare" — the plain fare is already
  // in the receipt's currency
  if (out.base_fare == null && out.local_fare != null) {
    out.base_fare = out.local_fare;
    out.local_fare = null;
  }
  // an extras receipt has no PNR — its identity is the eTicket it belongs to
  if (!out.confirmation && out.kind !== "ancillary_receipt")
    warnings.push("No confirmation number found");
  if (out.segments.length === 0) warnings.push("No flight segments found");
  if (out.gross_total == null) warnings.push("No total amount found");
  // a per-passenger total already covers one share; only say so once
  if (out.travelers > 1 && !warnings.some((w) => w.includes("your share")))
    warnings.push(
      `${out.travelers} travelers on this receipt — amounts shown are per passenger, so only your own share is recorded`
    );
  if (out.miles_redeemed != null && out.gross_total != null) {
    // award ticket: the cash part is the ledger cost; miles noted separately
    warnings.push(
      `Award ticket: ${out.miles_redeemed.toLocaleString()} miles redeemed; ${out.gross_total.toFixed(2)} ${out.currency} cash recorded as ticket cost`
    );
  }
  const partsOf = () =>
    (out.base_fare ?? 0) +
    (out.surcharges ?? 0) +
    (out.taxes ?? 0) +
    (out.ancillary_fees ?? 0);

  /*
   * A ticket issued abroad prints "Airfare" in the currency of sale and
   * "Equivalent Airfare" beside it, and normally the equivalent plus the taxes
   * IS the total — true on three of the four ZZ0006-era receipts here. On the
   * fourth (0167900000011, issued in Munich) it isn't: 682.00 / 408.00 against
   * a 886.81 total whose taxes come to 184.81, so the fare actually charged
   * was 702.00 and NEITHER printed figure is it. The two fare lines are in
   * some other currency basis; the total and the taxes are in the receipt's
   * currency and agree with the card charge.
   *
   * So where the foreign-issue shape is present and the printed fare doesn't
   * reconcile, take the fare as total minus everything else — that is the
   * amount in the receipt's own currency by construction. Only in that shape:
   * on a domestic receipt an unreconciled breakdown means a line failed to
   * parse, and papering that over with a derived fare would hide the gap
   * instead of reporting it.
   */
  if (
    out.gross_total != null &&
    out.local_fare != null &&
    out.base_fare != null &&
    Math.abs(partsOf() - out.gross_total) > 0.011
  ) {
    const printed = out.base_fare;
    const derived =
      Math.round(
        (out.gross_total - (out.surcharges ?? 0) - (out.taxes ?? 0) - (out.ancillary_fees ?? 0)) * 100
      ) / 100;
    out.base_fare = derived;
    warnings.push(
      `Receipt prints ${out.local_fare.toLocaleString()} airfare and ${printed.toFixed(2)} equivalent, but neither leaves the total intact — fare recorded as ${derived.toFixed(2)} ${out.currency} (total ${out.gross_total.toFixed(2)} less ${(out.gross_total - derived).toFixed(2)} taxes and fees)`
    );
  }

  const parts = partsOf();
  if (out.gross_total != null && parts > 0 && Math.abs(parts - out.gross_total) > 0.011) {
    warnings.push(
      `Fare parts (${parts.toFixed(2)}) don't sum to the total (${out.gross_total.toFixed(2)}) — check the breakdown`
    );
  }
}

/* --------------------- schema.org flight markup ------------------------- */

/** Every FlightReservation node in a parsed JSON-LD value, whatever its
 *  shape — bare object, array, or @graph wrapper. */
function collectFlightReservations(
  node: unknown,
  out: Record<string, unknown>[]
): void {
  if (Array.isArray(node)) {
    for (const n of node) collectFlightReservations(n, out);
    return;
  }
  if (node == null || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  if (t === "FlightReservation" || (Array.isArray(t) && t.includes("FlightReservation")))
    out.push(o);
  if (o["@graph"]) collectFlightReservations(o["@graph"], out);
}

/** "2026-05-14T07:15:00-07:00" read on the airport's own clock — the offset
 *  is dropped, not converted, because the printed local time IS the fact. */
const isoLocalDate = (s: unknown): string | null =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
const isoLocalTime = (s: unknown): string | null =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)
    ? s.slice(11, 16)
    : null;

/**
 * The schema.org FlightReservation markup many airlines embed in their
 * confirmation emails (the Gmail/Outlook email-markup standard): JSON-LD in a
 * script tag, one FlightReservation per passenger per leg. It is the
 * airline's own machine-readable statement of the itinerary — and of nothing
 * else: the standard has no fare, tax or total fields at all, so a markup
 * import scaffolds the flights and leaves the money to a later receipt or to
 * the user. The preview says so rather than letting a zero look like a fare.
 */
function parseSchemaMarkup(
  eml: ParsedEml,
  emailDate: string | null
): ParsedReceipt | null {
  const html = eml.html ?? "";
  if (!/application\/ld\+json/i.test(html)) return null;

  const found: Record<string, unknown>[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1];
    for (const attempt of [
      raw,
      // some senders entity-encode inside the script block; one bad block
      // must not take the others down
      raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    ]) {
      try {
        collectFlightReservations(JSON.parse(attempt), found);
        break;
      } catch {
        /* try the decoded form, then give up on this block */
      }
    }
  }
  if (found.length === 0) return null;

  const warnings: string[] = [];
  const passengers = new Set<string>();
  const confirmations = new Set<string>();
  let ticketNumber: string | null = null;
  /* One FlightReservation per passenger per leg is the spec's multi-traveller
     shape, so identical flights fold into one segment and the passenger
     count is carried separately. */
  const byIdentity = new Map<string, ReceiptSegment>();
  let cancelledSkipped = 0;

  for (const r of found) {
    if (/cancel/i.test(String(r.reservationStatus ?? ""))) {
      cancelledSkipped++;
      continue;
    }
    if (typeof r.reservationNumber === "string" && r.reservationNumber.trim())
      confirmations.add(r.reservationNumber.trim().toUpperCase());
    const under = r.underName as Record<string, unknown> | undefined;
    if (under && typeof under.name === "string") passengers.add(under.name);
    const ticket = r.reservedTicket as Record<string, unknown> | undefined;
    if (!ticketNumber && ticket && typeof ticket.ticketNumber === "string")
      ticketNumber = ticket.ticketNumber.replace(/[\s-]/g, "");

    const flight = r.reservationFor as Record<string, unknown> | undefined;
    if (!flight) continue;
    /* Google's email-markup examples say "airline"; schema.org's own Flight
       type says "provider"; senders follow whichever doc they read. The
       Hawaiian/Alaska hybrid writes provider, and reading only airline made
       the witness silently blind to its flights. */
    const airline = (flight.airline ?? flight.provider) as
      | Record<string, unknown>
      | undefined;
    const dep = flight.departureAirport as Record<string, unknown> | undefined;
    const arr = flight.arrivalAirport as Record<string, unknown> | undefined;
    const carrier = String(airline?.iataCode ?? "").trim().toUpperCase();
    const origin = String(dep?.iataCode ?? "").trim().toUpperCase();
    const destination = String(arr?.iataCode ?? "").trim().toUpperCase();
    const date = isoLocalDate(flight.departureTime);
    if (!carrier || !origin || !destination || !date) {
      warnings.push(
        "A flight in the markup was missing its airline, route or departure time and was skipped."
      );
      continue;
    }
    let number = String(flight.flightNumber ?? "").trim().toUpperCase();
    if (number.startsWith(carrier)) number = number.slice(carrier.length).trim();

    const seat =
      (typeof r.airplaneSeat === "string" && r.airplaneSeat) ||
      (typeof (
        (ticket?.ticketedSeat as Record<string, unknown> | undefined)?.seatNumber
      ) === "string"
        ? String((ticket!.ticketedSeat as Record<string, unknown>).seatNumber)
        : null) ||
      null;

    const key = `${carrier}|${number}|${date}|${origin}|${destination}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, {
        carrier,
        operating_carrier: null,
        flight_number: number,
        origin,
        destination,
        flight_date: date,
        departure_time: isoLocalTime(flight.departureTime),
        arrival_time: isoLocalTime(flight.arrivalTime),
        cabin: null,
        booking_class: null,
        seat,
        projected_pqp: null,
        projected_pqf: null,
        projected_award_miles: null,
      });
    }
  }

  const segments = [...byIdentity.values()].sort(
    (a, b) =>
      a.flight_date.localeCompare(b.flight_date) ||
      (a.departure_time ?? "").localeCompare(b.departure_time ?? "")
  );
  if (segments.length === 0) return null;

  const carriers = new Set(segments.map((s) => s.carrier));
  const issuing = [...carriers][0];
  if (carriers.size > 1)
    warnings.push(
      `Mixed airlines in one booking (${[...carriers].join(", ")}) — issuer recorded as ${issuing}.`
    );
  if (confirmations.size > 1)
    warnings.push(
      `The markup carries ${confirmations.size} confirmation codes; using the first.`
    );
  if (cancelledSkipped > 0)
    warnings.push(`${cancelledSkipped} cancelled reservation(s) in the markup were ignored.`);
  warnings.unshift(
    "Itinerary from the airline's embedded flight markup — this document names no fare. The ticket lands with no cost until a receipt or your own entry fills it."
  );

  return {
    kind: "schema_markup",
    confirmation: [...confirmations][0] ?? null,
    ticket_number: ticketNumber,
    issuing_carrier: issuing,
    issue_date: null,
    email_date: emailDate,
    currency: "USD",
    base_fare: null,
    local_fare: null,
    surcharges: null,
    taxes: null,
    ancillary_fees: null,
    gross_total: null,
    miles_redeemed: null,
    payment_method: null,
    payments: [],
    previous_ticket_number: null,
    residual_credit: null,
    credit_balance: null,
    additional_collection: null,
    original_trip_total: null,
    change_fee: null,
    frequent_flyer_program: null,
    travelers: Math.max(1, passengers.size),
    segments,
    warnings,
  };
}
