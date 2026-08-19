/*
 * myFlightradar24 "flight diary" CSV import.
 *
 * The export is a flight LOG, not an accounting document: no money, no
 * postings — but it is the richest quick-start many people have, and it
 * carries fields the ledger prizes and receipts rarely state: the seat, the
 * cabin, the aircraft type, the registration painted on the tail, and
 * whether the trip was work or leisure. So the import does two jobs: create
 * history the ledger has never met, and FILL BLANKS on flights it already
 * has — never overwriting a value the user or a receipt put there first.
 *
 * Format notes, learned from real exports:
 *  - the file starts with a blank line before the header;
 *  - airports print as "City / Name (IATA/ICAO)" — the IATA code is the
 *    part the ledger keys on, and a field without one cannot be imported;
 *  - "00:00:00" is how the diary spells an unknown time, so it is read as
 *    "no time" (a genuine midnight departure is the rarer thing to lose);
 *  - an empty airline prints as " (/)", an empty aircraft as " ()";
 *  - cabin and reason are numeric codes (1 Economy, 2 Business, 3 First,
 *    4 Premium; 1 Leisure, 2 Business — 0 means unset).
 */

import { parseCsv } from "./csv-parse";
import { segmentIdentityKey } from "./mileageplus-import";
import { UNKNOWN_CARRIER } from "./types";
import type { Purpose, SegmentRow } from "./types";

export interface DiaryRow {
  index: number; // 1-based line in the file, for error messages
  date: string;
  carrier: string | null;
  flight_number: string | null;
  origin: string;
  destination: string;
  departure_time: string | null;
  arrival_time: string | null;
  cabin: string | null;
  seat: string | null;
  aircraft: string | null;
  tail_number: string | null;
  purpose: Purpose | null;
  note: string | null;
}

export interface DiarySkippedRow {
  index: number;
  raw: string;
  reason: string;
}

export interface DiaryPreviewRow {
  key: number;
  action: "create" | "fill" | "unchanged";
  segmentId?: string;
  row: DiaryRow;
  /** for create: the status the segment will be born with */
  status?: "flown_unreconciled" | "ticketed";
  /** for fill: human-readable list of the blanks this row can fill */
  fills?: string[];
}

export interface DiaryPreview {
  rows: DiaryPreviewRow[];
  skipped: DiarySkippedRow[];
}

const CABINS: Record<string, string> = {
  "1": "Economy",
  "2": "Business",
  "3": "First",
  "4": "Premium Plus",
};
const REASONS: Record<string, Purpose> = { "1": "personal", "2": "business" };

/** The header row is unmistakable; used to route a dropped CSV. */
export function looksLikeFlightDiary(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase();
  return (
    head.includes("flight number") &&
    head.includes("dep time") &&
    head.includes("registration")
  );
}

const iata = (field: string): string | null =>
  field.match(/\(([A-Z0-9]{3})\/[A-Z0-9]*\)\s*$/)?.[1] ?? null;

const carrierOf = (airline: string): string | null =>
  airline.match(/\(([A-Z0-9]{2})\/[A-Z0-9]*\)\s*$/)?.[1] ?? null;

const timeOf = (raw: string): string | null => {
  const m = raw.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const t = `${m[1]}:${m[2]}`;
  return t === "00:00" ? null : t; // the diary's spelling of "unknown"
};

export function parseFlightDiaryCsv(text: string): {
  rows: DiaryRow[];
  skipped: DiarySkippedRow[];
  error?: string;
} {
  const table = parseCsv(text.replace(/^﻿/, ""));
  const headerIdx = table.findIndex(
    (r) => r[0]?.trim().toLowerCase() === "date" && r.length >= 10
  );
  if (headerIdx === -1)
    return {
      rows: [],
      skipped: [],
      error:
        "Couldn't find the header row (Date, Flight number, From, To, …). Is this the myFlightradar24 flight-diary export?",
    };
  const header = table[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cDate = col("date");
  const cNo = col("flight number");
  const cFrom = col("from");
  const cTo = col("to");
  const cDep = col("dep time");
  const cArr = col("arr time");
  const cAirline = col("airline");
  const cAircraft = col("aircraft");
  const cReg = col("registration");
  const cSeat = col("seat number");
  const cClass = col("flight class");
  const cReason = col("flight reason");
  const cNote = col("note");
  if (cFrom === -1 || cTo === -1)
    return { rows: [], skipped: [], error: "Couldn't find the From/To columns." };

  const rows: DiaryRow[] = [];
  const skipped: DiarySkippedRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue;
    const index = i + 1;
    const rawLabel = `${cells[cDate] ?? ""} ${cells[cNo] ?? ""} ${cells[cFrom] ?? ""}→${cells[cTo] ?? ""}`.trim();
    const date = (cells[cDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped.push({ index, raw: rawLabel, reason: "Unreadable date" });
      continue;
    }
    const origin = iata(cells[cFrom] ?? "");
    const destination = iata(cells[cTo] ?? "");
    if (!origin || !destination) {
      skipped.push({
        index,
        raw: rawLabel,
        reason: "Airport without an IATA code — the ledger keys on those",
      });
      continue;
    }
    // "UA59" carries the carrier; the Airline column is the fallback for
    // rows logged without a flight number
    const no = (cells[cNo] ?? "").trim().toUpperCase();
    const noMatch = no.match(/^([A-Z0-9]{2})\s*(\d{1,4})[A-Z]?$/);
    const carrier =
      noMatch?.[1] ?? carrierOf((cells[cAirline] ?? "").trim()) ?? null;
    const aircraftRaw = (cells[cAircraft] ?? "").trim();
    const aircraft =
      aircraftRaw.replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
    rows.push({
      index,
      date,
      carrier,
      flight_number: noMatch?.[2] ?? null,
      origin,
      destination,
      departure_time: timeOf(cells[cDep] ?? ""),
      arrival_time: timeOf(cells[cArr] ?? ""),
      cabin: CABINS[(cells[cClass] ?? "").trim()] ?? null,
      seat: (cells[cSeat] ?? "").trim().toUpperCase() || null,
      aircraft,
      tail_number: (cells[cReg] ?? "").trim().toUpperCase() || null,
      purpose: REASONS[(cells[cReason] ?? "").trim()] ?? null,
      note: (cells[cNote] ?? "").trim() || null,
    });
  }
  return { rows, skipped };
}

/* -------------------------------- Flighty ------------------------------- */

/** Flighty's Airline column speaks ICAO ("UAL", "DLH"), the ledger files by
 *  IATA ("UA", "LH") — filing raw ICAO would split a carrier from its own
 *  flights. Common carriers only; an unmapped code passes through raw,
 *  which is still the truth, just in the other alphabet, and editable. */
const ICAO_TO_IATA: Record<string, string> = {
  AAL: "AA", ACA: "AC", AEE: "A3", AFR: "AF", ASA: "AS", AUA: "OS",
  AUI: "PS", AZA: "AZ", BAW: "BA", BER: "AB", CCA: "CA", CES: "MU",
  CLH: "CL", CPA: "CX", CSA: "OK", CSN: "CZ", DAL: "DL", DLA: "EN",
  DLH: "LH", EIN: "EI", ELY: "LY", ETD: "EY", EVA: "BR", EZY: "U2",
  FIN: "AY", HAL: "HA", IBE: "IB", ITY: "AZ", JAL: "JL", JBU: "B6",
  KAL: "KE", KLM: "KL", LOT: "LO", NAX: "DY", PGT: "PC", QFA: "QF",
  QTR: "QR", RYR: "FR", SAS: "SK", SIA: "SQ", SWA: "WN", SWR: "LX",
  TAP: "TP", THA: "TG", THY: "TK", UAE: "EK", UAL: "UA", VIR: "VS",
  VLG: "VY", WZZ: "W6",
};

const FLIGHTY_CABINS: Record<string, string> = {
  ECONOMY: "Economy",
  PREMIUM_ECONOMY: "Premium Plus",
  BUSINESS: "Business",
  FIRST: "First",
};
const FLIGHTY_REASONS: Record<string, Purpose> = {
  LEISURE: "personal",
  BUSINESS: "business",
};

export function looksLikeFlighty(text: string): boolean {
  const head = text.slice(0, 600);
  return head.includes("Gate Departure (Scheduled)") && head.includes("Tail Number");
}

const isoTime = (raw: string): string | null => {
  const t = raw.trim().match(/T(\d{2}:\d{2})/)?.[1] ?? null;
  /* midnight is Flighty's spelling of "unknown" too — old synced flights
     carry T00:00 placeholders, and filling them wrote fake departure times
     into a real ledger. The genuine 00:00 gate departure is the rarer
     thing to lose, same trade the diary makes. */
  return t === "00:00" ? null : t;
};

export function parseFlightyCsv(text: string): {
  rows: DiaryRow[];
  skipped: DiarySkippedRow[];
  error?: string;
} {
  const table = parseCsv(text.replace(/^﻿/, ""));
  const headerIdx = table.findIndex(
    (r) => r[0]?.trim().toLowerCase() === "date" && r.length >= 20
  );
  if (headerIdx === -1)
    return {
      rows: [],
      skipped: [],
      error: "Couldn't find the header row. Is this the Flighty export?",
    };
  const header = table[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cDate = col("date");
  const cAirline = col("airline");
  const cNo = col("flight");
  const cFrom = col("from");
  const cTo = col("to");
  const cCanceled = col("canceled");
  const cDiverted = col("diverted to");
  const cDep = col("gate departure (scheduled)");
  const cArr = col("gate arrival (scheduled)");
  const cAircraft = col("aircraft type name");
  const cTail = col("tail number");
  const cSeat = col("seat number") >= 0 ? col("seat number") : col("seat");
  const cCabin = col("cabin class");
  const cReason = col("flight reason");
  const cNote = col("notes");
  if (cFrom === -1 || cTo === -1)
    return { rows: [], skipped: [], error: "Couldn't find the From/To columns." };

  const rows: DiaryRow[] = [];
  const skipped: DiarySkippedRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue;
    const index = i + 1;
    const date = (cells[cDate] ?? "").trim();
    const from = (cells[cFrom] ?? "").trim().toUpperCase();
    const to = (cells[cTo] ?? "").trim().toUpperCase();
    const label = `${from}→${to} ${date}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      skipped.push({ index, raw: label, reason: "Unreadable date or airport" });
      continue;
    }
    if ((cells[cCanceled] ?? "").trim().toLowerCase() === "true") {
      skipped.push({
        index,
        raw: label,
        reason: "Cancelled in Flighty — the log import files travel, not cancellations",
      });
      continue;
    }
    const icao = (cells[cAirline] ?? "").trim().toUpperCase();
    const number = (cells[cNo] ?? "").trim().replace(/\D/g, "") || null;
    /* a diversion is where the flight actually LANDED */
    const diverted = (cells[cDiverted] ?? "").trim().toUpperCase();
    const note = (cells[cNote] ?? "").trim();
    rows.push({
      index,
      date,
      carrier: icao ? (ICAO_TO_IATA[icao] ?? icao) : null,
      flight_number: number,
      origin: from,
      destination: /^[A-Z]{3}$/.test(diverted) ? diverted : to,
      departure_time: isoTime(cells[cDep] ?? ""),
      arrival_time: isoTime(cells[cArr] ?? ""),
      cabin: FLIGHTY_CABINS[(cells[cCabin] ?? "").trim().toUpperCase()] ?? null,
      seat: (cells[cSeat] ?? "").trim().toUpperCase() || null,
      aircraft: (cells[cAircraft] ?? "").trim() || null,
      tail_number: (cells[cTail] ?? "").trim().toUpperCase() || null,
      purpose: FLIGHTY_REASONS[(cells[cReason] ?? "").trim().toUpperCase()] ?? null,
      note:
        [note, diverted && diverted !== to ? `diverted from ${to}` : ""]
          .filter(Boolean)
          .join(" — ") || null,
    });
  }
  return { rows, skipped };
}

/* --------------------------- unified flight log -------------------------- */

/** Any supported flight-log CSV — myFlightradar24 or Flighty — one sniff. */
export function looksLikeFlightLog(text: string): boolean {
  return looksLikeFlighty(text) || looksLikeFlightDiary(text);
}

export function parseFlightLog(text: string): {
  rows: DiaryRow[];
  skipped: DiarySkippedRow[];
  error?: string;
} {
  /* Flighty first: its header also contains "Flight number"-adjacent words,
     but the diary's sniff needs "Dep time", which Flighty never prints */
  return looksLikeFlighty(text) ? parseFlightyCsv(text) : parseFlightDiaryCsv(text);
}

/* ------------------------------ preview -------------------------------- */

const FILLABLE = [
  ["departure_time", "departs"],
  ["arrival_time", "arrives"],
  ["cabin", "cabin"],
  ["seat", "seat"],
  ["aircraft", "aircraft"],
  ["tail_number", "tail"],
  ["purpose", "purpose"],
  ["note", "note"],
] as const;

const segField = (s: SegmentRow, f: (typeof FILLABLE)[number][0]) =>
  f === "note" ? s.notes : s[f];

/** What the diary can add to a segment the ledger already has: blanks only.
 *  A receipt's cabin, a hand-entered seat, a posted anything — all outrank
 *  a diary, which the user may have back-filled years later from memory. */
export function diaryFills(row: DiaryRow, seg: SegmentRow): string[] {
  return FILLABLE.filter(
    ([f]) => row[f === "note" ? "note" : f] != null && segField(seg, f) == null
  ).map(([, label]) => label);
}

export function buildFlightDiaryPreview(
  rows: DiaryRow[],
  segments: SegmentRow[],
  todayOverride?: string
): DiaryPreview {
  const today = todayOverride ?? new Date().toISOString().slice(0, 10);
  const byIdentity = new Map<string, SegmentRow>();
  const byDateRoute = new Map<string, SegmentRow[]>();
  for (const s of segments) {
    byIdentity.set(
      segmentIdentityKey({
        date: s.flight_date,
        carrier: s.marketing_carrier,
        number: s.flight_number,
        origin: s.origin,
        destination: s.destination,
      }),
      s
    );
    const k = `${s.flight_date}|${s.origin}|${s.destination}`;
    byDateRoute.set(k, [...(byDateRoute.get(k) ?? []), s]);
  }

  const out: DiaryPreviewRow[] = [];
  const skipped: DiarySkippedRow[] = [];
  const seenInFile = new Set<string>();
  for (const row of rows) {
    const identity = segmentIdentityKey({
      date: row.date,
      carrier: row.carrier,
      number: row.flight_number,
      origin: row.origin,
      destination: row.destination,
    });
    if (seenInFile.has(identity)) {
      skipped.push({
        index: row.index,
        raw: `${row.carrier ?? ""}${row.flight_number ?? ""} ${row.origin}→${row.destination} ${row.date}`,
        reason: "Duplicate row in this file",
      });
      continue;
    }
    seenInFile.add(identity);

    /* exact identity first; then the date+route pair, but only when it is
       unambiguous — two shuttle hops on one day must not merge */
    let seg = byIdentity.get(identity) ?? null;
    if (!seg) {
      const candidates =
        byDateRoute.get(`${row.date}|${row.origin}|${row.destination}`) ?? [];
      if (candidates.length === 1) seg = candidates[0];
    }

    if (seg) {
      const fills = diaryFills(row, seg);
      out.push(
        fills.length > 0
          ? { key: row.index, action: "fill", segmentId: seg.id, row, fills }
          : { key: row.index, action: "unchanged", segmentId: seg.id, row }
      );
      continue;
    }
    /* A row with no airline still gets its flight — under the honest
       UNKNOWN_CARRIER, which fails every UA check and so can't credit,
       earn, or lean on the CPM basis. Refusing the row lost real history
       (an old charter has no airline anyone remembers); guessing one would
       be worse. The user can name the airline later by editing the flight. */
    out.push({
      key: row.index,
      action: "create",
      row: row.carrier ? row : { ...row, carrier: UNKNOWN_CARRIER },
      status: row.date < today ? "flown_unreconciled" : "ticketed",
    });
  }
  /* Review order is chronological, not file order: Flighty exports newest
     first, myFlightradar24 whatever order flights were logged, and a
     115-row list in either is unscannable. Same-day legs order by departure
     time where the log has one; keys are file-row indices, so the tick
     state never depends on this order. */
  out.sort(
    (a, b) =>
      a.row.date.localeCompare(b.row.date) ||
      (a.row.departure_time ?? "99:99").localeCompare(b.row.departure_time ?? "99:99") ||
      a.key - b.key
  );
  return { rows: out, skipped };
}
