import { bindable, getDb, newId, nowIso, transaction } from "./db";
import { getAirport } from "./airports";
import { hasArrived } from "./arrival";
import { realDate, realTime } from "./validate";
import { routeDistanceMiles } from "./distance";
import { allocateChain, allocateTicket, standaloneAllocation } from "./allocation";
import {
  canEstimateCost,
  deriveTaxRates,
  estimateSegmentCost,
  TaxRates,
} from "./cost-estimate";
import {
  ActivityRecord,
  AdjustmentRow,
  PaymentRow,
  DEFAULT_SETTINGS,
  EnrichedSegment,
  chainWideFlag,
  chainWidePayers,
  effectivePurpose,
  NON_ALLOCABLE_STATUSES,
  RETIRED_SEGMENT_STATUSES,
  sameDayOrder,
  shareByDistance,
  SegmentRow,
  Settings,
  TicketAllocation,
  TicketRow,
} from "./types";

/* ------------------------------- helpers ------------------------------- */

type Values = Record<string, unknown>;

function insertRow(table: string, allowed: string[], values: Values): string {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  const cols = ["id", "created_at", "updated_at"];
  const vals: (string | number | null)[] = [id, now, now];
  const stored: Values = {};
  for (const k of allowed) {
    if (k in values) {
      cols.push(k);
      vals.push(bindable(values[k]));
      stored[k] = bindable(values[k]);
    }
  }
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  db.prepare(sql).run(...vals);
  logChange("create", table, id, { label: labelOf(table, stored), row: stored });
  return id;
}

function updateRow(
  table: string,
  allowed: string[],
  id: string,
  values: Values
): boolean {
  const db = getDb();
  /* Read the row first: the log records before AND after, and "what did this
     edit actually change" can only be answered against what was there. */
  const before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    | Values
    | undefined;
  if (!before) return false;
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const fields: Record<string, [unknown, unknown]> = {};
  for (const k of allowed) {
    if (k in values) {
      const after = bindable(values[k]);
      sets.push(`${k} = ?`);
      vals.push(after);
      if ((before[k] ?? null) !== after) fields[k] = [before[k] ?? null, after];
    }
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = ?");
  vals.push(nowIso());
  vals.push(id);
  const res = db
    .prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  /* Writing a value a row already had is not a change, so it logs nothing —
     otherwise every form save would fill the log with non-events. */
  if (res.changes > 0 && Object.keys(fields).length > 0)
    logChange("update", table, id, { label: labelOf(table, before), fields });
  return res.changes > 0;
}

function deleteRow(table: string, id: string): boolean {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    | Values
    | undefined;
  /* Deleting a ticket takes its money with it — payments and adjustments
     cascade, flights are detached — and SQLite does that silently. Capture
     the children BEFORE the delete, or the log records the disappearance of
     a ticket while the financial rows it took along leave no trace. */
  const cascaded =
    table === "tickets" && before
      ? {
          payments: db
            .prepare("SELECT * FROM payments WHERE ticket_id = ?")
            .all(id) as unknown as Values[],
          adjustments: db
            .prepare("SELECT * FROM adjustments WHERE ticket_id = ?")
            .all(id) as unknown as Values[],
          detached_segments: db
            .prepare("SELECT id, flight_date, origin, destination FROM segments WHERE ticket_id = ?")
            .all(id) as unknown as Values[],
        }
      : null;
  const gone = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  /* The whole row rides in the log: a deletion whose record says only
     "deleted" answers none of the questions a deletion raises. */
  if (gone && before)
    logChange("delete", table, id, {
      label: labelOf(table, before),
      row: before,
      ...(cascaded &&
      (cascaded.payments.length > 0 ||
        cascaded.adjustments.length > 0 ||
        cascaded.detached_segments.length > 0)
        ? { cascaded }
        : {}),
    });
  return gone;
}

/* ------------------------------ change log ------------------------------ */

/**
 * Who is writing, for the change log (design doc §16).
 *
 * Set by the entry points that are not a person — imports, restore — and
 * defaulting to "manual", because every other write is the user editing their
 * own ledger. Ambient rather than threaded through every call: the write
 * helpers above are the one choke point, and an actor argument through forty
 * call sites would be noise. Safe because the write paths are synchronous —
 * runAsActor never spans an await.
 */
let currentActor = "manual";
export function runAsActor<T>(actor: string, fn: () => T): T {
  const prev = currentActor;
  currentActor = actor;
  try {
    return fn();
  } finally {
    currentActor = prev;
  }
}

/** A row's human name in the log, from whichever row shape is at hand. */
function labelOf(table: string, r: Values): string {
  switch (table) {
    case "segments":
      return `${r.origin ?? "?"} → ${r.destination ?? "?"} ${r.flight_date ?? ""}`.trim();
    case "tickets":
      return String(r.confirmation_code ?? r.ticket_number ?? "ticket");
    case "mileageplus_activities":
      return String(r.description ?? "activity").slice(0, 48);
    case "adjustments":
      return `${r.type ?? "adjustment"} ${r.amount ?? ""}`.trim();
    case "payments":
      return `${r.payment_type ?? "payment"} ${r.amount ?? ""}`.trim();
    default:
      return table;
  }
}

/**
 * One appended row per data change, in the same database as the data. Creates
 * and deletes keep the whole row; updates keep only the fields that actually
 * changed, before and after — enough to reconstruct what happened without
 * joining anything.
 */
function logChange(op: string, tbl: string, rowId: string, diff: unknown): void {
  getDb()
    .prepare(
      "INSERT INTO changes (id, at, actor, op, tbl, row_id, diff) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(newId(), nowIso(), currentActor, op, tbl, rowId, JSON.stringify(diff));
}

export interface ChangeRow {
  id: string;
  at: string;
  actor: string;
  op: string;
  tbl: string;
  row_id: string;
  diff: string;
}

/** Newest first, in true insertion order. `tbl`/`rowId` narrow to one row. */
export function listChanges(
  opts: { tbl?: string; rowId?: string; limit?: number } = {}
): ChangeRow[] {
  const limit = Math.min(Math.max(1, Math.round(opts.limit ?? 50)), 500);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.tbl) {
    where.push("tbl = ?");
    args.push(opts.tbl);
  }
  if (opts.rowId) {
    where.push("row_id = ?");
    args.push(opts.rowId);
  }
  args.push(limit);
  return getDb()
    .prepare(
      `SELECT * FROM changes${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY rowid DESC LIMIT ?`
    )
    .all(...args) as unknown as ChangeRow[];
}

/* ------------------------------- tickets ------------------------------- */

const TICKET_FIELDS = [
  "ticket_number",
  "confirmation_code",
  "issuing_carrier",
  "issue_date",
  "currency",
  "exchange_rate",
  "base_fare",
  "surcharges",
  "taxes",
  "ancillary_fees",
  "gross_total",
  "payment_method",
  "status",
  "predecessor_ticket_id",
  "residual_credit",
  "additional_collection",
  "notes",
];

export function listTickets(): TicketRow[] {
  return getDb()
    .prepare("SELECT * FROM tickets ORDER BY COALESCE(issue_date, created_at) DESC")
    .all() as unknown as TicketRow[];
}

export function getTicket(id: string): TicketRow | undefined {
  return getDb().prepare("SELECT * FROM tickets WHERE id = ?").get(id) as
    | TicketRow
    | undefined;
}

/**
 * A reissue chain is a LINE, and allocation depends on it: the chain's money
 * is counted once across its members (design doc §6.5). Nothing in SQLite
 * enforced that shape, so two tickets could name the same predecessor and
 * the chain would silently branch — one branch dropping out of the walk
 * entirely, its fare counted a second time. Three ways to break the line,
 * all refused at the point of writing:
 *   - claiming a predecessor another ticket already claims (a fork)
 *   - naming yourself
 *   - naming a ticket that already descends from you (a cycle)
 */
export class ChainError extends Error {}

function assertChainSafe(id: string | null, predecessor: unknown): void {
  if (predecessor == null || predecessor === "") return;
  const pred = String(predecessor);
  if (id != null && pred === id)
    throw new ChainError("A ticket cannot be its own predecessor");
  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM tickets WHERE id = ?")
    .get(pred) as { id: string } | undefined;
  if (!exists)
    throw new ChainError(
      "That predecessor ticket isn't in the ledger — a chain can only point at a ticket that exists"
    );
  const claimed = db
    .prepare(
      "SELECT id FROM tickets WHERE predecessor_ticket_id = ? AND id IS NOT ?"
    )
    .get(pred, id ?? "") as { id: string } | undefined;
  if (claimed)
    throw new ChainError(
      "That ticket is already the predecessor of another ticket — a reissue chain is a line, not a fork"
    );
  if (id != null) {
    // walk forward from this ticket: reaching `pred` would close a loop
    const seen = new Set<string>([id]);
    let cur: string | null = id;
    while (cur) {
      const next = db
        .prepare("SELECT id FROM tickets WHERE predecessor_ticket_id = ?")
        .get(cur) as { id: string } | undefined;
      if (!next || seen.has(next.id)) break;
      if (next.id === pred)
        throw new ChainError("That would make the reissue chain loop back on itself");
      seen.add(next.id);
      cur = next.id;
    }
  }
}

export const createTicket = (v: Values) => {
  assertChainSafe(null, v.predecessor_ticket_id);
  return insertRow("tickets", TICKET_FIELDS, v);
};
export const updateTicket = (id: string, v: Values) => {
  if ("predecessor_ticket_id" in v) assertChainSafe(id, v.predecessor_ticket_id);
  return updateRow("tickets", TICKET_FIELDS, id, v);
};
/**
 * Straighten a set of tickets into legal chains.
 *
 * Keeps a predecessor link only when it points at a ticket in the same set,
 * isn't a self-reference, doesn't close a loop, and is the ONLY claim on
 * that predecessor (earliest issue date wins the tie, as allocation does).
 * Everything else is cleared, and named, so a restore reports what it had to
 * let go rather than silently costing the same dollars twice.
 */
/** Every date- and time-shaped field a backup carries, checked against the
 *  calendar and the clock. Returns human-readable complaints, empty when the
 *  file is sound. */
export function validateBackupRows(payload: {
  tickets?: unknown[];
  segments?: unknown[];
  adjustments?: unknown[];
  payments?: unknown[];
  activities?: unknown[];
  settings?: Record<string, unknown> | null;
}): string[] {
  const out: string[] = [];
  const look = (
    rows: unknown[] | undefined,
    table: string,
    dates: string[],
    times: string[] = []
  ) => {
    for (const raw of rows ?? []) {
      const row = raw as Record<string, unknown>;
      for (const f of dates) {
        const v = row[f];
        if (v == null || v === "") continue;
        if (!realDate(String(v))) out.push(`${table}.${f} = ${String(v)}`);
      }
      for (const f of times) {
        const v = row[f];
        if (v == null || v === "") continue;
        if (!realTime(String(v))) out.push(`${table}.${f} = ${String(v)}`);
      }
    }
  };
  look(payload.tickets, "ticket", ["issue_date"]);
  look(payload.segments, "flight", ["flight_date"], ["departure_time", "arrival_time"]);
  look(payload.adjustments, "adjustment", ["effective_date"]);
  look(payload.payments, "payment", ["payment_date"]);
  look(payload.activities, "activity", ["activity_date", "posting_date"]);
  /* settings carry dates too — a baseline or a tracking start that never
     existed silently reshapes every lifetime and cost figure downstream */
  const st = (payload as { settings?: Record<string, unknown> }).settings;
  if (st)
    for (const f of ["lifetime_baseline_date", "cost_tracking_start"]) {
      const v = st[f];
      if (v == null || v === "") continue;
      if (!realDate(String(v))) out.push(`settings.${f} = ${String(v)}`);
    }
  return out;
}

export function sanitizeChains<T extends Record<string, unknown>>(
  rows: T[]
): { tickets: T[]; dropped: string[] } {
  type Row = T & {
    id?: unknown;
    issue_date?: unknown;
    ticket_number?: unknown;
    confirmation_code?: unknown;
    predecessor_ticket_id?: unknown;
  };
  const ids = new Set(rows.map((r) => String(r.id)));
  const label = (r: Row) =>
    String(r.ticket_number ?? r.confirmation_code ?? r.id ?? "ticket");
  const dropped: string[] = [];
  const claims = new Map<string, Row[]>();
  const out: Row[] = rows.map((r) => ({ ...r }) as Row);
  for (const r of out) {
    const pred = r.predecessor_ticket_id ? String(r.predecessor_ticket_id) : "";
    if (!pred) continue;
    if (pred === String(r.id) || !ids.has(pred)) {
      dropped.push(`${label(r)} → ${pred === String(r.id) ? "itself" : "a ticket not in this backup"}`);
      r.predecessor_ticket_id = null;
      continue;
    }
    claims.set(pred, [...(claims.get(pred) ?? []), r]);
  }
  for (const [pred, claiming] of claims) {
    if (claiming.length < 2) continue;
    const keep = [...claiming].sort((a, b) =>
      String(a.issue_date ?? "").localeCompare(String(b.issue_date ?? ""))
    )[0];
    for (const r of claiming) {
      if (r === keep) continue;
      dropped.push(`${label(r)} → ${pred} (a second claim on one predecessor)`);
      r.predecessor_ticket_id = null;
    }
  }
  // whatever survived, walk it: any remaining loop loses its closing link
  const byId = new Map(out.map((r) => [String(r.id), r]));
  for (const r of out) {
    const seen = new Set<string>([String(r.id)]);
    let cur = r.predecessor_ticket_id ? byId.get(String(r.predecessor_ticket_id)) : undefined;
    while (cur) {
      if (seen.has(String(cur.id))) {
        dropped.push(`${label(r)} → a chain that loops back on itself`);
        r.predecessor_ticket_id = null;
        break;
      }
      seen.add(String(cur.id));
      cur = cur.predecessor_ticket_id ? byId.get(String(cur.predecessor_ticket_id)) : undefined;
    }
  }
  return { tickets: out, dropped };
}

/**
 * Deleting a ticket detaches whatever claimed it as a predecessor.
 *
 * SQLite would leave the id pointing at nothing: harmless for the walk (an
 * unresolvable predecessor reads as a chain root) but a lie in the data, and
 * a restore of that backup would carry it forward. Clearing it makes the
 * successor an honest root, and the change is logged like any other.
 */
export const deleteTicket = (id: string) => {
  const orphans = getDb()
    .prepare("SELECT id FROM tickets WHERE predecessor_ticket_id = ?")
    .all(id) as unknown as { id: string }[];
  for (const o of orphans) updateTicket(o.id, { predecessor_ticket_id: null });
  return deleteRow("tickets", id);
};

/* ------------------------------ payments ------------------------------- */

const PAYMENT_FIELDS = [
  "ticket_id",
  "payment_type",
  "amount",
  "currency",
  "award_miles_used",
  "payment_date",
  "reference",
  "notes",
];

export function listPayments(): PaymentRow[] {
  return getDb()
    .prepare("SELECT * FROM payments ORDER BY COALESCE(payment_date, created_at)")
    .all() as unknown as PaymentRow[];
}

export const createPayment = (v: Values) =>
  insertRow("payments", PAYMENT_FIELDS, v);
export const updatePayment = (id: string, v: Values) =>
  updateRow("payments", PAYMENT_FIELDS, id, v);
export const deletePayment = (id: string) => deleteRow("payments", id);

/* ----------------------------- adjustments ----------------------------- */

const ADJUSTMENT_FIELDS = [
  "ticket_id",
  "segment_id",
  "type",
  "amount",
  "effective_date",
  "payer",
  "notes",
];

export function listAdjustments(): AdjustmentRow[] {
  return getDb()
    .prepare("SELECT * FROM adjustments ORDER BY COALESCE(effective_date, created_at) DESC")
    .all() as unknown as AdjustmentRow[];
}

export const createAdjustment = (v: Values) =>
  insertRow("adjustments", ADJUSTMENT_FIELDS, v);
export const updateAdjustment = (id: string, v: Values) =>
  updateRow("adjustments", ADJUSTMENT_FIELDS, id, v);
export const deleteAdjustment = (id: string) => deleteRow("adjustments", id);

/* ------------------------------ segments ------------------------------- */

const SEGMENT_FIELDS = [
  "ticket_id",
  "marketing_carrier",
  "operating_carrier",
  "flight_number",
  "origin",
  "destination",
  "flight_date",
  "departure_time",
  "arrival_time",
  "cabin",
  "booking_class",
  "seat",
  "aircraft",
  "tail_number",
  "status",
  "purpose",
  "distance_miles",
  "lifetime_miles",
  /* Added by migration long after this list was written, and left out of it —
     so every write path silently dropped it. The flight form sent it, validate
     accepted it, receipt import set it, and insertRow/updateRow/insertPreserving
     each filtered it out before the SQL, leaving the column NULL forever. NULL
     means "infer", and inference says UA metal earns, so a UA flight credited
     to Miles & More kept reporting lifetime miles it never earned — and a
     backup restore dropped the flag a user had set by hand. */
  "credits_mileageplus",
  "award_miles",
  "pqp",
  "pqf",
  "projected_pqp",
  "projected_pqf",
  "projected_award_miles",
  "manual_cost",
  "notes",
];

/**
 * Newest first — and for flights sharing a date, the one that departed LATER
 * first, which is what "newest first" means within a day too.
 *
 * `departure_time DESC` handles that only when the times are recorded, and 62
 * of the segments here have none: a same-day connection then falls back to
 * insertion order, which is forward-chronological, so SFO→EWR printed above
 * the EWR→FCO it fed. With no clock to sort by, the itinerary orders itself —
 * a leg that starts where the previous one ended came after it.
 */
export function listSegmentsRaw(): SegmentRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM segments ORDER BY flight_date DESC, departure_time DESC")
    .all() as unknown as SegmentRow[];

  const out: SegmentRow[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && rows[j].flight_date === rows[i].flight_date) j++;
    const sameDay = rows.slice(i, j);
    out.push(...(sameDay.length > 1 ? sameDayOrder(sameDay) : sameDay));
    i = j;
  }
  return out;
}


export function getSegment(id: string): SegmentRow | undefined {
  return getDb().prepare("SELECT * FROM segments WHERE id = ?").get(id) as
    | SegmentRow
    | undefined;
}

/** Compute great-circle distance for a segment's route; null if airport unknown. */
function withDistance(v: Values): Values {
  const out = { ...v };
  if (typeof out.origin === "string") out.origin = out.origin.trim().toUpperCase();
  if (typeof out.destination === "string")
    out.destination = out.destination.trim().toUpperCase();
  if (out.origin && out.destination) {
    out.distance_miles = routeDistanceMiles(
      out.origin as string,
      out.destination as string
    );
  }
  return out;
}

export function createSegment(v: Values): string {
  return insertRow("segments", SEGMENT_FIELDS, withDistance(v));
}

export function updateSegment(id: string, v: Values): boolean {
  let values = { ...v };
  // Recompute distance when either endpoint changes
  if ("origin" in values || "destination" in values) {
    const existing = getSegment(id);
    if (existing) {
      values = withDistance({
        ...values,
        origin: values.origin ?? existing.origin,
        destination: values.destination ?? existing.destination,
      });
    }
  }
  return updateRow("segments", SEGMENT_FIELDS, id, values);
}

export const deleteSegment = (id: string) => deleteRow("segments", id);

/* ----------------------------- activities ------------------------------ */

const ACTIVITY_FIELDS = [
  "activity_date",
  "posting_date",
  "description",
  "activity_type",
  "carrier",
  "flight_number",
  "origin",
  "destination",
  "award_miles",
  "pqp",
  "pqf",
  "segment_id",
  "match_score",
  "match_status",
  "match_reason",
  "source",
  "dedup_key",
  "notes",
];

/**
 * Every table's writable columns, by table name.
 *
 * Exported for one reason: so the selftest can hold these lists against the
 * live schema. They gate all three write paths — insertRow, updateRow and the
 * backup restore — by silently skipping anything not named here, which makes a
 * forgotten column the quietest possible failure. Nothing throws, nothing
 * warns, and the value simply never reaches the database.
 *
 * `credits_mileageplus` sat missing here for exactly that long. Adding a
 * column in db.ts MIGRATIONS is half the job; this is the other half.
 */
export const WRITABLE_FIELDS: Record<string, readonly string[]> = {
  tickets: TICKET_FIELDS,
  segments: SEGMENT_FIELDS,
  adjustments: ADJUSTMENT_FIELDS,
  payments: PAYMENT_FIELDS,
  mileageplus_activities: ACTIVITY_FIELDS,
};

/** Columns every table has and no caller supplies. */
export const MANAGED_COLUMNS = ["id", "created_at", "updated_at"];

export function listActivities(): ActivityRecord[] {
  return getDb()
    .prepare(
      "SELECT * FROM mileageplus_activities ORDER BY activity_date DESC, created_at DESC"
    )
    .all() as unknown as ActivityRecord[];
}

export function getActivity(id: string): ActivityRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM mileageplus_activities WHERE id = ?")
    .get(id) as ActivityRecord | undefined;
}

export function listDedupKeys(): Set<string> {
  const rows = getDb()
    .prepare(
      "SELECT dedup_key FROM mileageplus_activities WHERE dedup_key IS NOT NULL"
    )
    .all() as unknown as { dedup_key: string }[];
  return new Set(rows.map((r) => r.dedup_key));
}

export const createActivity = (v: Values) =>
  insertRow("mileageplus_activities", ACTIVITY_FIELDS, v);
export const updateActivity = (id: string, v: Values) =>
  updateRow("mileageplus_activities", ACTIVITY_FIELDS, id, v);
export const deleteActivity = (id: string) =>
  deleteRow("mileageplus_activities", id);

/* ------------------------------ settings ------------------------------- */

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as unknown as {
    key: string;
    value: string;
  }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      stored[r.key] = r.value;
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export function saveSettings(patch: Partial<Settings>, silent = false): Settings {
  const db = getDb();
  const before = getSettings();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const fields: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const norm = v ?? null;
    const prev = (before as unknown as Values)[k] ?? null;
    if (JSON.stringify(prev) !== JSON.stringify(norm)) fields[k] = [prev, norm];
    stmt.run(k, JSON.stringify(norm));
  }
  if (!silent && Object.keys(fields).length > 0)
    logChange("update", "settings", "", { label: "settings", fields });
  return getSettings();
}

/* ----------------------- enrichment & allocation ----------------------- */

export interface EnrichedData {
  segments: EnrichedSegment[];
  tickets: TicketRow[];
  adjustments: AdjustmentRow[];
  payments: PaymentRow[];
  activities: ActivityRecord[];
  allocations: Record<string, TicketAllocation>; // by ticket id
  /** tax rates behind PQP-derived cost estimates, for disclosure in the UI */
  taxRates: TaxRates;
}

/** Load everything and run cost allocation. Single source of truth for lists,
 *  analytics and exports — computed on read so it can never go stale. */
/** Advance every "ticketed" leg whose scheduled arrival passed the margin
 *  (arrival.ts: six hours where the schedule is known, the day rule where it
 *  isn't) to flown_unreconciled. Runs on every enriched read, so a flight
 *  becomes flown by landing, not by waiting for the next import to say so.
 *  Only ever that one transition — cancelled stays cancelled, flown and
 *  reconciled are never touched — and every advance is logged under its own
 *  actor, so Recent changes answers "who marked this flown" with "it landed".
 */
export function advanceArrivedLegs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const segments = listSegmentsRaw();
  const due = segments.filter(
    (s) => s.status === "ticketed" && hasArrived(s, nowMs, today)
  );
  if (due.length === 0) return 0;
  /* The clock alone cannot tell "landed" from "reissued away before
     departure": a leg still ticketed on a ticket that has a SUCCESSOR is
     an exchange leftover, and calling it flown once poisoned a real
     chain's miles and cost split. The reissue's own rule applies instead —
     issued before the leg's date and not carried by the new itinerary
     means the coupon died with the exchange; the boundary day stays a
     question (the receipt re-import asks it), never a silent verdict. */
  const successorOf = new Map<string, TicketRow>();
  for (const t of listTickets())
    if (t.predecessor_ticket_id) successorOf.set(t.predecessor_ticket_id, t);
  const legKey = (x: { flight_date: string; origin: string; destination: string }) =>
    `${x.flight_date}|${x.origin}|${x.destination}`;
  let advanced = 0;
  runAsActor("arrival", () =>
    transaction(() => {
      for (const s of due) {
        const succ = s.ticket_id ? successorOf.get(s.ticket_id) : undefined;
        if (!succ) {
          updateSegment(s.id, { status: "flown_unreconciled" });
          advanced++;
          continue;
        }
        const carried = segments.some(
          (x) => x.ticket_id === succ.id && legKey(x) === legKey(s)
        );
        if (carried) continue; // its coupon moved; this row is the import's to resolve
        if (succ.issue_date && s.flight_date > succ.issue_date) {
          updateSegment(s.id, { status: "canceled" });
          advanced++;
        }
        // same-day or dateless reissue: leave the question standing
      }
    })
  );
  return advanced;
}

export function getEnrichedData(): EnrichedData {
  advanceArrivedLegs();
  const segments = listSegmentsRaw();
  const tickets = listTickets();
  const adjustments = listAdjustments();

  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  /* Tickets bought with miles. An award earns no redeemable miles, and on a
     partner's metal it earns nothing at all — so a flight on one may be
     legitimately absent from every MileagePlus statement. */
  const reimbursedTickets = new Set(
    adjustments.filter((a) => a.type === "reimbursement").map((a) => a.ticket_id)
  );
  /* Who paid it back, when the reimbursement names them. A fully reimbursed
     flight's personal cost is $0.00, which is true but says nothing — the
     useful fact is WHO covered it. Several payers on one ticket is a split, so
     nobody is singled out. */
  const reimbursedBy = new Map<string, string | null>();
  for (const a of adjustments) {
    if (a.type !== "reimbursement" || !a.payer) continue;
    const seen = reimbursedBy.get(a.ticket_id);
    reimbursedBy.set(
      a.ticket_id,
      seen === undefined || seen === a.payer ? a.payer : null
    );
  }
  const milesPayments = listPayments().filter((p) => p.payment_type === "miles");
  const awardTickets = new Set(milesPayments.map((p) => p.ticket_id));
  /* Miles redeemed per ticket, where the receipt recorded them. */
  const milesByTicket = new Map<string, number>();
  for (const p of milesPayments) {
    if (p.award_miles_used == null) continue;
    milesByTicket.set(
      p.ticket_id,
      (milesByTicket.get(p.ticket_id) ?? 0) + p.award_miles_used
    );
  }
  const segsByTicket = new Map<string, SegmentRow[]>();
  for (const s of segments) {
    if (!s.ticket_id) continue;
    const arr = segsByTicket.get(s.ticket_id) ?? [];
    arr.push(s);
    segsByTicket.set(s.ticket_id, arr);
  }
  const adjByTicket = new Map<string, AdjustmentRow[]>();
  for (const a of adjustments) {
    const arr = adjByTicket.get(a.ticket_id) ?? [];
    arr.push(a);
    adjByTicket.set(a.ticket_id, arr);
  }

  /* Reissue chains are allocated as one unit so the same dollars aren't
     counted once per ticket (design doc §6.5). Walk each chain from its root. */
  /* One successor per ticket. Writes now refuse a fork, but data restored
     from an older backup can still carry one — and a Map would silently keep
     the last writer, dropping the other branch out of every chain walk and
     out of `allocations` entirely. Keep the earliest-issued claimant as the
     line's continuation (that is the reissue that actually followed) and let
     the others start their own chains, so every ticket is allocated exactly
     once. reconcile.ts reports the fork. */
  const successorOf = new Map<string, TicketRow>();
  for (const t of tickets) {
    const pred = t.predecessor_ticket_id;
    if (!pred) continue;
    const held = successorOf.get(pred);
    if (!held) {
      successorOf.set(pred, t);
      continue;
    }
    const key = (x: TicketRow) => x.issue_date ?? x.created_at ?? x.id;
    if (key(t) < key(held)) successorOf.set(pred, t);
  }
  /* a ticket only continues the line if the line agrees it does */
  const isSuccessor = (t: TicketRow) =>
    t.predecessor_ticket_id != null &&
    successorOf.get(t.predecessor_ticket_id)?.id === t.id;
  const isRoot = (t: TicketRow) =>
    !t.predecessor_ticket_id ||
    !ticketById.has(t.predecessor_ticket_id) ||
    !isSuccessor(t);

  const allocations: Record<string, TicketAllocation> = {};
  const done = new Set<string>();
  for (const t of tickets) {
    if (done.has(t.id) || !isRoot(t)) continue;
    const chain: TicketRow[] = [t];
    const guard = new Set<string>([t.id]); // circular links can't hang the walk
    let next = successorOf.get(t.id);
    while (next && !guard.has(next.id)) {
      chain.push(next);
      guard.add(next.id);
      next = successorOf.get(next.id);
    }
    if (chain.length === 1) {
      allocations[t.id] = allocateTicket(
        t,
        segsByTicket.get(t.id) ?? [],
        adjByTicket.get(t.id) ?? []
      );
      done.add(t.id);
      continue;
    }
    const chainAllocs = allocateChain(chain, segsByTicket, adjByTicket);
    for (const c of chain) {
      allocations[c.id] = chainAllocs[c.id];
      done.add(c.id);
    }
  }
  // tickets whose predecessor is missing/circular still need an allocation
  for (const t of tickets) {
    if (!done.has(t.id)) {
      allocations[t.id] = allocateTicket(
        t,
        segsByTicket.get(t.id) ?? [],
        adjByTicket.get(t.id) ?? []
      );
    }
  }

  /* The payer belongs to the whole chain, not just the member it was recorded
     against — see chainWidePayers. */
  const chains = [
    ...new Set(Object.values(allocations).map((a) => a.chain?.ticketIds).filter(Boolean)),
  ] as string[][];
  const chainPayers = chainWidePayers(reimbursedBy, chains);
  /* Buying with miles is a fact about the PURCHASE, so it survives a reissue:
     exchange an award ticket and the miles payment stays on the ticket you
     gave up. Read per ticket, the flown coupon of such a chain came back
     "not an award" — which `expectsMileagePlusCredit` then uses to decide a
     partner leg should have earned. Same shape as the payer and the
     reimbursement flag. */
  const awardAnywhereInChain = chainWideFlag(awardTickets, chains);

  /* Redeemed miles, allocated to the coupons that flew on them.
     A reissue is funded by its predecessor's value, so the miles payment sits
     on the ticket that was exchanged AWAY, not the one you flew: ZZ0005's
     12,700 are recorded against 0167900000002, one hop back. Read per ticket,
     the flown leg found nothing and fell back to PQP x 100 — the right number
     wearing an "estimated" asterisk while the real payment sat in the ledger.
     A chain redeems once, so its miles belong to all of its coupons, split by
     distance the way its cash is.

     Redeems ONCE — which is why the chain's figure is its latest priced
     redemption, never a sum. United reprices an award by redeposit-and-
     recharge: the MHRYF6 rebooking posted "Air Award Redeposit +79,500" and a
     fresh −40,000 the same day, so when a reissue prints its own award total,
     that total REPLACES the predecessor's redemption. Summed, the chain
     charged 119,500 miles for a 40,000-mile trip. A reissue that prints no
     award total (ZZ0005's shape) leaves the earlier redemption standing. */
  const awardMilesBySegment = new Map<string, number>();
  const fundingGroups: string[][] = [
    ...chains,
    ...tickets.filter((t) => !allocations[t.id]?.chain).map((t) => [t.id]),
  ];
  for (const ids of fundingGroups) {
    // ids are root-first, so the last member with a redemption is the reprice
    const miles = ids.reduce((a, id) => milesByTicket.get(id) ?? a, 0);
    if (miles <= 0) continue;
    const segs = ids
      .flatMap((id) => segsByTicket.get(id) ?? [])
      .filter((x) => !NON_ALLOCABLE_STATUSES.includes(x.status));
    if (segs.length === 0) continue;
    for (const [id, v] of shareByDistance(miles, segs)) awardMilesBySegment.set(id, v);
  }
  /* And the reimbursement ITSELF is chain-wide, which decides business vs
     personal. Read per-ticket, one member of a chain came out business and its
     sibling personal off a single reimbursement — so a flight showing its
     payer still sat under the Personal filter. */
  const reimbursedAnywhereInChain = chainWideFlag(reimbursedTickets, chains);

  const settings = getSettings();
  const taxRates = deriveTaxRates(tickets, segments, {
    domestic: settings.tax_rate_domestic,
    international: settings.tax_rate_international,
  });

  const enriched: EnrichedSegment[] = segments.map((s) => {
    const ticket = s.ticket_id ? ticketById.get(s.ticket_id) : undefined;
    const alloc =
      s.ticket_id && allocations[s.ticket_id]
        ? allocations[s.ticket_id].perSegment[s.id]
        : undefined;
    const standalone = alloc ? null : standaloneAllocation(s);
    const originAirport = getAirport(s.origin);
    const destAirport = getAirport(s.destination);
    const allocationMethod = alloc ? alloc.method : standalone!.method;
    const estimated_gross =
      settings.estimate_cost_from_pqp &&
      canEstimateCost({
        status: s.status,
        allocation_method: allocationMethod,
        pqp: s.pqp,
        award_miles: s.award_miles,
      })
        ? estimateSegmentCost(s, taxRates)
        : null;
    return {
      ...s,
      gross_cost: alloc ? alloc.gross : standalone!.gross,
      personal_cost: alloc ? alloc.personal : standalone!.personal,
      allocation_method: allocationMethod,
      estimated_gross,
      effective_purpose: effectivePurpose(
        s.purpose,
        ticket != null && reimbursedAnywhereInChain.has(ticket.id)
      ),
      reimbursed_by: ticket ? (chainPayers.get(ticket.id) ?? null) : null,
      /* What this leg cost in miles. A recorded payment is authoritative and
         is split across the ticket's legs by distance. Where the receipt never
         itemised it, United's award PQP is the redemption divided by 100 —
         checked against the 10 tickets here that record both: exact on 9, and
         off by one PQP on the tenth. Derived values are flagged, not passed
         off as recorded. */
      ...(() => {
        const recorded = awardMilesBySegment.get(s.id);
        if (recorded != null)
          return { award_miles_spent: recorded, award_miles_estimated: false };
        if (!ticket) return { award_miles_spent: null, award_miles_estimated: false };
        if (!awardAnywhereInChain.has(ticket.id) && s.award_miles !== 0)
          return { award_miles_spent: null, award_miles_estimated: false };
        return s.pqp != null && s.pqp > 0
          ? { award_miles_spent: s.pqp * 100, award_miles_estimated: true }
          : { award_miles_spent: null, award_miles_estimated: false };
      })(),
      ticket_label: ticket
        ? ticket.confirmation_code || ticket.ticket_number || "ticket"
        : null,
      issuing_carrier: ticket?.issuing_carrier ?? null,
      ticket_is_award: ticket != null && awardAnywhereInChain.has(ticket.id),
      origin_city: originAirport?.city ?? null,
      destination_city: destAirport?.city ?? null,
      distance_estimated: s.distance_miles == null,
      /* what this flight's money is made of: extras pinned to it are inside
         gross_cost, and a flight that says only "$537.60" can't explain the
         $299 upgrade sitting in that figure */
      pinned_extras: adjustments
        .filter((a) => a.segment_id === s.id && a.type === "extra")
        .map((a) => ({
          label: (a.notes ?? "").split(" — ")[0] || "Extra purchase",
          amount: a.amount ?? 0,
        })),
    };
  });

  return {
    segments: enriched,
    tickets,
    adjustments,
    payments: listPayments(),
    activities: listActivities(),
    allocations,
    taxRates,
  };
}

/* --------------------------- backup / restore --------------------------- */

export interface BackupPayload {
  version: 1;
  exported_at: string;
  settings: Settings;
  tickets: TicketRow[];
  segments: SegmentRow[];
  adjustments: AdjustmentRow[];
  payments?: PaymentRow[]; // added later; absent in older backups
  activities?: ActivityRecord[];
}

export function exportBackup(): BackupPayload {
  return {
    version: 1,
    exported_at: nowIso(),
    settings: getSettings(),
    tickets: listTickets(),
    segments: listSegmentsRaw(),
    adjustments: listAdjustments(),
    payments: listPayments(),
    activities: listActivities(),
  };
}

function insertPreserving(table: string, rowsIn: readonly object[], allowed: string[]) {
  const db = getDb();
  const rows = rowsIn as Record<string, unknown>[];
  for (const row of rows) {
    const cols = ["id", "created_at", "updated_at"];
    const vals: (string | number | null)[] = [
      String(row.id ?? newId()),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ];
    for (const k of allowed) {
      if (k in row) {
        cols.push(k);
        vals.push(bindable(row[k]));
      }
    }
    db.prepare(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
    ).run(...vals);
  }
}

/** Replace the entire database with a backup payload (validated by caller). */
export function importBackup(payload: BackupPayload): void {
  runAsActor("restore", () => {
  transaction((db) => {
    const replaced: Record<string, number> = {};
    for (const t of ["tickets", "segments", "adjustments", "payments", "mileageplus_activities"])
      replaced[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    db.exec(
      "DELETE FROM mileageplus_activities; DELETE FROM payments; DELETE FROM adjustments; DELETE FROM segments; DELETE FROM tickets; DELETE FROM settings;"
    );
    /* insertPreserving writes rows verbatim, so every guard on the normal
       write path is bypassed — including the one that keeps a reissue chain
       a line. A backup taken before that guard existed (or hand-edited) can
       carry a fork, a cycle or a link to a ticket that isn't in the file;
       each would make allocation count money twice. Straighten it here,
       where the whole set is visible, and say what was dropped. */
    /* insertPreserving writes rows verbatim — ids and timestamps must
       survive a restore — but "verbatim" also let 2026-02-31 and 99:99 in
       through the back door, values no form could produce and no report can
       group. Validate the fields that have a shape, and refuse the whole
       file rather than quietly storing an impossible date. */
    const bad = validateBackupRows(payload as unknown as Parameters<typeof validateBackupRows>[0]);
    if (bad.length > 0)
      throw new Error(
        `This backup has ${bad.length} impossible value(s): ${bad.slice(0, 4).join("; ")}` +
          (bad.length > 4 ? ` (and ${bad.length - 4} more)` : "")
      );
    const restoredTickets = sanitizeChains(
      (payload.tickets ?? []) as unknown as Record<string, unknown>[]
    );
    insertPreserving(
      "tickets",
      restoredTickets.tickets as unknown as Values[],
      TICKET_FIELDS
    );
    /* A backup taken before the statuses were collapsed still carries them,
       and insertPreserving writes rows verbatim without going through
       validate. Remap on the way in so a restore can't reintroduce a status
       the rest of the app no longer knows. */
    insertPreserving(
      "segments",
      (payload.segments ?? []).map((s) =>
        RETIRED_SEGMENT_STATUSES[s.status]
          ? { ...s, status: RETIRED_SEGMENT_STATUSES[s.status] }
          : s
      ),
      SEGMENT_FIELDS
    );
    insertPreserving("adjustments", payload.adjustments ?? [], ADJUSTMENT_FIELDS);
    insertPreserving("payments", payload.payments ?? [], PAYMENT_FIELDS);
    insertPreserving(
      "mileageplus_activities",
      payload.activities ?? [],
      ACTIVITY_FIELDS
    );
    /* One event for the whole restore. The rows arrive via insertPreserving,
       which is deliberately unlogged — five hundred per-row "creates" would
       bury the one line that says what actually happened. */
    logChange("restore", "", "", {
      replaced,
      ...(restoredTickets.dropped.length > 0
        ? { chain_links_dropped: restoredTickets.dropped }
        : {}),
      restored: {
        tickets: payload.tickets?.length ?? 0,
        segments: payload.segments?.length ?? 0,
        adjustments: payload.adjustments?.length ?? 0,
        payments: payload.payments?.length ?? 0,
        activities: payload.activities?.length ?? 0,
      },
    });
  });
  /* silent: the restore already logged one summary event, and it promised
     to be the only one — a second "settings changed" beside it describes a
     write nobody made */
  if (payload.settings) saveSettings(payload.settings, true);
  });
}

export function wipeAll(): void {
  transaction((db) => {
    const counts: Record<string, number> = {};
    for (const t of ["tickets", "segments", "adjustments", "payments", "mileageplus_activities"])
      counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    db.exec(
      "DELETE FROM mileageplus_activities; DELETE FROM payments; DELETE FROM adjustments; DELETE FROM segments; DELETE FROM tickets;"
    );
    /* One event, not one per row. The wipe also truncates the history:
       after a total erasure there is no data left for prior entries to
       explain, and on a shared machine "erase all data" leaving row-level
       contents behind is residue, not an audit trail (found the day the
       hosted browser build met its first real import-and-erase). The record
       OF the wipe — with its counts — is the one entry that remains. */
    db.exec("DELETE FROM changes");
    logChange("wipe", "", "", { counts });
  });
}
