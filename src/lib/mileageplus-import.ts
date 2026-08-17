/**
 * United "My Activity" CSV import: parse → classify → match → build a
 * reviewable preview (design doc §10.2).
 *
 * Two things happen per row, and they are deliberately separate:
 *  1. EVERY row is recorded as MileagePlus account activity (§8.8) — flight
 *     rows and non-flight earning alike (credit-card PQP, shopping, hotels).
 *     This is account history; it is idempotent via a dedup key and needs no
 *     review.
 *  2. FLIGHT rows additionally reconcile against the flight ledger. That part
 *     is reviewable: create / fill in / unchanged / low-confidence suggestion /
 *     conflict with values already entered.
 */
import { parseCsv } from "./csv-parse";
import {
  ActivityKey,
  classifyActivity,
  dedupKey,
  matchActivity,
} from "./activity-match";
import { ActivityType, SegmentRow } from "./types";

export interface ActivityRow {
  index: number; // 1-based line for messages
  date: string | null; // YYYY-MM-DD
  postingDate: string | null;
  activityType: string | null; // raw CSV column
  description: string;
  pqf: number | null;
  pqp: number | null;
  awardMiles: number | null;
  flight: {
    carrier: string;
    number: string;
    origin: string;
    destination: string;
  } | null;
  skipReason: string | null;
}

/** What will be written to the activity ledger for one CSV row. */
export interface ActivityPreviewRow {
  key: number;
  date: string;
  description: string;
  type: ActivityType;
  award: number | null;
  pqp: number | null;
  pqf: number | null;
  dedupKey: string;
  /** already present from an earlier import — will be skipped */
  duplicate: boolean;
}

export interface ImportPreviewRow {
  key: number;
  date: string;
  carrier: string;
  number: string;
  origin: string;
  destination: string;
  pqp: number | null;
  pqf: number | null;
  award: number | null;
  lifetime: number | null;
  lifetimeNote: "award travel" | "non-UA flight" | null;
  action: "create" | "update" | "unchanged" | "conflict" | "suggested";
  segmentId?: string;
  /** why the matcher proposed this segment (design doc §11.3) */
  matchScore?: number;
  matchReasons?: string[];
  diffs: string[];
  fills: string[];
  existing?: {
    label: string;
    pqp: number | null;
    pqf: number | null;
    award: number | null;
    status: string;
  };
}

export interface SkippedRow {
  date: string | null;
  description: string;
  reason: string;
}

export interface ImportPreview {
  flights: ImportPreviewRow[];
  activities: ActivityPreviewRow[];
  skipped: SkippedRow[];
}

/* ------------------------------ parsing -------------------------------- */

/** "UA 604 SFO - IAH" (partner codes like "LH 441" too) */
const FLIGHT_RE =
  /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*(\d{1,4})\s+([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/;

function parseUsDate(raw: string): string | null {
  const s = raw.trim().split(/\s+/)[0] ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mo, d, yRaw] = m;
  const month = Number(mo);
  const day = Number(d);
  let year = Number(yRaw);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,$"\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function parseActivityCsv(text: string): {
  rows: ActivityRow[];
  error?: string;
} {
  const table = parseCsv(text.replace(/^﻿/, ""));
  if (table.length === 0) return { rows: [], error: "The file is empty." };

  // United exports sometimes carry preamble lines; find the real header row.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const lower = table[i].map((c) => c.trim().toLowerCase());
    if (
      lower.some((c) => c.includes("description")) &&
      lower.some((c) => c === "pqp")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      error:
        "Couldn't find the header row (expected columns like Date, Description, PQF, PQP, Miles). Is this the United “My Activity” CSV export?",
    };
  }
  const header = table[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (pred: (c: string) => boolean) => header.findIndex(pred);
  const cDate = col((c) => c.includes("date") && !c.includes("post"));
  const cPosted = col((c) => c.includes("post"));
  const cType = col((c) => c.includes("activity") && c.includes("type"));
  const cDesc = col((c) => c.includes("description"));
  const cPqf = col((c) => c === "pqf");
  const cPqp = col((c) => c === "pqp");
  const cMiles = col((c) => c === "miles" || c === "award miles");
  if (cDate === -1 || cDesc === -1) {
    return { rows: [], error: "Couldn't find the Date/Description columns." };
  }

  const rows: ActivityRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue;
    const description = (cells[cDesc] ?? "").trim();
    const activityType = cType >= 0 ? (cells[cType] ?? "").trim() || null : null;
    const date = parseUsDate(cells[cDate] ?? "");
    const row: ActivityRow = {
      index: i + 1,
      date,
      postingDate: cPosted >= 0 ? parseUsDate(cells[cPosted] ?? "") : null,
      activityType,
      description,
      pqf: cPqf >= 0 ? parseNum(cells[cPqf]) : null,
      pqp: cPqp >= 0 ? parseNum(cells[cPqp]) : null,
      awardMiles: cMiles >= 0 ? parseNum(cells[cMiles]) : null,
      flight: null,
      skipReason: null,
    };

    if (!date) {
      row.skipReason = "Unreadable date";
      rows.push(row);
      continue;
    }

    const isAirline = activityType
      ? /airline/i.test(activityType)
      : FLIGHT_RE.test(description.toUpperCase());
    if (isAirline) {
      const m = description.toUpperCase().match(FLIGHT_RE);
      if (!m) {
        // an airline row we can't read a route from is still account activity
        row.skipReason = null;
      } else {
        const [, carrier, number, origin, destination] = m;
        if (origin === destination) {
          row.skipReason = "Origin and destination are identical";
        } else {
          row.flight = {
            carrier,
            number: String(Number(number)),
            origin,
            destination,
          };
        }
      }
    }
    rows.push(row);
  }
  return { rows };
}

/* ------------------------------ matching ------------------------------- */

const num = (v: number | null | undefined) => (v == null ? null : Number(v));
const numEq = (a: number | null, b: number | null) =>
  a == null || b == null ? a === b : Math.abs(a - b) < 1e-9;
const normFlightNo = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return isFinite(n) ? String(n) : s;
};

/** Statuses that can't legitimately earn a posting — matching one is a conflict. */
const NON_EARNING = new Set(["canceled", "missed"]);

/**
 * Exact identity of one flight: date + carrier + flight number + route. The
 * preview uses it to drop duplicate flight rows within one file; the apply
 * endpoint uses it to refuse to create a segment the ledger already has, so a
 * replayed apply cannot double-count a flight. Deliberately narrower than the
 * fuzzy matcher: a rejected suggestion (same route, different flight number)
 * must still be creatable.
 */
export function segmentIdentityKey(parts: {
  date: string;
  carrier: string | null;
  number: string | null;
  origin: string;
  destination: string;
}): string {
  return [
    parts.date,
    (parts.carrier ?? "").toUpperCase(),
    normFlightNo(parts.number) ?? "",
    parts.origin.toUpperCase(),
    parts.destination.toUpperCase(),
  ].join("|");
}

export function buildImportPreview(
  rows: ActivityRow[],
  segments: SegmentRow[],
  existingKeys: Set<string> = new Set()
): ImportPreview {
  const flights: ImportPreviewRow[] = [];
  const activities: ActivityPreviewRow[] = [];
  const skipped: SkippedRow[] = [];
  const claimed = new Set<string>();
  const createdKeys = new Set<string>();
  const seenKeys = new Map<string, number>();

  for (const row of rows) {
    if (!row.date || row.skipReason) {
      skipped.push({
        date: row.date,
        description: row.description || "(blank row)",
        reason: row.skipReason ?? "Not importable",
      });
      continue;
    }

    // "Airline" rows without a readable route (redeposits, corrections) are
    // not flights — classify them from the description instead
    const type = classifyActivity(
      row.description,
      row.flight != null,
      row.flight?.carrier ?? null
    );

    // dedup: identical rows across imports collapse; genuine repeats within one
    // file get an occurrence suffix so both are kept
    let key = dedupKey({
      date: row.date,
      description: row.description,
      award: row.awardMiles,
      pqp: row.pqp,
      pqf: row.pqf,
    });
    const seen = (seenKeys.get(key) ?? 0) + 1;
    seenKeys.set(key, seen);
    if (seen > 1) key = `${key}#${seen}`;

    activities.push({
      key: row.index,
      date: row.date,
      description: row.description,
      type,
      award: num(row.awardMiles),
      pqp: num(row.pqp),
      pqf: num(row.pqf),
      dedupKey: key,
      duplicate: existingKeys.has(key),
    });

    /* An already-recorded row's story ends at "already recorded": apply
       skips duplicates wholesale, so a match card for one asks a question
       whose answer is discarded — fourteen of them, one real import. A row
       United restated (different PQP, award or wording) has a different
       dedup key and still gets its card, which is the case that matters. */
    if (existingKeys.has(key)) continue;

    if (!row.flight) continue; // non-flight activity: recorded, never matched

    const f = row.flight;
    // Award travel earns 0 award miles — that alone is the signature (award
    // tickets do earn PQP/PQF under current rules). Award and non-UA rows earn
    // no lifetime miles.
    const isAwardFlight = row.awardMiles === 0;
    const lifetimeNote = isAwardFlight
      ? "award travel"
      : f.carrier !== "UA"
        ? "non-UA flight"
        : null;
    const preview: ImportPreviewRow = {
      key: row.index,
      date: row.date,
      carrier: f.carrier,
      number: f.number,
      origin: f.origin,
      destination: f.destination,
      pqp: num(row.pqp),
      pqf: num(row.pqf),
      award: num(row.awardMiles),
      lifetime: lifetimeNote ? 0 : null,
      lifetimeNote,
      action: "create",
      diffs: [],
      fills: [],
    };

    const activityKey: ActivityKey = {
      date: row.date,
      carrier: f.carrier,
      flightNumber: f.number,
      origin: f.origin,
      destination: f.destination,
    };
    const outcome = matchActivity(activityKey, segments, { excludeIds: claimed });

    if (outcome.status === "unmatched") {
      const dupKey = segmentIdentityKey(preview);
      if (createdKeys.has(dupKey)) {
        skipped.push({
          date: preview.date,
          description: row.description,
          reason: "Duplicate flight row in this file",
        });
        continue;
      }
      createdKeys.add(dupKey);
      preview.action = "create";
      flights.push(preview);
      continue;
    }

    const seg = outcome.candidate.segment;
    claimed.add(seg.id);
    preview.segmentId = seg.id;
    preview.matchScore = outcome.candidate.score;
    preview.matchReasons = outcome.candidate.reasons;
    preview.existing = {
      label: `${seg.origin}→${seg.destination} ${seg.marketing_carrier}${seg.flight_number ?? ""} on ${seg.flight_date}`,
      pqp: num(seg.pqp),
      pqf: num(seg.pqf),
      award: num(seg.award_miles),
      status: seg.status,
    };

    // low-confidence match: the user decides whether it's the same flight
    if (outcome.status === "suggested") {
      preview.action = "suggested";
      flights.push(preview);
      continue;
    }

    const check = (label: string, mine: number | null, theirs: number | null) => {
      if (mine != null && theirs != null && !numEq(mine, theirs))
        preview.diffs.push(`${label} ${mine} → ${theirs}`);
    };
    check("PQP", num(seg.pqp), preview.pqp);
    check("PQF", num(seg.pqf), preview.pqf);
    check("Award", num(seg.award_miles), preview.award);
    check("Lifetime", num(seg.lifetime_miles), preview.lifetime);
    const segNo = normFlightNo(seg.flight_number);
    if (segNo != null && segNo !== preview.number)
      preview.diffs.push(
        `Flight # ${seg.marketing_carrier}${segNo} → ${preview.carrier}${preview.number}`
      );
    else if (seg.marketing_carrier && seg.marketing_carrier !== preview.carrier)
      preview.diffs.push(`Carrier ${seg.marketing_carrier} → ${preview.carrier}`);
    if (NON_EARNING.has(seg.status))
      preview.diffs.push(`Status ${seg.status} → flown_reconciled (United posted activity for it)`);

    if (preview.diffs.length > 0) {
      preview.action = "conflict";
      flights.push(preview);
      continue;
    }

    if (seg.pqp == null && preview.pqp != null) preview.fills.push(`PQP ${preview.pqp}`);
    if (seg.pqf == null && preview.pqf != null) preview.fills.push(`PQF ${preview.pqf}`);
    if (seg.award_miles == null && preview.award != null)
      preview.fills.push(`Award ${preview.award}`);
    if (seg.lifetime_miles == null && preview.lifetime != null)
      preview.fills.push(`Lifetime 0 (${preview.lifetimeNote})`);
    if (segNo == null) preview.fills.push(`Flight # ${preview.carrier}${preview.number}`);
    if (seg.status !== "flown_reconciled") preview.fills.push("status → reconciled");

    preview.action = preview.fills.length > 0 ? "update" : "unchanged";
    flights.push(preview);
  }

  flights.sort((a, b) => b.date.localeCompare(a.date));
  activities.sort((a, b) => b.date.localeCompare(a.date));
  return { flights, activities, skipped };
}
