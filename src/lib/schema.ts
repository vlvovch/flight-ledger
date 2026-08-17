/*
 * The ledger's DDL and its opening ritual, split from db.ts so the browser
 * build can run them too: everything here speaks SqlDriver and nothing else.
 * The node app opens a file and hands its driver in; the browser build
 * (design: mode 1) opens an OPFS-backed WASM database and hands in the same
 * interface. One schema, one migration list, every engine.
 */
import { RETIRED_SEGMENT_STATUSES } from "./types";
import type { SqlDriver } from "./sql-driver";

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT,
  confirmation_code TEXT,
  issuing_carrier TEXT DEFAULT 'UA',
  issue_date TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate REAL NOT NULL DEFAULT 1,
  base_fare REAL NOT NULL DEFAULT 0,
  surcharges REAL NOT NULL DEFAULT 0,
  taxes REAL NOT NULL DEFAULT 0,
  ancillary_fees REAL NOT NULL DEFAULT 0,
  gross_total REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  predecessor_ticket_id TEXT,
  residual_credit REAL,
  additional_collection REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  marketing_carrier TEXT NOT NULL DEFAULT 'UA',
  operating_carrier TEXT,
  flight_number TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  flight_date TEXT NOT NULL,
  departure_time TEXT,
  arrival_time TEXT,
  cabin TEXT,
  booking_class TEXT,
  seat TEXT,
  aircraft TEXT,
  tail_number TEXT,
  status TEXT NOT NULL DEFAULT 'ticketed',
  purpose TEXT,
  distance_miles REAL,
  lifetime_miles INTEGER,
  award_miles INTEGER,
  pqp REAL,
  pqf REAL,
  projected_pqp REAL,
  projected_pqf REAL,
  projected_award_miles INTEGER,
  manual_cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_date ON segments(flight_date);
CREATE INDEX IF NOT EXISTS idx_segments_ticket ON segments(ticket_id);

-- How a ticket was funded (design doc §8.6). Separate from cost: a ticket's
-- gross is what the transportation was worth; payments say where the money
-- came from — card, TravelBank, a certificate, or a previous ticket's residual.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL,
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  award_miles_used INTEGER,
  payment_date TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_ticket ON payments(ticket_id);

CREATE TABLE IF NOT EXISTS adjustments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  effective_date TEXT,
  payer TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adjustments_ticket ON adjustments(ticket_id);

-- MileagePlus account activity (design doc §8.8): every row of the united.com
-- activity export, flight and non-flight alike. Flight rows may link to a
-- segment; non-flight rows (card PQP, shopping, hotels) are earning in their
-- own right and count toward status.
CREATE TABLE IF NOT EXISTS mileageplus_activities (
  id TEXT PRIMARY KEY,
  activity_date TEXT NOT NULL,
  posting_date TEXT,
  description TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  carrier TEXT,
  flight_number TEXT,
  origin TEXT,
  destination TEXT,
  award_miles REAL,
  pqp REAL,
  pqf REAL,
  segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
  match_score REAL,
  match_status TEXT NOT NULL DEFAULT 'not_applicable',
  match_reason TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  dedup_key TEXT UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_date ON mileageplus_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_activities_segment ON mileageplus_activities(segment_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON mileageplus_activities(activity_type);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Append-only change log (design doc §16), written by repo.ts beside every
-- data write. Deliberately outside the JSON backup and untouched by a wipe:
-- it is the history of this FILE, and the incident that motivated it — flags
-- silently dropped by a restore — is exactly the case where the history must
-- outlive the data it describes. Ordering is by rowid (insertion order);
-- \`at\` is for people.
CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  op TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  diff TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_row ON changes(tbl, row_id);
`;

/** Columns added after the initial schema — applied idempotently to
 *  existing databases (CREATE TABLE IF NOT EXISTS won't touch them). */
export const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ["segments", "projected_pqp", "REAL"],
  ["segments", "projected_pqf", "REAL"],
  ["segments", "projected_award_miles", "INTEGER"],
  // exchange/reissue chain: this ticket was issued against another's value
  ["tickets", "predecessor_ticket_id", "TEXT"],
  ["tickets", "residual_credit", "REAL"],
  ["tickets", "additional_collection", "REAL"],
  /* Whether this flight was ever going to appear on a MileagePlus statement.
     NULL = work it out from the ticket and carrier; 1/0 = the user overriding
     that. Without it, a Delta flight or a partner award nags forever under
     "United never credited this". */
  ["segments", "credits_mileageplus", "INTEGER"],
  /* An extra purchase (paid upgrade, seat) pinned to the flight it was bought
     for — the receipt names the leg, and allocation puts the money there
     rather than spreading it across the ticket (§7.2). */
  ["adjustments", "segment_id", "TEXT"],
  ["segments", "tail_number", "TEXT"],
];

function migrate(db: SqlDriver): void {
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
}

/**
 * Drop the retired trips feature from a database that predates its removal.
 *
 * Trips grouped flights under a name and lent them a default purpose. The
 * grouping that turned out to matter is the ticket — it is the thing money is
 * attached to — so trips were removed rather than kept as a second, weaker
 * answer to the same question.
 *
 * `ALTER TABLE ... DROP COLUMN` refuses on a column that carries a foreign key
 * or an index, and trip_id has both, so each table is rebuilt without it. The
 * new table is built from the live CREATE statement rather than from SCHEMA
 * above, so columns added by migrate() survive the copy — building it from
 * SCHEMA would silently discard credits_mileageplus and the projected_* set.
 */
function dropTripsFeature(db: SqlDriver): void {
  const hasTripId = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[]).some(
      (c) => c.name === "trip_id"
    );
  const tables = ["tickets", "segments"].filter(hasTripId);
  const tripsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trips'")
    .get();
  if (tables.length === 0 && !tripsTable) return;

  /* Indexes are dropped along with their table; keep the DDL to rebuild the
     survivors. The one on trip_id is not among them. */
  const indexes = (
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name IN ('tickets','segments')"
      )
      .all() as unknown as { sql: string }[]
  )
    .map((r) => r.sql)
    .filter((sql) => !/\btrip_id\b/.test(sql));

  /* Neither pragma may change inside a transaction. foreign_keys=OFF lets the
     old table be dropped without cascading into payments/adjustments;
     legacy_alter_table stops RENAME from rewriting those tables' references to
     point at the temporary name. */
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("PRAGMA legacy_alter_table = ON");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const t of tables) {
      const { sql } = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
        .get(t) as unknown as { sql: string };
      const rebuilt = sql
        .replace(/CREATE TABLE\s+"?\w+"?/i, `CREATE TABLE ${t}__new`)
        .replace(/^\s*trip_id\b.*,\s*$\n/im, "");
      if (/\btrip_id\b/.test(rebuilt))
        throw new Error(`could not remove trip_id from the ${t} schema`);
      const cols = (
        db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[]
      )
        .map((c) => c.name)
        .filter((c) => c !== "trip_id")
        .join(", ");
      db.exec(rebuilt);
      db.exec(`INSERT INTO ${t}__new (${cols}) SELECT ${cols} FROM ${t}`);
      db.exec(`DROP TABLE ${t}`);
      db.exec(`ALTER TABLE ${t}__new RENAME TO ${t}`);
    }
    db.exec("DROP TABLE IF EXISTS trips");
    for (const sql of indexes) db.exec(sql.replace(/CREATE (UNIQUE )?INDEX/i, "CREATE $1INDEX IF NOT EXISTS"));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA legacy_alter_table = OFF");
    db.exec("PRAGMA foreign_keys = ON");
  }
  /* A rebuild can leave a stale reference behind; fail loudly rather than
     serve a database whose foreign keys no longer resolve. */
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0)
    throw new Error(`trips removal left ${violations.length} broken foreign key(s)`);
}

/**
 * Move segments off the two retired statuses. Both were behaviourally
 * identical to the status they map to — see RETIRED_SEGMENT_STATUSES — so this
 * renames rows rather than reinterpreting them, and nothing about cost, miles
 * or reconciliation moves. Idempotent: after the first run it matches nothing.
 */
function retireSegmentStatuses(db: SqlDriver): void {
  for (const [from, to] of Object.entries(RETIRED_SEGMENT_STATUSES)) {
    db.prepare("UPDATE segments SET status = ? WHERE status = ?").run(to, from);
  }
}

/** Bring a freshly opened database to the current shape — idempotent, run on
 *  every open, exactly what db.ts has always done. */
export function prepareLedger(db: SqlDriver): void {
  db.exec(SCHEMA);
  migrate(db);
  dropTripsFeature(db);
  retireSegmentStatuses(db);
}
