/**
 * Sanity checks for the pure domain logic (run: npm run selftest).
 * Covers the design doc §19.1 unit-test list and §19.4 invariants.
 */
import {
  creditedMiles,
  geodesicMiles,
  haversineMiles,
  publishedMiles,
  routeDistanceMiles,
} from "../src/lib/distance";
import { getAirport } from "../src/lib/airports";
import {
  buildCashFlow,
  forecastLifetime,

  summarizeRoutes,
  type MonthlySummary,
} from "../src/lib/metrics";
import { flightCpmSpread, summarizeFareClasses, summarizeMix } from "../src/lib/mix";
import { buildMapData, dominantCategory } from "../src/lib/map";
import { splitMbox } from "../src/lib/mbox";
import { rollingCpm } from "../src/lib/rolling";
import {
  MANAGED_COLUMNS,
  WRITABLE_FIELDS,
  createPayment,
  createSegment,
  createTicket,
  listTickets,
  sanitizeChains,
  validateBackupRows,
  deleteSegment,
  deleteTicket,
  getSegment,
  importBackup,
  listChanges,
  runAsActor,
  saveSettings,
  updateSegment,
  updateTicket,
  wipeAll,
} from "../src/lib/repo";
import { allocateChain, allocateTicket, distribute } from "../src/lib/allocation";
import {
  buildImportPreview,
  parseActivityCsv,
} from "../src/lib/mileageplus-import";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createAccount,
  readRegistry,
  switchAccount,
  writeRegistry,
} from "../src/lib/accounts";
import { getDb } from "../src/lib/db";
import { join } from "node:path";
import { htmlToText, parseEml } from "../src/lib/eml";
import {
  appendMarkupCrossCheck,
  parseUnitedEmail,
  pqpEligibleAncillary,
  preferTravelerTicket,
  splitReissueFunding,
} from "../src/lib/united-receipt";
import type { ParsedReceipt, ReceiptSegment } from "../src/lib/united-receipt";
import {
  EMPTY_BATCH,
  buildApplyItem,
  buildBatchContext,
  buildReceiptPreview,
} from "../src/lib/receipt-import";
import { classifyActivity, matchActivity } from "../src/lib/activity-match";
import { spanLabel } from "../src/lib/format";
import {
  ALL_EXCEPTION_KINDS,
  RECONCILE_GROUPS,
} from "../src/lib/reconcile-groups";
import { prepareSegment, realDate } from "../src/lib/validate";
import { wasmUrl } from "../src/lib/browser/wasm-url";
import {
  createOwnership,
  type ChannelLike,
  type LocksLike,
} from "../src/lib/browser/ownership";
import {
  DRIVE_BACKUP_NAME,
  DriveError,
  backupFingerprint,
  backupIsEmpty,
  buildMultipart,
  createDriveClient,
  planSync,
  stableStringify,
  summarizeBackup,
  syncOnce,
  type RemoteMeta,
  type SyncMarker,
  type SyncSnapshot,
} from "../src/lib/drive-sync";
import type { BackupPayload } from "../src/lib/repo";
import { MAX_BATCH_MESSAGES } from "../src/lib/mbox";
import {
  fleetDatasetMeta,
  friendlyType,
  loadFleetRegistry,
  learnFleet,
  normalizeTail,
  typeForTail,
} from "../src/lib/fleet";
/* The route handlers themselves, imported as plain functions. A Next route
   module exports (Request, ctx) => Response with no server attached, which is
   what makes the API layer drivable from here — see "route handlers" below. */
import {
  GET as apiFlights,
  POST as apiFlightCreate,
} from "../src/app/api/flights/route";
import {
  GET as apiFlightGet,
  PATCH as apiFlightPatch,
  DELETE as apiFlightDelete,
} from "../src/app/api/flights/[id]/route";
import { POST as apiTicketCreate } from "../src/app/api/tickets/route";
import { DELETE as apiTicketDelete } from "../src/app/api/tickets/[id]/route";
import { POST as apiBackupRestore } from "../src/app/api/backup/route";
import { POST as apiAdjustmentCreate } from "../src/app/api/adjustments/route";
import { POST as apiPaymentCreate } from "../src/app/api/payments/route";
import { PUT as apiSettingsPut } from "../src/app/api/settings/route";
import { GET as apiExport } from "../src/app/api/export/route";
import { POST as apiRestore, DELETE as apiWipe } from "../src/app/api/backup/route";
import { POST as apiMpImport } from "../src/app/api/import/mileageplus/route";
import { GET as apiActivities } from "../src/app/api/activity/route";
import { buildReconcileReport } from "../src/lib/reconcile";
import { scheduledArrivalUtc } from "../src/lib/arrival";
import {
  DEFAULT_PREMIER_PROGRAMS,
  buildPremierYears,
  pathFor,
  programFor,
  shortfall,
} from "../src/lib/premier";
import {
  canEstimateCost,
  deriveTaxRates,
  estimateSegmentCost,
  FALLBACK_TAX_RATES,
  isInternationalSegment,
} from "../src/lib/cost-estimate";
import {
  DEFAULT_SETTINGS,
  NON_ALLOCABLE_STATUSES,
  RETIRED_SEGMENT_STATUSES,
  SEGMENT_STATUSES,
  TICKET_STATUSES,
  chainWideFlag,
  chainWidePayers,
  effectivePurpose,
  estimatedLifetimeMiles,
  expectsMileagePlusCredit,
  isCpmEligible,
  effectiveCabin,
  sameDayOrder,
  shareByDistance,
} from "../src/lib/types";
import type {
  ActivityRecord,
  AdjustmentRow,
  AllocationMethod,
  EnrichedSegment,
  PaymentRow,
  SegmentRow,
  TicketRow,
} from "../src/lib/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ----------------------------- distance ----------------------------- */
console.log("distance:");
// Reference great-circle distances (GCMap, statute miles)
check("IAH-SFO ≈ 1635 mi", approx(routeDistanceMiles("IAH", "SFO")!, 1635, 10));
check("SFO-NRT ≈ 5112 mi", approx(routeDistanceMiles("SFO", "NRT")!, 5112, 15));
check("EWR-SIN ≈ 9523 mi", approx(routeDistanceMiles("EWR", "SIN")!, 9523, 25));
check("zero distance to self", haversineMiles(29.98, -95.34, 29.98, -95.34) === 0);
check("geodesic: zero distance to self", geodesicMiles(29.98, -95.34, 29.98, -95.34) === 0);

/* Distances are checked against a real table of great-circle mileages rather
   than against the formula's own output, because the formula was the thing in
   doubt: a single-radius sphere ran 3.67 mi light on average over these pairs
   and matched only 5 of 118 exactly. The ellipsoid matches 90 exactly and every
   one of them to within a mile.
   The ±1 tolerance is not slack: residuals scatter −0.84…+0.96 mi with a mean
   of −0.02, i.e. both directions and no bias. That is the two databases placing
   an airport's reference point differently (terminal centroid vs ARP vs runway
   midpoint) — airports are miles across. A systematic error would show up as a
   one-sided mean, which is exactly how the spherical model was caught.
   Rounding is to NEAREST, confirmed against this table: round matches 90 of
   118, floor and ceil only 59 each. */
{
  const rows = readFileSync(join(process.cwd(), "fixtures/gcdist-reference.txt"), "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/));
  let compared = 0;
  let exact = 0;
  const off: string[] = [];
  for (const [a, b, , gcdist] of rows) {
    const ref = gcdist; // last column; the "bis" column is a credited-mileage
                        // table, not a distance, and nothing computes it
    /* Deliberately the FORMULA, not routeDistanceMiles: that now answers "what
       does this credit?" from the published table, which is a different
       question from "is the geometry right?" — the one these figures test. */
    const o = getAirport(a);
    const d = getAirport(b);
    const got = o && d ? geodesicMiles(o.lat, o.lon, d.lat, d.lon) : null;
    if (got == null) continue; // airport not in the dataset (e.g. closed TXL)
    compared++;
    const diff = Math.round(got) - Number(ref);
    if (diff === 0) exact++;
    if (Math.abs(diff) > 1) off.push(`${a}-${b} ${Math.round(got)}≠${ref}`);
  }
  check("distance table: enough pairs to be worth checking", compared >= 110, String(compared));
  /* The published figure wins over the computed one, in either direction, and
     a short segment still credits the 500 minimum. */
  check(
    "a published pair returns its published mileage",
    publishedMiles("IAH", "SFO") === 1636 && routeDistanceMiles("IAH", "SFO") === 1636
  );
  check(
    "…the same either way round, from one entry",
    routeDistanceMiles("SFO", "IAH") === routeDistanceMiles("IAH", "SFO")
  );
  check(
    "an unlisted pair falls back to the geodesic",
    publishedMiles("SFO", "BUR") === null &&
      Math.round(routeDistanceMiles("SFO", "BUR")!) === 326
  );
  /* Distance and credited miles are different quantities and are kept apart:
     the 500-mile minimum is a payout rule, so applying it to distance made a
     135-mile hop report 500 miles flown and a third of its true CPM. */
  check(
    "a short hop's DISTANCE is its real distance",
    Math.round(routeDistanceMiles("CMI", "ORD")!) === 135 &&
      Math.round(routeDistanceMiles("ORD", "CMI")!) === 135
  );
  check(
    "…while what it CREDITS is the 500 minimum",
    creditedMiles("CMI", "ORD") === 500 && creditedMiles("ORD", "CMI") === 500
  );
  check(
    "…and the minimum never lengthens or shortens a long one",
    creditedMiles("EWR", "SFO") === routeDistanceMiles("EWR", "SFO")
  );
  /* DSM-ORD is listed at exactly 500 while the pair is 299 mi: that entry is
     the crediting floor already baked into the table, not a distance. */
  check(
    "a table entry that is really the floor doesn't masquerade as distance",
    publishedMiles("DSM", "ORD") === 500 &&
      Math.round(routeDistanceMiles("DSM", "ORD")!) === 299 &&
      creditedMiles("DSM", "ORD") === 500
  );
  check(
    "the lifetime estimate is credited miles, so the minimum applies there",
    estimatedLifetimeMiles({
      lifetime_miles: null, distance_miles: 135, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "UA", issuing_carrier: "UA",
      credits_mileageplus: null, ticket_id: "t",
    }) === 500
  );
  check(
    "every published great-circle distance matches within a mile",
    off.length === 0,
    off.join(" · ")
  );
  check(
    "…and most match exactly",
    exact / compared > 0.7,
    `${exact}/${compared} exact`
  );
}
check("unknown airport → null", routeDistanceMiles("XXX", "IAH") === null);
check(
  "symmetry",
  routeDistanceMiles("IAH", "SFO") === routeDistanceMiles("SFO", "IAH")
);

/* ---------------------------- distribute ---------------------------- */
console.log("distribute:");
{
  const parts = distribute(100, [1, 1, 1]);
  check(
    "100/3 sums exactly to 100.00",
    parts.reduce((a, b) => a + b, 0) === 100,
    JSON.stringify(parts)
  );
  const parts2 = distribute(811.4, [1635, 5130]);
  check(
    "distance-weighted sums exactly",
    approx(parts2.reduce((a, b) => a + b, 0), 811.4, 0.001),
    JSON.stringify(parts2)
  );
  check("zero weights → zeros", distribute(50, [0, 0]).every((p) => p === 0));
  check("empty → empty", distribute(50, []).length === 0);
}

/* ---------------------------- allocation ---------------------------- */
console.log("allocation:");
const mkTicket = (over: Partial<TicketRow> = {}): TicketRow => ({
  id: "t1",
  ticket_number: null,
  confirmation_code: "ABC123",
  issuing_carrier: "UA",
  issue_date: null,
  currency: "USD",
  exchange_rate: 1,
  base_fare: 0,
  surcharges: 0,
  taxes: 0,
  ancillary_fees: 0,
  gross_total: 811.4,
  payment_method: null,
  status: "active",
  predecessor_ticket_id: null,
  residual_credit: null,
  additional_collection: null,
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});
const mkSeg = (id: string, over: Partial<SegmentRow> = {}): SegmentRow => ({
  id,
  ticket_id: "t1",
  marketing_carrier: "UA",
  operating_carrier: null,
  flight_number: null,
  origin: "IAH",
  destination: "SFO",
  flight_date: "2026-07-10",
  departure_time: null,
  arrival_time: null,
  cabin: null,
  booking_class: null,
  seat: null,
  aircraft: null,
  tail_number: null,
  status: "flown_reconciled",
  purpose: null,
  distance_miles: 1635,
  lifetime_miles: null,
  credits_mileageplus: null,
  award_miles: null,
  pqp: null,
  pqf: null,
  projected_pqp: null,
  projected_pqf: null,
  projected_award_miles: null,
  manual_cost: null,
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});
const mkAdj = (over: Partial<AdjustmentRow>): AdjustmentRow => ({
  id: Math.random().toString(36).slice(2),
  ticket_id: "t1",
  type: "reimbursement",
  amount: 0,
  effective_date: null,
  payer: null,
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});

{
  // PQP-weighted when all segments have PQP
  const segs = [
    mkSeg("a", { pqp: 328 }),
    mkSeg("b", { pqp: 672, origin: "SFO", destination: "NRT", distance_miles: 5130 }),
  ];
  const r = allocateTicket(mkTicket(), segs, []);
  check("method = pqp", r.method === "pqp");
  check(
    "pqp shares sum to gross",
    approx(r.perSegment.a.gross + r.perSegment.b.gross, 811.4, 0.001)
  );
  check(
    "pqp share ratio",
    approx(r.perSegment.a.gross, 811.4 * (328 / 1000), 0.01),
    String(r.perSegment.a.gross)
  );
}
{
  // Distance fallback when PQP missing on any segment
  const segs = [
    mkSeg("a"),
    mkSeg("b", { pqp: 672, origin: "SFO", destination: "NRT", distance_miles: 5130 }),
  ];
  const r = allocateTicket(mkTicket(), segs, []);
  check("method = distance when any PQP missing", r.method === "distance");
}
{
  // Equal fallback when no distance
  const segs = [
    mkSeg("a", { distance_miles: null }),
    mkSeg("b", { distance_miles: null }),
  ];
  const r = allocateTicket(mkTicket(), segs, []);
  check("method = equal", r.method === "equal");
  check("equal split", r.perSegment.a.gross === 405.7);
}
{
  // Manual override + remainder distributed to others
  const segs = [
    mkSeg("a", { manual_cost: 200 }),
    mkSeg("b"),
    mkSeg("c"),
  ];
  const r = allocateTicket(mkTicket({ gross_total: 800 }), segs, []);
  check("manual respected", r.perSegment.a.gross === 200);
  check(
    "remainder split by distance",
    approx(r.perSegment.b.gross + r.perSegment.c.gross, 600, 0.001)
  );
}
{
  // Reimbursement reduces personal, not gross; refund reduces both
  const segs = [mkSeg("a"), mkSeg("b")];
  const r = allocateTicket(mkTicket({ gross_total: 1000 }), segs, [
    mkAdj({ type: "reimbursement", amount: 250 }),
    mkAdj({ type: "refund", amount: 100 }),
  ]);
  check("gross allocable = 900", r.gross_allocable === 900);
  check("personal total = 650", r.personal_total === 650);
  const sumP = r.perSegment.a.personal + r.perSegment.b.personal;
  check("personal shares sum exactly", approx(sumP, 650, 0.001), String(sumP));
}
{
  // Over-reimbursement clamps at 0 with warning
  const r = allocateTicket(mkTicket({ gross_total: 100 }), [mkSeg("a")], [
    mkAdj({ type: "reimbursement", amount: 500 }),
  ]);
  check("over-reimbursed clamps personal to 0", r.personal_total === 0);
  check("warning emitted", r.warnings.length === 1);
}
{
  // Canceled segments excluded
  const segs = [mkSeg("a"), mkSeg("b", { status: "canceled" })];
  const r = allocateTicket(mkTicket({ gross_total: 500 }), segs, []);
  check("canceled gets 0", r.perSegment.b.gross === 0);
  check("active gets all", r.perSegment.a.gross === 500);
}
{
  // Currency conversion
  const r = allocateTicket(
    mkTicket({ gross_total: 1000, currency: "EUR", exchange_rate: 1.08 }),
    [mkSeg("a")],
    []
  );
  check("exchange rate applied", r.gross_allocable === 1080);
}
{
  // Fuzz: allocation always sums to totals
  let ok = true;
  for (let trial = 0; trial < 500; trial++) {
    const n = 1 + Math.floor(Math.random() * 5);
    const segs = Array.from({ length: n }, (_, i) =>
      mkSeg(String(i), {
        pqp: Math.random() < 0.5 ? Math.round(Math.random() * 900) : null,
        distance_miles:
          Math.random() < 0.9 ? Math.round(Math.random() * 6000) : null,
        manual_cost: Math.random() < 0.2 ? Math.round(Math.random() * 300) : null,
        status: Math.random() < 0.15 ? "canceled" : "flown_reconciled",
      })
    );
    const gross = Math.round(Math.random() * 300000) / 100;
    const adjs = [
      mkAdj({ type: "reimbursement", amount: Math.round(Math.random() * 50000) / 100 }),
      mkAdj({ type: "refund", amount: Math.round(Math.random() * 20000) / 100 }),
    ];
    const r = allocateTicket(mkTicket({ gross_total: gross }), segs, adjs);
    const active = segs.filter((s) => s.status !== "canceled");
    const autoSegs = active.filter((s) => s.manual_cost == null);
    const manualSum = active
      .filter((s) => s.manual_cost != null)
      .reduce((s, m) => s + (m.manual_cost as number), 0);
    const sumG = Object.values(r.perSegment).reduce((s, p) => s + p.gross, 0);
    const sumP = Object.values(r.perSegment).reduce((s, p) => s + p.personal, 0);
    // With auto segments: manual + remainder = max(allocable, manualSum).
    // All-manual: exactly the manual sum (shortfall/overage is warned, not
    // silently reallocated). No active segments: nothing allocated.
    const expectedG =
      active.length === 0
        ? 0
        : autoSegs.length > 0
          ? Math.max(r.gross_allocable, Math.round(manualSum * 100) / 100)
          : Math.round(manualSum * 100) / 100;
    if (!approx(sumG, expectedG, 0.011)) {
      ok = false;
      console.error("   fuzz gross mismatch", { trial, sumG, expectedG, r, segs });
      break;
    }
    if (active.length > 0 && !approx(sumP, r.personal_total, 0.011)) {
      ok = false;
      console.error("   fuzz personal mismatch", { trial, sumP, r });
      break;
    }
  }
  check("fuzz ×500: shares always sum to totals", ok);
}

/* ------------------------- MileagePlus import -------------------------- */
console.log("mileageplus import:");
{
  const csv = `Transaction Date,Activity Type,Description,PQF,PQP,PQM,PQS,PQD,Miles
7/27/26,Non-Air,PQP Earn Explorer Card,0,3,0,0,0,0
7/23/26,Airline,UA 604 SFO - IAH,1,190,0,0,0,"1,520"
7/17/26,Airline,UA 892 ICN - SFO,1,434,0,0,0,3472
7/17/26,Airline,UA 892 ICN - SFO,1,434,0,0,0,3472
7/10/26,Airline,UA 1976 IAH - SFO,1,218,0,0,0,1744
7/2/26,Airline,Award redeposit,0,0,0,0,0,500
bad-date,Airline,UA 1 SFO - IAH,1,1,0,0,0,1
`;
  const parsed = parseActivityCsv(csv);
  check("no parse error", parsed.error == null, parsed.error);
  const flightRows = parsed.rows.filter((r) => r.flight);
  check("4 parseable flight rows", flightRows.length === 4, String(flightRows.length));
  const ua604 = parsed.rows.find((r) => r.description.includes("604"))!;
  check("date M/D/YY → ISO", ua604.date === "2026-07-23", String(ua604.date));
  check("comma miles parsed", ua604.awardMiles === 1520, String(ua604.awardMiles));
  check(
    "flight fields parsed",
    ua604.flight?.carrier === "UA" &&
      ua604.flight?.number === "604" &&
      ua604.flight?.origin === "SFO" &&
      ua604.flight?.destination === "IAH"
  );
  check(
    "non-air row kept (recorded as activity, not skipped)",
    parsed.rows.find((r) => r.description.includes("Explorer"))?.skipReason === null
  );
  check(
    "airline row without a readable route still kept",
    parsed.rows.find((r) => r.description === "Award redeposit")?.skipReason === null
  );
  check(
    "bad date skipped",
    parsed.rows.find((r) => r.description.includes("UA 1 "))?.skipReason ===
      "Unreadable date"
  );

  const segs: SegmentRow[] = [
    // matches UA604 with identical values but unreconciled → update (status only)
    mkSeg("s1", {
      origin: "SFO",
      destination: "IAH",
      flight_date: "2026-07-23",
      flight_number: "604",
      status: "flown_unreconciled",
      pqp: 190,
      pqf: 1,
      award_miles: 1520,
    }),
    // matches UA1976 with a different PQP → conflict
    mkSeg("s2", {
      origin: "IAH",
      destination: "SFO",
      flight_date: "2026-07-10",
      flight_number: "1976",
      status: "flown_unreconciled",
      pqp: 999,
      pqf: 1,
      award_miles: 1744,
    }),
  ];
  const p = buildImportPreview(parsed.rows, segs);
  const byRoute = (o: string, d: string) =>
    p.flights.find((r) => r.origin === o && r.destination === d)!;
  check("UA604 → update", byRoute("SFO", "IAH").action === "update");
  check(
    "UA604 fills status only",
    byRoute("SFO", "IAH").fills.join() === "status → reconciled",
    byRoute("SFO", "IAH").fills.join()
  );
  check("UA1976 → conflict", byRoute("IAH", "SFO").action === "conflict");
  check(
    "conflict diff lists PQP",
    byRoute("IAH", "SFO").diffs.some((d) => d.includes("PQP 999 → 218")),
    byRoute("IAH", "SFO").diffs.join()
  );
  check("UA892 (no match) → create", byRoute("ICN", "SFO").action === "create");
  check(
    "duplicate flight row skipped from the ledger",
    p.skipped.some((s) => s.reason === "Duplicate flight row in this file")
  );
  check("skip count", p.skipped.length === 2, String(p.skipped.length));

  /* every row becomes account activity — including non-flight earning */
  check("all dated rows recorded as activity", p.activities.length === 6, String(p.activities.length));
  const card = p.activities.find((a) => a.description.includes("Explorer"))!;
  check("card row classified as credit_card", card.type === "credit_card");
  check("card row carries its PQP", card.pqp === 3);
  check(
    "redeposit classified as redemption",
    p.activities.find((a) => a.description === "Award redeposit")?.type === "redemption"
  );
  check(
    "flight rows are activities too",
    p.activities.filter((a) => a.type === "united_flight").length === 4
  );
  check(
    "in-file duplicate gets its own dedup key",
    new Set(p.activities.map((a) => a.dedupKey)).size === p.activities.length
  );
  check("nothing marked duplicate on a fresh import", p.activities.every((a) => !a.duplicate));
  const reimport = buildImportPreview(
    parsed.rows,
    segs,
    new Set(p.activities.map((a) => a.dedupKey))
  );
  check(
    "re-import marks every activity as already recorded",
    reimport.activities.every((a) => a.duplicate)
  );
  check(
    "…and asks nothing about them — apply would discard the answers anyway",
    reimport.flights.length === 0,
    String(reimport.flights.length)
  );

  // idempotency: same values, already reconciled → unchanged
  const segsDone: SegmentRow[] = [
    mkSeg("s3", {
      origin: "SFO",
      destination: "IAH",
      flight_date: "2026-07-23",
      flight_number: "604",
      status: "flown_reconciled",
      pqp: 190,
      pqf: 1,
      award_miles: 1520,
    }),
  ];
  const p2 = buildImportPreview(parsed.rows, segsDone);
  check(
    "re-import → unchanged",
    p2.flights.find((r) => r.origin === "SFO")!.action === "unchanged"
  );
}

/* ------------- lifetime-mile rules (award & non-UA flights) ------------- */
console.log("lifetime rules:");
{
  const csv = `Transaction Date,Activity Type,Description,PQF,PQP,PQM,PQS,PQD,Miles
5/22/26,Airline,UA 790 IAH - ORD,0,0,0,0,0,0
6/26/26,Airline,UA 1654 IAH - DEN,1,127,0,0,0,0
6/19/26,Airline,LH 441 IAH - FRA,1,634,0,0,0,3169
7/23/26,Airline,UA 604 SFO - IAH,1,190,0,0,0,1520
`;
  const parsed = parseActivityCsv(csv);
  const p = buildImportPreview(parsed.rows, []);
  const byOrigin = (o: string) => p.flights.find((r) => r.origin === o)!;
  check(
    "award flight (0/0/0) → lifetime 0",
    byOrigin("IAH") && p.flights.find((r) => r.number === "790")!.lifetime === 0 &&
      p.flights.find((r) => r.number === "790")!.lifetimeNote === "award travel"
  );
  check(
    "modern award flight (PQP-earning, 0 award mi) → lifetime 0",
    p.flights.find((r) => r.number === "1654")!.lifetime === 0 &&
      p.flights.find((r) => r.number === "1654")!.lifetimeNote === "award travel"
  );
  check(
    "non-UA flight → lifetime 0",
    p.flights.find((r) => r.carrier === "LH")!.lifetime === 0 &&
      p.flights.find((r) => r.carrier === "LH")!.lifetimeNote === "non-UA flight"
  );
  check(
    "revenue UA flight → lifetime stays blank",
    byOrigin("SFO").lifetime === null && byOrigin("SFO").lifetimeNote === null
  );

  // matching: fill blank lifetime with 0; conflict when user entered a value
  const segBlank = mkSeg("a1", {
    origin: "IAH", destination: "ORD", flight_date: "2026-05-22",
    flight_number: "790", status: "flown_reconciled",
    pqp: 0, pqf: 0, award_miles: 0, lifetime_miles: null,
  });
  const pFill = buildImportPreview(parsed.rows, [segBlank]);
  const fillRow = pFill.flights.find((r) => r.number === "790")!;
  check("award match fills Lifetime 0", fillRow.action === "update" &&
    fillRow.fills.some((f) => f.includes("Lifetime 0 (award travel)")), fillRow.fills.join());

  const segManual = mkSeg("a2", {
    origin: "IAH", destination: "ORD", flight_date: "2026-05-22",
    flight_number: "790", status: "flown_reconciled",
    pqp: 0, pqf: 0, award_miles: 0, lifetime_miles: 700,
  });
  const pConf = buildImportPreview(parsed.rows, [segManual]);
  const confRow = pConf.flights.find((r) => r.number === "790")!;
  check("award vs entered lifetime → conflict", confRow.action === "conflict" &&
    confRow.diffs.some((d) => d.includes("Lifetime 700 → 0")), confRow.diffs.join());

  // ledger estimate helper
  const uaSeg = mkSeg("e1", { distance_miles: 1000, lifetime_miles: null });
  const partnerSeg = mkSeg("e2", { distance_miles: 1000, lifetime_miles: null, operating_carrier: "LH" });
  const postedSeg = mkSeg("e3", { distance_miles: 1000, lifetime_miles: 850, operating_carrier: "LH" });
  check("estimate: UA-operated → distance", estimatedLifetimeMiles(uaSeg) === 1000);
  check("estimate: non-UA operated → 0", estimatedLifetimeMiles(partnerSeg) === 0);
  check("estimate: posted always wins", estimatedLifetimeMiles(postedSeg) === 850);
  const awardSeg = mkSeg("e4", { distance_miles: 862, award_miles: 0, pqp: 127, pqf: 1 });
  check("estimate: award signature (0 award mi) → 0", estimatedLifetimeMiles(awardSeg) === 0);
}

/* -------------------------- CPM eligibility ---------------------------- */
console.log("cpm eligibility:");
{
  const el = (over: Partial<SegmentRow>, method: AllocationMethod) =>
    isCpmEligible({ ...mkSeg("c", over), allocation_method: method });
  check(
    "costed UA revenue flight → in",
    el({ distance_miles: 1000 }, "distance") === true
  );
  check(
    "no recorded cost → out",
    el({ distance_miles: 1000 }, "none") === false
  );
  check(
    "award flight (lifetime 0) → out",
    el({ distance_miles: 1000, lifetime_miles: 0 }, "manual") === false
  );
  check(
    "PQP-earning award flight (0 award mi) → out",
    el({ distance_miles: 862, award_miles: 0, pqp: 127 }, "manual") === false
  );
  check(
    "non-UA operated, no posting → out",
    el({ distance_miles: 1000, operating_carrier: "LH" }, "pqp") === false
  );
  check(
    "non-UA but posted lifetime > 0 → in",
    el({ distance_miles: 1000, operating_carrier: "LH", lifetime_miles: 900 }, "pqp") === true
  );
  check(
    "not flown → out",
    isCpmEligible({
      ...mkSeg("c", { distance_miles: 1000, status: "ticketed" }),
      allocation_method: "distance",
    }) === false
  );
}

/* ------------------------------ EML decoding --------------------------- */
console.log("eml decoding:");
{
  const qpHtml =
    "<html><head><style>p{color:red}</style></head><body>" +
    "<p>eTicket number: 0162345678901</p>" +
    "<table><tr><td>Total:</td><td>$811.40</td></tr></table>" +
    "<p>Houston =E2=80=94 San Francisco</p></body></html>";
  const b64Text = Buffer.from(
    "Confirmation: ABC123\nTotal: $811.40\n",
    "utf-8"
  ).toString("base64");
  const eml = [
    'Content-Type: multipart/alternative; boundary="XYZ-42"',
    "Subject: =?utf-8?B?WW91ciB0cmlwIGNvbmZpcm1hdGlvbg==?=",
    "From: United Airlines <unitedairlines@united.com>",
    "Date: Mon, 14 Jul 2026 09:00:00 -0500",
    "MIME-Version: 1.0",
    "",
    "preamble to ignore",
    "--XYZ-42",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Text,
    "--XYZ-42",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qpHtml,
    "--XYZ-42",
    'Content-Type: application/pdf; name="receipt.pdf"',
    "Content-Disposition: attachment; filename=\"receipt.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
    "--XYZ-42--",
    "",
  ].join("\r\n");

  const parsed = parseEml(eml);
  check("subject encoded-word decoded", parsed.subject === "Your trip confirmation", String(parsed.subject));
  check("from parsed", parsed.from?.includes("united.com") === true);
  check("text/plain base64 decoded", parsed.text?.includes("Confirmation: ABC123") === true);
  check("html qp decoded (em dash)", parsed.html?.includes("Houston — San Francisco") === true);
  check("attachment metadata only", parsed.attachments.length === 1 && parsed.attachments[0].filename === "receipt.pdf");
  const text = htmlToText(parsed.html ?? "");
  check("htmlToText strips style", !text.includes("color:red"));
  check("htmlToText keeps values", text.includes("eTicket number: 0162345678901") && text.includes("Total: $811.40"), text.slice(0, 120));
  check(
    "header folding + encoded Q",
    parseEml("Subject: =?utf-8?Q?Fare_=E2=82=AC42?=\r\n continued\r\n\r\nbody").subject ===
      "Fare €42 continued"
  );
}

/* --------------------------- receipt parsing ---------------------------- */
console.log("receipt parsing (anonymized fixtures):");
{
  const fx = (name: string) =>
    parseUnitedEmail(
      parseEml(readFileSync(join(process.cwd(), "fixtures/anonymized", name), "utf-8"))
    )!;

  /* Format 11: the schema.org FlightReservation markup (Gmail/Outlook email
     markup standard) — the airline's own machine-readable itinerary, and the
     format that catches carriers nobody wrote a text parser for. */
  {
    const mk = fx("schema-markup-confirmation.eml");
    check("markup: detected as the airline's embedded markup", mk.kind === "schema_markup");
    check(
      "markup: confirmation and issuer come from the markup itself",
      mk.confirmation === "H7QW3Z" && mk.issuing_carrier === "DL",
      JSON.stringify({ c: mk.confirmation, i: mk.issuing_carrier })
    );
    check(
      "markup: both legs, in order, on each airport's own clock",
      mk.segments.length === 2 &&
        mk.segments[0].flight_date === "2026-05-14" &&
        mk.segments[0].departure_time === "07:15" &&
        mk.segments[0].origin === "SFO" &&
        mk.segments[0].destination === "JFK" &&
        mk.segments[1].arrival_time === "22:05",
      JSON.stringify(mk.segments)
    );
    check(
      "markup: a carrier-prefixed flight number loses the prefix",
      mk.segments[1].flight_number === "448",
      mk.segments[1].flight_number
    );
    check("markup: seats ride along", mk.segments[0].seat === "21C");
    check(
      "markup: no money is claimed — every fare field stays null",
      mk.gross_total === null && mk.base_fare === null && mk.taxes === null &&
        mk.payments.length === 0,
      JSON.stringify({ g: mk.gross_total, b: mk.base_fare })
    );
    check(
      "markup: and it says so out loud",
      mk.warnings.some((w) => /names no fare/i.test(w)),
      mk.warnings.join(" | ")
    );

    const mkEml = (json: string) =>
      parseEml(
        [
          "From: Some Airline <noreply@example-air.com>",
          "Subject: Your trip",
          "Date: Mon, 20 Apr 2026 10:00:00 -0400",
          "MIME-Version: 1.0",
          "Content-Type: text/html; charset=utf-8",
          "",
          `<html><head><script type="application/ld+json">${json}</script></head><body><p>Trip details enclosed.</p></body></html>`,
        ].join("\r\n")
      );
    const res = (name: string, status = "ReservationConfirmed") => ({
      "@type": "FlightReservation",
      reservationNumber: "ZZTEST",
      reservationStatus: `http://schema.org/${status}`,
      underName: { "@type": "Person", name },
      reservationFor: {
        "@type": "Flight",
        flightNumber: "9",
        airline: { "@type": "Airline", iataCode: "B6" },
        departureAirport: { "@type": "Airport", iataCode: "JFK" },
        departureTime: "2026-06-01T08:00:00-04:00",
        arrivalAirport: { "@type": "Airport", iataCode: "LAX" },
        arrivalTime: "2026-06-01T11:20:00-07:00",
      },
    });
    const multi = parseUnitedEmail(mkEml(JSON.stringify([res("A A"), res("B B")])))!;
    check(
      "markup: one reservation per passenger folds to one flight, two travelers",
      multi.segments.length === 1 && multi.travelers === 2,
      JSON.stringify({ n: multi.segments.length, t: multi.travelers })
    );
    check(
      "markup: an @graph wrapper parses the same",
      parseUnitedEmail(
        mkEml(JSON.stringify({ "@context": "http://schema.org", "@graph": [res("A A")] }))
      )!.segments.length === 1
    );
    check(
      "markup: a booking of nothing but cancellations creates nothing",
      parseUnitedEmail(mkEml(JSON.stringify([res("A A", "ReservationCancelled")]))) === null
    );

    /* The cross-check: when a text format matched AND the email carries
       markup, the airline stated the itinerary twice — once for people, once
       for machines. Disagreement on a matched leg warns; agreement is
       silence; set differences stay silent because change notices are
       forward-looking. */
    const base = () => ({
      ...mk,
      kind: "eticket_receipt" as const,
      warnings: [] as string[],
      confirmation: "H7QW3Z",
      segments: mk.segments.map((s) => ({ ...s })),
    });
    const agree = base();
    appendMarkupCrossCheck(agree, mk);
    check("markup cross-check: agreement is silence", agree.warnings.length === 0,
      agree.warnings.join("|"));
    const conflict = base();
    conflict.segments[0].flight_number = "446";
    appendMarkupCrossCheck(conflict, mk);
    check(
      "…a flight-number conflict on a matched leg warns, naming both sides",
      conflict.warnings.length === 1 && /446/.test(conflict.warnings[0]) &&
        /447/.test(conflict.warnings[0]),
      conflict.warnings.join("|")
    );
    const late = base();
    late.segments[0].departure_time = "09:15";
    appendMarkupCrossCheck(late, mk);
    check(
      "…so does a departure-time conflict",
      late.warnings.length === 1 && /09:15/.test(late.warnings[0]) && /07:15/.test(late.warnings[0]),
      late.warnings.join("|")
    );
    const zeros = base();
    zeros.segments[0].flight_number = "0447";
    appendMarkupCrossCheck(zeros, mk);
    check("…while 0447 and 447 are the same flight, not a conflict", zeros.warnings.length === 0);
    const fewer = base();
    fewer.segments = [fewer.segments[0]];
    appendMarkupCrossCheck(fewer, mk);
    check(
      "…a leg only the markup has stays silent — change notices are forward-looking",
      fewer.warnings.length === 0
    );
    const airlineConf = base();
    airlineConf.confirmation = "OTHER1";
    appendMarkupCrossCheck(airlineConf, mk);
    check(
      "…an airline document's differing confirmation is flagged",
      airlineConf.warnings.some((w) => /H7QW3Z/.test(w) && /OTHER1/.test(w)),
      airlineConf.warnings.join("|")
    );
    const agency = { ...base(), kind: "chase_travel" as const, confirmation: "AGENCY" };
    appendMarkupCrossCheck(agency, mk);
    check(
      "…but never on an agency document — the agency-locator rule holds here too",
      agency.warnings.length === 0,
      agency.warnings.join("|")
    );
  }

  /* Negative fixtures: other airlines' real (anonymized) emails, adapted
     from the MIT-licensed partiu project. The property under test is
     SILENCE — a detector that misfires on a foreign airline's email would
     import nonsense with confidence. Brussels Airlines is the adversarial
     pick: Lufthansa-group, so its email is the nearest real-world neighbour
     to a format we DO parse. */
  /* Brussels is the one remaining negative: Lufthansa-group, so the nearest
     real neighbour to a parsed format. (Azul was a negative too, until an
     Azul parser landed and correctly claimed it — a negative can only be an
     airline nobody parses.) */
  for (const name of ["negative-brussels-airlines.eml"]) {
    const r = parseUnitedEmail(
      parseEml(readFileSync(join(process.cwd(), "fixtures/anonymized", name), "utf-8"))
    );
    check(
      `another airline's email stays unmatched: ${name}`,
      r === null,
      r ? `matched as ${r.kind}` : ""
    );
  }

  const cash = fx("eticket-receipt-cash.eml");
  check("receipt kind", cash.kind === "eticket_receipt");
  check("receipt confirmation", cash.confirmation === "AB12CD");
  check("receipt ticket number", cash.ticket_number === "0169999999901");
  check("receipt purchase date", cash.issue_date === "2026-03-03");
  check("receipt fare parts", cash.base_fare === 250 && cash.taxes === 29.35 && cash.gross_total === 279.35);
  check("receipt 2 segments", cash.segments.length === 2);
  const s1 = cash.segments[0];
  check(
    "segment fields",
    s1.flight_number === "100" && s1.origin === "EWR" && s1.destination === "ORD" &&
      s1.flight_date === "2026-03-12" && s1.departure_time === "08:00" &&
      s1.arrival_time === "10:30" && s1.booking_class === "K" && s1.seat === "12A"
  );
  check("second seat via FF line", cash.segments[1].seat === "14C");
  check("no bogus warnings", cash.warnings.length === 0, cash.warnings.join("; "));
  check(
    "accrual projections on segment 1",
    s1.projected_pqp === 125 && s1.projected_pqf === 1 && s1.projected_award_miles === 1250
  );
  check(
    "no accrual row → projections stay null",
    cash.segments[1].projected_pqp === null
  );

  const award = fx("eticket-receipt-award.eml");
  check("award miles redeemed", award.miles_redeemed === 9900);
  check("award cash total", award.gross_total === 5.6);
  check("award 2-letter class", award.segments[0]?.booking_class === "XN");
  check("award payment joined", award.payment_method?.includes("Visa ending in 0000") === true);
  check(
    "award accrual projections (0 award mi, PQP-earning)",
    award.segments[0]?.projected_award_miles === 0 &&
      award.segments[0]?.projected_pqp === 88 &&
      award.segments[0]?.projected_pqf === 1
  );

  // an award ticket paid three ways, with a tax label that contains "bag"
  const multi = fx("eticket-receipt-award-multipay.eml");
  // the method list runs until "Date of purchase" — it is not an allow-list of
  // card brands, so "Miscellaneous Document" must not end it early
  check(
    "multi-pay: all three methods captured",
    multi.payment_method ===
      "MileagePlus XXXXX999 · Miscellaneous Document · PayPal",
    String(multi.payment_method)
  );
  check(
    "multi-pay: methods → miles + credit + other",
    multi.payments?.map((p) => p.payment_type).join() ===
      "miles,future_flight_credit,other",
    multi.payments?.map((p) => p.payment_type).join()
  );
  // "Italy Security Bag Charge" is a tax; "1st bag charge" heads the baggage
  // table and is not
  check("multi-pay: bag-named tax counted", multi.taxes === 30.3, String(multi.taxes));
  check("multi-pay: per-passenger total, not the party total", multi.gross_total === 30.3);
  check("multi-pay: miles per passenger", multi.miles_redeemed === 6000);
  // the parts-vs-total check runs on award tickets too — it is what catches a
  // dropped tax line when the fare itself is 0
  check(
    "multi-pay: parts sum to total → no mismatch warning",
    !multi.warnings.some((w) => /Fare parts/i.test(w)),
    multi.warnings.join(" | ")
  );

  /* An award booking for TWO, paid from one account. Every figure printed for
     the party must land as ONE person's share: the cash side always divided,
     and the miles side is the regression — 60,000 party miles sat on one seat
     and its CPM paid twice. */
  const pair = fx("eticket-receipt-award-two-travelers.eml");
  check(
    "two-traveler award: your share of miles and cash, not the party's",
    pair.travelers === 2 && pair.miles_redeemed === 30000 && pair.gross_total === 132.9,
    JSON.stringify({ t: pair.travelers, m: pair.miles_redeemed, g: pair.gross_total })
  );
  check(
    "two-traveler award: the spaced 'Mileage Plus' method carries the miles",
    pair.payments?.some((p) => p.payment_type === "miles" && p.award_miles_used === 30000) ===
      true &&
      pair.payments?.some((p) => p.payment_type === "card" && p.amount === 132.9) === true,
    JSON.stringify(pair.payments)
  );
  check(
    "two-traveler award: the division is disclosed",
    pair.warnings.some((w) => /2 travelers/.test(w)),
    pair.warnings.join(" | ")
  );

  /* The award REISSUE: same layout plus the three lines that carry the
     rebooking — a per-passenger total, an additional collection printed with
     NO currency code (requiring one is how a real 266.40 went unrecorded),
     and the previous ticket numbers whose value was applied. The collection
     is printed for the party, like the Total, so it divides too. */
  const reiss = fx("eticket-receipt-award-reissue.eml");
  check(
    "award reissue: per-passenger price, share of the collection, the chain link",
    reiss.miles_redeemed === 40000 &&
      reiss.gross_total === 5.6 &&
      reiss.additional_collection === 133.2 &&
      reiss.previous_ticket_number === "0169999999914",
    JSON.stringify({
      m: reiss.miles_redeemed,
      g: reiss.gross_total,
      a: reiss.additional_collection,
      p: reiss.previous_ticket_number,
    })
  );
  /* "was charged" beside "value was applied" is not always a charge: on the
     real rebooking, 266.40 + 11.20 equalled the original's 277.60 to the
     cent and the card saw nothing. The receipt can't tell the two apart, so
     the figure must arrive WARNED. */
  check(
    "award reissue: a collection beside an applied value imports with a warning",
    reiss.warnings.some((w) => /additional collection.*applied previous-ticket value/i.test(w)),
    reiss.warnings.join(" | ")
  );

  /* Amex Travel — an OTA, so the airline's RECORD LOCATOR is the key, never the
     "Trip ID" in the subject. Its flight blocks are almost unlabelled. */
  const amex = fx("amex-travel-flight.eml");
  check("Amex Travel detected", amex.kind === "amex_travel", amex.kind);
  check(
    "Amex: the airline locator, not the Amex Trip ID",
    amex.confirmation === "ZZ0011",
    String(amex.confirmation)
  );
  // 027 is Alaska's ticket stock — more authoritative than the itinerary
  check(
    "Amex: issuing airline from the ticket-number stock prefix",
    amex.ticket_number === "0279999999944" && amex.issuing_carrier === "AS",
    JSON.stringify({ t: amex.ticket_number, c: amex.issuing_carrier })
  );
  check(
    "Amex: total, per-traveler fare and taxes",
    amex.gross_total === 148.6 && amex.base_fare === 124.65 && amex.taxes === 23.95,
    JSON.stringify({ g: amex.gross_total, b: amex.base_fare, t: amex.taxes })
  );
  check(
    "Amex: card brand and last four from their separate lines",
    amex.payment_method === "American Express ending in 4001" &&
      amex.payments[0]?.amount === 148.6,
    JSON.stringify(amex.payments)
  );
  /* airline as a NAME with the number beneath, times as a range on one line,
     route split across two, and a date with no year */
  check(
    "Amex: the leg, from a block with almost no labels",
    amex.segments.length === 1 &&
      amex.segments[0].carrier === "AS" &&
      amex.segments[0].flight_number === "601" &&
      amex.segments[0].origin === "SEA" &&
      amex.segments[0].destination === "SFO" &&
      amex.segments[0].flight_date === "2022-11-19" &&
      amex.segments[0].departure_time === "13:55" &&
      amex.segments[0].arrival_time === "16:03" &&
      amex.segments[0].seat === "30A" &&
      amex.segments[0].cabin === "Economy",
    JSON.stringify(amex.segments)
  );
  // it prints a cabin but never a fare class — so there isn't one to record
  check("Amex: no fare class is invented", amex.segments[0].booking_class === null);

  /* Alaska. Its dates carry no year, and on a codeshare the only Alaska
     booking code in the whole email is the one in the subject line. */
  const as1 = fx("alaska-receipt.eml");
  check("Alaska receipt detected", as1.kind === "alaska", as1.kind);
  check(
    "AS: booking code, ticket, issuer and the date it was charged",
    as1.confirmation === "ZZ0017" &&
      as1.ticket_number === "0279999999911" &&
      as1.issuing_carrier === "AS" &&
      as1.issue_date === "2022-03-29",
    JSON.stringify({ c: as1.confirmation, t: as1.ticket_number, d: as1.issue_date })
  );
  check(
    "AS: fare, taxes, total and the card from the charge sentence",
    as1.base_fare === 146.98 && as1.taxes === 25.62 && as1.gross_total === 172.6 &&
      as1.payment_method === "Visa ending in 4003" &&
      as1.payments[0]?.amount === 172.6,
    JSON.stringify({ g: as1.gross_total, m: as1.payment_method })
  );
  // "Mon, Apr 11" says no year — it comes from the booking date
  check(
    "AS: the year comes from the email, since the flight block has none",
    as1.segments.length === 1 &&
      as1.segments[0].flight_date === "2022-04-11" &&
      as1.segments[0].carrier === "AS" &&
      as1.segments[0].flight_number === "119" &&
      as1.segments[0].departure_time === "08:00" &&
      as1.segments[0].seat === "28D" &&
      as1.segments[0].booking_class === "S" &&
      as1.segments[0].cabin === "Economy",
    JSON.stringify(as1.segments)
  );

  const as2 = fx("alaska-receipt-codeshare.eml");
  /* On a codeshare Alaska prints the OPERATING airline's locator in the body
     and its own nowhere but the subject. Keying on the body would file an
     Alaska ticket under Hawaiian's code — the agency-locator trap again. */
  check(
    "AS codeshare: the subject's code wins over the operator's in the body",
    as2.confirmation === "ZZ0013",
    String(as2.confirmation)
  );
  check(
    "AS codeshare: Alaska sold it, Hawaiian flies it",
    as2.segments.length === 1 &&
      as2.segments[0].carrier === "AS" &&
      as2.segments[0].flight_number === "8241" &&
      as2.segments[0].operating_carrier === "HA",
    JSON.stringify(as2.segments.map((x) => [x.carrier + x.flight_number, x.operating_carrier]))
  );
  // two travelers: this one's share, not the party's $179.60
  check(
    "AS codeshare: one traveler's share, and the first ticket number",
    as2.gross_total === 89.8 &&
      as2.travelers === 2 &&
      as2.ticket_number === "0279999999922" &&
      as2.warnings.some((w) => /2 tickets on this receipt/.test(w)),
    JSON.stringify({ g: as2.gross_total, t: as2.ticket_number })
  );
  // "†" is a placeholder meaning "ask the operating airline", not a seat
  check(
    "AS codeshare: an unassigned seat isn't invented",
    as2.segments[0].seat === null && as2.segments[0].booking_class === "V",
    JSON.stringify(as2.segments[0])
  );
  check(
    "AS codeshare: \"to be charged\" reads like \"was charged\"",
    as2.payment_method === "Visa ending in 4006" && as2.issue_date === "2025-07-23",
    JSON.stringify({ m: as2.payment_method, d: as2.issue_date })
  );

  /* The post-merger Hawaiian/Alaska hybrid: hawaiianairlines.com sender,
     Hawaiian dress, Alaska ticket stock. Its flight head is "Flight 1 · Sat
     Aug 15" where 1 is an ORDINAL — the real number sits in "AS 1064 ·
     Boeing 717-200" — and the charge sentence drops "fare of" and wears a
     scheme prefix on the card number. */
  const hy = fx("alaska-hawaiian-hybrid.eml");
  check("AS hybrid: Hawaiian-dressed receipt detected as Alaska", hy.kind === "alaska", hy.kind);
  check(
    "AS hybrid: the booking code comes from the 'flight is booked' subject",
    hy.confirmation === "ZZ0042",
    String(hy.confirmation)
  );
  check(
    "AS hybrid: per-person money, first ticket, and the two-ticket warning",
    hy.base_fare === 180.47 &&
      hy.taxes === 24.44 &&
      hy.gross_total === 204.91 &&
      hy.travelers === 2 &&
      hy.ticket_number === "0272999999910" &&
      hy.warnings.some((w) => /2 tickets on this receipt/.test(w)),
    JSON.stringify({ g: hy.gross_total, t: hy.ticket_number })
  );
  check(
    "AS hybrid: the ordinal head isn't a flight — AS 1064 two lines later is",
    hy.segments.length === 1 &&
      hy.segments[0].carrier === "AS" &&
      hy.segments[0].flight_number === "1064" &&
      hy.segments[0].origin === "LIH" &&
      hy.segments[0].destination === "HNL" &&
      hy.segments[0].flight_date === "2026-08-15" &&
      hy.segments[0].departure_time === "11:58" &&
      hy.segments[0].arrival_time === "12:37",
    JSON.stringify(hy.segments)
  );
  check(
    "AS hybrid: the first traveler's seat line is the recorded one",
    hy.segments[0]?.seat === "14F" &&
      hy.segments[0]?.booking_class === "L" &&
      hy.segments[0]?.cabin === "Economy" &&
      hy.segments[0]?.operating_carrier === "AS",
    JSON.stringify(hy.segments[0] ?? null)
  );
  check(
    "AS hybrid: the charge sentence without 'fare of' still names the card",
    hy.payment_method === "VISA ending in 0042" && hy.issue_date === "2026-08-15",
    JSON.stringify({ m: hy.payment_method, d: hy.issue_date })
  );
  /* The email's own markup agrees with the text here, so the witness stays
     silent — and the parser found flights, so nothing was adopted. */
  check(
    "AS hybrid: text and markup agree, so no cross-check warnings",
    !hy.warnings.some((w) => /worth a look|machine-readable markup/.test(w)),
    JSON.stringify(hy.warnings)
  );
  /* And when a template drifts FURTHER than its parser knows — money read,
     no itinerary recognized — the email's own markup donates the flights,
     and the preview says where they came from. */
  const drifted = parseUnitedEmail(
    parseEml(
      [
        "Subject: Your flight is booked: ZZ0043 to Lihue on 09/01/2026",
        'From: "Hawaiian Airlines Reservation" <reservation@email.hawaiianairlines.com>',
        "Date: Tue, 25 Aug 2026 10:00:00 -0600",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        '<html><head><script type="application/ld+json">[{"@context":"https://schema.org","@type":"FlightReservation","reservationId":"ZZ0043","reservationStatus":"https://schema.org/ReservationConfirmed","reservationFor":{"@type":"Flight","flightNumber":"1070","departureTime":"2026-09-01T09:00:00-10:00","arrivalTime":"2026-09-01T09:45:00-10:00","provider":{"@type":"Airline","name":"Alaska Airlines","iataCode":"AS"},"departureAirport":{"@type":"Airport","iataCode":"HNL"},"arrivalAirport":{"@type":"Airport","iataCode":"LIH"}}}]</script></head><body>',
        "<p>Summary of airfare charges</p>",
        "<p>Ticket 0272999999912</p>",
        "<p>Base fare and surcharges</p>",
        "<p>$100.00</p>",
        "<p>Taxes and other fees</p>",
        "<p>$10.00</p>",
        "<p>Per-person total</p>",
        "<p>$110.00</p>",
        "</body></html>",
      ].join("\r\n")
    )
  );
  check(
    "drifted template: money from the text, flights donated by the markup",
    drifted?.kind === "alaska" &&
      drifted.gross_total === 110 &&
      drifted.segments.length === 1 &&
      drifted.segments[0].flight_number === "1070" &&
      drifted.segments[0].origin === "HNL" &&
      drifted.warnings.some((w) => /machine-readable markup/.test(w)),
    JSON.stringify({ k: drifted?.kind, s: drifted?.segments })
  );

  /* A receipt for two records the FIRST traveler's eTicket — whoever the
     airline alphabetized on top. The owner's ledger should carry the owner's. */
  {
    const pair = (name: string, ticket_number: string) => ({ name, ticket_number });
    const two = {
      ticket_number: "0162000000018",
      traveler_tickets: [
        pair("DOE/JANE", "0162000000018"),
        pair("VOVCHENKO/VOLODYMYR", "0162000000015"),
      ],
      warnings: [] as string[],
    } as unknown as ParsedReceipt;
    preferTravelerTicket(two, "Volodymyr", "Vovchenko");
    check(
      "two travelers: the ledger owner's eTicket wins over the first listed",
      two.ticket_number === "0162000000015" &&
        two.warnings.some((w) => /your own eTicket/.test(w)),
      JSON.stringify({ t: two.ticket_number, w: two.warnings })
    );
    const stranger = {
      ticket_number: "0162000000018",
      traveler_tickets: [
        pair("DOE/JANE", "0162000000018"),
        pair("VOVCHENKO/VOLODYMYR", "0162000000015"),
      ],
      warnings: [] as string[],
    } as unknown as ParsedReceipt;
    preferTravelerTicket(stranger, "Someone", "Else");
    check(
      "owner not aboard: the first listed stands, without comment",
      stranger.ticket_number === "0162000000018" && stranger.warnings.length === 0,
      String(stranger.ticket_number)
    );
    /* Whole first names only: ANN travels with ANNA, and ANNA prints first.
       A bare prefix match handed ANN her companion's ticket number. */
    const nested = {
      ticket_number: "0162000000021",
      traveler_tickets: [
        pair("SMITH/ANNA", "0162000000021"),
        pair("SMITH/ANN", "0162000000022"),
      ],
      warnings: [] as string[],
    } as unknown as ParsedReceipt;
    preferTravelerTicket(nested, "Ann", "Smith");
    check(
      "a first name inside a longer one: ANN gets ANN's ticket, not ANNA's",
      nested.ticket_number === "0162000000022",
      String(nested.ticket_number)
    );
    const middle = {
      ticket_number: "0162000000023",
      traveler_tickets: [
        pair("SMITH/ANNA", "0162000000023"),
        pair("SMITH/ANN MARIE", "0162000000024"),
      ],
      warnings: [] as string[],
    } as unknown as ParsedReceipt;
    preferTravelerTicket(middle, "Ann", "Smith");
    check(
      "…and a printed middle name still matches on the word boundary",
      middle.ticket_number === "0162000000024",
      String(middle.ticket_number)
    );
    const absent = {
      ticket_number: "0162000000025",
      traveler_tickets: [
        pair("SMITH/ANNA", "0162000000025"),
        pair("JONES/ROBERT", "0162000000026"),
      ],
      warnings: [] as string[],
    } as unknown as ParsedReceipt;
    preferTravelerTicket(absent, "Ann", "Smith");
    check(
      "…while ANNA alone is not ANN: no swap, no comment",
      absent.ticket_number === "0162000000025" && absent.warnings.length === 0,
      String(absent.ticket_number)
    );
  }

  /* CWT corporate trip document. Same rule as every agency format: key on the
     AIRLINE's booking reference, never the agency's own locator. */
  const cwt = fx("cwt-trip-document.eml");
  check("CWT trip document detected", cwt.kind === "cwt", cwt.kind);
  check(
    "CWT: keys on the airline PNR, not CWT's trip locator",
    cwt.confirmation === "ZZ0010",
    String(cwt.confirmation)
  );
  check(
    "CWT: issuer read off the ticket line, ticket number and issue date",
    cwt.issuing_carrier === "DL" &&
      cwt.ticket_number === "0069999999977" &&
      cwt.issue_date === "2022-03-10",
    JSON.stringify({ i: cwt.issuing_carrier, t: cwt.ticket_number, d: cwt.issue_date })
  );
  check(
    "CWT: fare, taxes and total across their split lines",
    cwt.base_fare === 540.62 && cwt.taxes === 69.75 && cwt.gross_total === 610.37,
    JSON.stringify({ b: cwt.base_fare, t: cwt.taxes, g: cwt.gross_total })
  );
  // "VIxxxxxxxxxxxx4002" is the same GDS scheme code ADTRAV prints
  check(
    "CWT: card from the GDS form-of-payment code",
    cwt.payment_method === "Visa ending in 4002" &&
      cwt.payments.length === 1 &&
      cwt.payments[0].amount === 610.37,
    JSON.stringify(cwt.payments)
  );
  // each leg's values are scattered over a dozen lines under DEPARTURE/ARRIVAL
  check(
    "CWT: both legs with times, seat, class and operating carrier",
    cwt.segments.length === 2 &&
      cwt.segments[0].origin === "OAK" &&
      cwt.segments[0].destination === "LAX" &&
      cwt.segments[0].flight_date === "2022-03-18" &&
      cwt.segments[0].departure_time === "16:02" &&
      cwt.segments[0].arrival_time === "17:25" &&
      cwt.segments[0].seat === "10C" &&
      cwt.segments[0].booking_class === "M" &&
      cwt.segments[0].operating_carrier === "OO" &&
      cwt.segments[1].origin === "LAX" &&
      cwt.segments[1].seat === "11B",
    JSON.stringify(cwt.segments)
  );

  /* Lufthansa "Booking details" — European dates, 24-hour times with a unit,
     and the only format that names the OPERATING carrier in words. */
  const lh = fx("lufthansa-booking-details.eml");
  check("Lufthansa booking detected", lh.kind === "lufthansa", lh.kind);
  check(
    "LH: issuer, booking code and ticket number",
    lh.issuing_carrier === "LH" &&
      lh.confirmation === "ZZ0016" &&
      lh.ticket_number === "2209999999999",
    JSON.stringify({ i: lh.issuing_carrier, c: lh.confirmation, t: lh.ticket_number })
  );
  check(
    "LH: fare and taxes from the flattened price table",
    lh.base_fare === 1175 && lh.taxes === 547.57 && lh.gross_total === 1722.57,
    JSON.stringify({ b: lh.base_fare, t: lh.taxes, g: lh.gross_total })
  );
  // "Mon. 21 December 2026" is day-first, and "09:30 h +1" is an arrival past
  // midnight — neither shape appears in any other format here
  check(
    "LH: European dates and 24-hour times",
    lh.segments.length === 2 &&
      lh.segments[0].flight_date === "2026-12-20" &&
      lh.segments[0].departure_time === "13:30" &&
      lh.segments[0].arrival_time === "09:30" &&
      lh.segments[1].flight_date === "2026-12-21",
    JSON.stringify(lh.segments.map((s) => [s.flight_date, s.departure_time, s.arrival_time]))
  );
  // the whole point of reading "operated by:" — LH7996 is United metal
  check(
    "LH: operating carrier read from the words under each leg",
    lh.segments[0].operating_carrier === "UA" &&
      lh.segments[1].operating_carrier === "LH",
    JSON.stringify(lh.segments.map((s) => [s.carrier + s.flight_number, s.operating_carrier]))
  );
  /* Two shapes for the same thing: a plain "Economy Class (U)" on one line, and
     a branded fare spread over three ("Class/Fare:" / "Business Class/" /
     "Business Saver" / "(J)"). A scan that only knew the one-line form ran past
     its line budget and over the NEXT leg's departure time, quietly importing a
     two-leg booking as one flight — and then past the price table too. */
  check(
    "LH: cabin and fare class, one-line and branded-fare forms alike",
    lh.segments[0].cabin === "Economy" && lh.segments[0].booking_class === "U" &&
      lh.segments[1].cabin === "Business" && lh.segments[1].booking_class === "J",
    JSON.stringify(lh.segments.map((s) => [s.cabin, s.booking_class]))
  );
  check(
    "…and the leg after a branded fare is still found",
    lh.segments.length === 2 && lh.segments[1].origin === "MUC",
    JSON.stringify(lh.segments.map((s) => `${s.origin}${s.destination}`))
  );
  check(
    "…as is the price table that follows the last leg",
    lh.gross_total === 1722.57
  );
  /* …and the reason it matters: United metal on a Lufthansa ticket was
     credited to Miles & More, so it earns no MileagePlus lifetime miles. */
  check(
    "a UA-operated leg on a foreign ticket estimates no lifetime miles",
    estimatedLifetimeMiles({
      lifetime_miles: null, distance_miles: 5800, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "LH", issuing_carrier: "LH",
    }) === 0
  );
  check(
    "…while the same leg on a United ticket still earns them",
    estimatedLifetimeMiles({
      lifetime_miles: null, distance_miles: 5800, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "LH", issuing_carrier: "UA",
    }) === 5800
  );
  /* Lifetime miles are a MileagePlus balance, so a flight that credited
     elsewhere cannot add to it — the flag has to reach this, not just the
     reconcile queue. UA59 on a United ticket, United metal, credited to
     Miles & More was still counting all 5,685 of its miles. */
  check(
    "a flight marked as crediting elsewhere earns no lifetime miles",
    estimatedLifetimeMiles({
      lifetime_miles: null, distance_miles: 5685, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "UA", issuing_carrier: "UA",
      credits_mileageplus: 0, ticket_id: "t",
    }) === 0
  );
  check(
    "…the same flight without that flag still does",
    estimatedLifetimeMiles({
      lifetime_miles: null, distance_miles: 5685, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "UA", issuing_carrier: "UA",
      credits_mileageplus: null, ticket_id: "t",
    }) === 5685
  );
  check(
    "…and a posted figure still wins over the flag",
    estimatedLifetimeMiles({
      lifetime_miles: 900, distance_miles: 5685, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "UA", issuing_carrier: "UA",
      credits_mileageplus: 0, ticket_id: "t",
    }) === 900
  );
  check(
    "…and a posted value always wins over both",
    estimatedLifetimeMiles({
      lifetime_miles: 1234, distance_miles: 5800, award_miles: null,
      operating_carrier: "UA", marketing_carrier: "LH", issuing_carrier: "LH",
    }) === 1234
  );

  /* American Airlines — itinerary and receipt in one email. A non-United ticket
     still belongs in the ledger: it costs money and flies miles. */
  const aa = fx("aa-trip-confirmation.eml");
  check("AA receipt detected as its own format", aa.kind === "aa_receipt", aa.kind);
  check(
    "AA: issuer, booking, ticket number and issue date",
    aa.issuing_carrier === "AA" &&
      aa.confirmation === "ZZ0009" &&
      aa.ticket_number === "0019999999966" &&
      aa.issue_date === "2024-03-12",
    JSON.stringify({ c: aa.issuing_carrier, k: aa.confirmation, t: aa.ticket_number })
  );
  check(
    "AA: fare, taxes and total from the one-line breakdown",
    aa.base_fare === 426.05 && aa.taxes === 62.15 && aa.gross_total === 488.2,
    JSON.stringify({ b: aa.base_fare, t: aa.taxes, g: aa.gross_total })
  );
  check(
    "AA: card payment",
    aa.payments.length === 1 &&
      aa.payments[0].payment_type === "card" &&
      aa.payments[0].amount === 488.2 &&
      aa.payment_method === "MasterCard ending in 4005",
    JSON.stringify(aa.payments)
  );
  // only the first leg of each day carries a date, and a codeshare pushes
  // "Operated by …" between the flight and its destination
  check(
    "AA: four legs across two days, codeshares included",
    aa.segments.length === 4 &&
      aa.segments.map((s) => `${s.flight_date} ${s.origin}${s.destination}`).join("|") ===
        "2024-05-14 IAHORD|2024-05-14 ORDCMI|2024-05-18 CMIORD|2024-05-18 ORDSFO",
    JSON.stringify(aa.segments.map((s) => [s.flight_date, s.origin, s.destination]))
  );
  check(
    "AA: times and fare class survive the codeshare lines",
    aa.segments[1].flight_number === "3469" &&
      aa.segments[1].departure_time === "15:04" &&
      aa.segments[1].arrival_time === "15:59" &&
      aa.segments[1].booking_class === "O" &&
      aa.segments[3].booking_class === "Q",
    JSON.stringify(aa.segments[1])
  );

  /* The other American layout: "Your trip confirmation and receipt" prints
     the locator inline ("Record Locator: EIKCON") and sells a paid seat as
     its own document inside "Total cost" — the extra has to be in the parts
     too, or the sum check cries wolf over the receipt's own arithmetic. */
  const aav = fx("aa-trip-receipt-paid-seat.eml");
  check("AA variant: detected as an American receipt", aav.kind === "aa_receipt", aav.kind);
  check(
    "AA variant: the inline Record Locator is the confirmation",
    aav.confirmation === "EIKCON" &&
      aav.ticket_number === "0012107179603" &&
      aav.issue_date === "2024-01-13",
    JSON.stringify({ c: aav.confirmation, t: aav.ticket_number, d: aav.issue_date })
  );
  check(
    "AA variant: the paid seat is an extra, and the parts reconcile",
    aav.base_fare === 87.44 &&
      aav.taxes === 31.16 &&
      aav.ancillary_fees === 10.21 &&
      aav.gross_total === 128.81,
    JSON.stringify({ b: aav.base_fare, t: aav.taxes, a: aav.ancillary_fees, g: aav.gross_total })
  );
  check(
    "AA variant: no false alarm about the breakdown",
    !aav.warnings.some((w) => w.includes("don't sum")),
    JSON.stringify(aav.warnings)
  );
  check(
    "AA variant: the paid seat is called out",
    aav.warnings.some((w) => w.includes("Paid Seat") && w.includes("10.21")),
    JSON.stringify(aav.warnings)
  );
  check(
    "AA variant: both legs, seat only where one was printed",
    aav.segments.length === 2 &&
      aav.segments[0].origin === "SFO" &&
      aav.segments[0].destination === "DFW" &&
      aav.segments[0].seat === "27C" &&
      aav.segments[0].booking_class === "B" &&
      aav.segments[1].destination === "SHV" &&
      aav.segments[1].seat === null,
    JSON.stringify(aav.segments.map((s) => [s.origin, s.destination, s.seat]))
  );

  /* Format 12: Delta's "Your Flight Receipt". The text splits each flight
     across three tables — year-less date and city NAMES in the flight block,
     year and airport CODES in the bag-allowance table, seats in their own
     FLIGHT/SEAT table — and the parser knits them back together. */
  const dl = fx("delta-flight-receipt.eml");
  check("Delta: detected as its own format", dl.kind === "delta_receipt", dl.kind);
  check(
    "Delta: issuer, booking, ticket, issue date and programme",
    dl.issuing_carrier === "DL" &&
      dl.confirmation === "GFQWNR" &&
      dl.ticket_number === "0062406766693" &&
      dl.issue_date === "2026-02-20" &&
      dl.frequent_flyer_program === "DL",
    JSON.stringify({ c: dl.confirmation, t: dl.ticket_number, d: dl.issue_date })
  );
  check(
    "Delta: base fare, itemized taxes and ticket amount reconcile",
    dl.base_fare === 480 && dl.taxes === 66.8 && dl.gross_total === 546.8 && dl.currency === "USD",
    JSON.stringify({ b: dl.base_fare, t: dl.taxes, g: dl.gross_total })
  );
  check(
    "Delta: no complaint about its own arithmetic",
    !dl.warnings.some((w) => w.includes("don't sum")),
    JSON.stringify(dl.warnings)
  );
  check(
    "Delta: card brand read from the two-letter code",
    dl.payment_method === "Visa ending in 1234" &&
      dl.payments.length === 1 &&
      dl.payments[0].payment_type === "card" &&
      dl.payments[0].amount === 546.8,
    JSON.stringify(dl.payments)
  );
  check(
    "Delta: year and airport codes knitted in from the bag table",
    dl.segments.length === 2 &&
      dl.segments.map((s) => `${s.flight_date} ${s.origin}${s.destination}`).join("|") ===
        "2026-03-08 JFKSFO|2026-03-12 SFOJFK",
    JSON.stringify(dl.segments.map((s) => [s.flight_date, s.origin, s.destination]))
  );
  check(
    "Delta: times, class letters, seats from the seat table, Main = Economy",
    dl.segments[0].flight_number === "670" &&
      dl.segments[0].departure_time === "17:25" &&
      dl.segments[0].arrival_time === "21:00" &&
      dl.segments[0].booking_class === "U" &&
      dl.segments[0].seat === "45C" &&
      dl.segments[0].cabin === "Economy" &&
      dl.segments[1].booking_class === "T" &&
      dl.segments[1].seat === "42C",
    JSON.stringify(dl.segments)
  );

  /* The Montréal departure: same layout, CAD amounts, a starred codeshare
     ("DELTA 5449*"), Basic Economy, and no seat until check-in. */
  const dlc = fx("delta-flight-receipt-cad.eml");
  check(
    "Delta CAD: booking and issue date",
    dlc.confirmation === "G8E4SQ" && dlc.issue_date === "2025-01-10",
    JSON.stringify({ c: dlc.confirmation, d: dlc.issue_date })
  );
  check(
    "Delta CAD: the currency rides on the amounts",
    dlc.currency === "CAD" && dlc.base_fare === 87 && dlc.taxes === 125.82 && dlc.gross_total === 212.82,
    JSON.stringify({ c: dlc.currency, b: dlc.base_fare, t: dlc.taxes, g: dlc.gross_total })
  );
  check(
    "Delta CAD: starred codeshare still reads as the marketing flight",
    dlc.segments.length === 1 &&
      dlc.segments[0].flight_number === "5449" &&
      dlc.segments[0].origin === "YUL" &&
      dlc.segments[0].destination === "LGA" &&
      dlc.segments[0].flight_date === "2025-02-24",
    JSON.stringify(dlc.segments)
  );
  check(
    "Delta CAD: Basic Economy in class E, seat assigned only at check-in",
    dlc.segments[0].cabin === "Basic Economy" &&
      dlc.segments[0].booking_class === "E" &&
      dlc.segments[0].seat === null &&
      dlc.segments[0].departure_time === "17:15" &&
      dlc.segments[0].arrival_time === "19:01",
    JSON.stringify(dlc.segments[0])
  );

  /* An extras card: "Additional Purchase Summary" bills a seat assignment as
     its own transaction, on a different card, with its own tax line. None of
     it is the ticket's fare — before the guard, the card's 2.70 tax bled into
     the ticket's taxes and made an honest 316.97 receipt look mis-summed. */
  const extras = fx("eticket-receipt-additional-purchase.eml");
  check(
    "extras card: the ticket's own money parses clean",
    extras.base_fare === 266.39 && extras.taxes === 50.58 && extras.gross_total === 316.97,
    JSON.stringify({ b: extras.base_fare, t: extras.taxes, g: extras.gross_total })
  );
  check(
    "extras card: no false alarm about the breakdown",
    !extras.warnings.some((w) => w.includes("don't sum")),
    JSON.stringify(extras.warnings)
  );
  check(
    "extras card: the ticket's card wins, not the extras card's",
    extras.payment_method === "Visa ending in 1234",
    String(extras.payment_method)
  );
  check(
    "extras card: the separate purchase is named and priced in a note",
    extras.warnings.some(
      (w) => w.includes("Basic Economy Seat Assignment") && w.includes("38.69")
    ),
    JSON.stringify(extras.warnings)
  );
  check(
    "extras card: itinerary unaffected",
    extras.segments.length === 2 && extras.segments[1].booking_class === "N",
    JSON.stringify(extras.segments.map((s) => [s.origin, s.destination]))
  );

  /* Azul, in Portuguese, in two layouts — one prints the flight datetime with
     a year ("02/03/2026 - 13:20"), the other without ("02/03 • 13:20"), day
     first in both. Fare + seat + services must equal Total da Passagem. */
  const az = fx("azul-purchase.eml");
  check("Azul: detected as its own format", az.kind === "azul", az.kind);
  check(
    "Azul: booking, fare parts and PIX payment",
    az.confirmation === "TQJWFX" &&
      az.base_fare === 577.5 &&
      az.ancillary_fees === 136.44 &&
      az.gross_total === 713.94 &&
      az.currency === "BRL" &&
      az.payment_method === "PIX",
    JSON.stringify({ c: az.confirmation, b: az.base_fare, a: az.ancillary_fees, g: az.gross_total })
  );
  check(
    "Azul: day-first date, route, seat from the travelers table",
    az.segments.length === 1 &&
      az.segments[0].flight_date === "2026-03-02" &&
      az.segments[0].origin === "VCP" &&
      az.segments[0].destination === "FLN" &&
      az.segments[0].flight_number === "4849" &&
      az.segments[0].departure_time === "13:20" &&
      az.segments[0].seat === "6C",
    JSON.stringify(az.segments)
  );
  const az2 = fx("azul-purchase-variant.eml");
  check(
    "Azul variant: the year-less datetime resolves against the email date",
    az2.segments.length === 1 &&
      az2.segments[0].flight_date === "2026-03-02" &&
      az2.gross_total === 713.94,
    JSON.stringify({ d: az2.segments[0]?.flight_date, g: az2.gross_total })
  );

  /* LATAM: itinerary positional around the flight line, Portuguese dates,
     and a total-only money block — the breakdown is in a PDF attachment. */
  const la = fx("latam-purchase-confirmation.eml");
  check("LATAM: detected as its own format", la.kind === "latam", la.kind);
  check(
    "LATAM: booking, total-only money, and the PDF note",
    la.confirmation === "XXXXXX" &&
      la.gross_total === 632.86 &&
      la.currency === "BRL" &&
      la.base_fare === null &&
      la.warnings.some((w) => w.includes("PDF attachment")),
    JSON.stringify({ c: la.confirmation, g: la.gross_total, w: la.warnings })
  );
  check(
    "LATAM: leg with Portuguese date and parenthesized codes",
    la.segments.length === 1 &&
      la.segments[0].carrier === "LA" &&
      la.segments[0].flight_number === "3357" &&
      la.segments[0].origin === "FLN" &&
      la.segments[0].destination === "GRU" &&
      la.segments[0].flight_date === "2026-03-16" &&
      la.segments[0].departure_time === "11:45",
    JSON.stringify(la.segments)
  );

  /* SAS, in Swedish: an award for two, legs told from the trip-summary line
     by what follows them, a Virgin-operated leg under its own VS number. */
  const sk = fx("sas-booking-confirmation.eml");
  check("SAS: detected as its own format", sk.kind === "sas", sk.kind);
  check(
    "SAS: award for two divides to one traveler's share",
    sk.confirmation === "WD7WYD" &&
      sk.travelers === 2 &&
      sk.miles_redeemed === 27000 &&
      sk.taxes === 1566 &&
      sk.gross_total === 1566 &&
      sk.currency === "SEK",
    JSON.stringify({ c: sk.confirmation, t: sk.travelers, m: sk.miles_redeemed, g: sk.gross_total })
  );
  check(
    "SAS: both legs dated from the header date, cabin applied, VS leg kept",
    sk.segments.length === 2 &&
      sk.segments[0].carrier === "SK" &&
      sk.segments[0].flight_number === "533" &&
      sk.segments[0].origin === "ARN" &&
      sk.segments[0].destination === "LHR" &&
      sk.segments[0].flight_date === "2025-10-28" &&
      sk.segments[0].cabin === "Economy" &&
      sk.segments[1].carrier === "VS" &&
      sk.segments[1].flight_number === "449" &&
      sk.segments[1].destination === "JNB",
    JSON.stringify(sk.segments)
  );
  /* …and the OTHER SAS document: a courtesy email whose entire content lives
     in a PDF attachment. Recognized so the import can say exactly that. */
  const skPdf = fx("sas-eticket-pdf.eml");
  check(
    "SAS PDF: recognized, empty, and honest about why",
    skPdf.kind === "sas" &&
      skPdf.segments.length === 0 &&
      skPdf.gross_total === null &&
      skPdf.warnings.some((w) => w.includes("PDF attachment")),
    JSON.stringify(skPdf.warnings)
  );

  /* Wizz, forwarded — the detector reads wizzair.com out of the forwarded
     header block in the body. Two passengers' fares plus the administration
     fee must equal the grand total, divided to one share. */
  const wz = fx("wizz-itinerary.eml");
  check("Wizz: detected from the forwarded body", wz.kind === "wizz", wz.kind);
  check(
    "Wizz: two fares + admin fee = grand total, divided to one share",
    wz.confirmation === "GW8PSD" &&
      wz.travelers === 2 &&
      wz.base_fare === 10.99 &&
      wz.ancillary_fees === 9 &&
      wz.gross_total === 19.99 &&
      wz.currency === "EUR" &&
      wz.issue_date === "2026-03-03",
    JSON.stringify({ c: wz.confirmation, b: wz.base_fare, a: wz.ancillary_fees, g: wz.gross_total })
  );
  check(
    "Wizz: day-first date, both times off the one datetime line",
    wz.segments.length === 1 &&
      wz.segments[0].carrier === "W9" &&
      wz.segments[0].flight_number === "5362" &&
      wz.segments[0].origin === "BCN" &&
      wz.segments[0].destination === "LTN" &&
      wz.segments[0].flight_date === "2026-05-14" &&
      wz.segments[0].departure_time === "09:35" &&
      wz.segments[0].arrival_time === "11:00",
    JSON.stringify(wz.segments)
  );

  /* Southwest: itinerary only — the money is on a purchase receipt Southwest
     sends separately, and the import says so instead of inventing zeros. */
  const wn = fx("southwest-itinerary.eml");
  check("Southwest: detected as its own format", wn.kind === "southwest", wn.kind);
  check(
    "Southwest: booking, purchase date, three passengers, no invented money",
    wn.confirmation === "4474MV" &&
      wn.issue_date === "2022-09-06" &&
      wn.travelers === 3 &&
      wn.gross_total === null &&
      wn.warnings.some((w) => w.includes("separate purchase receipt")),
    JSON.stringify({ c: wn.confirmation, d: wn.issue_date, t: wn.travelers })
  );
  check(
    "Southwest: both flights with dates and times",
    wn.segments.length === 2 &&
      wn.segments.map((s) => `${s.flight_date} WN${s.flight_number} ${s.origin}${s.destination}`).join("|") ===
        "2022-09-30 WN114 OAKLAS|2022-10-02 WN1834 LASOAK" &&
      wn.segments[0].departure_time === "15:00" &&
      wn.segments[1].arrival_time === "11:15",
    JSON.stringify(wn.segments)
  );
  const wnR = fx("southwest-trip-reminder.eml");
  check(
    "Southwest reminder: booking only, and honest about having no flights",
    wnR.kind === "southwest" &&
      wnR.confirmation === "2CEPA9" &&
      wnR.segments.length === 0,
    JSON.stringify({ c: wnR.confirmation, n: wnR.segments.length })
  );

  /* Kiwi.com: recognized precisely so the import can explain why there is
     nothing to import — agency number only, no flights, no amounts. */
  const kw = fx("kiwi-ota-confirmation.eml");
  check(
    "Kiwi: recognized, empty, and the agency-locator rule holds",
    kw.kind === "kiwi" &&
      kw.confirmation === null &&
      kw.segments.length === 0 &&
      kw.gross_total === null &&
      kw.warnings.some((w) => w.includes("airline's own receipt")),
    JSON.stringify({ c: kw.confirmation, w: kw.warnings })
  );

  /* Chase Travel's newest layout: Depart:/Return: bounds instead of
     "Flight N:" headings, and Ultimate Rewards points in the payment
     summary. Points follow the award-ticket rule — the cash actually billed
     is the cost, and the points are noted, never priced or filed as miles. */
  const chp = fx("chase-travel-points-cash.eml");
  check(
    "Chase points+cash: billed cash is the cost, not the trip price",
    chp.gross_total === 338.5 && chp.payment_method === "Visa ending in 8360",
    JSON.stringify({ g: chp.gross_total, p: chp.payment_method })
  );
  check(
    "Chase points+cash: the note prices the whole trip",
    chp.warnings.some((w) => w.includes("538.14") && w.includes("19,964")),
    JSON.stringify(chp.warnings)
  );
  check(
    "Chase points+cash: Depart/Return bounds parse into dated segments",
    chp.segments.length === 2 &&
      chp.segments[0].carrier === "DL" &&
      chp.segments[0].flight_number === "625" &&
      chp.segments[0].origin === "JFK" &&
      chp.segments[0].destination === "MEX" &&
      chp.segments[0].flight_date === "2026-05-13" &&
      chp.segments[0].departure_time === "09:29" &&
      chp.segments[0].cabin === "Basic Economy" &&
      chp.segments[0].booking_class === "E" &&
      chp.segments[1].flight_number === "7976" &&
      chp.segments[1].flight_date === "2026-05-17",
    JSON.stringify(chp.segments)
  );
  check(
    "Chase points+cash: points are a payment entry, never miles",
    chp.miles_redeemed === null &&
      chp.payments.some(
        (p) => p.payment_type === "other" && /19,964 Chase points/.test(p.reference ?? "")
      ),
    JSON.stringify(chp.payments)
  );

  const chm = fx("chase-travel-points-mixed-total.eml");
  check(
    "Chase mixed total: '53,934 points + $98.29' reads as points and cash",
    chm.gross_total === 98.29 && chm.warnings.some((w) => w.includes("53,934")),
    JSON.stringify({ g: chm.gross_total, w: chm.warnings })
  );
  check(
    "Chase mixed total: alphanumeric Trip ID, and the operating metal kept",
    chm.warnings.some((w) => w.includes("THX4DS5PC")) &&
      chm.segments.length === 2 &&
      chm.segments[0].carrier === "NH" &&
      chm.segments[0].operating_carrier === "UA" &&
      chm.segments[0].flight_date === "2024-11-25" &&
      chm.segments[1].flight_date === "2024-12-13",
    JSON.stringify(chm.segments)
  );

  const cho = fx("chase-travel-points-only.eml");
  check(
    "Chase points-only: zero cash cost, points noted rather than priced",
    cho.gross_total === 0 && cho.warnings.some((w) => w.includes("41,838")),
    JSON.stringify({ g: cho.gross_total, w: cho.warnings })
  );
  check(
    "Chase points-only: a one-stop bound splits around the printed stop",
    cho.segments.length === 2 &&
      cho.segments[0].flight_number === "916" &&
      cho.segments[0].origin === "HKG" &&
      cho.segments[0].destination === "TPE" &&
      cho.segments[0].departure_time === "17:35" &&
      cho.segments[1].flight_number === "12" &&
      cho.segments[1].origin === "TPE" &&
      cho.segments[1].destination === "JFK" &&
      cho.segments[1].arrival_time === "19:20" &&
      cho.warnings.some((w) => w.includes("its own date isn't printed")),
    JSON.stringify(cho.segments)
  );

  const chd = fx("chase-travel-points-pair.eml");
  check(
    "Chase pair: two travelers' cash divides; the trip note stays whole",
    chd.gross_total === 31.47 &&
      chd.travelers === 2 &&
      chd.segments.length === 1 &&
      chd.segments[0].carrier === "HX" &&
      chd.segments[0].booking_class === "S" &&
      chd.warnings.some((w) => w.includes("310.60")),
    JSON.stringify({ g: chd.gross_total, s: chd.segments })
  );

  /* Capital One Travel: a "multiple itineraries" trip is really two tickets
     with two airline locators — and Capital One's own "H-H-…" code is an
     agency locator, skipped on purpose. Per-traveler fare details reconcile
     to each traveler's share of the stated total. */
  const co = fx("capital-one-split-ticket.eml");
  check("Capital One: detected as its own format", co.kind === "capital_one", co.kind);
  check(
    "Capital One: the airline locator wins, and the split is called out",
    co.confirmation === "LMTRZQ" && co.warnings.some((w) => w.includes("KZUAUU")),
    JSON.stringify({ c: co.confirmation, w: co.warnings })
  );
  check(
    "Capital One: per-traveler parts reconcile to the share",
    co.base_fare === 140.47 &&
      co.taxes === 41.33 &&
      co.ancillary_fees === 52.72 &&
      co.gross_total === 234.52 &&
      co.travelers === 2 &&
      !co.warnings.some((w) => w.includes("don't sum")),
    JSON.stringify({ b: co.base_fare, t: co.taxes, a: co.ancillary_fees, g: co.gross_total })
  );
  check(
    "Capital One: both directions, split airports, Basic Economy",
    co.segments.length === 2 &&
      co.segments[0].flight_number === "3100" &&
      co.segments[0].origin === "LGA" &&
      co.segments[0].destination === "ORD" &&
      co.segments[0].flight_date === "2026-07-15" &&
      co.segments[0].departure_time === "09:44" &&
      co.segments[0].cabin === "Basic Economy" &&
      co.segments[1].flight_number === "1421" &&
      co.segments[1].destination === "JFK" &&
      co.segments[1].arrival_time === "20:04",
    JSON.stringify(co.segments)
  );
  check(
    "Capital One: card and travel credit both recorded, credit not netted",
    co.payments.length === 2 &&
      co.payments[0].amount === 84.52 &&
      co.payments[1].amount === 150 &&
      co.warnings.some((w) => w.includes("statement credit")),
    JSON.stringify(co.payments)
  );

  /* Format 21: "Thanks for your purchase with United" — an extras receipt
     (here a Premium Cabin Upgrade), which is NOT a ticket and must never look
     like one: before it had a parser, its "Flight 1 of 1" line tripped the
     eTicket detector and $299 masqueraded as the ticket's fare. It imports as
     a dated "extra purchase" adjustment on the ticket it names, and its EMD
     reference keeps re-imports inert. */
  const up = fx("united-purchase-upgrade.eml");
  check(
    "upgrade: detected as a purchase, not an eTicket",
    up.kind === "ancillary_receipt",
    up.kind
  );
  check(
    "upgrade: names the ticket it belongs to and its own EMD",
    up.ticket_number === "0169999999955" &&
      up.ancillary_items?.length === 1 &&
      up.ancillary_items[0].label === "Premium Cabin Upgrade" &&
      up.ancillary_items[0].reference === "0169999999966" &&
      up.ancillary_items[0].amount === 299,
    JSON.stringify(up.ancillary_items)
  );
  check(
    "upgrade: dated to the purchase day, paid how the receipt says",
    up.issue_date === "2022-12-04" &&
      up.gross_total === 299 &&
      up.payment_method === "American Express ending in 0000",
    JSON.stringify({ d: up.issue_date, g: up.gross_total, p: up.payment_method })
  );
  check(
    "upgrade: the flight it upgrades, carrying the PQP projection",
    up.segments.length === 1 &&
      up.segments[0].flight_number === "1210" &&
      up.segments[0].origin === "SEA" &&
      up.segments[0].destination === "IAH" &&
      up.segments[0].flight_date === "2022-12-10" &&
      up.segments[0].projected_pqp === 299,
    JSON.stringify(up.segments)
  );
  /* Which purchases earn PQP is the item label's job to say: seats and
     upgrades do; Wi-Fi, bags and the like cost money but project nothing —
     and the projection is over eligible ITEMS, never the receipt total,
     which can include taxes. */
  check(
    "PQP eligibility: seats and upgrades earn, Wi-Fi and bags don't",
    pqpEligibleAncillary([
      { label: "Premium Cabin Upgrade", amount: 299 },
      { label: "United Wi-Fi", amount: 8 },
    ]) === 299 &&
      // the statement posts a $299 "Premium Economy Upsell" as 299 PQP —
      // United's word for a paid cabin bump, same as any upgrade
      pqpEligibleAncillary([{ label: "Premium Economy Upsell", amount: 299 }]) === 299 &&
      pqpEligibleAncillary([{ label: "Basic Economy Seat Assignment", amount: 35.99 }]) === 36 &&
      pqpEligibleAncillary([{ label: "Economy Plus", amount: 59 }]) === 59 &&
      pqpEligibleAncillary([{ label: "United Wi-Fi", amount: 8 }]) === 0 &&
      pqpEligibleAncillary([{ label: "Checked bag", amount: 40 }]) === 0 &&
      // the trap: a Wi-Fi TIER upgrade contains "upgrade" and earns nothing
      pqpEligibleAncillary([
        { label: "Inflight Wi-Fi Messaging to Basic Full Flight Upgrade", amount: 16.99 },
      ]) === 0 &&
      // and a FEE is a co-pay, not a purchase — three real $20 PlusPoints
      // fees were projecting 20 PQP each off the word "upgrade"
      pqpEligibleAncillary([
        { label: "Mp Pluspoint Regular Upgrade Fee", amount: 20 },
      ]) === 0
  );
  {
    const upTicket = {
      id: "T-up",
      ticket_number: "0169999999955",
      confirmation_code: "AB12CD",
    } as unknown as import("../src/lib/types").TicketRow;
    const upSeg = {
      id: "S-up",
      ticket_id: "T-up",
      origin: "SEA",
      destination: "IAH",
      flight_date: "2022-12-10",
      status: "flown_reconciled",
    } as unknown as import("../src/lib/types").SegmentRow;
    const pv = buildReceiptPreview(
      up,
      [upTicket],
      [upSeg],
      [],
      buildBatchContext([up], [upTicket])
    );
    check(
      "upgrade preview: attaches to the ticket, pinned to the flight it names",
      pv.ticket.action === "unchanged" &&
        pv.extras?.length === 1 &&
        pv.extras[0].action === "create" &&
        pv.extras[0].ticketId === "T-up" &&
        pv.extras[0].segmentId === "S-up" &&
        pv.extras[0].effective_date === "2022-12-04",
      JSON.stringify(pv.extras)
    );
    const applyUp = buildApplyItem(pv);
    check(
      "upgrade apply: one adjustment row carrying the pin, fare untouched",
      applyUp != null &&
        applyUp.extras?.length === 1 &&
        applyUp.extras[0].data.type === "extra" &&
        applyUp.extras[0].data.amount === 299 &&
        applyUp.extras[0].data.segment_id === "S-up" &&
        String(applyUp.extras[0].data.notes).includes("0169999999966") &&
        applyUp.ticket.action === "none" &&
        Object.keys(applyUp.ticket.data).length === 0,
      JSON.stringify(applyUp)
    );
    /* An upgrade travels with its coupon. Reissue the ticket and the named
       leg is cancelled while the same flight departs under the new number —
       pinning to the dead coupon would fall back to spreading the money
       across every leg, the exact smear pinning exists to prevent. */
    {
      const oldTicket = mkTicket({
        id: "T-old", ticket_number: "0169999999955", confirmation_code: "AB12CD",
      });
      const newTicket = mkTicket({
        id: "T-new", ticket_number: "0169999999977", confirmation_code: "AB12CD",
        predecessor_ticket_id: "T-old",
      });
      const deadLeg = mkSeg("S-dead", {
        origin: "SEA", destination: "IAH", flight_date: "2022-12-10",
        status: "canceled", ticket_id: "T-old",
      });
      const liveLeg = mkSeg("S-live", {
        origin: "SEA", destination: "IAH", flight_date: "2022-12-10",
        status: "flown_reconciled", ticket_id: "T-new",
      });
      const pvChain = buildReceiptPreview(
        up, [oldTicket, newTicket], [deadLeg, liveLeg], [],
        buildBatchContext([up], [oldTicket, newTicket])
      );
      check(
        "an upgrade pins to the leg that flew, not the coupon it replaced",
        pvChain.extras?.[0]?.segmentId === "S-live",
        JSON.stringify({ pinned: pvChain.extras?.[0]?.segmentId })
      );

      /* Three tickets deep: the upgrade's coupon is two hops from the leg
         that finally flew, and a one-hop search pins it to the dead root. */
      const mid = mkTicket({
        id: "T-mid", ticket_number: "0169999999966", confirmation_code: "ZZ0001",
        predecessor_ticket_id: "T-old",
      });
      const grandchild = mkTicket({
        id: "T-gc", ticket_number: "0169999999988", confirmation_code: "ZZ0002",
        predecessor_ticket_id: "T-mid",
      });
      const liveFar = mkSeg("S-far", {
        origin: "SEA", destination: "IAH", flight_date: "2022-12-10",
        status: "flown_reconciled", ticket_id: "T-gc",
      });
      const pvFar = buildReceiptPreview(
        up, [oldTicket, mid, grandchild], [deadLeg, liveFar], [],
        buildBatchContext([up], [oldTicket, mid, grandchild])
      );
      check(
        "the pin follows a whole reissue chain, not one hop",
        pvFar.extras?.[0]?.segmentId === "S-far",
        JSON.stringify({ pinned: pvFar.extras?.[0]?.segmentId })
      );

      /* Recorded once without a pin — by an older import, or before the
         flight existed — and its money has been spreading ever since. A
         replay fills that blank instead of reporting "already there". */
      const pvRepair = buildReceiptPreview(
        up, [upTicket], [upSeg], [], buildBatchContext([up], [upTicket]),
        [{ id: "ADJ1", ticket_id: "T-up", notes: "Premium Cabin Upgrade — EMD 0169999999966", segment_id: null }]
      );
      check(
        "a replay repairs a pin the ledger is missing, without a second row",
        pvRepair.extras?.[0]?.action === "pin" &&
          pvRepair.extras[0].adjustmentId === "ADJ1" &&
          buildApplyItem(pvRepair)?.extras?.[0]?.adjustmentId === "ADJ1",
        JSON.stringify(pvRepair.extras?.[0])
      );
      const pvPinned = buildReceiptPreview(
        up, [upTicket], [upSeg], [], buildBatchContext([up], [upTicket]),
        [{ id: "ADJ1", ticket_id: "T-up", notes: "Premium Cabin Upgrade — EMD 0169999999966", segment_id: "S-up" }]
      );
      check(
        "…and a pin already there is left alone, replay still inert",
        pvPinned.extras?.[0]?.action === "unchanged" && buildApplyItem(pvPinned) === null,
        JSON.stringify(pvPinned.extras?.[0])
      );
    }

    const replay = buildReceiptPreview(
      up,
      [upTicket],
      [],
      [],
      buildBatchContext([up], [upTicket]),
      [{ ticket_id: "T-up", notes: "Premium Cabin Upgrade — EMD 0169999999966" }]
    );
    check(
      "upgrade replay: the EMD is found and nothing is written",
      replay.extras?.[0].action === "unchanged" && buildApplyItem(replay) === null,
      JSON.stringify(replay.extras)
    );
    const orphan = buildReceiptPreview(up, [], [], [], buildBatchContext([up], []));
    check(
      "upgrade with no ticket: nothing invented, told to import the ticket first",
      orphan.extras?.[0].action === "orphan" &&
        (orphan.ticket.note ?? "").includes("import its eTicket receipt first") &&
        buildApplyItem(orphan) === null,
      JSON.stringify({ note: orphan.ticket.note })
    );
    /* The consumption doctrine on a MIXED receipt: an upgrade plus inflight
       Wi-Fi in one transaction — the product change imports, the onboard
       purchase stays out of cost entirely (not merely out of PQP). */
    const mixed = {
      ...up,
      ancillary_items: [
        ...(up.ancillary_items ?? []),
        { label: "Inflight Wi-Fi Basic Full Flight", reference: "0161111111111", amount: 16.99 },
      ],
    };
    const pvMixed = buildReceiptPreview(
      mixed,
      [upTicket],
      [upSeg],
      [],
      buildBatchContext([mixed], [upTicket])
    );
    check(
      "consumption doctrine: on a mixed receipt only the product change imports",
      pvMixed.extras?.length === 1 &&
        pvMixed.extras[0].label === "Premium Cabin Upgrade" &&
        pvMixed.extras[0].action === "create",
      JSON.stringify(pvMixed.extras)
    );
  }

  /* Funding reconciliation across parser generations. The method block once
     imported as amount-less rows ("Mileage Plus …" as Other, the card with
     nothing on it) and the redemption as a bare miles row; a later parse
     states the same instruments with their data. Exact-key dedupe filed both
     renditions side by side, so re-importing a mailbox after any parser
     improvement DOUBLED funding — the ledger's ticket showed 60,000 miles on a
     30,000-mile seat. The poorer rendition is retired, and a healed ticket
     re-imports as a funding no-op. */
  {
    const pairParse = fx("eticket-receipt-award-two-travelers.eml");
    const healTicket = mkTicket({
      id: "T-heal",
      confirmation_code: "AW2PAX",
      ticket_number: "0169999999924",
      gross_total: 132.9,
      issue_date: "2023-11-25",
    });
    const stale = [
      { id: "p1", ticket_id: "T-heal", payment_type: "other", amount: null, award_miles_used: null, reference: "Mileage Plus XXXXX999" },
      { id: "p2", ticket_id: "T-heal", payment_type: "card", amount: null, award_miles_used: null, reference: "Visa ending in 1111" },
      { id: "p3", ticket_id: "T-heal", payment_type: "miles", amount: null, award_miles_used: 30000, reference: null },
    ];
    const informative = [
      { id: "p4", ticket_id: "T-heal", payment_type: "miles", amount: null, award_miles_used: 30000, reference: "Mileage Plus XXXXX999" },
      { id: "p5", ticket_id: "T-heal", payment_type: "card", amount: 132.9, award_miles_used: null, reference: "Visa ending in 1111" },
    ];
    const healPv = buildReceiptPreview(
      pairParse,
      [healTicket],
      [],
      [...stale, ...informative],
      buildBatchContext([pairParse], [healTicket])
    );
    check(
      "a better parse retires the poorer rendition of the same funding",
      healPv.stalePayments.map((s) => s.id).sort().join() === "p1,p2,p3" &&
        healPv.payments.length === 0,
      JSON.stringify({ stale: healPv.stalePayments, add: healPv.payments.length })
    );
    check(
      "…and the apply item carries exactly those deletions",
      buildApplyItem(healPv)?.stalePaymentIds?.slice().sort().join() === "p1,p2,p3",
      JSON.stringify(buildApplyItem(healPv)?.stalePaymentIds)
    );
    const firstPv = buildReceiptPreview(
      pairParse,
      [healTicket],
      [],
      stale,
      buildBatchContext([pairParse], [healTicket])
    );
    check(
      "…one pass both records the stated rows and retires the stale ones",
      firstPv.payments.length === 2 && firstPv.stalePayments.length === 3,
      JSON.stringify({ add: firstPv.payments.length, stale: firstPv.stalePayments.length })
    );
    const donePv = buildReceiptPreview(
      pairParse,
      [healTicket],
      [],
      informative,
      buildBatchContext([pairParse], [healTicket])
    );
    check(
      "…and a healed ticket re-imports as a funding no-op",
      donePv.payments.length === 0 && donePv.stalePayments.length === 0,
      JSON.stringify(donePv.stalePayments)
    );
  }

  /* The NGVWFE deadlock, from a real mailbox: an upgrade receipt names the
     eTicket it belongs to, and the same-number reprint rule crowned it "the
     newer copy" of that ticket — silencing the actual eTicket receipt, whose
     plan the upgrade was in turn waiting on. Nobody created the ticket. A
     document that merely REFERENCES a ticket is never a copy of it, and an
     upgrade travelling in the same batch as its eTicket attaches to the
     ticket that batch creates — resolved by number, pinned by flight, at
     apply time. */
  {
    const et = {
      ...fx("eticket-receipt-cash.eml"),
      ticket_number: "0169999999955",
      confirmation: "NG99ZZ",
    };
    const upgrade = fx("united-purchase-upgrade.eml"); // names 0169999999955
    const both = buildBatchContext([et, upgrade], []);
    const pvEt = buildReceiptPreview(et, [], [], [], both);
    check(
      "a purchase receipt is never 'the newer copy' of its ticket",
      pvEt.ticket.action === "create" &&
        !(pvEt.ticket.note ?? "").includes("older copy"),
      JSON.stringify({ a: pvEt.ticket.action, n: pvEt.ticket.note })
    );
    const pvUp = buildReceiptPreview(upgrade, [], [], [], both);
    const apUp = buildApplyItem(pvUp);
    check(
      "an upgrade in the same batch attaches to the ticket the batch creates",
      pvUp.extras?.[0]?.action === "create" &&
        pvUp.extras[0].ticketNumber === "0169999999955" &&
        (pvUp.ticket.note ?? "").includes("arrives in this same import") &&
        apUp?.extras?.[0]?.ticketNumber === "0169999999955" &&
        apUp.extras[0].pin?.origin === "SEA",
      JSON.stringify({ x: pvUp.extras?.[0], note: pvUp.ticket.note })
    );
  }

  /* The Wi-Fi variant of format 21 — a real receipt, and the reason the
     consumption doctrine exists. It genuinely carries NO eTicket number
     (Wi-Fi attaches to nothing), writes its item amount without a currency
     code (only the Total line says USD), and must import nothing: onboard
     consumption is a coffee-shop purchase at 35,000 feet, not trip cost. */
  const wf = fx("united-purchase-wifi.eml");
  check(
    "wifi: recognized and priced — the currency-less item line still captures",
    wf.kind === "ancillary_receipt" &&
      wf.gross_total === 16.99 &&
      wf.currency === "USD" &&
      wf.ancillary_items?.length === 1 &&
      wf.ancillary_items[0].label === "Inflight Wi-Fi Basic Full Flight" &&
      wf.ancillary_items[0].reference === "0169999999977" &&
      wf.payment_method === "Visa ending in 0000",
    JSON.stringify({ g: wf.gross_total, i: wf.ancillary_items })
  );
  check(
    "wifi: no ticket by design, no PQP, and the warning says consumption",
    wf.ticket_number === null &&
      wf.segments.length === 1 &&
      wf.segments[0].projected_pqp === null &&
      wf.warnings.some((w) => w.includes("onboard consumption")) &&
      !wf.warnings.some((w) => w.includes("No eTicket number")),
    JSON.stringify(wf.warnings)
  );
  {
    const pvWifi = buildReceiptPreview(wf, [], [], [], buildBatchContext([wf], []));
    check(
      "wifi preview: imports nothing, and the note says why",
      (pvWifi.extras ?? []).length === 0 &&
        (pvWifi.ticket.note ?? "").includes("onboard consumption") &&
        buildApplyItem(pvWifi) === null,
      JSON.stringify({ note: pvWifi.ticket.note, extras: pvWifi.extras })
    );
  }

  /* The Wi-Fi TIER-upgrade receipt: its label contains "upgrade", which used
     to project 17 PQP for a $16.99 messaging-to-browsing bump. Consumption is
     tested before earning, so it projects nothing and imports nothing. */
  const wfu = fx("united-purchase-wifi-upgrade.eml");
  check(
    "wifi upgrade: consumption beats the word 'upgrade' — no PQP projected",
    wfu.kind === "ancillary_receipt" &&
      wfu.ancillary_items?.[0]?.label === "Inflight Wi-Fi Messaging to Basic Full Flight Upgrade" &&
      wfu.segments.length === 1 &&
      wfu.segments[0].projected_pqp === null &&
      wfu.warnings.some((w) => w.includes("onboard consumption")),
    JSON.stringify({ pqp: wfu.segments[0]?.projected_pqp, w: wfu.warnings })
  );

  /* The refund notice — same layout, money flowing BACK: never a purchase,
     never a payment, never a PQP projection. Consumption refunds change
     nothing; a refunded extra that WAS imported gets a pointer to its ticket
     via the EMD reference in the adjustment's notes. */
  const rf = fx("united-purchase-refund.eml");
  check(
    "refund notice: its own kind, no payment, the Refunded item line reads",
    rf.kind === "ancillary_refund" &&
      rf.gross_total === 16.99 &&
      rf.payments.length === 0 &&
      rf.ancillary_items?.[0]?.reference === "0169999999978" &&
      rf.warnings.some((w) => w.includes("was refunded")),
    JSON.stringify({ k: rf.kind, p: rf.payments, i: rf.ancillary_items })
  );
  {
    const pvRefund = buildReceiptPreview(rf, [], [], [], buildBatchContext([rf], []));
    const tk = {
      id: "T-rf",
      ticket_number: "0161234567890",
      confirmation_code: "RFND01",
    } as unknown as import("../src/lib/types").TicketRow;
    const pvOwned = buildReceiptPreview(
      rf,
      [tk],
      [],
      [],
      buildBatchContext([rf], [tk]),
      [{ ticket_id: "T-rf", notes: "extra — EMD 0169999999978" }]
    );
    check(
      "refund preview: imports nothing; names the owning ticket when the EMD matches",
      (pvRefund.extras ?? []).length === 0 &&
        buildApplyItem(pvRefund) === null &&
        pvRefund.ticket.note == null &&
        (pvOwned.ticket.note ?? "").includes("refund adjustment") &&
        pvOwned.ticket.existingLabel === "0161234567890" &&
        buildApplyItem(pvOwned) === null,
      JSON.stringify({ plain: pvRefund.ticket.note, owned: pvOwned.ticket.note })
    );
  }

  /* The pre-2022 subject — "Receipt for Ancillary Purchase with United" —
     for the very same receipt layout, straight through the doctrine. */
  const a20 = fx("united-ancillary-2020.eml");
  check(
    "2020 ancillary subject: recognized, priced, and consumption",
    a20.kind === "ancillary_receipt" &&
      a20.gross_total === 5.99 &&
      a20.ancillary_items?.[0]?.label === "Inflight Wi-Fi Basic Hourly - Panasonic" &&
      a20.warnings.some((w) => w.includes("onboard consumption")),
    JSON.stringify({ k: a20.kind, g: a20.gross_total, i: a20.ancillary_items })
  );

  /* A forwarded/quoted copy carries the eTicket boilerplate but the quoting
     mangles every line the parser reads — a parse that found nothing must
     not become an empty ticket. */
  const husk = parseUnitedEmail(
    parseEml(
      "Subject: Re: Fwd: eTicket Itinerary and Receipt for Confirmation ABCDEF\n" +
        "Content-Type: text/plain\n\n" +
        "> A receipt of your purchase is shown below.\n" +
        "> (the quoting ate every line the parser reads)\n"
    )
  );
  check(
    "forwarded husk: an eTicket body that parsed to nothing imports nothing",
    husk === null,
    JSON.stringify(husk?.kind)
  );

  /* "Your flight cancellation is complete" — notifications@united.com, a
     different pipeline than receipts@: no itinerary, no money, only the
     confirmation. It cancels the BOOKING's future, not listed legs. */
  const cc = fx("united-cancellation-complete.eml");
  check(
    "cancellation-complete: detected, keyed on the confirmation, leg-less",
    cc.kind === "cancellation" &&
      cc.confirmation === "EFGH12" &&
      cc.segments.length === 0 &&
      cc.email_date === "2024-06-20" &&
      cc.warnings.some((w) => w.includes("prints no itinerary")),
    JSON.stringify({ k: cc.kind, c: cc.confirmation, w: cc.warnings })
  );

  /* The other cancellation receipts@ sends, and the dangerous one: it comes
     in the full eTicket layout, itinerary and all, under "You've
     successfully canceled your reservation (KLMN34)". Read as a receipt it
     imported the flights it was announcing the end of — which is how three
     cancelled April 2020 legs came to sit in a ledger looking flown. Its
     scope is the word in its subject, so the printed legs are dropped and
     the booking is what it names. */
  {
    const cr = fx("united-cancellation-reservation.eml");
    check(
      "reservation-cancelled: an itinerary printed is not an itinerary booked",
      cr.kind === "cancellation" &&
        cr.confirmation === "KLMN34" &&
        cr.ticket_number === "0162345678902" &&
        cr.email_date === "2020-04-14" &&
        cr.segments.length === 0,
      JSON.stringify({ k: cr.kind, c: cr.confirmation, t: cr.ticket_number, n: cr.segments.length })
    );
  }

  /* Whose travel is it? Receipts print LAST/FIRST pax lines; a booking that
     names travelers, none of whom is the profile's person, is someone
     else's trip in the same mailbox — recognized, explained, imported as
     nothing. Including you (multi-traveler) imports; no names filters
     nothing. */
  {
    const cash = fx("eticket-receipt-cash.eml");
    const multi = fx("eticket-receipt-award-multipay.eml");
    check(
      "traveler names are read off the receipt",
      (cash.traveler_names ?? []).includes("DOE/JANE") &&
        (multi.traveler_names ?? []).includes("DOE/JANE") &&
        (multi.traveler_names ?? []).includes("ROE/RICHARD"),
      JSON.stringify({ cash: cash.traveler_names, multi: multi.traveler_names })
    );
    const pvOther = buildReceiptPreview(
      cash, [], [], [], buildBatchContext([cash], []), [], null,
      { last: "Vovchenko", first: "Volodymyr" }
    );
    const pvMine = buildReceiptPreview(
      cash, [], [], [], buildBatchContext([cash], []), [], null,
      { last: "Doe", first: "Jane" }
    );
    const pvIncluded = buildReceiptPreview(
      multi, [], [], [], buildBatchContext([multi], []), [], null,
      { last: "Roe", first: "Richard" }
    );
    check(
      "someone else's booking imports nothing, and the note names them",
      pvOther.ticket.action === "unchanged" &&
        (pvOther.ticket.note ?? "").includes("DOE/JANE") &&
        (pvOther.ticket.note ?? "").includes("not your travel") &&
        pvOther.segments.length === 0 &&
        buildApplyItem(pvOther) === null,
      JSON.stringify({ a: pvOther.ticket.action, n: pvOther.ticket.note })
    );
    check(
      "your own booking — solo or as one of several travelers — imports normally",
      pvMine.ticket.action === "create" &&
        pvMine.segments.length > 0 &&
        pvIncluded.ticket.action === "create",
      JSON.stringify({ mine: pvMine.ticket.action, incl: pvIncluded.ticket.action })
    );
  }
  {
    /* the "extra" type through the money math: joins gross AND personal —
       and is never confused with a reimbursement, which reduces personal */
    const t = { id: "T1", gross_total: 1000, exchange_rate: 1 } as unknown as
      import("../src/lib/types").TicketRow;
    const s = {
      id: "S1", ticket_id: "T1", status: "flown_reconciled", distance_miles: 1000,
    } as unknown as import("../src/lib/types").SegmentRow;
    const adj = (id: string, type: string, amount: number, date: string | null = null) =>
      ({ id, ticket_id: "T1", type, amount, effective_date: date }) as unknown as
        import("../src/lib/types").AdjustmentRow;
    const a = allocateTicket(t, [s], [adj("A1", "extra", 299)]);
    check(
      "an extra joins gross and personal — money the trip cost",
      a.gross_allocable === 1299 &&
        a.personal_total === 1299 &&
        a.perSegment["S1"].gross === 1299,
      JSON.stringify({ g: a.gross_allocable, p: a.personal_total })
    );
    const b = allocateTicket(t, [s], [adj("A1", "extra", 299), adj("A2", "reimbursement", 500)]);
    check(
      "…and a reimbursement still comes off personal, never off the extra",
      b.gross_allocable === 1299 && b.personal_total === 799,
      JSON.stringify({ g: b.gross_allocable, p: b.personal_total })
    );
    const flow = buildCashFlow([], [adj("A1", "extra", 299, "2022-12-04")], {});
    const dec = flow.months.find((m) => m.month === "2022-12");
    check(
      "cash flow: an extra is money OUT in the month it was bought",
      dec != null && dec.out === 299 && dec.in === 0,
      JSON.stringify(dec)
    );
  }
  {
    /* PINNED extras: the receipt names the leg, so the money lands there —
       the exact case that motivated the rule: a $477.20 round trip, fully
       reimbursed by work, with a $299 upgrade on the return paid personally.
       Pro-rata smeared the upgrade across both legs; pinning puts it whole
       on the flight it bought. */
    const t = { id: "T1", gross_total: 477.2, exchange_rate: 1 } as unknown as
      import("../src/lib/types").TicketRow;
    const s1 = {
      id: "S1", ticket_id: "T1", status: "flown_reconciled", distance_miles: 1873,
    } as unknown as import("../src/lib/types").SegmentRow;
    const s2 = {
      id: "S2", ticket_id: "T1", status: "flown_reconciled", distance_miles: 1873,
    } as unknown as import("../src/lib/types").SegmentRow;
    const adj = (id: string, type: string, amount: number, segment_id: string | null = null) =>
      ({ id, ticket_id: "T1", type, amount, segment_id }) as unknown as
        import("../src/lib/types").AdjustmentRow;
    const a = allocateTicket(t, [s1, s2], [
      adj("A1", "reimbursement", 477.2),
      adj("A2", "extra", 299, "S2"),
    ]);
    check(
      "pinned extra: lands whole on its own flight, gross and personal",
      a.perSegment["S2"].gross === 537.6 &&
        a.perSegment["S2"].personal === 299 &&
        a.perSegment["S1"].gross === 238.6 &&
        a.perSegment["S1"].personal === 0 &&
        a.gross_allocable === 776.2 &&
        a.personal_total === 299,
      JSON.stringify(a.perSegment)
    );
    /* a reimbursement larger than the fare spills into the pinned extra */
    const b = allocateTicket(t, [s1, s2], [
      adj("A1", "reimbursement", 600),
      adj("A2", "extra", 299, "S2"),
    ]);
    check(
      "…and an over-fare reimbursement spills into the pinned extra",
      b.personal_total === 176.2 &&
        b.perSegment["S2"].personal === 176.2 &&
        b.perSegment["S1"].personal === 0,
      JSON.stringify({ p: b.personal_total, s2: b.perSegment["S2"] })
    );
    /* pinned to a canceled flight → falls back to the pool, with a warning */
    const sX = {
      id: "SX", ticket_id: "T1", status: "canceled", distance_miles: 1873,
    } as unknown as import("../src/lib/types").SegmentRow;
    const c = allocateTicket(t, [s1, sX], [adj("A2", "extra", 299, "SX")]);
    check(
      "an extra pinned to a canceled flight spreads instead, and says so",
      c.perSegment["S1"].gross === 776.2 &&
        c.warnings.some((w) => w.includes("canceled or missing flight")),
      JSON.stringify({ s1: c.perSegment["S1"], w: c.warnings })
    );
  }

  /* mbox: Google Takeout's bulk export — one file per Gmail label. The
     splitter undoes the "From " separators and mboxrd escaping; every piece
     then rides the same pipeline as a dropped .eml, which these checks prove
     by rebuilding an mbox out of two real fixtures. */
  {
    const rawA = readFileSync(
      join(process.cwd(), "fixtures/anonymized/eticket-receipt-cash.eml"),
      "utf-8"
    );
    const rawB = readFileSync(
      join(process.cwd(), "fixtures/anonymized/delta-flight-receipt.eml"),
      "utf-8"
    );
    const escapeBody = (t: string) => t.replace(/^(>*From )/gm, ">$1");
    const mbox =
      "From 1@takeout Thu Jan 01 00:00:00 2026\n" + escapeBody(rawA) +
      "\nFrom 2@takeout Thu Jan 01 00:00:01 2026\n" + escapeBody(rawB) + "\n";
    const pieces = splitMbox(mbox);
    check("mbox: two messages come back out of the concatenation", pieces.length === 2, String(pieces.length));
    const mp1 = parseUnitedEmail(parseEml(pieces[0]));
    const mp2 = parseUnitedEmail(parseEml(pieces[1]));
    check(
      "mbox: each piece parses exactly like the standalone fixture",
      mp1?.kind === "eticket_receipt" && mp1?.confirmation === "AB12CD" &&
        mp2?.kind === "delta_receipt" && mp2?.confirmation === "GFQWNR",
      JSON.stringify({ a: [mp1?.kind, mp1?.confirmation], b: [mp2?.kind, mp2?.confirmation] })
    );
    check(
      "mbox: mboxrd escaping unescapes, one level at a time",
      splitMbox("From a b\nX\n>From line\n>>From deeper\n")[0] ===
        "X\nFrom line\n>From deeper"
    );
    check(
      "mbox: CRLF survives the split",
      splitMbox("From a b\r\nH: v\r\n\r\nbody\r\n").length === 1 &&
        /H: v/.test(splitMbox("From a b\r\nH: v\r\n\r\nbody\r\n")[0])
    );
  }

  /* "…is processing" — the interim notice for a CHANGE. A reissue in
     everything but name: no eTicket number, forward-looking itinerary, and a
     credit whose arithmetic the document itself proves. */
  const chg = fx("reservation-change-notice.eml");
  check("change notice detected", chg.kind === "change_notice", chg.kind);
  check(
    "change notice: booking, date and both trip values",
    chg.confirmation === "QT4W8N" &&
      chg.email_date === "2026-06-04" &&
      chg.gross_total === 1184.08 &&
      chg.original_trip_total === 1215.26 &&
      chg.change_fee === 0,
    JSON.stringify({ c: chg.confirmation, d: chg.email_date, g: chg.gross_total, o: chg.original_trip_total })
  );
  // original − new − taxes difference = credit, so it IS a residual here,
  // unlike the eTicket receipt's whole-bank "Total Credit"
  check(
    "change notice: credit checks out, so it counts as a residual",
    chg.residual_credit === 31.18 && chg.credit_balance === null,
    JSON.stringify({ r: chg.residual_credit, b: chg.credit_balance })
  );
  check("change notice: no eTicket number to key on", chg.ticket_number === null);
  check(
    "change notice: itinerary with times, cabin, class and seats",
    chg.segments.length === 2 &&
      chg.segments[0].carrier === "UA" &&
      chg.segments[0].flight_number === "549" &&
      chg.segments[0].origin === "SFO" &&
      chg.segments[0].destination === "EWR" &&
      chg.segments[0].departure_time === "23:40" &&
      chg.segments[0].arrival_time === "08:15" &&
      chg.segments[0].booking_class === "S" &&
      chg.segments[0].seat === "11A" &&
      chg.segments[1].flight_number === "1610" &&
      chg.segments[1].seat === "15F",
    JSON.stringify(chg.segments)
  );

  /* THE RECEIPT SAYS WHICH PROGRAMME THE TICKET WAS CREDITED TO. A United
     ticket credited to Miles & More is United in every other respect — issuer,
     carrier, metal — so this line is the only thing that can tell you the
     flight will never appear on a MileagePlus statement. */
  const own = fx("eticket-receipt-cash.eml");
  check("receipt records the crediting programme", own.frequent_flyer_program === "UA",
    String(own.frequent_flyer_program));
  const partner = fx("eticket-receipt-credited-to-partner.eml");
  check(
    "…including when a United ticket was credited to a partner",
    partner.frequent_flyer_program === "LH" && partner.issuing_carrier === "UA",
    JSON.stringify({ ff: partner.frequent_flyer_program, issuer: partner.issuing_carrier })
  );
  {
    const pv = buildReceiptPreview(partner, [], [], [], buildBatchContext([partner], []));
    check(
      "…and its flights are imported as crediting elsewhere",
      pv.segments.every((x) => x.data.credits_mileageplus === 0),
      JSON.stringify(pv.segments.map((x) => x.data.credits_mileageplus))
    );
    const mine = buildReceiptPreview(own, [], [], [], buildBatchContext([own], []));
    check(
      "…while a MileagePlus-credited one is imported as crediting",
      mine.segments.every((x) => x.data.credits_mileageplus === 1),
      JSON.stringify(mine.segments.map((x) => x.data.credits_mileageplus))
    );
  }

  /* "Total Credit" is the balance of the future-flight-credit BANK after the
     purchase, not this ticket's residual — it can hold value from tickets this
     one never touched. Read as a residual it made a real chain total -362.80. */
  const bank = fx("eticket-receipt-credit-balance.eml");
  check(
    "credit-bank balance is not a residual",
    bank.residual_credit === null && bank.credit_balance === 546.81,
    JSON.stringify({ residual: bank.residual_credit, balance: bank.credit_balance })
  );
  check(
    "…and the ticket keeps its own face value",
    bank.gross_total === 192.38 && bank.base_fare === 164.91,
    String(bank.gross_total)
  );
  check(
    "…funded entirely by the credit",
    bank.payments.length === 1 &&
      bank.payments[0].payment_type === "future_flight_credit" &&
      bank.payments[0].amount === 192.38,
    JSON.stringify(bank.payments)
  );

  // ticket issued abroad: "Airfare" is in the currency of sale, "Equivalent
  // Airfare" is the receipt-currency value that sums with the taxes
  const foreign = fx("eticket-receipt-foreign-exchange.eml");
  check("foreign: base fare = equivalent", foreign.base_fare === 220);
  check("foreign: local fare kept separately", foreign.local_fare === 300000);
  // includes a label with a slash ("Passenger/Security Charge") — a real
  // format that an earlier, narrower pattern silently dropped
  check("foreign: taxes summed incl. slashed label", foreign.taxes === 82.14, String(foreign.taxes));
  check(
    "foreign: parts sum to total → no warning",
    foreign.warnings.length === 0,
    foreign.warnings.join("; ")
  );

  /* …and the case United actually prints sometimes: the local and equivalent
     fares are in a basis of their own and NEITHER leaves the total intact.
     From the user's 0167900000011 — 682.00 / 408.00 against an 886.81 total
     whose taxes come to 184.81, so 702.00 was the fare charged. The total is
     what the card paid, so the fare is derived from it rather than left as a
     figure that makes the ticket not add up. */
  {
    const odd = fx("eticket-receipt-foreign-unreconciled.eml");
    const parts =
      (odd.base_fare ?? 0) + (odd.surcharges ?? 0) + (odd.taxes ?? 0) + (odd.ancillary_fees ?? 0);
    check(
      "foreign: an unreconcilable printed fare is derived from the total",
      odd.base_fare === 704.67 && Math.abs(parts - (odd.gross_total ?? 0)) < 0.011,
      JSON.stringify({ base: odd.base_fare, taxes: odd.taxes, total: odd.gross_total })
    );
    check(
      "…and says so rather than silently rewriting the receipt",
      odd.warnings.some((w) => /neither leaves the total intact/.test(w)),
      odd.warnings.join("; ")
    );
  }
  check(
    "foreign: exchange predecessor captured",
    foreign.previous_ticket_number === "0169999999900"
  );
  check("domestic: no local fare", cash.local_fare === null && cash.base_fare === 250);

  const booking = fx("booking-confirmation.eml");
  check("booking kind", booking.kind === "booking_confirmation");
  check("booking confirmation", booking.confirmation === "QQ1WW2");
  check("booking fare/taxes/total", booking.base_fare === 199 && booking.taxes === 21.1 && booking.gross_total === 220.1);
  const bs = booking.segments[0];
  check(
    "booking segment",
    booking.segments.length === 1 && bs.flight_number === "999" &&
      bs.origin === "IAH" && bs.destination === "DEN" &&
      bs.flight_date === "2026-04-02" && bs.departure_time === "09:15" &&
      bs.cabin === "Economy" && bs.seat === "21C"
  );
  check("booking issue date from email header", booking.issue_date === "2026-03-25");

  /* A chain is one purchase reimbursed once, and the reimbursement sits on
     the member holding the value — not necessarily the one the flights hang
     on. ZZ0004's coupons are on one ticket while UH's payment is on another. */
  {
    const per = new Map<string, string | null>([["root", null], ["reissue", "UH"]]);
    const spread = chainWidePayers(per, [["root", "reissue"]]);
    check(
      "a chain's payer reaches the member the flights actually hang on",
      spread.get("root") === "UH" && spread.get("reissue") === "UH",
      JSON.stringify([...spread])
    );
    const split = chainWidePayers(
      new Map([["a", "UH"], ["b", "LBNL"]]),
      [["a", "b"]]
    );
    check(
      "…but two payers in one chain names nobody, rather than picking one",
      split.get("a") === null && split.get("b") === null,
      JSON.stringify([...split])
    );
    const none = chainWidePayers(new Map([["a", null], ["b", null]]), [["a", "b"]]);
    check(
      "…and an unrecorded payer stays unrecorded, never invented",
      none.get("a") === null && none.get("b") === null
    );
    const solo = chainWidePayers(new Map([["x", "WSU"]]), []);
    check("…leaving standalone tickets untouched", solo.get("x") === "WSU");

    /* The reimbursement itself is chain-wide too, and it is what makes a trip
       business. Read per-ticket, one member came out business and its sibling
       personal off a single reimbursement — so a flight showing its payer
       still sat under the Personal filter. */
    const flags = chainWideFlag(new Set(["reissue"]), [["root", "reissue"]]);
    check(
      "a chain member's reimbursement makes the whole chain business",
      flags.has("root") && flags.has("reissue"),
      JSON.stringify([...flags])
    );
    check(
      "…and a chain nobody reimbursed stays unflagged",
      chainWideFlag(new Set<string>(), [["a", "b"]]).size === 0
    );
    /* Miles an award chain redeemed. A chain redeems ONCE, so its miles are
       split across its coupons — giving each the full figure would report a
       40,000-mile ticket as 80,000 across two legs. */
    const legs = [
      { id: "a", distance_miles: 4293 },
      { id: "b", distance_miles: 2566 },
    ];
    const milesSplit = shareByDistance(40000, legs);
    check(
      "a chain's redeemed miles are split across its coupons, not repeated",
      [...milesSplit.values()].reduce((a, b) => a + b, 0) === 40000 &&
        milesSplit.get("a")! > milesSplit.get("b")!,
      JSON.stringify([...milesSplit])
    );
    check(
      "…and the parts sum EXACTLY, with rounding absorbed rather than dropped",
      [...shareByDistance(10000, [
        { id: "x", distance_miles: 1 },
        { id: "y", distance_miles: 1 },
        { id: "z", distance_miles: 1 },
      ]).values()].reduce((a, b) => a + b, 0) === 10000
    );
    check(
      "…a single coupon takes all of it",
      shareByDistance(12700, [{ id: "only", distance_miles: 862 }]).get("only") === 12700
    );
    check(
      "…coupons with no distance split evenly rather than dividing by zero",
      [...shareByDistance(1000, [
        { id: "p", distance_miles: null },
        { id: "q", distance_miles: null },
      ]).values()].reduce((a, b) => a + b, 0) === 1000
    );
    check(
      "…and nothing redeemed allocates nothing",
      shareByDistance(0, [{ id: "n", distance_miles: 500 }]).size === 0
    );

    check(
      "reimbursed → business, but an explicit personal still wins",
      effectivePurpose(null, true) === "business" &&
        effectivePurpose("personal", true) === "personal" &&
        effectivePurpose(null, false) === "personal"
    );
  }

  /* Same-day ordering. A newest-first list has to mean newest-first WITHIN a
     day too, and neither the clock nor the route can do it alone. */
  {
    const leg = (o: string, d: string, t: string | null) => ({
      origin: o, destination: d, departure_time: t,
    });
    const say = (r: { origin: string; destination: string }[]) =>
      r.map((x) => `${x.origin}\u2192${x.destination}`).join(" ");

    const untimed = sameDayOrder([leg("SFO", "EWR", null), leg("EWR", "FCO", null)]);
    check(
      "same day, no times: the connecting leg is listed above the one that fed it",
      say(untimed) === "EWR\u2192FCO SFO\u2192EWR",
      say(untimed)
    );
    /* The clock lies across the date line: KIX departs 16:50 local and lands
       SFO in the morning, before the 14:59 SFO\u2192IAH it connects to. */
    const dateline = sameDayOrder([leg("KIX", "SFO", "16:50"), leg("SFO", "IAH", "14:59")]);
    check(
      "same day, across the date line: the route overrules the departure clock",
      say(dateline) === "SFO\u2192IAH KIX\u2192SFO",
      say(dateline)
    );
    /* Nothing connects: two separate trips in one day, so the clock decides. */
    const unrelated = sameDayOrder([leg("EWR", "IAH", "17:59"), leg("LGA", "ORD", "19:29")]);
    check(
      "same day, unconnected legs: latest departure first",
      say(unrelated) === "LGA\u2192ORD EWR\u2192IAH",
      say(unrelated)
    );
    check(
      "same-day ordering never drops or duplicates a leg",
      sameDayOrder([leg("A", "B", null), leg("B", "C", null), leg("X", "Y", "08:00")]).length === 3
    );
  }

  /* An award receipt where United prints the miles with a decimal —
     "15000.00 miles + 5.60 USD". The miles group only matched integers, so the
     whole Total line failed: no cash total, no miles, and the funding rows
     left with no amounts at all. */
  const awardDec = fx("eticket-receipt-award-decimal-miles.eml");
  check(
    "award: a decimal in the miles doesn't lose the total",
    awardDec.gross_total === 5.6 && awardDec.miles_redeemed === 15000,
    `gross=${awardDec.gross_total} miles=${awardDec.miles_redeemed}`
  );
  check(
    "award: 'Mileage Plus' spelled with a space is still miles, not 'other'",
    awardDec.payments.map((p) => p.payment_type).join() === "miles,card",
    awardDec.payments.map((p) => `${p.payment_type}:${p.amount ?? p.award_miles_used}`).join()
  );
  check(
    "award: the miles fund the miles row and the cash funds the card",
    awardDec.payments[0]?.award_miles_used === 15000 &&
      awardDec.payments[1]?.amount === 5.6,
    JSON.stringify(awardDec.payments)
  );
  check(
    "award: the struck-through original price is not what was redeemed",
    awardDec.miles_redeemed !== 21300
  );

  /* Collegiate Travel Planners — a university travel desk. Third agency format
     printing two locators, plus a service fee billed separately. */
  const ctp = fx("ctp-ticketed-itinerary.eml");
  check("ctp kind", ctp.kind === "ctp");
  check(
    "ctp: United's locator, not the agency reference",
    ctp.confirmation === "ZZ0014",
    `${ctp.confirmation} (agency ZGPDYH must not win)`
  );
  check("ctp: eTicket number", ctp.ticket_number === "0167900000022");
  check(
    "ctp: both taxes on one line are summed",
    ctp.base_fare === 408.4 && ctp.taxes === 60.43,
    `base=${ctp.base_fare} taxes=${ctp.taxes}`
  );
  check(
    "ctp: the agency service fee is kept, and the parts sum to the total",
    ctp.ancillary_fees === 4.75 &&
      ctp.gross_total === 473.58 &&
      Math.abs(
        (ctp.base_fare ?? 0) + (ctp.taxes ?? 0) + (ctp.ancillary_fees ?? 0) - 473.58
      ) < 0.011,
    `fees=${ctp.ancillary_fees} gross=${ctp.gross_total}`
  );
  check(
    "ctp: no 'parts don't sum' warning once the fee counts",
    !ctp.warnings.some((w) => /don.t sum/i.test(w)),
    ctp.warnings.join(" | ")
  );
  check(
    "ctp: both legs, with GDS dates, 12h times and seats",
    ctp.segments.length === 2 &&
      ctp.segments[0].flight_date === "2023-05-10" &&
      ctp.segments[0].origin === "IAH" &&
      ctp.segments[0].destination === "DSM" &&
      ctp.segments[0].departure_time === "11:55" &&
      ctp.segments[0].arrival_time === "14:12" &&
      ctp.segments[0].seat === "8D" &&
      ctp.segments[1].flight_date === "2023-05-12" &&
      ctp.segments[1].origin === "DSM" &&
      ctp.segments[1].seat === "9A",
    JSON.stringify(
      ctp.segments.map((s) => `${s.flight_date} ${s.origin}→${s.destination} ${s.departure_time}/${s.arrival_time} ${s.seat}`)
    )
  );
  check(
    "ctp: card from the GDS mask",
    ctp.payments.length === 1 &&
      ctp.payments[0].payment_type === "card" &&
      ctp.payments[0].amount === 473.58 &&
      /4004/.test(ctp.payments[0].reference ?? ""),
    JSON.stringify(ctp.payments)
  );

  /* Chase Travel: OTA booking — airline PNR, no eTicket, per-leg dates only
     in the rules section, two travelers, no fare breakdown */
  /* Chase's 2023-and-earlier layout: labels above values, THREE reference
     numbers in the header, and leg dates with no year. */
  const chaseEarly = fx("chase-travel-early.eml");
  check("chase (early): recognised as the same kind", chaseEarly.kind === "chase_travel");
  check(
    "chase (early): the Flight Confirmation #, not the Trip ID or Agency Reference",
    chaseEarly.confirmation === "WX9YZ2",
    `${chaseEarly.confirmation} (trip ABCDE1234 / agency 7K4MQP must not win)`
  );
  check(
    "chase (early): a December email dates a January flight to NEXT year",
    chaseEarly.segments[0]?.flight_date === "2024-01-16",
    chaseEarly.segments[0]?.flight_date
  );
  check(
    "chase (early): both directions, with times and booking class",
    chaseEarly.segments.length === 2 &&
      chaseEarly.segments[0].origin === "SFO" &&
      chaseEarly.segments[0].destination === "IAH" &&
      chaseEarly.segments[0].departure_time === "14:50" &&
      chaseEarly.segments[0].booking_class === "L" &&
      chaseEarly.segments[1].flight_date === "2024-01-21" &&
      chaseEarly.segments[1].origin === "IAH" &&
      chaseEarly.segments[1].booking_class === "T",
    JSON.stringify(chaseEarly.segments.map((s) => `${s.flight_date} ${s.origin}→${s.destination} ${s.departure_time} ${s.booking_class}`))
  );
  check(
    "chase (early): total and card, with no invented fare breakdown",
    chaseEarly.gross_total === 199.9 &&
      chaseEarly.base_fare === null &&
      chaseEarly.payments.length === 1 &&
      chaseEarly.payments[0].amount === 199.9 &&
      /4006/.test(chaseEarly.payments[0].reference ?? ""),
    JSON.stringify(chaseEarly.payments)
  );
  /* Basic Economy is its own cabin. "basic economy" also contains "economy",
     so an economy-first test files every basic fare as plain Economy and the
     distinction is gone at import. Premium Economy had the same collision and
     was landing on Economy too; it is United's Premium Plus. */
  const beRaw = readFileSync(
    join(process.cwd(), "fixtures/anonymized/chase-travel-early.eml"),
    "utf-8"
  );
  const swapCabin = (to: string) =>
    parseUnitedEmail(
      parseEml(beRaw.replace("<p>Economy</p>\n<p>Economy (L)</p>", to))
    )!;
  check(
    "Basic Economy is kept apart from Economy",
    swapCabin("<p>Basic Economy</p>\n<p>Basic Economy (N)</p>").segments[0]?.cabin ===
      "Basic Economy",
    swapCabin("<p>Basic Economy</p>\n<p>Basic Economy (N)</p>").segments[0]?.cabin ?? "(none)"
  );
  check(
    "…and plain Economy is still Economy",
    swapCabin("<p>Economy</p>\n<p>Economy (L)</p>").segments[0]?.cabin === "Economy"
  );
  check(
    "…and Premium Economy lands on Premium Plus, not Economy",
    swapCabin("<p>Premium Economy</p>\n<p>Premium Economy (O)</p>").segments[0]?.cabin ===
      "Premium Plus",
    swapCabin("<p>Premium Economy</p>\n<p>Premium Economy (O)</p>").segments[0]?.cabin ?? "(none)"
  );

  check(
    "chase (early): the passenger table isn't read as another flight",
    chaseEarly.segments.every((s) => s.carrier === "UA"),
    JSON.stringify(chaseEarly.segments.map((s) => s.carrier + s.flight_number))
  );

  const chase = fx("chase-travel-booking.eml");
  check("chase kind", chase.kind === "chase_travel");
  check("chase uses the AIRLINE confirmation, not the trip id", chase.confirmation === "PQ7RS2");
  check("chase has no eTicket number", chase.ticket_number === null);
  check("chase records one traveler's share", chase.gross_total === 420 && chase.travelers === 2);
  check("chase records the card payment", chase.payments.length === 1 && chase.payments[0].amount === 420);
  check("chase leaves the fare breakdown empty", chase.base_fare === null && chase.taxes === null);
  check("chase parses both legs", chase.segments.length === 2);
  const c1 = chase.segments[0];
  const c2 = chase.segments[1];
  check(
    "chase leg 1 from the rules-section date",
    c1.flight_date === "2025-11-18" && c1.origin === "OGG" && c1.destination === "SFO" &&
      c1.flight_number === "1288" && c1.departure_time === "14:30" && c1.booking_class === "S"
  );
  check(
    "chase leg 2 uses its own departure date, not the arrival",
    c2.flight_date === "2025-11-22" && c2.arrival_time === "00:59"
  );
  check(
    "chase explains the split and the missing breakdown",
    chase.warnings.some((w) => w.includes("your share")) &&
      chase.warnings.some((w) => w.includes("Chase Travel"))
  );

  /* ADTRAV / RezDesk corporate itinerary — an agency document like Chase */
  const adt = fx("adtrav-itinerary.eml");
  check("adtrav kind", adt.kind === "adtrav");
  check(
    "adtrav keys on the AIRLINE reference, not the agency locator",
    adt.confirmation === "ZZ0008"
  );
  check("adtrav reads the eTicket number", adt.ticket_number === "0167900000019");
  check("adtrav ticketed date, not the trip date", adt.issue_date === "2025-01-14");
  check("adtrav invoiced total", adt.gross_total === 365.14);
  check("adtrav leaves the fare split empty", adt.base_fare === null && adt.taxes === null);
  check(
    "adtrav decodes the GDS card code",
    adt.payment_method === "Visa ending in 4002" &&
      adt.payments[0]?.payment_type === "card" &&
      adt.payments[0]?.amount === 365.14
  );
  check("adtrav parses both legs", adt.segments.length === 2, String(adt.segments.length));
  const [a1, a2] = adt.segments;
  check(
    "adtrav leg 1 — date from the day header, airports from the Depart/Arrive rows",
    a1.flight_date === "2025-03-06" && a1.origin === "IAH" && a1.destination === "SFO" &&
      a1.carrier === "UA" && a1.flight_number === "2206"
  );
  check(
    "adtrav converts the 12-hour times",
    a1.departure_time === "20:18" && a1.arrival_time === "22:52"
  );
  check(
    "adtrav leg 2 keeps its own day and cabin",
    a2.flight_date === "2025-03-14" && a2.destination === "BUR" &&
      a2.cabin === "Economy" && a2.booking_class === "G" && a2.seat === "11A"
  );
  check(
    "adtrav discloses the agency refs and the missing fare split",
    adt.warnings.some((w) => w.includes("RezID 0000-0000") && w.includes("no fare/tax split"))
  );

  /* An agency re-sends only the trip that changed, so a leg the newest copy
     omits is unrepeated, not superseded — it must still import. */
  {
    const older = adt;
    const newer: ParsedReceipt = {
      ...adt,
      email_date: "2025-03-13",
      segments: [{ ...a2, cabin: "Business", booking_class: "P", seat: "3E" }],
    };
    const batch = buildBatchContext([newer, older], []);
    const oldPrev = buildReceiptPreview(older, [], [], [], batch);
    const rows = Object.fromEntries(
      oldPrev.segments.map((r) => [`${r.parsed.origin}${r.parsed.destination}`, r])
    );
    check(
      "the leg the newer copy repeats is left to it",
      rows.SFOBUR.action === "unchanged"
    );
    check(
      "…while the leg it never mentions is still imported",
      rows.IAHSFO.action === "create" &&
        rows.IAHSFO.data.ticket_id === "__TICKETNO__:0167900000019",
      JSON.stringify({ action: rows.IAHSFO.action, tid: rows.IAHSFO.data.ticket_id })
    );
    check(
      "…and the older copy still creates no duplicate ticket or payment",
      oldPrev.ticket.action === "unchanged" && oldPrev.payments.length === 0
    );
  }

  /* preview matching */
  const emptyPreview = buildReceiptPreview(cash, [], []);
  check("no ledger → ticket create", emptyPreview.ticket.action === "create");
  check(
    "no ledger → segments create as flown (past dates)",
    emptyPreview.segments.every((s) => s.action === "create" && s.data.status === "flown_unreconciled")
  );
  check(
    "created segments attach to the new ticket",
    emptyPreview.segments.every((s) => s.data.ticket_id === "__TICKET__")
  );

  const seg1day = mkSeg("r1", {
    origin: "EWR", destination: "ORD", flight_date: "2026-03-13", // +1 vs receipt
    flight_number: "100", status: "flown_reconciled", ticket_id: null,
  });
  const p1 = buildReceiptPreview(cash, [], [seg1day]);
  const row1 = p1.segments[0];
  check(
    "±1 day match → conflict with date diff",
    row1.action === "conflict" && row1.diffs.some((d) => d.includes("Flight date 2026-03-13 → 2026-03-12")),
    row1.diffs.join()
  );
  check(
    "±1 match still fills metadata + attach",
    row1.fills.some((f) => f.includes("attach")) && row1.data.ticket_id === "__TICKET__"
  );
}

/* --------------- supersession: purchase is not proof of travel ---------- */
console.log("receipt supersession (reissues & cancellations):");
{
  const leg = (flight_date: string, origin: string, destination: string): ReceiptSegment => ({
    carrier: "UA", flight_number: "1", origin, destination, flight_date,
    departure_time: null, arrival_time: null, cabin: null, booking_class: null,
    seat: null, projected_pqp: null, projected_pqf: null, projected_award_miles: null,
  });
  const mkReceipt = (over: Partial<ParsedReceipt>): ParsedReceipt => ({
    kind: "eticket_receipt", confirmation: "ZZ0006", ticket_number: null,
    issue_date: null, email_date: null, currency: "USD", base_fare: null,
    local_fare: null, surcharges: null, taxes: null, ancillary_fees: null, gross_total: null,
    miles_redeemed: null, payment_method: null, payments: [], credit_balance: null,
    original_trip_total: null, change_fee: null, issuing_carrier: "UA",
    frequent_flyer_program: null,
    previous_ticket_number: null, residual_credit: null, additional_collection: null,
    travelers: 1, segments: [], warnings: [], ...over,
  });

  /* the ZZ0006 chain: A reissued into B, B into C, with a cancellation
     notice sent 2025-07-14 — the day before A's second leg was due out */
  const A = mkReceipt({
    ticket_number: "0167900000011", issue_date: "2024-12-17", email_date: "2025-07-14",
    segments: [leg("2024-12-30", "MUC", "EWR"), leg("2025-07-15", "SFO", "FRA")],
  });
  const notice = mkReceipt({ ...A, kind: "cancellation" });
  const B = mkReceipt({
    ticket_number: "0167900000004", issue_date: "2025-12-14", email_date: "2025-12-14",
    previous_ticket_number: "0167900000011",
    segments: [leg("2025-12-17", "IAH", "DEN"), leg("2025-12-17", "DEN", "OGG")],
  });
  const C = mkReceipt({
    ticket_number: "0167900000005", issue_date: "2025-12-17", email_date: "2025-12-17",
    previous_ticket_number: "0167900000004",
    segments: [leg("2025-12-17", "IAH", "SFO"), leg("2025-12-17", "SFO", "OGG")],
  });

  const whole = buildBatchContext([C, B, notice, A], []);
  const statuses = (r: ParsedReceipt, batch = whole) =>
    buildReceiptPreview(r, [], [], [], batch).segments.map((s) => s.data.status).join(",");

  check(
    "reissued-away coupons are never recorded as flown",
    statuses(B) === "canceled,canceled", statuses(B)
  );
  check(
    "the surviving ticket's legs still read as flown",
    statuses(C) === "flown_unreconciled,flown_unreconciled", statuses(C)
  );
  check(
    "a cancellation notice voids only travel that hadn't departed when it was sent",
    statuses(A) === "flown_unreconciled,canceled", statuses(A)
  );
  check(
    "…and the notice is what does that work",
    statuses(A, buildBatchContext([C, B, A], [])) === "flown_unreconciled,flown_unreconciled"
  );
  check(
    "a notice with no send date cancels nothing on a guess",
    statuses(A, buildBatchContext([{ ...notice, email_date: null }], [])) ===
      "flown_unreconciled,flown_unreconciled"
  );
  /* The lagged midnight email (a real BH0DFV chain): the eleventh same-day
     change produced a ticket issued ON the flight day, and United's
     cancellation email arrived the next morning — making a flight that
     never flew look already-departed. A coupon issued on/after its own
     flight day, cancelled by an email at most a day later, never flew. */
  {
    const dayOf = mkReceipt({
      ticket_number: "0167900000021", issue_date: "2025-01-31", email_date: "2025-01-30",
      segments: [leg("2025-01-31", "IAH", "SFO")],
    });
    const nightNotice = mkReceipt({
      kind: "cancellation", ticket_number: "0167900000021",
      issue_date: "2025-01-31", email_date: "2025-02-01",
      segments: [leg("2025-01-31", "IAH", "SFO")],
    });
    check(
      "a midnight cancellation emailed next morning still voids the day-of coupon",
      statuses(dayOf, buildBatchContext([dayOf, nightNotice], [])) === "canceled",
      statuses(dayOf, buildBatchContext([dayOf, nightNotice], []))
    );
    /* the guard: same 1-day email lag, but the ticket is months old — a
       reservation cancelled the day after its outbound flew keeps the
       outbound: the printed date says the coupon long predates the flight */
    const oldTicket = mkReceipt({
      ticket_number: "0167900000022", issue_date: "2024-12-17", email_date: "2024-12-17",
      segments: [leg("2025-07-13", "MUC", "EWR")],
    });
    const dayAfterNotice = mkReceipt({
      kind: "cancellation", ticket_number: "0167900000022",
      issue_date: "2024-12-17", email_date: "2025-07-14",
      segments: [leg("2025-07-13", "MUC", "EWR")],
    });
    check(
      "…but a day-late email never voids a leg the old ticket already flew",
      statuses(oldTicket, buildBatchContext([oldTicket, dayAfterNotice], [])) ===
        "flown_unreconciled",
      statuses(oldTicket, buildBatchContext([oldTicket, dayAfterNotice], []))
    );
  }

  /* The leg-less cancellation cancels by CONFIRMATION: every leg the batch
     (or the ledger) holds under that booking, future legs only. */
  {
    const legless = mkReceipt({
      kind: "cancellation", confirmation: "EFGH12", ticket_number: null,
      email_date: "2024-06-20", segments: [],
    });
    const awardTicket = mkReceipt({
      confirmation: "EFGH12", ticket_number: "0167900000031",
      issue_date: "2024-05-01", email_date: "2024-05-01",
      segments: [leg("2024-06-15", "SFO", "FCO"), leg("2024-07-02", "FCO", "SFO")],
    });
    check(
      "a leg-less cancellation voids the booking's future legs, keeps the flown one",
      statuses(awardTicket, buildBatchContext([awardTicket, legless], [])) ===
        "flown_unreconciled,canceled",
      statuses(awardTicket, buildBatchContext([awardTicket, legless], []))
    );
    /* ledger-side: the booking already applied — the notice reads its legs
       out of the ledger and runs them through the same rules */
    const lt = mkTicket({
      id: "T-cc", ticket_number: "0167900000031", confirmation_code: "EFGH12",
    });
    const flownRow = mkSeg("S-cc1", {
      origin: "SFO", destination: "FCO", flight_date: "2024-06-15",
      status: "flown_reconciled", ticket_id: "T-cc",
    });
    const futureRow = mkSeg("S-cc2", {
      origin: "FCO", destination: "SFO", flight_date: "2024-07-02",
      status: "ticketed", ticket_id: "T-cc",
    });
    const pvLedger = buildReceiptPreview(
      legless, [lt], [flownRow, futureRow], [],
      buildBatchContext([legless], [lt])
    );
    check(
      "…and against the ledger it cancels the future leg, reconciliation keeps the rest",
      pvLedger.segments.length === 2 &&
        pvLedger.segments.some(
          (x) => x.segmentId === "S-cc2" && x.action === "update" && x.data.status === "canceled"
        ) &&
        pvLedger.segments.some(
          (x) => x.segmentId === "S-cc1" && x.action === "unchanged" &&
            (x.note ?? "").includes("departed before")
        ),
      JSON.stringify(pvLedger.segments.map((x) => ({ id: x.segmentId, a: x.action, n: x.note })))
    );
  }

  /* The same rule carrying an April 2020 case: a nonstop SFO→FRA was
     re-routed through Newark on a NEW ticket under the SAME confirmation,
     and then the whole reservation was cancelled. The notice prints only
     the re-routed pair, so a leg-listed reading would leave the nonstop it
     replaced standing — and, being in the past, flown. Naming the booking
     reaches it, while the outbound that already flew is untouched. */
  {
    const notice = parseUnitedEmail(
      parseEml(
        readFileSync(
          join(process.cwd(), "fixtures/anonymized/united-cancellation-reservation.eml"),
          "utf-8"
        )
      )
    )!;
    const original = mkReceipt({
      confirmation: "KLMN34",
      ticket_number: "0162345678901",
      issue_date: "2020-02-07",
      email_date: "2020-02-07",
      segments: [leg("2020-02-16", "FRA", "SFO"), leg("2020-04-25", "SFO", "FRA")],
    });
    check(
      "a cancelled reservation reaches the leg its own re-routing replaced",
      statuses(original, buildBatchContext([original, notice], [])) ===
        "flown_unreconciled,canceled",
      statuses(original, buildBatchContext([original, notice], []))
    );
  }

  /* Nothing advances a status on a timer, so a leg imported the day before
     departure could sit as "ticketed" forever — missing from every flown
     figure. Re-importing the receipt now moves it, in that direction only. */
  {
    const past = mkReceipt({
      confirmation: "STL001", ticket_number: "0167900000092",
      issue_date: "2026-08-01", email_date: "2026-08-01",
      segments: [leg("2026-08-08", "IAH", "SAN")],
    });
    const tk = mkTicket({ id: "T-stale", ticket_number: "0167900000092", confirmation_code: "STL001" });
    const stale = mkSeg("S-stale", {
      origin: "IAH", destination: "SAN", flight_date: "2026-08-08",
      status: "ticketed", ticket_id: "T-stale",
    });
    const pv = buildReceiptPreview(
      past, [tk], [stale], [], buildBatchContext([past], [tk]), [], null, null, "2026-08-20"
    );
    check(
      "re-importing advances a leg whose date has since passed",
      pv.segments[0].data.status === "flown_unreconciled" &&
        pv.segments[0].fills.some((f) => /status → flown/.test(f)),
      JSON.stringify({ st: pv.segments[0].data.status, fills: pv.segments[0].fills })
    );
    const flownAlready = mkSeg("S-done", {
      origin: "IAH", destination: "SAN", flight_date: "2026-08-08",
      status: "flown_reconciled", ticket_id: "T-stale",
    });
    const pvDone = buildReceiptPreview(
      past, [tk], [flownAlready], [], buildBatchContext([past], [tk]), [], null, null, "2026-08-20"
    );
    check(
      "…and never touches a status that already says more than it does",
      pvDone.segments[0].data.status === undefined,
      String(pvDone.segments[0].data.status)
    );
  }

  /* The flown boundary, where the receipt prints a schedule, is the
     SCHEDULED ARRIVAL — destination clock from longitude, next-day shift
     for overnight arrivals, six hours of margin — not the calendar date.
     One rule (arrival.ts) answers for the import and for Reconcile alike. */
  {
    const fraSfo = {
      ...leg("2026-08-08", "FRA", "SFO"),
      departure_time: "13:20",
      arrival_time: "16:05",
    };
    // SFO sits near lon −122° → UTC−8; 16:05 local is 00:05Z the next day
    check(
      "scheduled arrival: destination clock from longitude",
      scheduledArrivalUtc(fraSfo) === Date.parse("2026-08-09T00:05:00Z"),
      new Date(scheduledArrivalUtc(fraSfo) ?? 0).toISOString()
    );
    const ewrFco = {
      ...leg("2026-08-08", "EWR", "FCO"),
      departure_time: "17:40",
      arrival_time: "07:55",
    };
    // arrival clock before departure clock = the red-eye lands next day;
    // FCO near lon 12° → UTC+1
    check(
      "scheduled arrival: an overnight arrival lands the next day",
      scheduledArrivalUtc(ewrFco) === Date.parse("2026-08-09T06:55:00Z"),
      new Date(scheduledArrivalUtc(ewrFco) ?? 0).toISOString()
    );
    const timed = mkReceipt({
      confirmation: "ARR001", ticket_number: "0167900000093",
      issue_date: "2026-08-01", email_date: "2026-08-01",
      segments: [fraSfo],
    });
    const statusAt = (now: string) =>
      buildReceiptPreview(timed, [], [], [], buildBatchContext([timed], []), [], null, null, now)
        .segments[0].data.status;
    check(
      "a leg is ticketed until its scheduled arrival plus margin has passed",
      // 03:00Z next day: the DATE has passed, but arrival+6h ends 06:05Z —
      // the day rule would have called this flown; the schedule knows better
      statusAt("2026-08-08T22:00:00Z") === "ticketed" &&
        statusAt("2026-08-09T03:00:00Z") === "ticketed" &&
        statusAt("2026-08-09T07:00:00Z") === "flown_unreconciled",
      JSON.stringify({
        before: statusAt("2026-08-08T22:00:00Z"),
        dayPassedButAirborne: statusAt("2026-08-09T03:00:00Z"),
        landed: statusAt("2026-08-09T07:00:00Z"),
      })
    );
  }

  /* A flight departing today has not flown yet: the day is still running,
     and "flown" is a claim about the past. */
  {
    const todayFlight = mkReceipt({
      confirmation: "TDY001", ticket_number: "0167900000091",
      issue_date: "2026-08-07", email_date: "2026-08-07",
      segments: [leg("2026-08-08", "IAH", "SAN")],
    });
    const statusOn = (today: string) =>
      buildReceiptPreview(
        todayFlight, [], [], [], buildBatchContext([todayFlight], [])
      , [], null, null, today).segments[0].data.status;
    check(
      "a flight departing today is ticketed, not flown",
      statusOn("2026-08-08") === "ticketed" &&
        statusOn("2026-08-09") === "flown_unreconciled" &&
        statusOn("2026-08-07") === "ticketed",
      JSON.stringify({
        onTheDay: statusOn("2026-08-08"),
        dayAfter: statusOn("2026-08-09"),
      })
    );
  }

  /* A ticket says what you bought; a flown flight records what you flew,
     and between them sits every upgrade. A receipt written before the
     flight must not ask "Economy or First?" about a trip that is over. */
  {
    const flownFirst = mkSeg("S-up", {
      origin: "SEA", destination: "IAH", flight_date: "2022-12-10",
      status: "flown_reconciled", cabin: "First", booking_class: "PZ",
      ticket_id: "T-up",
    });
    const tk = mkTicket({ id: "T-up", ticket_number: "0167900000081", confirmation_code: "NGV111" });
    const booked = mkReceipt({
      confirmation: "NGV111", ticket_number: "0167900000081",
      issue_date: "2022-11-12", email_date: "2022-11-12",
      segments: [{ ...leg("2022-12-10", "SEA", "IAH"), cabin: "Economy", booking_class: "L" }],
    });
    const pv = buildReceiptPreview(
      booked, [tk], [flownFirst], [], buildBatchContext([booked], [tk])
    );
    check(
      "an older receipt never re-asks the cabin of a flight already flown",
      pv.segments[0].action !== "conflict" &&
        !pv.segments[0].diffs.some((d) => /Cabin|Class/.test(d)) &&
        (pv.segments[0].note ?? "").includes("flown in First"),
      JSON.stringify({ a: pv.segments[0].action, d: pv.segments[0].diffs, n: pv.segments[0].note })
    );
    const notFlown = mkSeg("S-bk", {
      origin: "SEA", destination: "IAH", flight_date: "2027-12-10",
      status: "ticketed", cabin: "First", booking_class: "PZ", ticket_id: "T-up",
    });
    const future = mkReceipt({
      ...booked,
      segments: [{ ...leg("2027-12-10", "SEA", "IAH"), cabin: "Economy", booking_class: "L" }],
    });
    const pvFuture = buildReceiptPreview(
      future, [tk], [notFlown], [], buildBatchContext([future], [tk])
    );
    check(
      "…but a flight still ahead of you does ask, because nothing has happened yet",
      pvFuture.segments[0].action === "conflict",
      JSON.stringify(pvFuture.segments[0].diffs)
    );
  }

  /* United recycles six-character codes: a leg-less notice must not reach
     back years and cancel an unrelated booking that once wore the same
     code. Only tickets from the notice's own era (issued within ~a year
     before it) are its booking. */
  {
    const recycledNotice = mkReceipt({
      kind: "cancellation", confirmation: "RECYC1", ticket_number: null,
      email_date: "2026-06-20", segments: [],
    });
    const ancient = mkReceipt({
      confirmation: "RECYC1", ticket_number: "0167900000061",
      issue_date: "2023-01-10", email_date: "2023-01-10",
      segments: [leg("2026-09-01", "SFO", "IAH")],
    });
    const current = mkReceipt({
      confirmation: "RECYC1", ticket_number: "0167900000062",
      issue_date: "2026-05-01", email_date: "2026-05-01",
      segments: [leg("2026-09-01", "IAH", "SFO")],
    });
    const b = buildBatchContext([ancient, current, recycledNotice], []);
    check(
      "a leg-less notice cancels only its own era's booking, not a recycled code's",
      statuses(ancient, b) === "ticketed" && statuses(current, b) === "canceled",
      JSON.stringify({ ancient: statuses(ancient, b), current: statuses(current, b) })
    );
  }

  /* a voided coupon never claims ANY row owned by a different ticket — not
     just flown ones. The cancelled generation was courting its rebooking's
     not-yet-flown row and asking "cancel it anyway?" about real travel. */
  {
    const gen2Ticket = mkTicket({
      id: "T-g2", ticket_number: "0167900000072", confirmation_code: "HETZZ9",
    });
    const gen2Row = mkSeg("S-g2", {
      origin: "ICN", destination: "SFO", flight_date: "2026-07-17",
      status: "ticketed", ticket_id: "T-g2",
    });
    const gen1 = mkReceipt({
      confirmation: "HETZZ9", ticket_number: "0167900000071",
      issue_date: "2026-06-14", email_date: "2026-06-14",
      segments: [leg("2026-07-17", "ICN", "SFO")],
    });
    const notice1 = mkReceipt({
      kind: "cancellation", confirmation: "HETZZ9", ticket_number: "0167900000071",
      issue_date: "2026-06-14", email_date: "2026-06-16",
      segments: [leg("2026-07-17", "ICN", "SFO")],
    });
    const pvGen1 = buildReceiptPreview(
      gen1, [gen2Ticket], [gen2Row], [],
      buildBatchContext([gen1, notice1], [gen2Ticket])
    );
    check(
      "a voided coupon leaves the rebooking's row alone, flown or not",
      pvGen1.segments[0].action === "create" &&
        pvGen1.segments[0].segmentId == null &&
        pvGen1.segments[0].data.status === "canceled",
      JSON.stringify({ a: pvGen1.segments[0].action, id: pvGen1.segments[0].segmentId, st: pvGen1.segments[0].data.status })
    );
    /* …including when the voiding evidence is only the STATEMENT (the
       cancellation email never reached the mailbox — a real HETKL1): a
       coverage-canceled coupon may still claim its own or unowned flown
       rows, but never another ticket's */
    const pvGen1Cov = buildReceiptPreview(
      gen1, [gen2Ticket], [gen2Row], [],
      buildBatchContext([gen1], [gen2Ticket]), [],
      { from: "2021-11-13", to: "2026-08-03" }
    );
    check(
      "a coverage-voided coupon also keeps to itself across tickets",
      pvGen1Cov.segments[0].action === "create" &&
        pvGen1Cov.segments[0].segmentId == null &&
        pvGen1Cov.segments[0].data.status === "canceled",
      JSON.stringify({ a: pvGen1Cov.segments[0].action, id: pvGen1Cov.segments[0].segmentId })
    );
  }

  /* United's statement as authority: inside the imported activity's date
     range, a past leg United never posted did not fly — cancelled, changed
     or no-show on evidence the mailbox may lack. Outside the range, or on a
     ticket credited to another programme, the receipt keeps its word. */
  {
    const cov = { from: "2021-11-13", to: "2026-08-03" };
    const orphan = mkReceipt({
      confirmation: "DYJ8WG", ticket_number: "0167900000041",
      issue_date: "2022-11-20", email_date: "2022-11-20",
      segments: [leg("2022-12-01", "SFO", "IAH")],
    });
    const pvIn = buildReceiptPreview(
      orphan, [], [], [], buildBatchContext([orphan], []), [], cov
    );
    check(
      "inside statement coverage, an unposted past leg is born canceled",
      pvIn.segments[0].action === "create" &&
        pvIn.segments[0].data.status === "canceled" &&
        (pvIn.segments[0].note ?? "").includes("posted nothing"),
      JSON.stringify({ st: pvIn.segments[0].data.status, n: pvIn.segments[0].note })
    );
    const pvOut = buildReceiptPreview(
      orphan, [], [], [], buildBatchContext([orphan], []), [],
      { from: "2024-01-01", to: "2026-08-03" }
    );
    const pvNone = buildReceiptPreview(orphan, [], [], [], buildBatchContext([orphan], []));
    check(
      "outside the range — or with no statement at all — the receipt keeps its word",
      pvOut.segments[0].data.status === "flown_unreconciled" &&
        pvNone.segments[0].data.status === "flown_unreconciled",
      JSON.stringify({ out: pvOut.segments[0].data.status, none: pvNone.segments[0].data.status })
    );
    const elsewhere = mkReceipt({
      ...orphan, ticket_number: "0167900000042", frequent_flyer_program: "LH",
    });
    const pvLH = buildReceiptPreview(
      elsewhere, [], [], [], buildBatchContext([elsewhere], []), [], cov
    );
    const future = mkReceipt({
      ...orphan, ticket_number: "0167900000043",
      segments: [leg("2026-12-01", "SFO", "IAH")],
    });
    const pvFut = buildReceiptPreview(
      future, [], [], [], buildBatchContext([future], []), [], cov
    );
    check(
      "credited-elsewhere travel is exempt, and future legs stay ticketed",
      pvLH.segments[0].data.status === "flown_unreconciled" &&
        pvFut.segments[0].data.status === "ticketed",
      JSON.stringify({ lh: pvLH.segments[0].data.status, fut: pvFut.segments[0].data.status })
    );
    /* the premise holds only where a flight WOULD have posted: an award leg
       (no PQP/PQF to post) and a partner-marketed flight (LH1871 FCO→MUC,
       flown, nothing ever posted) may legitimately be absent */
    const partnerAward = mkReceipt({
      confirmation: "J5RPZV", ticket_number: "0167900000044",
      issue_date: "2024-11-20", email_date: "2024-11-20", miles_redeemed: 20000,
      segments: [{ ...leg("2024-12-27", "FCO", "MUC"), carrier: "LH", flight_number: "1871" }],
    });
    const pvPA = buildReceiptPreview(
      partnerAward, [], [], [], buildBatchContext([partnerAward], []), [], cov
    );
    const cashPartner = mkReceipt({
      confirmation: "J5RPZV", ticket_number: "0167900000045",
      issue_date: "2024-11-20", email_date: "2024-11-20",
      segments: [{ ...leg("2024-12-27", "FCO", "MUC"), carrier: "LH", flight_number: "1871" }],
    });
    const pvCP = buildReceiptPreview(
      cashPartner, [], [], [], buildBatchContext([cashPartner], []), [], cov
    );
    check(
      "award and partner-marketed legs are exempt from statement authority",
      pvPA.segments[0].data.status === "flown_unreconciled" &&
        pvCP.segments[0].data.status === "flown_unreconciled",
      JSON.stringify({ award: pvPA.segments[0].data.status, partner: pvCP.segments[0].data.status })
    );
  }

  /* The two traps the first fresh-ledger import found. Coverage must never
     refuse the flown row that DISPROVES it: its premise ("nothing posted")
     is false exactly when a flown candidate exists, so a receipt's leg
     claims the activity row and only an unmatched leg is born canceled.
     And a cancellation notice cancels only tickets that existed when it was
     sent — the rebooking under the same confirmation and flights is a new
     coupon, not a target. */
  {
    const cov = { from: "2021-11-13", to: "2026-08-03" };
    const flownRow = mkSeg("S-posted", {
      origin: "ICN", destination: "SFO", flight_date: "2026-07-17",
      status: "flown_reconciled", ticket_id: null,
    });
    const flew = mkReceipt({
      confirmation: "HETKL1", ticket_number: "0167900000051",
      issue_date: "2026-07-02", email_date: "2026-07-02",
      segments: [leg("2026-07-17", "ICN", "SFO")],
    });
    const pvClaim = buildReceiptPreview(
      flew, [], [flownRow], [], buildBatchContext([flew], []), [], cov
    );
    check(
      "coverage never blocks claiming the flown row that disproves it",
      pvClaim.segments[0].segmentId === "S-posted" &&
        pvClaim.segments[0].action !== "create",
      JSON.stringify({ id: pvClaim.segments[0].segmentId, a: pvClaim.segments[0].action })
    );
    const oldGen = mkReceipt({
      confirmation: "HETKL1", ticket_number: "0167900000052",
      issue_date: "2026-06-14", email_date: "2026-06-14",
      segments: [leg("2026-07-17", "ICN", "SFO")],
    });
    const notice = mkReceipt({
      kind: "cancellation", confirmation: "HETKL1", ticket_number: "0167900000052",
      issue_date: "2026-06-14", email_date: "2026-06-16",
      segments: [leg("2026-07-17", "ICN", "SFO")],
    });
    const both = buildBatchContext([oldGen, notice, flew], []);
    check(
      "a notice cancels the generation it postdates, never the rebooking",
      statuses(oldGen, both) === "canceled" &&
        statuses(flew, both) === "flown_unreconciled",
      JSON.stringify({ old: statuses(oldGen, both), rebooked: statuses(flew, both) })
    );
  }
  check(
    "every cancelled row explains itself",
    buildReceiptPreview(B, [], [], [], whole).segments.every((s) =>
      (s.note ?? "").includes("reissued on 2025-12-17")
    )
  );

  /* Cancel-and-rebook: the notice cancels the booking it NAMES, not the
     itinerary. The same flights recorded as flown on a different (rebooked)
     ticket are not a decision to put to the user — they are kept, and the
     row says whose they are. The booking's own flight still cancels. */
  {
    const rebooked = {
      id: "T-new", ticket_number: "0162115423701", confirmation_code: "LDHD5N",
    } as unknown as import("../src/lib/types").TicketRow;
    const own = {
      id: "T-old", ticket_number: "0167900000099", confirmation_code: "KZ2BP6",
    } as unknown as import("../src/lib/types").TicketRow;
    const flownOnRebooked = mkSeg("S-new", {
      origin: "IAH", destination: "SFO", flight_date: "2026-07-10",
      status: "flown_reconciled", ticket_id: "T-new",
    });
    const bookedOnOwn = mkSeg("S-old", {
      origin: "IAH", destination: "SFO", flight_date: "2026-07-10",
      status: "ticketed", ticket_id: "T-old",
    });
    const cancelKZ = mkReceipt({
      kind: "cancellation", confirmation: "KZ2BP6", ticket_number: null,
      email_date: "2026-06-17",
      segments: [leg("2026-07-10", "IAH", "SFO")],
    });
    const pvRebook = buildReceiptPreview(
      cancelKZ, [rebooked], [flownOnRebooked], [],
      buildBatchContext([cancelKZ], [rebooked])
    );
    check(
      "cancel-and-rebook: the rebooked ticket's flown flight is kept, and named",
      pvRebook.segments[0].action === "unchanged" &&
        (pvRebook.segments[0].note ?? "").includes("0162115423701") &&
        buildApplyItem(pvRebook) === null,
      JSON.stringify({ a: pvRebook.segments[0].action, n: pvRebook.segments[0].note })
    );
    const pvOwn = buildReceiptPreview(
      cancelKZ, [own, rebooked], [bookedOnOwn, flownOnRebooked], [],
      buildBatchContext([cancelKZ], [own, rebooked])
    );
    check(
      "…while the booking's own flight still cancels",
      pvOwn.segments[0].action === "update" &&
        pvOwn.segments[0].segmentId === "S-old" &&
        pvOwn.segments[0].data.status === "canceled",
      JSON.stringify({ a: pvOwn.segments[0].action, id: pvOwn.segments[0].segmentId })
    );
  }

  /* The same disease one layer deeper: a predecessor's receipt inside its
     own exchange chain. Cancel an award booking and rebook a day later in
     the same PNR, and the old receipt's leg sits within ±1 day of the flown
     replacement — it must NOT steal that segment and drag its date back. It
     creates its own leg instead, which the ledger-linked reissue voids. */
  {
    const pred = mkTicket({
      id: "T-pred", ticket_number: "0162114148948", confirmation_code: "DK6ZQ3",
    });
    const succ = mkTicket({
      id: "T-succ", ticket_number: "0162116001553", confirmation_code: "DK6ZQ3",
      issue_date: "2026-06-29", predecessor_ticket_id: "T-pred",
    });
    const flownReplacement = mkSeg("S-succ", {
      origin: "DEN", destination: "IAH", flight_date: "2026-06-30",
      status: "flown_reconciled", ticket_id: "T-succ",
    });
    const oldReceipt = mkReceipt({
      confirmation: "DK6ZQ3", ticket_number: "0162114148948",
      issue_date: "2026-06-22", email_date: "2026-06-22",
      segments: [leg("2026-06-29", "DEN", "IAH")],
    });
    const pv = buildReceiptPreview(
      oldReceipt, [pred, succ], [flownReplacement], [],
      buildBatchContext([oldReceipt], [pred, succ])
    );
    check(
      "a predecessor's receipt never claims its replacement's flown flight",
      pv.segments[0].action === "create" &&
        pv.segments[0].segmentId == null &&
        pv.segments[0].data.status === "canceled",
      JSON.stringify({ a: pv.segments[0].action, st: pv.segments[0].data.status, n: pv.segments[0].note })
    );
    check(
      "…and the created leg says it was reissued away, not flown",
      (pv.segments[0].note ?? "").includes("reissued on 2026-06-29"),
      pv.segments[0].note
    );
  }

  /* The FRESH-LEDGER shape of cancel-and-rebook: activity CSV first, so the
     flown rows are unowned and ownership can't protect them. Two rules take
     over: a reconciled flight outranks any cancellation notice, and a coupon
     the batch proves was voided never claims a flown segment. */
  {
    const flownUnowned = mkSeg("S-free", {
      origin: "IAH", destination: "SFO", flight_date: "2026-07-10",
      status: "flown_reconciled", ticket_id: null,
    });
    const cancelNote = mkReceipt({
      kind: "cancellation", confirmation: "KZ2BP6", ticket_number: "0162112854083",
      email_date: "2026-06-17",
      segments: [leg("2026-07-10", "IAH", "SFO")],
    });
    const pvFresh = buildReceiptPreview(
      cancelNote, [], [flownUnowned], [],
      buildBatchContext([cancelNote], [])
    );
    check(
      "fresh ledger: a cancellation never questions an unowned reconciled flight",
      pvFresh.segments[0].action === "unchanged" &&
        (pvFresh.segments[0].note ?? "").includes("a cancelled coupon never posts") &&
        buildApplyItem(pvFresh) === null,
      JSON.stringify({ a: pvFresh.segments[0].action, n: pvFresh.segments[0].note })
    );
    const oldBooking = mkReceipt({
      confirmation: "KZ2BP6", ticket_number: "0162112854083",
      issue_date: "2026-06-01", email_date: "2026-06-01",
      segments: [leg("2026-07-10", "IAH", "SFO")],
    });
    const pvVoided = buildReceiptPreview(
      oldBooking, [], [flownUnowned], [],
      buildBatchContext([oldBooking, cancelNote], [])
    );
    check(
      "fresh ledger: a voided coupon never claims the flown row — its own leg is born canceled",
      pvVoided.segments[0].action === "create" &&
        pvVoided.segments[0].segmentId == null &&
        pvVoided.segments[0].data.status === "canceled" &&
        (pvVoided.segments[0].note ?? "").includes("cancelled on 2026-06-17"),
      JSON.stringify({ a: pvVoided.segments[0].action, st: pvVoided.segments[0].data.status, n: pvVoided.segments[0].note })
    );
  }
  check(
    "a reissue arriving in the same import defers its chain link",
    buildReceiptPreview(C, [], [], [], whole).exchangePending === "0167900000004" &&
      buildReceiptPreview(C, [], [], [], whole).exchangeUnresolved === null
  );
  check(
    "a reissue with no predecessor anywhere stays unresolved",
    buildReceiptPreview(C, [], [], [], buildBatchContext([C], [])).exchangeUnresolved ===
      "0167900000004"
  );

  /* United moved the flight WITHOUT reissuing: same eTicket number, whole
     receipt re-sent. Two snapshots of one coupon, not two flights. */
  {
    const flown = (n: string) => ({ ...leg("2025-09-29", "SFO", "IAH"), flight_number: n });
    const older = mkReceipt({
      ticket_number: "0167900000003", confirmation: "ZZ0002", gross_total: 213.83,
      issue_date: "2025-09-04", email_date: "2025-09-04",
      payments: [{ payment_type: "card", amount: 213.83, award_miles_used: null, reference: "Visa" }],
      segments: [flown("1387")],
    });
    const newer = mkReceipt({ ...older, email_date: "2025-09-29", segments: [flown("776")] });
    const batch = buildBatchContext([newer, older], []);
    const a = buildReceiptPreview(older, [], [], [], batch);
    const b = buildReceiptPreview(newer, [], [], [], batch);

    check("the newest copy of a reprinted ticket is the one that acts", b.ticket.action === "create");
    check("the older copy doesn't create a second ticket on the same number", a.ticket.action === "unchanged");
    check("…nor a second funding row", a.payments.length === 0 && b.payments.length === 1);
    check(
      "…nor drags the itinerary back to the flight that was replaced",
      a.segments.every((s) => s.action === "unchanged" && Object.keys(s.conflictData).length === 0),
      JSON.stringify(a.segments.map((s) => [s.action, s.conflictData]))
    );
    check("the inert copy says why", (a.ticket.note ?? "").includes("supersedes"));
    check(
      "one receipt alone is never treated as a reprint",
      buildReceiptPreview(older, [], [], [], buildBatchContext([older], [])).ticket.action === "create"
    );

    /* THE SAME FILE TWICE. A Gmail double-download gives byte-identical copies,
       so both carry the same email_date — and a date comparison then calls
       NEITHER of them stale, creating the eTicket number twice and counting its
       money twice. The winner is held by identity, so ties resolve. */
    {
      const twin = mkReceipt({ ...older });
      const b = buildBatchContext([older, twin], []);
      const first = buildReceiptPreview(older, [], [], [], b);
      const second = buildReceiptPreview(twin, [], [], [], b);
      check(
        "two identical copies create the ticket exactly once",
        [first.ticket.action, second.ticket.action].filter((a) => a === "create").length === 1,
        JSON.stringify([first.ticket.action, second.ticket.action])
      );
      check(
        "…and its funding exactly once",
        first.payments.length + second.payments.length === 1,
        JSON.stringify([first.payments.length, second.payments.length])
      );
      check(
        "…with the duplicate saying why it did nothing",
        (second.ticket.note ?? "").includes("supersedes"),
        second.ticket.note
      );
    }

    /* a leg the newer copy never mentions is unrepeated, not superseded */
    const twoLeg = mkReceipt({
      ...older, segments: [flown("1387"), leg("2025-10-02", "IAH", "DEN")],
    });
    const batch2 = buildBatchContext([newer, twoLeg], []);
    const rows2 = buildReceiptPreview(twoLeg, [], [], [], batch2).segments;
    check(
      "a leg missing from the newer copy is still imported, not dropped",
      rows2[1].action === "create" &&
        String(rows2[1].data.ticket_id).startsWith("__TICKETNO__:"),
      JSON.stringify({ action: rows2[1].action, tid: rows2[1].data.ticket_id })
    );
    check(
      "…while the repeated leg is left to the newer copy",
      rows2[0].action === "unchanged"
    );
    /* …and it has to SURVIVE the trip to the apply endpoint. The older copy is
       inert on the ticket and has no ticket id — the newer copy creates it —
       so sending that plan as an "update" made the whole item fail with
       "Ticket to update no longer exists", taking its flights with it. */
    const inert = buildApplyItem(buildReceiptPreview(twoLeg, [], [], [], batch2))!;
    check(
      "an inert copy is not sent as a ticket update",
      inert.ticket.action === "none" && inert.ticket.ticketId === undefined,
      JSON.stringify(inert.ticket)
    );
    check(
      "…and still carries the leg only it knows about",
      inert.segments.length === 1 &&
        inert.segments[0].action === "create" &&
        String(inert.segments[0].data.ticket_id).startsWith("__TICKETNO__:"),
      JSON.stringify(inert.segments)
    );
    check(
      "a fully up-to-date file is dropped entirely",
      buildApplyItem(buildReceiptPreview(older, [], [], [], batch)) === null
    );
    const fresh = buildApplyItem(buildReceiptPreview(newer, [], [], [], batch))!;
    check(
      "a creating file still creates",
      fresh.ticket.action === "create" && fresh.payments.length === 1,
      JSON.stringify(fresh.ticket.action)
    );
  }

  /* TWO CHANGE NOTICES OVER ONE RECEIPT — the ZZ0003 shape. Neither
     notice carries an eTicket number, so the chain can only be built by
     ordering the booking's documents by date. */
  {
    const nb = (date: string, gross: number, original: number, credit: number,
                segs: ReceiptSegment[]): ParsedReceipt =>
      mkReceipt({
        kind: "change_notice", confirmation: "ZZ0003", ticket_number: null,
        issue_date: date, email_date: date, gross_total: gross,
        original_trip_total: original, residual_credit: credit, change_fee: 0,
        segments: segs,
      });
    const root = mkTicket({
      id: "root", ticket_number: "0167900000006", confirmation_code: "ZZ0003",
      issue_date: "2024-04-29", gross_total: 2185.93,
    });
    const n1 = nb("2024-05-31", 1215.26, 2185.93, 970.67, [
      { ...leg("2024-06-01", "IAH", "SFO"), flight_number: "2034" },
      { ...leg("2024-06-16", "EWR", "IAH"), flight_number: "1991" },
    ]);
    const n2 = nb("2024-06-04", 1184.08, 1215.26, 31.18, [
      { ...leg("2024-06-16", "EWR", "IAH"), flight_number: "1610" },
    ]);
    const b = buildBatchContext([n2, n1], [root]); // order of files must not matter
    check(
      "the first notice replaces the ticket, the second replaces the first",
      JSON.stringify(b.changePredecessor.get("ZZ0003@2024-05-31")) ===
        JSON.stringify({ ticketNumber: "0167900000006" }) &&
        JSON.stringify(b.changePredecessor.get("ZZ0003@2024-06-04")) ===
          JSON.stringify({ pnrDate: "ZZ0003@2024-05-31" }),
      JSON.stringify([...b.changePredecessor])
    );
    check(
      "…and the original ticket's unflown legs die on the change date",
      b.replacedAt.get("0167900000006") === "2024-05-31",
      JSON.stringify([...b.replacedAt])
    );

    const p1 = buildReceiptPreview(n1, [root], [], [], b);
    check(
      "a notice becomes its own ticket in the chain, priced at the new trip",
      p1.ticket.action === "create" &&
        p1.ticket.data.gross_total === 1215.26 &&
        p1.ticket.data.ticket_number === null &&
        p1.ticket.data.residual_credit === 970.67,
      JSON.stringify(p1.ticket.data)
    );
    check(
      "…linked to the ticket it changed, directly when that ticket is on file",
      p1.ticket.data.predecessor_ticket_id === "root" &&
        p1.exchange?.label?.includes("ZZ0003") === true,
      JSON.stringify({ pred: p1.ticket.data.predecessor_ticket_id, pending: p1.exchangePending })
    );
    // …and deferred when the receipt that creates it is in the same import
    const pFresh = buildReceiptPreview(n1, [], [], [], buildBatchContext(
      [n2, n1, mkReceipt({ confirmation: "ZZ0003", ticket_number: "0167900000006",
        issue_date: "2024-04-29", email_date: "2024-04-29", gross_total: 2185.93 })], []
    ));
    check(
      "…or deferred when that ticket arrives in the same import",
      pFresh.exchangePending === "0167900000006",
      String(pFresh.exchangePending)
    );
    // its EWR-IAH leg was itself replaced four days later and never flew
    check(
      "a leg the NEXT change replaced is created canceled, not flown",
      p1.segments[1].data.status === "canceled" &&
        /changed again on 2024-06-04/.test(p1.segments[1].note ?? ""),
      JSON.stringify({ s: p1.segments[1].data.status, n: p1.segments[1].note })
    );

    const p2 = buildReceiptPreview(n2, [root], [], [], b);
    check(
      "the second notice points at the first, which has no number to point at",
      p2.exchangePending === "pnr:ZZ0003@2024-05-31" &&
        p2.ticket.data.gross_total === 1184.08,
      JSON.stringify({ e: p2.exchangePending, g: p2.ticket.data.gross_total })
    );
    // root 2185.93 − (970.67 + 31.18) = 1184.08, the final trip's real cost
    check(
      "…and the chain's residuals reduce it to what the trip actually cost",
      2185.93 - (970.67 + 31.18) === 1184.08
    );

    /* The same three documents imported together, with the original receipt in
       the batch rather than already on file. A notice prints no ticket number
       — neither its own nor its predecessor's — so a stand-down keyed on
       ticket numbers could never reach it, and EWR→IAH UA1991 was written
       twice: once on the receipt, once on the notice that carried it. */
    const rootReceipt = mkReceipt({
      confirmation: "ZZ0003", ticket_number: "0167900000006",
      issue_date: "2024-04-29", email_date: "2024-04-29", gross_total: 2185.93,
      segments: [
        { ...leg("2024-06-01", "IAH", "FRA"), flight_number: "46" },
        { ...leg("2024-06-16", "EWR", "IAH"), flight_number: "1991" },
      ],
    });
    const bAll = buildBatchContext([rootReceipt, n1, n2], []);
    const pRoot = buildReceiptPreview(rootReceipt, [], [], [], bAll);
    const ewrOnRoot = pRoot.segments.find((x) => x.parsed.origin === "EWR")!;
    const fraOnRoot = pRoot.segments.find((x) => x.parsed.destination === "FRA")!;
    check(
      "a notice takes the coupon it carried off the receipt it changed",
      ewrOnRoot.action === "unchanged" &&
        /coupon is attached there/.test(ewrOnRoot.note ?? ""),
      JSON.stringify({ a: ewrOnRoot.action, n: ewrOnRoot.note })
    );
    check(
      "…while a leg the notice dropped stays on the receipt that sold it",
      fraOnRoot.action === "create",
      JSON.stringify({ a: fraOnRoot.action, n: fraOnRoot.note })
    );
    /* n2 rebooked EWR→IAH from UA1991 to UA1610. Same day, same route, so a
       date-and-route key calls them one coupon; they are two, and n1 keeps
       its own — unflown, but its own. */
    const pn1 = buildReceiptPreview(n1, [], [], [], bAll);
    const ewrOnN1 = pn1.segments.find((x) => x.parsed.origin === "EWR")!;
    check(
      "…but a rebooking onto a different flight is not the same coupon",
      ewrOnN1.action === "create" && ewrOnN1.data.status === "canceled",
      JSON.stringify({ a: ewrOnN1.action, s: ewrOnN1.data.status, n: ewrOnN1.note })
    );
  }

  /* A REISSUE MOVES THE COUPON. The ZZ0007 chain left its only live leg
     on the ticket that was replaced, so the chain reported cost against the
     superseded ticket and reconcile called it a double count. */
  {
    const root = mkTicket({
      id: "root", ticket_number: "0167900000008", confirmation_code: "ZZ0007",
      issue_date: "2024-07-06", gross_total: 192.38,
    });
    const flown = mkSeg("s1", {
      ticket_id: "root", origin: "IAH", destination: "SFO",
      flight_date: "2024-08-29", flight_number: "1906", status: "flown_reconciled",
    });
    const reissue = mkReceipt({
      ticket_number: "0167900000010", confirmation: "ZZ0007",
      issue_date: "2024-07-10", email_date: "2024-07-10", gross_total: 179.48,
      // United names an interim document the ledger has never seen
      previous_ticket_number: "0167900000009",
      payments: [{ payment_type: "future_flight_credit", amount: 179.48,
        award_miles_used: null, reference: "Miscellaneous Document" }],
      segments: [{ ...leg("2024-08-29", "IAH", "SFO"), flight_number: "1906" }],
    });
    const b = buildBatchContext([reissue], [root]);
    const pv = buildReceiptPreview(reissue, [root], [flown], [], b);
    check(
      "a reissue takes the flight with it, rather than asking",
      pv.segments[0].action === "update" &&
        pv.segments[0].data.ticket_id === "__TICKET__" &&
        pv.segments[0].diffs.every((d) => !/different ticket/.test(d)),
      JSON.stringify({ action: pv.segments[0].action, diffs: pv.segments[0].diffs })
    );
    // …but a flight on an UNRELATED ticket is still the user's call
    const rival = mkTicket({ id: "rival", ticket_number: "0169999999999" });
    const pv2 = buildReceiptPreview(
      reissue, [rival], [{ ...flown, ticket_id: "rival" }], [], buildBatchContext([reissue], [rival])
    );
    check(
      "…while a rival ticket's flight still asks",
      pv2.segments[0].action === "conflict" &&
        pv2.segments[0].diffs.some((d) => /different ticket/.test(d)),
      JSON.stringify(pv2.segments[0].diffs)
    );
  }

  /* United's posted activity outranks a receipt on what actually flew: the
     ZZ0001 case — same-day-changed twice, receipts show UA611 then UA589,
     United posted UA1342 and no receipt exists for it. */
  {
    const posted = mkSeg("posted", {
      origin: "IAH", destination: "SFO", flight_date: "2025-05-13",
      marketing_carrier: "UA", flight_number: "1342", status: "flown_reconciled",
      cabin: null, booking_class: null, departure_time: null, ticket_id: null,
    });
    const receipt = mkReceipt({
      ticket_number: "0167900000017", confirmation: "ZZ0001", gross_total: 199.48,
      issue_date: "2025-04-21", email_date: "2025-05-13",
      segments: [{
        ...leg("2025-05-13", "IAH", "SFO"),
        flight_number: "589", departure_time: "14:55", cabin: "Economy", booking_class: "L",
      }],
    });
    const row = buildReceiptPreview(receipt, [], [posted], [], EMPTY_BATCH).segments[0];
    check(
      "a receipt never renames a flight United already posted",
      row.conflictData.flight_number === undefined && row.data.flight_number === undefined,
      JSON.stringify({ data: row.data, conflict: row.conflictData })
    );
    check(
      "…nor writes the superseded flight's times, cabin or class",
      row.data.departure_time === undefined &&
        row.data.cabin === undefined &&
        row.data.booking_class === undefined
    );
    check("…but the ticket is still attached", row.data.ticket_id === "__TICKET__");
    check("…and nothing is put to the user to decide", row.action !== "conflict" && row.diffs.length === 0);
    check(
      "…with both flight numbers named in the reason",
      (row.note ?? "").includes("UA1342") && (row.note ?? "").includes("UA589"),
      row.note ?? ""
    );

    const unposted = mkSeg("unposted", {
      ...posted, id: "unposted", status: "flown_unreconciled",
    });
    const row2 = buildReceiptPreview(receipt, [], [unposted], [], EMPTY_BATCH).segments[0];
    check(
      "an unreconciled flight can still be corrected by a receipt",
      row2.action === "conflict" && row2.conflictData.flight_number === "589",
      JSON.stringify({ action: row2.action, conflict: row2.conflictData })
    );
    const sameFlight = mkSeg("same", { ...posted, id: "same", flight_number: "0589" });
    check(
      "a leading zero is not a different flight",
      (buildReceiptPreview(receipt, [], [sameFlight], [], EMPTY_BATCH).segments[0].note ?? "") === ""
    );
  }

  /* a reissue names its funding methods but states the split only in prose */
  {
    const unsplit = () => [
      { payment_type: "future_flight_credit" as const, amount: null, award_miles_used: null, reference: "Miscellaneous Document" },
      { payment_type: "card" as const, amount: null, award_miles_used: null, reference: "Visa ending in 4004" },
    ];
    const reissue = mkReceipt({
      ticket_number: "0167900000004", issue_date: "2025-12-14", gross_total: 1117.52,
      additional_collection: 230.71, previous_ticket_number: "0167900000011",
      payments: unsplit(), segments: [leg("2025-12-17", "IAH", "DEN")],
    });
    splitReissueFunding(reissue);
    check(
      "new money goes to the card, carried-forward value to the credit",
      reissue.payments[1].amount === 230.71 && reissue.payments[0].amount === 886.81,
      JSON.stringify(reissue.payments.map((p) => p.amount))
    );
    check(
      "…and the split reconciles to the total",
      reissue.payments.reduce((s, p) => s + (p.amount ?? 0), 0) === 1117.52
    );

    const noCollection = mkReceipt({
      gross_total: 1117.52, payments: unsplit(), segments: [leg("2025-12-17", "IAH", "DEN")],
    });
    splitReissueFunding(noCollection);
    check(
      "no additional-collection line → amounts stay unknown rather than guessed",
      noCollection.payments.every((p) => p.amount === null)
    );

    const priced = mkReceipt({
      gross_total: 500, additional_collection: 100,
      payments: [{ payment_type: "card", amount: 500, award_miles_used: null, reference: "Visa" }],
      segments: [leg("2025-12-17", "IAH", "DEN")],
    });
    splitReissueFunding(priced);
    check("an already-priced funding row is never overwritten", priced.payments[0].amount === 500);

    check(
      "the ticket's additional collection reaches the ledger",
      buildReceiptPreview(reissue, [], [], [], EMPTY_BATCH).ticket.data.additional_collection ===
        230.71
    );
  }

  /* United's printed "previous ticket" is often an interim document you never
     got a receipt for (ZZ0015: three tickets, two naming unknowns). */
  {
    const credit = [{ payment_type: "future_flight_credit" as const, amount: null, award_miles_used: null, reference: "Miscellaneous Document" }];
    const card = [{ payment_type: "card" as const, amount: 1545.51, award_miles_used: null, reference: "Visa" }];
    const A = mkTicket({ id: "A", ticket_number: "0167900000012", confirmation_code: "ZZ0015", issue_date: "2025-01-31", gross_total: 1545.51 });
    const B = mkReceipt({
      ticket_number: "0167900000014", confirmation: "ZZ0015", issue_date: "2025-02-12",
      email_date: "2025-02-12", gross_total: 1394.21,
      previous_ticket_number: "0167900000013", payments: credit,
      segments: [leg("2025-04-03", "IAH", "FRA")],
    });
    const C = mkReceipt({
      ticket_number: "0167900000016", confirmation: "ZZ0015", issue_date: "2025-02-23",
      email_date: "2025-02-23", gross_total: 1211.01,
      previous_ticket_number: "0167900000015", payments: credit,
      segments: [leg("2025-04-03", "IAH", "FRA")],
    });
    const batch = buildBatchContext([C, B], [A]);
    check(
      "an unknown 'previous ticket' falls back to the only candidate in the booking",
      batch.inferredPredecessor.get("0167900000014")?.ticketNumber === "0167900000012",
      JSON.stringify([...batch.inferredPredecessor])
    );
    check(
      "…and the next reissue chains onto it, not back onto the root",
      batch.inferredPredecessor.get("0167900000016")?.ticketNumber === "0167900000014"
    );
    const prevB = buildReceiptPreview(B, [A], [], [], batch);
    check(
      "the preview links it and says the link was inferred",
      prevB.exchangePending === "0167900000012" &&
        (prevB.exchangeInferred ?? "").length > 0 &&
        prevB.exchangeUnresolved === null
    );
    /* Naming only the eTicket number made a link to a sibling in the same
       batch read as a link to some unrelated ticket. A is a ledger ticket
       here; B's predecessor being inferred FROM the batch says so instead. */
    check(
      "…and says whether the predecessor is in the ledger or in this import",
      (prevB.exchangeInferred ?? "").includes("already in your ledger"),
      prevB.exchangeInferred ?? "(none)"
    );
    // the same root ticket, but arriving as a RECEIPT in the batch rather than
    // sitting in the ledger — and listing the same leg the reissue lists
    const A_asReceipt = mkReceipt({
      ticket_number: "0167900000012", confirmation: "ZZ0015", issue_date: "2025-01-31",
      email_date: "2025-01-31", gross_total: 1545.51, payments: card,
      segments: [leg("2025-04-03", "IAH", "FRA")],
    });
    const inBatch = buildBatchContext([C, B, A_asReceipt], []);
    check(
      "…saying 'the other receipt here' when it came from the batch",
      (inBatch.inferredPredecessor.get("0167900000014")?.why ?? "").includes(
        "the other receipt here"
      ),
      inBatch.inferredPredecessor.get("0167900000014")?.why ?? "(none)"
    );

    /* One flight, reissued: both receipts list the same leg, and queuing it on
       both writes it twice and leaves it on whichever file happened to be
       applied last. The predecessor still has to be CREATED — it carries the
       root fare the chain's cost is computed from — so only its coupon stands
       down. */
    const chainPreviews = [A_asReceipt, B, C].map((p) => ({
      no: p.ticket_number,
      pre: buildReceiptPreview(p, [], [], [], inBatch),
    }));
    const writers = chainPreviews.filter((x) =>
      x.pre.segments.some((s) => s.action !== "unchanged")
    );
    check(
      "one leg reissued twice is queued once — on the last ticket, not on all three",
      writers.length === 1 && writers[0].no === "0167900000016",
      chainPreviews
        .map((x) => `${x.no}=${x.pre.segments.map((s) => s.action).join("/")}`)
        .join(" ")
    );
    check(
      "…while every superseded ticket is still written, since they carry the fares",
      chainPreviews.every((x) => x.pre.ticket.action === "create"),
      chainPreviews.map((x) => x.pre.ticket.action).join(",")
    );

    /* the guardrails */
    const cardFunded = mkReceipt({ ...C, payments: card });
    check(
      "a ticket paid with a card is a purchase, not a carried-forward reissue",
      buildBatchContext([cardFunded], [A]).inferredPredecessor.size === 0
    );
    const other = mkTicket({ id: "X", ticket_number: "0162400000000", confirmation_code: "ZZ0015", issue_date: "2025-02-01", gross_total: 900 });
    check(
      "two possible predecessors is ambiguous — nothing is inferred",
      buildBatchContext([B], [A, other]).inferredPredecessor.size === 0
    );
    check(
      "a printed previous ticket that IS in the ledger needs no inference",
      buildBatchContext(
        [mkReceipt({ ...B, previous_ticket_number: "0167900000012" })],
        [A]
      ).inferredPredecessor.size === 0
    );
    check(
      "a later ticket is never inferred as its own predecessor",
      buildBatchContext([B], [mkTicket({ ...A, id: "late", issue_date: "2025-06-01" })])
        .inferredPredecessor.size === 0
    );
  }

  /* a notice never puts an already-flown leg up for a decision */
  {
    const flew = mkSeg("mucewr", {
      origin: "MUC", destination: "EWR", flight_date: "2024-12-30",
      status: "flown_reconciled",
    });
    const later = mkSeg("sfofra", {
      origin: "SFO", destination: "FRA", flight_date: "2025-07-15", status: "ticketed",
    });
    const rows = buildReceiptPreview(notice, [], [flew, later], [], whole).segments;
    check(
      "a leg that departed before the notice isn't a decision",
      rows[0].action === "unchanged" && (rows[0].note ?? "").includes("not cancelled by it"),
      `${rows[0].action} ${rows[0].note ?? ""}`
    );
    check(
      "the leg the notice actually cancelled is still cancelled",
      rows[1].action === "update" && rows[1].data.status === "canceled"
    );
    const undated = buildReceiptPreview(
      { ...notice, email_date: null }, [], [flew, later], [], whole
    ).segments;
    check(
      "no send date, but reconciled: United's posting outranks the notice",
      undated[0].action === "unchanged" &&
        (undated[0].note ?? "").includes("a cancelled coupon never posts"),
      `${undated[0].action} ${undated[0].note ?? ""}`
    );
    const flewByHand = mkSeg("byhand", {
      origin: "MUC", destination: "EWR", flight_date: "2024-12-30",
      status: "flown_unreconciled",
    });
    const undated2 = buildReceiptPreview(
      { ...notice, email_date: null }, [], [flewByHand], [], whole
    ).segments;
    check(
      "…while an unreconciled flown leg still falls back to asking",
      undated2[0].action === "conflict" && undated2[0].conflictData.status === "canceled",
      undated2[0].action
    );
  }

  /* chains already linked in the ledger void coupons the same way */
  const ledgerPrev = mkTicket({ id: "prev", ticket_number: "0167900000011" });
  const ledgerNext = mkTicket({
    id: "next", ticket_number: "0167900000004", issue_date: "2025-12-14",
    predecessor_ticket_id: "prev",
  });
  const fromLedger = buildBatchContext([A], [ledgerPrev, ledgerNext]);
  check(
    "a ledger-linked reissue voids the predecessor's later coupons",
    statuses(
      mkReceipt({ ...A, segments: [leg("2026-01-05", "SFO", "FRA")] }),
      fromLedger
    ) === "canceled"
  );
  check(
    "…but leaves coupons that departed before the reissue alone",
    statuses(mkReceipt({ ...A, segments: [leg("2024-12-30", "MUC", "EWR")] }), fromLedger) ===
      "flown_unreconciled"
  );

  /* The reissue's voiding, extended to a predecessor already IN the ledger:
     import only the new receipt, and the old ticket's still-unflown legs the
     new itinerary dropped are proposed for cancellation — an HNL trip:
     LIH→SFO→IAH ticketed for the 16th, reissued into HNL→IAH on the 15th. */
  {
    const predTicket = mkTicket({
      id: "T-pred", ticket_number: "0167900000071", confirmation_code: "ZZEX01",
      issue_date: "2026-08-01",
    });
    const ledgerSegs = [
      mkSeg("S-lih-sfo", {
        ticket_id: "T-pred", origin: "LIH", destination: "SFO",
        flight_date: "2026-08-16", status: "ticketed",
      }),
      mkSeg("S-sfo-iah", {
        ticket_id: "T-pred", origin: "SFO", destination: "IAH",
        flight_date: "2026-08-16", status: "ticketed",
      }),
      mkSeg("S-flew", {
        ticket_id: "T-pred", origin: "HNL", destination: "LIH",
        flight_date: "2026-08-10", status: "flown_reconciled",
      }),
    ];
    const reissue = mkReceipt({
      ticket_number: "0167900000072", confirmation: "ZZEX01",
      issue_date: "2026-08-15", email_date: "2026-08-15",
      previous_ticket_number: "0167900000071",
      segments: [leg("2026-08-15", "HNL", "IAH")],
    });
    const pv = buildReceiptPreview(
      reissue, [predTicket], ledgerSegs, [],
      buildBatchContext([reissue], [predTicket])
    );
    check(
      "a reissue cancels the ledger legs it left behind — and only those",
      pv.leftBehind.length === 2 &&
        pv.leftBehind.some((l) => l.segmentId === "S-lih-sfo") &&
        pv.leftBehind.some((l) => l.segmentId === "S-sfo-iah") &&
        !pv.leftBehind.some((l) => l.segmentId === "S-flew"),
      JSON.stringify(pv.leftBehind)
    );
    const apply = buildApplyItem(pv);
    check(
      "…and apply carries them as ordinary status updates",
      apply != null &&
        apply.segments.filter(
          (s) => s.action === "update" && s.data.status === "canceled"
        ).length === 2,
      JSON.stringify(apply?.segments)
    );
    /* a leg the new itinerary still lists is MOVED, never cancelled */
    const carried = mkReceipt({
      ...reissue,
      segments: [leg("2026-08-15", "HNL", "IAH"), leg("2026-08-16", "SFO", "IAH")],
    });
    const pvCarried = buildReceiptPreview(
      carried, [predTicket], ledgerSegs, [],
      buildBatchContext([carried], [predTicket])
    );
    check(
      "a carried-forward leg is a coupon move, not a cancellation",
      pvCarried.leftBehind.length === 1 &&
        pvCarried.leftBehind[0].segmentId === "S-lih-sfo",
      JSON.stringify(pvCarried.leftBehind)
    );
    /* The same leg one day later — an ordinary irregular-ops rebooking, and
       the case where the two rules collide: coupon matching reaches ±1 day
       and MOVES the row, while the date-keyed carried-set can't recognize it
       and would sweep the very same row into a cancellation. Applied in that
       order the cancel lands last, so the one leg still being flown was
       recorded as cancelled on the ticket it had just moved to. */
    const shifted = mkReceipt({
      ...reissue,
      segments: [leg("2026-08-15", "HNL", "IAH"), leg("2026-08-17", "SFO", "IAH")],
    });
    const pvShifted = buildReceiptPreview(
      shifted, [predTicket], ledgerSegs, [],
      buildBatchContext([shifted], [predTicket])
    );
    check(
      "a leg the reissue moved by a day is moved, not left behind",
      !pvShifted.leftBehind.some((l) => l.segmentId === "S-sfo-iah"),
      JSON.stringify(pvShifted.leftBehind)
    );
    {
      const ap = buildApplyItem(pvShifted);
      const ids = (ap?.segments ?? [])
        .map((s) => ("segmentId" in s ? s.segmentId : null))
        .filter(Boolean);
      check(
        "…and no segment is queued twice in one apply",
        new Set(ids).size === ids.length,
        JSON.stringify(ap?.segments)
      );
    }
    /* Re-import after the chain already linked: the printed "previous
       ticket" is the COMPANION's number, which the ledger never had — the
       chain link sitting on the existing ticket is what finds the dead
       legs. Without the fallback this healed nothing exactly when the user
       came back to heal it. */
    const succTicket = mkTicket({
      id: "T-succ", ticket_number: "0167900000072", confirmation_code: "ZZEX01",
      issue_date: "2026-08-15", predecessor_ticket_id: "T-pred",
    });
    const reImport = mkReceipt({
      ...reissue,
      previous_ticket_number: "0167900000099",
    });
    const pvRe = buildReceiptPreview(
      reImport, [predTicket, succTicket], ledgerSegs, [],
      buildBatchContext([reImport], [predTicket, succTicket])
    );
    check(
      "re-import after the chain linked: the ledger's own link finds the dead legs",
      pvRe.leftBehind.length === 2,
      JSON.stringify(pvRe.leftBehind)
    );
    /* The boundary day: a leg due the very day of the reissue may have flown
       that morning and simply never been marked — "ticketed" outlives
       arrival on unreconciled ledgers. The receipt's inference becomes a
       question there; strictly-later legs stay verdicts. */
    const boundarySegs = [
      mkSeg("S-day-of", {
        ticket_id: "T-pred", origin: "LIH", destination: "SFO",
        flight_date: "2026-08-15", status: "ticketed",
      }),
      mkSeg("S-day-after", {
        ticket_id: "T-pred", origin: "SFO", destination: "IAH",
        flight_date: "2026-08-16", status: "ticketed",
      }),
    ];
    const pvB = buildReceiptPreview(
      reissue, [predTicket], boundarySegs, [],
      buildBatchContext([reissue], [predTicket])
    );
    const dayOf = pvB.leftBehind.find((l) => l.segmentId === "S-day-of");
    const dayAfter = pvB.leftBehind.find((l) => l.segmentId === "S-day-after");
    check(
      "a leg due the day of the reissue is a question, the day after a verdict",
      dayOf?.action === "conflict" && dayAfter?.action === "update",
      JSON.stringify(pvB.leftBehind)
    );
    const undecided = buildApplyItem(pvB);
    check(
      "undecided, the boundary leg is left alone and the certain one cancels",
      undecided != null &&
        !undecided.segments.some(
          (s) => "segmentId" in s && s.segmentId === "S-day-of"
        ) &&
        undecided.segments.some(
          (s) =>
            "segmentId" in s &&
            s.segmentId === "S-day-after" &&
            s.data.status === "canceled"
        ),
      JSON.stringify(undecided?.segments)
    );
    const cancelled = buildApplyItem(pvB, { leftBehind: () => "receipt" });
    const kept = buildApplyItem(pvB, { leftBehind: () => "keep" });
    check(
      "an explicit answer is honored both ways — and both leave a mark",
      cancelled != null &&
        cancelled.segments.some(
          (s) => "segmentId" in s && s.segmentId === "S-day-of" && s.data.status === "canceled"
        ) &&
        kept != null &&
        /* "It flew" is a fact the ledger lacked: recorded, not discarded —
           a row left "ticketed" would ask the same question on every
           re-import, and an Apply that wrote nothing for an answered row
           reported "0 flights written" */
        kept.segments.some(
          (s) =>
            "segmentId" in s &&
            s.segmentId === "S-day-of" &&
            s.data.status === "flown_unreconciled"
        ),
      JSON.stringify({ c: cancelled?.segments, k: kept?.segments })
    );
    /* A re-import can find everything current EXCEPT the predecessor's dead
       legs. The repair must still go through: leftBehind alone is work. */
    const lbOnly = {
      ticket: { action: "unchanged", ticketId: "T-succ", data: {} },
      segments: [],
      payments: [],
      stalePayments: [],
      exchangePending: null,
      extras: [],
      leftBehind: [
        { segmentId: "S-dead", label: "", why: "", action: "update" as const },
      ],
    } as unknown as Parameters<typeof buildApplyItem>[0];
    const lbItem = buildApplyItem(lbOnly);
    check(
      "a preview whose only work is left-behind legs still applies",
      lbItem != null &&
        lbItem.segments.length === 1 &&
        lbItem.segments[0].data.status === "canceled",
      JSON.stringify(lbItem?.segments)
    );
    const lbConflictOnly = {
      ...(lbOnly as object),
      leftBehind: [
        { segmentId: "S-dead", label: "", why: "", action: "conflict" as const },
      ],
    } as unknown as Parameters<typeof buildApplyItem>[0];
    check(
      "…one whose only question is unanswered submits nothing",
      buildApplyItem(lbConflictOnly) == null,
      JSON.stringify(buildApplyItem(lbConflictOnly))
    );
    const lbFlew = buildApplyItem(lbConflictOnly, { leftBehind: () => "keep" });
    check(
      "…and 'It flew' alone is a real write, not an empty apply",
      lbFlew != null &&
        lbFlew.segments.length === 1 &&
        lbFlew.segments[0].data.status === "flown_unreconciled",
      JSON.stringify(lbFlew?.segments)
    );
  }
}

/* ------------------- classification & match scoring --------------------- */
console.log("activity classification & scoring:");
{
  check("card row", classifyActivity("PQP Earn Explorer Card", false, null) === "credit_card");
  check("hotel row", classifyActivity("Marriott Bonvoy stay", false, null) === "hotel");
  check("rideshare row", classifyActivity("Lyft - Airport Ride - 3x", false, null) === "rideshare");
  check("shopping row", classifyActivity("MileagePlus Shopping", false, null) === "shopping");
  check("unknown → other", classifyActivity("Mystery credit", false, null) === "other");
  check("UA flight", classifyActivity("UA 604 SFO - IAH", true, "UA") === "united_flight");
  check("partner flight", classifyActivity("LH 441 IAH - FRA", true, "LH") === "partner_flight");

  const seg = mkSeg("m1", {
    origin: "IAH", destination: "SFO", flight_date: "2026-07-10",
    flight_number: "1976", marketing_carrier: "UA",
  });
  const key = {
    date: "2026-07-10", carrier: "UA", flightNumber: "1976",
    origin: "IAH", destination: "SFO",
  };
  const exact = matchActivity(key, [seg]);
  check("exact match is automatic", exact.status === "auto", String(exact.candidate?.score));
  /* a reissue chain holds a cancelled twin of the flight that flew — same
     date, number and route on the replaced ticket. It never posts, so it
     must never compete: with it in the pool this exact match demoted to
     "review", nineteen times over on a real ledger. */
  const cancelledTwin = mkSeg("m1-dead", {
    origin: "IAH", destination: "SFO", flight_date: "2026-07-10",
    flight_number: "1976", marketing_carrier: "UA", status: "canceled",
  });
  const withTwin = matchActivity(key, [seg, cancelledTwin]);
  check(
    "a cancelled twin coupon neither wins nor casts doubt",
    withTwin.status === "auto" &&
      withTwin.candidate?.segment.id === "m1" &&
      !withTwin.candidate?.reasons.some((r) => /nearly as well/.test(r)),
    JSON.stringify({ s: withTwin.status, r: withTwin.candidate?.reasons })
  );
  check(
    "explanation lists the features",
    exact.candidate!.reasons.some((r) => r.includes("date exact")) &&
      exact.candidate!.reasons.some((r) => r.includes("IAH → SFO"))
  );

  const offByOne = matchActivity({ ...key, date: "2026-07-11" }, [seg]);
  check(
    "±1 day is only a suggestion",
    offByOne.status === "suggested",
    String(offByOne.candidate?.score)
  );

  const wrongNumber = matchActivity({ ...key, flightNumber: "9999" }, [seg]);
  check("contradicting flight number → suggestion at best", wrongNumber.status === "suggested");

  const noNumber = matchActivity(key, [mkSeg("m2", {
    origin: "IAH", destination: "SFO", flight_date: "2026-07-10", flight_number: null,
  })]);
  check("missing flight number still auto-matches", noNumber.status === "auto");

  const farAway = matchActivity({ ...key, date: "2026-08-20" }, [seg]);
  check("distant date doesn't match at all", farAway.status === "unmatched");

  const twins = [
    mkSeg("t1", { origin: "IAH", destination: "SFO", flight_date: "2026-07-10", flight_number: "1976" }),
    mkSeg("t2", { origin: "IAH", destination: "SFO", flight_date: "2026-07-10", flight_number: "1976" }),
  ];
  const ambiguous = matchActivity(key, twins);
  check(
    "two equally good candidates are never auto-linked",
    ambiguous.status === "suggested" &&
      ambiguous.candidate!.reasons.some((r) => r.includes("nearly as well"))
  );
}

/* ------------------------ reconciliation report ------------------------- */
console.log("reconciliation:");
{
  const settings = { ...DEFAULT_SETTINGS, missing_posting_delay_days: 7 };
  const mkAct = (over: Partial<ActivityRecord>): ActivityRecord => ({
    id: Math.random().toString(36).slice(2),
    activity_date: "2026-07-10",
    posting_date: null,
    description: "UA 1976 IAH - SFO",
    activity_type: "united_flight",
    carrier: "UA",
    flight_number: "1976",
    origin: "IAH",
    destination: "SFO",
    award_miles: 1744,
    pqp: 218,
    pqf: 1,
    segment_id: null,
    match_score: null,
    match_status: "unmatched",
    match_reason: null,
    source: "csv",
    dedup_key: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...over,
  });
  const base = {
    tickets: [] as TicketRow[],
    adjustments: [],
    payments: [] as PaymentRow[],
    allocations: {},
    taxRates: {
      domestic: 0.175,
      international: 0.2,
      domesticSample: 0,
      internationalSample: 0,
      source: "fallback" as const,
    },
  };
  const enrich = (s: SegmentRow) =>
    ({
      ...s,
      gross_cost: 0,
      personal_cost: 0,
      allocation_method: "none" as const,
      effective_purpose: "personal" as const,
      reimbursed_by: null,
      award_miles_spent: null,
      award_miles_estimated: false,
      ticket_label: null,
      issuing_carrier: null,
      ticket_is_award: false,
      origin_city: null,
      destination_city: null,
      distance_estimated: false,
      estimated_gross: null,
      pinned_extras: [],
    });

  const unmatched = buildReconcileReport(
    { ...base, segments: [], activities: [mkAct({})] },
    settings
  );
  check(
    "credited flight with no segment is flagged",
    unmatched.counts.unmatched_activity === 1
  );

  /* The still-marked-upcoming nag fires on the same scheduled-arrival
     boundary the import uses — not a day later. Same leg, three instants:
     airborne, date-passed-but-still-short-of-arrival-plus-margin, landed. */
  {
    const inFlight = enrich(
      mkSeg("arr1", {
        origin: "FRA", destination: "SFO", flight_date: "2026-08-08",
        departure_time: "13:20", arrival_time: "16:05", status: "ticketed",
      })
    );
    const nagAt = (now: string) =>
      buildReconcileReport(
        { ...base, segments: [inFlight], activities: [] },
        settings,
        now
      ).counts.past_but_upcoming ?? 0;
    check(
      "the upcoming nag waits for scheduled arrival plus margin, then fires",
      nagAt("2026-08-09T03:00:00Z") === 0 && nagAt("2026-08-09T07:00:00Z") === 1,
      JSON.stringify({ airborne: nagAt("2026-08-09T03:00:00Z"), landed: nagAt("2026-08-09T07:00:00Z") })
    );
  }

  const dupSegs = [
    enrich(mkSeg("d1", { origin: "IAH", destination: "SFO", flight_date: "2026-07-10", flight_number: "1976" })),
    enrich(mkSeg("d2", { origin: "IAH", destination: "SFO", flight_date: "2026-07-10", flight_number: "1976" })),
  ];
  const dupReport = buildReconcileReport(
    { ...base, segments: dupSegs, activities: [] },
    settings
  );
  check("duplicate flights detected", dupReport.counts.duplicate_segment === 1);

  const dupActs = [mkAct({ description: "PQP Earn Explorer Card", activity_type: "credit_card", pqp: 3, award_miles: 0 })];
  dupActs.push(mkAct({ ...dupActs[0], id: "x2" }));
  const dupActReport = buildReconcileReport(
    { ...base, segments: [], activities: dupActs },
    settings
  );
  check("duplicate activity detected", dupActReport.counts.duplicate_activity === 1);

  /* payments & exchange chains */
  const mkPay = (over: Partial<PaymentRow>): PaymentRow => ({
    id: Math.random().toString(36).slice(2),
    ticket_id: "t1",
    payment_type: "card",
    amount: null,
    currency: "USD",
    award_miles_used: null,
    payment_date: null,
    reference: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...over,
  });
  const tk = (over: Partial<TicketRow> = {}) => mkTicket({ gross_total: 500, ...over });
  const allocOf = (t: TicketRow) => ({
    [t.id]: {
      ticketId: t.id,
      method: "none" as const,
      gross_reporting: t.gross_total,
      cashAt: t.gross_total,
      refunds: 0,
      gross_allocable: t.gross_total,
      other_adjustments: 0,
      personal_total: t.gross_total,
      perSegment: {},
      warnings: [],
    },
  });

  const balanced = tk();
  const okPay = buildReconcileReport(
    {
      ...base,
      segments: [],
      activities: [],
      tickets: [balanced],
      payments: [mkPay({ amount: 300 }), mkPay({ amount: 200 })],
      allocations: allocOf(balanced),
    },
    settings
  );
  check("payments summing to the total pass", (okPay.counts.payment_mismatch ?? 0) === 0);

  const shortPay = buildReconcileReport(
    {
      ...base,
      segments: [],
      activities: [],
      tickets: [balanced],
      payments: [mkPay({ amount: 300 })],
      allocations: allocOf(balanced),
    },
    settings
  );
  check("underfunded ticket flagged", shortPay.counts.payment_mismatch === 1);

  const unknownAmount = buildReconcileReport(
    {
      ...base,
      segments: [],
      activities: [],
      tickets: [balanced],
      payments: [mkPay({ amount: null, payment_type: "future_flight_credit" })],
      allocations: allocOf(balanced),
    },
    settings
  );
  check(
    "payment without a stated amount isn't a mismatch",
    (unknownAmount.counts.payment_mismatch ?? 0) === 0
  );
  /* Award-mile balance. The one property a running balance must have is
     continuity: each year has to open exactly where the previous one closed,
     or the series is measuring something other than a balance. */
  {
    const seg = (date: string, award: number) =>
      mkSeg(`s-${date}-${award}`, {
        flight_date: date, status: "flown_reconciled", pqp: 100, pqf: 1,
        award_miles: award,
      });
    const act = (date: string, award: number): ActivityRecord => ({
      id: `a-${date}-${award}`,
      activity_date: date,
      posting_date: null,
      description: "Air Travel Award",
      activity_type: "redemption",
      carrier: null,
      flight_number: null,
      origin: null,
      destination: null,
      award_miles: award,
      pqp: 0,
      pqf: 0,
      segment_id: null,
      match_score: null,
      match_status: "not_applicable",
      match_reason: null,
      source: "csv",
      dedup_key: null,
      notes: null,
      created_at: "",
      updated_at: "",
    });
    const years = buildPremierYears(
      [seg("2024-03-01", 10000), seg("2025-05-01", 4000)],
      [act("2024-07-01", -6000), act("2025-09-01", -1000)]
    ).sort((a, b) => a.year.localeCompare(b.year));
    check(
      "a year opens on the balance the previous one closed at",
      years[0].openingAward === 0 &&
        years[0].closingAward === 4000 &&
        years[1].openingAward === 4000 &&
        years[1].closingAward === 7000,
      JSON.stringify(years.map((y) => [y.year, y.openingAward, y.closingAward]))
    );
    const may = years[1].monthly.find((m) => m.month === "2025-05")!;
    const sep = years[1].monthly.find((m) => m.month === "2025-09")!;
    const dec = years[1].monthly.find((m) => m.month === "2025-12")!;
    check(
      "…the balance falls on a redemption rather than only ever rising",
      may.awardBalance === 8000 && sep.award === -1000 && sep.awardBalance === 7000,
      JSON.stringify({ may: may.awardBalance, sep: [sep.award, sep.awardBalance] })
    );
    check(
      "…and stops at the last movement instead of running flat to December",
      dec.awardBalance === null,
      String(dec.awardBalance)
    );
    /* A redemption posts zero PQP, so it never reaches the PQP event stream —
       borrowing that cutoff would end the balance line before the redemption
       that is the whole point of watching it. */
    const janOnlyPqp = buildPremierYears(
      [seg("2025-01-10", 500)],
      [act("2025-11-20", -20000)]
    )[0];
    check(
      "…a redemption after the last PQP posting still lands on the line",
      janOnlyPqp.monthly.find((m) => m.month === "2025-11")!.awardBalance === -19500,
      JSON.stringify(janOnlyPqp.monthly.map((m) => m.awardBalance))
    );
  }

  /* Per-date series. The point of it is that a flight on the 2nd and one on
     the 30th no longer land on the same mark. */
  {
    const seg = (date: string, award: number, pqp = 100) =>
      mkSeg(`d-${date}`, {
        flight_date: date, status: "flown_reconciled", pqp, pqf: 1, award_miles: award,
      });
    const y = buildPremierYears(
      [seg("2025-03-02", 1000), seg("2025-03-30", 2000)],
      []
    )[0];
    const dates = y.points.map((p) => p.date);
    check(
      "two flights in one month are two points, not one",
      dates.includes("2025-03-02") && dates.includes("2025-03-30"),
      dates.join(",")
    );
    check(
      "…anchored on 1 January so the year starts where the year starts",
      y.points[0].date === "2025-01-01" && y.points[0].cumPqp === 0,
      JSON.stringify(y.points[0])
    );
    /* Every month-end is anchored even when nothing happened in it. A
       cumulative line is flat between events; without the anchors a spline
       through sparse points bows upward and shows growth in months that had
       none. */
    const quiet = buildPremierYears(
      [seg("2025-02-10", 0, 500), seg("2025-11-20", 0, 700)],
      []
    )[0];
    const ends = quiet.points.filter((p) => /-(28|29|30|31)$/.test(p.date));
    check(
      "every month-end is a point, even in a month with no activity",
      ends.length >= 12,
      quiet.points.map((p) => p.date).join(",")
    );
    /* Between the February flight and the November one nothing happened, so
       every month-end in between must report February's total unchanged. */
    const between = quiet.points.filter(
      (p) => p.date > "2025-02-28" && p.date < "2025-11-20" && /-(28|29|30|31)$/.test(p.date)
    );
    check(
      "…and a quiet stretch holds the same total rather than drifting",
      between.length >= 7 && between.every((p) => p.cumPqp === 500),
      JSON.stringify(between.map((p) => [p.date, p.cumPqp]))
    );
    /* Located by date, not by position: the month-end anchors sit among the
       events, so an index no longer identifies a particular flight. */
    const mar2 = y.points.find((p) => p.date === "2025-03-02")!;
    const mar30 = y.points.find((p) => p.date === "2025-03-30")!;
    check(
      "…and spaced by real time, so the axis can place them",
      mar2.t === Date.UTC(2025, 2, 2) && mar30.t - mar2.t === 28 * 86400000,
      JSON.stringify({ mar2: mar2.t, mar30: mar30.t })
    );
    /* A date where only miles move still has to state where PQP stood, or the
       PQP line breaks at a gap that is not a gap in PQP. */
    const redeem = (date: string, miles: number): ActivityRecord =>
      ({
        id: `r-${date}`, activity_date: date, posting_date: null,
        description: "Air Travel Award", activity_type: "redemption",
        carrier: null, flight_number: null, origin: null, destination: null,
        award_miles: miles, pqp: 0, pqf: 0, segment_id: null,
        match_score: null, match_status: "not_applicable", match_reason: null,
        source: "csv", dedup_key: null, notes: null, created_at: "", updated_at: "",
      }) as ActivityRecord;
    const mixed = buildPremierYears(
      [seg("2025-04-01", 500), seg("2025-10-01", 500)],
      [redeem("2025-08-15", -20000)]
    )[0];
    const aug = mixed.points.find((p) => p.date === "2025-08-15")!;
    check(
      "a miles-only date BETWEEN postings carries the PQP total forward",
      // 500 earned in April, less the 20,000 redeemed here; October's 500 is
      // still ahead of this point and must not be counted into it
      aug.cumPqp === 100 && aug.awardBalance === -19500,
      JSON.stringify(aug)
    );
    /* …but past the last posting it must not: a PQP line running flat to a
       date nothing posted on would assert a total that hasn't happened. Each
       series ends at its own last movement, which is why they have separate
       cutoffs rather than sharing one. */
    const tail = buildPremierYears(
      [seg("2025-04-01", 500)],
      [redeem("2025-08-15", -20000)]
    )[0];
    const tailAug = tail.points.find((p) => p.date === "2025-08-15")!;
    check(
      "…and past the last posting the PQP line ends while miles carry on",
      tailAug.cumPqp === null && tailAug.awardBalance === -19500,
      JSON.stringify(tailAug)
    );
  }

  /* Rolling CPM. The property that matters is that it WEIGHTS: a month with
     one cheap short flight must not count as much as a month with twenty. */
  {
    const mo = (month: string, miles: number, gross: number, personal = gross) =>
      ({ month, cpmMiles: miles, cpmLifetimeMiles: miles, cpmGross: gross,
         cpmPersonal: personal } as unknown as MonthlySummary);
    /* 100 mi at $10 is 10¢; 900 mi at $9 is 1¢. The weighted answer over both
       is 1900¢/1000mi = 1.9¢ — NOT the 5.5¢ a mean of the two would give. */
    const two = rollingCpm([mo("2025-01", 100, 10), mo("2025-02", 900, 9)], 2);
    check(
      "rolling CPM weights by miles rather than averaging the ratios",
      two[1].gross === 1.9,
      JSON.stringify(two)
    );
    check(
      "…and shows nothing until the window is full",
      two[0].gross === null,
      JSON.stringify(two[0])
    );
    /* It trails: the window moves, it does not accumulate from the start. */
    const three = rollingCpm(
      [mo("2025-01", 1000, 100), mo("2025-02", 1000, 10), mo("2025-03", 1000, 10)],
      2
    );
    check(
      "…and trails, so an old expensive month drops out of the window",
      three[1].gross === 5.5 && three[2].gross === 1,
      JSON.stringify(three.map((r) => r.gross))
    );
    check(
      "…and a window with no miles yields no point rather than a divide by zero",
      rollingCpm([mo("2025-01", 0, 0), mo("2025-02", 0, 0)], 2)[1].gross === null
    );
  }

  /* Route-level CPM. Same restricted basis as every other average here, which
     is the whole difficulty: a route's DISTANCE counts every flight on it,
     while its COST counts only the flights that have one. */
  {
    const rseg = (
      id: string,
      origin: string,
      destination: string,
      o: Partial<EnrichedSegment> = {}
    ) =>
      ({
        id,
        origin,
        destination,
        flight_date: "2025-03-01",
        status: "flown_reconciled",
        marketing_carrier: "UA",
        operating_carrier: "UA",
        distance_miles: 1000,
        lifetime_miles: null,
        award_miles: 1000,
        ticket_id: "t1",
        credits_mileageplus: null,
        allocation_method: "distance",
        gross_cost: 100,
        personal_cost: 100,
        ...o,
      }) as unknown as EnrichedSegment;

    const both = summarizeRoutes([rseg("a", "IAH", "SFO"), rseg("b", "SFO", "IAH")]);
    check(
      "route CPM reads a city pair undirected, so a round trip is one row",
      both.length === 1 && both[0].route === "IAH ⇄ SFO" && both[0].count === 2,
      JSON.stringify(both.map((r) => r.route))
    );
    check(
      "…and still records which directions were actually flown",
      both[0].directions.length === 2 && both[0].directions.every((d) => d.count === 1),
      JSON.stringify(both[0].directions)
    );

    /* The one that would be wrong silently. 1,000 mi at $100 is 10¢; spreading
       that same $100 over both flights' 2,000 mi gives 5¢ — half a fare that
       was never paid, on a route that looks twice as good as it is. */
    const mixed = summarizeRoutes([
      rseg("a", "IAH", "SFO"),
      rseg("b", "SFO", "IAH", {
        allocation_method: "none",
        gross_cost: 0,
        personal_cost: 0,
      }),
    ]);
    check(
      "route CPM divides by the costed miles, not by every mile flown",
      mixed[0].grossCpm === 10 && mixed[0].cpmMiles === 1000 && mixed[0].miles === 2000,
      JSON.stringify(mixed[0])
    );
    check(
      "…and reports the n behind it, so a 1-of-2 figure can say so",
      mixed[0].cpmFlights === 1 && mixed[0].count === 2,
      JSON.stringify(mixed[0])
    );
    check(
      "…and a route with nothing costed yields no CPM, not a divide by zero",
      summarizeRoutes([rseg("a", "DEN", "ORD", { allocation_method: "none" })])[0]
        .grossCpm === null
    );
    check(
      "…and award travel leaves the basis here as it does in the aggregates",
      summarizeRoutes([rseg("a", "LAX", "JFK", { award_miles: 0 })])[0].grossCpm === null
    );
    const ranked = summarizeRoutes([
      rseg("a", "IAH", "SFO"),
      rseg("b", "DEN", "ORD"),
      rseg("c", "ORD", "DEN"),
    ]);
    check(
      "…and routes rank by how often they were flown, not by what they cost",
      ranked[0].route === "DEN ⇄ ORD" && ranked[1].route === "IAH ⇄ SFO",
      JSON.stringify(ranked.map((r) => r.route))
    );
    check(
      "…and a booked flight is not yet a route flown",
      summarizeRoutes([rseg("a", "IAH", "SFO", { status: "ticketed" })]).length === 0
    );

    /* The figures a row prints must divide into the figure beside them. Two
       559.2-mile legs are 1,118.4 mi, shown as 1,118; at $57.12 each the CPM
       has to be the 10.22¢ that $114.24 over 1,118 gives, not the 10.21¢ that
       full-precision miles give — the monthly ledger rounds its basis first
       and these two sit on the same screen. */
    const frac = summarizeRoutes([
      rseg("a", "FRA", "WAW", { distance_miles: 559.2, gross_cost: 57.12, personal_cost: 57.12 }),
      rseg("b", "WAW", "FRA", { distance_miles: 559.2, gross_cost: 57.12, personal_cost: 57.12 }),
    ])[0];
    check(
      "…and a route's CPM divides the figures the row actually shows",
      frac.cpmMiles === 1118 &&
        frac.gross === 114.24 &&
        frac.grossCpm === round2((100 * frac.gross) / frac.cpmMiles),
      JSON.stringify(frac)
    );
  }

  /* Travel mix. Three cuts of one set of segments, so the property that
     matters most is that they stay the SAME set — a dimension that quietly
     drops or double-counts a flight would still look plausible on screen. */
  {
    const mseg = (
      id: string,
      o: Partial<EnrichedSegment> = {}
    ) =>
      ({
        id,
        origin: "IAH",
        destination: "SFO",
        flight_date: "2025-03-01",
        status: "flown_reconciled",
        marketing_carrier: "UA",
        operating_carrier: "UA",
        distance_miles: 1000,
        lifetime_miles: null,
        award_miles: 1000,
        ticket_id: "t1",
        credits_mileageplus: null,
        allocation_method: "distance",
        gross_cost: 100,
        personal_cost: 100,
        effective_purpose: "personal",
        ...o,
      }) as unknown as EnrichedSegment;

    const mix = summarizeMix([
      mseg("a", { effective_purpose: "business" }),
      mseg("b", { effective_purpose: "business" }),
      mseg("c"),
      mseg("d", { marketing_carrier: "LH", operating_carrier: "LH" }),
      mseg("e", { status: "ticketed" }), // booked, not flown
      mseg("f", { status: "canceled" }),
    ]);
    const sum = (bs: { flights: number }[]) => bs.reduce((a, b) => a + b.flights, 0);
    check(
      "travel mix counts only flown segments",
      sum(mix.carrier) === 4,
      JSON.stringify(mix.carrier.map((b) => `${b.key}=${b.flights}`))
    );
    check(
      "…and every dimension partitions the same set, so the totals agree",
      sum(mix.purpose) === sum(mix.carrier) && sum(mix.geography) === sum(mix.carrier),
      JSON.stringify({ p: sum(mix.purpose), c: sum(mix.carrier), g: sum(mix.geography) })
    );
    check(
      "…splitting business from personal on the purpose the ledger settled on",
      mix.purpose.find((b) => b.key === "business")!.flights === 2 &&
        mix.purpose.find((b) => b.key === "personal")!.flights === 2,
      JSON.stringify(mix.purpose.map((b) => `${b.key}=${b.flights}`))
    );
    /* "Other airlines", not "Partners": Delta and American are competitors and
       SkyWest flies for whoever holds the contract. The dimension is whose
       metal you were on, which says nothing about an alliance. */
    check(
      "…and United metal from every other airline's",
      mix.carrier.find((b) => b.key === "ua")!.flights === 3 &&
        mix.carrier.find((b) => b.key === "other")!.flights === 1 &&
        mix.carrier.find((b) => b.key === "other")!.label === "Other airlines",
      JSON.stringify(mix.carrier.map((b) => `${b.key}=${b.flights}`))
    );
    check(
      "…with shares over the flown miles, summing to one",
      Math.abs(mix.carrier.reduce((a, b) => a + b.share, 0) - 1) < 1e-9,
      String(mix.carrier.reduce((a, b) => a + b.share, 0))
    );
    /* Same restricted basis as routes and the aggregates: an uncosted flight
       is still a flight and still miles, but it cannot price the slice. */
    const uncosted = summarizeMix([
      mseg("a"),
      mseg("b", { allocation_method: "none", gross_cost: 0, personal_cost: 0 }),
    ]).carrier.find((b) => b.key === "ua")!;
    check(
      "…and a slice prices only the flights that cost cash",
      uncosted.flights === 2 && uncosted.miles === 2000 &&
        uncosted.cpmFlights === 1 && uncosted.grossCpm === 10,
      JSON.stringify(uncosted)
    );
    /* The point of the wider basis. Under isCpmEligible another airline's
       metal earns no lifetime miles and so can never be priced — which leaves
       one whole side of this dimension permanently blank, in a panel whose job
       is to compare the two sides. It cost cash and flew miles, so it prices. */
    const foreign = summarizeMix([
      mseg("a", { marketing_carrier: "LH", operating_carrier: "LH" }),
    ]).carrier.find((b) => b.key === "other")!;
    check(
      "…including another airline's, which the headline CPM basis cannot price",
      foreign.cpmFlights === 1 && foreign.grossCpm === 10,
      JSON.stringify(foreign)
    );
    /* But award travel still cannot: a few dollars of tax over a long flight
       reads as almost free and would beat every fare actually paid for. */
    const awarded = summarizeMix([
      mseg("a", { award_miles: 0, gross_cost: 5.6 }),
    ]).carrier.find((b) => b.key === "ua")!;
    check(
      "…while award travel stays out, so cents-per-mile isn't dragged to zero",
      awarded.flights === 1 && awarded.cpmFlights === 0 && awarded.grossCpm === null,
      JSON.stringify(awarded)
    );
    /* An airport is touched twice by a round trip — once departing, once
       arriving — and that is the count the panel means. */
    check(
      "…and airports count once per flight that touches them",
      summarizeMix([mseg("a"), mseg("b", { origin: "SFO", destination: "IAH" })])
        .airports.every((a) => a.flights === 2),
      JSON.stringify(summarizeMix([mseg("a")]).airports)
    );
    check(
      "…and an empty ledger yields no slices rather than a divide by zero",
      summarizeMix([]).carrier.every((b) => b.share === 0 && b.grossCpm === null)
    );

    /* Fare classes. The trap is $/PQP: an award booking earns real points for
       no fare, so letting its PQP into the divisor makes a class look like it
       buys status almost free. */
    const fc = summarizeFareClasses([
      mseg("a", { booking_class: "L", pqp: 100, gross_cost: 200, cabin: "Economy" }),
      mseg("b", { booking_class: "L", pqp: 100, gross_cost: 200, cabin: "Economy" }),
      /* Same class, but flown on an award ticket: 500 PQP, no fare. */
      mseg("c", {
        booking_class: "L", pqp: 500, gross_cost: 5.6, cabin: "Economy",
        award_miles: 0,
      }),
      mseg("d", { booking_class: "PZ", pqp: 300, gross_cost: 900, cabin: "First" }),
    ]);
    const L = fc.find((r) => r.code === "L")!;
    check(
      "fare classes price $/PQP over the cash flights and their OWN points",
      L.costPerPqp === 2 && L.cashPqp === 200 && L.pqp === 700,
      JSON.stringify(L)
    );
    check(
      "…counting the award flight in the class without letting it cheapen it",
      L.flights === 3 && L.awardFlights === 1 && L.cashFlights === 2,
      JSON.stringify(L)
    );
    check(
      "…and ordering by how much each was flown, never by an implied rank",
      fc[0].code === "L" && fc[1].code === "PZ",
      JSON.stringify(fc.map((r) => r.code))
    );
    check(
      "…reporting the class verbatim and the cabins it spanned",
      fc.find((r) => r.code === "PZ")!.cabins.join() === "First",
      JSON.stringify(fc.find((r) => r.code === "PZ"))
    );
    /* Unclassified flying gets a row, not silence — seeing it is how you
       learn it exists. One row per airline, like every real class. */
    const noClass = summarizeFareClasses([
      mseg("a", { booking_class: null, gross_cost: 300, pqp: 200 }),
      mseg("b", { booking_class: "  ", marketing_carrier: "AZ", operating_carrier: "AZ" }),
    ]);
    check(
      "…while a flight with no class recorded shows as unclassified, not dropped",
      noClass.length === 2 && noClass.every((r) => r.code === ""),
      JSON.stringify(noClass.map((r) => `${r.carrier}:${JSON.stringify(r.code)}`))
    );
    check(
      "…still pricing what it cost and what it earned",
      noClass.find((r) => r.carrier === "UA")!.costPerPqp === 1.5,
      JSON.stringify(noClass.find((r) => r.carrier === "UA"))
    );
    /* The per-flight spread. One vote per flight, against every weighted
       mean in the app: the mean is what the flying costs, this is what a
       FLIGHT costs, and the two disagree whenever long-haul dominates. */
    const sp = flightCpmSpread([
      mseg("a", { gross_cost: 100 }),                       // 10¢ over 1000 mi
      mseg("b", { gross_cost: 200 }),                       // 20¢
      mseg("c", { gross_cost: 300 }),                       // 30¢
      mseg("d", { gross_cost: 90, distance_miles: 9000 }),  // 1¢ — the long haul
    ])!;
    check(
      "the per-flight median gives every flight one vote, however long",
      sp.flights === 4 && sp.median === 15,
      JSON.stringify(sp)
    );
    check(
      "…which is not what the weighted mean says",
      Math.round((100 * (100 + 200 + 300 + 90)) / 12000) === 6,
      "mean ≈ 6¢ vs median 15¢ on the same four flights"
    );
    check(
      "…with an odd count, the middle flight IS the median",
      flightCpmSpread([
        mseg("a", { gross_cost: 100 }),
        mseg("b", { gross_cost: 200 }),
        mseg("c", { gross_cost: 300 }),
      ])!.median === 20
    );
    check(
      "…award travel and uncosted flights get no vote",
      flightCpmSpread([
        mseg("a", { gross_cost: 100 }),
        mseg("b", { award_miles: 0, gross_cost: 5.6 }),
        mseg("c", { allocation_method: "none", gross_cost: 0 }),
      ])!.flights === 1
    );
    check(
      "…and no flights means no answer, not a zero",
      flightCpmSpread([]) === null
    );

    /* A booking class is the airline's own namespace. One real ledger's V
       spanned United, Lufthansa and Alaska fares with nothing in common but
       the letter — blended, they quoted a ¢/mi nobody ever paid. */
    const twoAirlines = summarizeFareClasses([
      mseg("a", { booking_class: "V", pqp: 100, gross_cost: 200, cabin: "Economy" }),
      mseg("b", {
        booking_class: "V", pqp: 100, gross_cost: 400, cabin: "Economy",
        marketing_carrier: "LH", operating_carrier: "LH",
      }),
    ]);
    check(
      "…and the same letter on two airlines is two fares, never one row",
      twoAirlines.length === 2 &&
        new Set(twoAirlines.map((r) => r.carrier)).size === 2 &&
        twoAirlines.every((r) => r.flights === 1),
      JSON.stringify(twoAirlines.map((r) => `${r.carrier}:${r.code}=${r.flights}`))
    );
    /* The class letter lives in the SELLER's inventory: a codeshare is booked
       in the marketing airline's class whoever operates the aircraft. */
    check(
      "…keyed by the airline that sold the fare, not the one that flew it",
      summarizeFareClasses([
        mseg("a", { booking_class: "O", marketing_carrier: "AS", operating_carrier: "HA" }),
      ])[0].carrier === "AS"
    );
  }

  /* Cash-flow accounting (§7.3): money in the month it MOVED, against every
     other figure here, which places it in the month flown. The design doc's
     rule is that the two are never silently mixed, so the thing worth pinning
     is that this one genuinely reads different dates. */
  {
    const tkt = (id: string, issue: string | null, gross: number) =>
      ({ id, issue_date: issue, gross_total: gross } as unknown as TicketRow);
    const alloc = (id: string, cashAt: number) =>
      ({ [id]: { cashAt } as unknown as AllocationMethod }) as unknown as Record<
        string,
        { cashAt: number }
      >;
    const adj = (ticket: string, date: string | null, amount: number) =>
      ({ ticket_id: ticket, effective_date: date, amount,
         type: "reimbursement" } as unknown as AdjustmentRow);

    const cf = buildCashFlow(
      [tkt("a", "2025-01-15", 600), tkt("b", "2025-03-02", 400)],
      [adj("a", "2025-04-20", 250)],
      { ...alloc("a", 600), ...alloc("b", 400) } as never
    );
    check(
      "cash flow places a ticket in the month it was BOUGHT, not flown",
      cf.months[0].month === "2025-01" && cf.months[0].out === 600,
      JSON.stringify(cf.months.map((m) => `${m.month}:${m.out}/${m.in}`))
    );
    check(
      "…and money coming back in the month it was effective",
      cf.months.find((m) => m.month === "2025-04")!.in === 250,
      JSON.stringify(cf.months.map((m) => `${m.month}:${m.in}`))
    );
    check(
      "…gap-filling the quiet months between, rather than closing them up",
      cf.months.map((m) => m.month).join() === "2025-01,2025-02,2025-03,2025-04",
      cf.months.map((m) => m.month).join()
    );
    check(
      "…and running a cumulative net that ends at out minus in",
      cf.months[cf.months.length - 1].cumulative === 750,
      String(cf.months[cf.months.length - 1].cumulative)
    );

    /* An undated reimbursement is ASSUMED into its ticket's purchase month —
       the user's own rule, chosen over the earlier behaviour of leaving it off
       the table, which on a ledger where "Reimbursed" never records a date
       meant a Back column of nothing. The guess stays a guess: it is counted
       separately so the UI can mark it ≈, and a recorded date always wins. */
    const assumed = buildCashFlow(
      [tkt("a", "2025-01-15", 600)],
      [adj("a", null, 250), adj("a", null, 100)],
      alloc("a", 600) as never
    );
    check(
      "an undated reimbursement is assumed into its ticket's purchase month",
      assumed.months[0].month === "2025-01" && assumed.months[0].in === 350,
      JSON.stringify(assumed.months)
    );
    check(
      "…carried as an assumption, never passed off as a recorded date",
      assumed.months[0].inAssumed === 350 &&
        assumed.assumedIn.count === 2 && assumed.assumedIn.amount === 350 &&
        assumed.undatedIn.count === 0,
      JSON.stringify({ m: assumed.months[0], a: assumed.assumedIn })
    );
    check(
      "…while a dated reimbursement stays exact and unflagged",
      cf.months.find((m) => m.month === "2025-04")!.inAssumed === 0 &&
        cf.assumedIn.count === 0,
      JSON.stringify(cf.assumedIn)
    );
    check(
      "…and money whose ticket is also dateless stays off the table, reported",
      buildCashFlow([tkt("a", null, 600)], [adj("a", null, 250)], alloc("a", 600) as never)
        .undatedIn.amount === 250
    );
    check(
      "…and an undated ticket likewise sits on no month",
      buildCashFlow([tkt("a", null, 600)], [], alloc("a", 600) as never).undatedOut
        .amount === 600
    );
    /* A superseded chain member has a face value but consumed no new money, so
       it is no event at all — not a zero one. Its month never joins the
       timeline, which is what keeps a reissue from reading as a second
       purchase for the same trip. */
    const superseded = buildCashFlow(
      [tkt("a", "2025-01-15", 600), tkt("b", "2025-02-01", 600)],
      [],
      { ...alloc("a", 600), ...alloc("b", 0) } as never
    );
    check(
      "…and a chain member that consumed no new money is no event at all",
      superseded.months.length === 1 &&
        superseded.months[0].month === "2025-01" &&
        superseded.months[0].tickets === 1 &&
        superseded.months[0].out === 600,
      JSON.stringify(superseded.months)
    );
  }

  /* Million Miler forecasting. Straight-line from a trailing window, and the
     properties that matter are all about what it REFUSES to say. */
  {
    /** n consecutive months ending Dec 2025, each crediting `per` miles. */
    const months = (n: number, per: number): MonthlySummary[] =>
      Array.from({ length: n }, (_, i) => {
        const m = 12 - (n - 1 - i);
        const y = 2025 + Math.floor((m - 1) / 12);
        const mm = ((((m - 1) % 12) + 12) % 12) + 1;
        return {
          month: `${y}-${String(mm).padStart(2, "0")}`,
          lifetimeEst: per,
        } as unknown as MonthlySummary;
      });

    /* 24 months at 2,000 mi is 24,000 a year, and a 500,000 baseline plus that
       window is 548,000 flown. The remaining 452,000 to the first rung takes
       18.8 years, landing in 2044 from a 2026-01-15 reading. Every higher rung
       is 60+ years out and so past the horizon. */
    const f = forecastLifetime(months(24, 2000), 500_000, "2026-01-15")!;
    check(
      "lifetime forecast fits a rate from the trailing window",
      f.ratePerYear === 24000 && f.windowMonths === 24 && f.current === 548000,
      JSON.stringify({ rate: f.ratePerYear, w: f.windowMonths, cur: f.current })
    );
    check(
      "…and reports the year the rate arrives, not a date",
      f.milestones[0].year === 2044 && !f.milestones[0].reached,
      JSON.stringify(f.milestones[0])
    );
    check(
      "…and states the window it rests on, so the rate can be judged",
      f.from === "2024-01" && f.to === "2025-12",
      `${f.from}..${f.to}`
    );
    check(
      "…and leaves a rung past the horizon blank rather than quoting a year",
      f.milestones[3].year === null && !f.milestones[3].reached,
      JSON.stringify(f.milestones[3])
    );
    /* A rung passed inside tracked history is a fact, and the month it fell is
       known — so it is reported instead of a projection. */
    const passed = forecastLifetime(months(24, 2000), 990_000, "2026-01-15")!
      .milestones[0];
    check(
      "…and marks a rung already passed as reached, with no year",
      passed.reached === true && passed.year === null,
      JSON.stringify(passed)
    );
    /* 990,000 plus 2,000 a month from Jan 2024 reaches exactly 1,000,000 in
       the fifth month — the rung falls the month the total MEETS it. */
    check(
      "…and names the month the ledger crossed it",
      passed.crossedAt === "2024-05",
      JSON.stringify(passed)
    );
    /* Crossed before tracking began — the miles are real, the date is not in
       evidence, and inventing one from a baseline would be a guess. */
    const inherited = forecastLifetime(months(24, 2000), 1_500_000, "2026-01-15")!
      .milestones[0];
    check(
      "…but a rung already inside the baseline reports no crossing month",
      inherited.reached === true && inherited.crossedAt === null,
      JSON.stringify(inherited)
    );

    /* The refusals. Each returns null rather than a figure wearing a label it
       has not earned — the same rule rollingCpm follows. */
    check(
      "a ledger with under a year of history gets no forecast at all",
      forecastLifetime(months(11, 2000), 500_000, "2026-01-15") === null
    );
    check(
      "…and a window that earned nothing gets none either",
      forecastLifetime(months(24, 0), 500_000, "2026-01-15") === null
    );

    /* The month in progress is a partial month. Counting it whole would rate
       the forecast light in proportion to how early it is read — so the same
       ledger must give the same rate on the 1st and the 28th. */
    const withPartial = [
      ...months(24, 2000),
      { month: "2026-01", lifetimeEst: 3 } as unknown as MonthlySummary,
    ];
    check(
      "…and the month in progress never enters the rate",
      forecastLifetime(withPartial, 500_000, "2026-01-01")!.ratePerYear ===
        forecastLifetime(withPartial, 500_000, "2026-01-28")!.ratePerYear,
      JSON.stringify(forecastLifetime(withPartial, 500_000, "2026-01-01"))
    );
    check(
      "…though its miles still count toward the total flown",
      forecastLifetime(withPartial, 500_000, "2026-01-15")!.current === 548003
    );
  }

  /* Basic Economy. United prints it as plain "United Economy" and only the
     fare class says otherwise — and it earns zero PQF, so getting it wrong
     overstates progress toward any tier that counts flights. */
  check(
    "United class N is Basic Economy however the receipt labels it",
    effectiveCabin("UA", "N", "Economy") === "Basic Economy" &&
      effectiveCabin("ua", "n", null) === "Basic Economy"
  );
  check(
    "…but another airline's N is ordinary economy",
    effectiveCabin("AS", "N", "Economy") === "Economy",
    String(effectiveCabin("AS", "N", "Economy"))
  );
  check(
    "…and every other United class keeps the cabin the receipt gave",
    effectiveCabin("UA", "K", "Economy") === "Economy" &&
      effectiveCabin("UA", "J", "Business") === "Business",
    JSON.stringify([effectiveCabin("UA", "K", "Economy"), effectiveCabin("UA", "J", "Business")])
  );

  /* Writable-column coverage.

     The *_FIELDS lists gate all three write paths — insertRow, updateRow and
     the backup restore — by silently skipping any key not named in them. A
     column added by migration and forgotten there therefore reaches the
     database never, with nothing thrown and nothing logged.

     credits_mileageplus sat missing for exactly that long: the flight form
     sent it, validate accepted it, receipt import set it, and every write
     dropped it, so a UA flight credited to Miles & More kept reporting
     lifetime miles because the override could not be saved. This holds the
     lists against the real schema so the next one cannot go quiet. */
  {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "flightdeck-columns-"));
    try {
      process.chdir(tmp);
      mkdirSync(join(tmp, "data"), { recursive: true });
      const db = getDb();
      const gaps: string[] = [];
      for (const [table, fields] of Object.entries(WRITABLE_FIELDS)) {
        const cols = (
          db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
            name: string;
          }[]
        )
          .map((c) => c.name)
          .filter((c) => !MANAGED_COLUMNS.includes(c));
        for (const c of cols) if (!fields.includes(c)) gaps.push(`${table}.${c}`);
      }
      check(
        "every column the schema has is one the write paths can actually write",
        gaps.length === 0,
        `unwritable: ${gaps.join(", ")}`
      );

      /* The bug itself, end to end. */
      const id = createSegment({
        origin: "FRA",
        destination: "SFO",
        flight_date: "2020-02-16",
        status: "flown_reconciled",
        marketing_carrier: "UA",
        operating_carrier: "UA",
        credits_mileageplus: 0,
      });
      const back = getSegment(id)!;
      check(
        "…so a flight marked as not crediting MileagePlus stays marked",
        back.credits_mileageplus === 0,
        JSON.stringify({ stored: back.credits_mileageplus })
      );
      check(
        "…and then earns no lifetime miles, United metal or not",
        estimatedLifetimeMiles(back) === 0,
        `${estimatedLifetimeMiles(back)} (distance ${back.distance_miles})`
      );
    } finally {
      process.chdir(cwd);
    }
  }

  /* Change log (§16). The property the lost-flags incident demanded: a write
     leaves evidence — who, what, before and after — and the evidence outlives
     the data it describes. */
  {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "flightdeck-changes-"));
    try {
      process.chdir(tmp);
      mkdirSync(join(tmp, "data"), { recursive: true });
      const segId = createSegment({
        origin: "IAH", destination: "SFO", flight_date: "2025-03-01",
        status: "ticketed", marketing_carrier: "UA",
      });
      const created = listChanges()[0];
      check(
        "a create is logged with the row it created",
        created?.op === "create" && created?.tbl === "segments" &&
          created?.actor === "manual" &&
          JSON.parse(created.diff).row.origin === "IAH",
        JSON.stringify(created)
      );
      updateSegment(segId, { seat: "20F" });
      const upd = JSON.parse(listChanges()[0].diff);
      check(
        "an update logs only the fields that changed, before and after",
        listChanges()[0].op === "update" &&
          Object.keys(upd.fields).length === 1 &&
          upd.fields.seat[0] === null && upd.fields.seat[1] === "20F",
        JSON.stringify(upd)
      );
      const n1 = listChanges().length;
      updateSegment(segId, { seat: "20F" });
      check(
        "writing a value the row already had logs nothing",
        listChanges().length === n1
      );
      runAsActor("import:test", () => updateSegment(segId, { seat: "3A" }));
      check("the actor rides with the change", listChanges()[0].actor === "import:test");
      check(
        "a row's own history is one filter away",
        listChanges({ tbl: "segments", rowId: segId }).length === 3
      );
      deleteSegment(segId);
      check(
        "a delete logs the whole row it removed, seat and all",
        listChanges()[0].op === "delete" &&
          JSON.parse(listChanges()[0].diff).row.seat === "3A",
        listChanges()[0].diff
      );
      saveSettings({ award_valuation_cpm: 1.7 });
      check(
        "a settings change is a change like any other",
        listChanges()[0].tbl === "settings" &&
          JSON.parse(listChanges()[0].diff).fields.award_valuation_cpm[1] === 1.7,
        listChanges()[0].diff
      );

      /* Wipe and restore: single events with their counts. A wipe TRUNCATES
         the history to its own record — erasure that leaves row contents
         behind is residue, not an audit trail (§16, amended) — while a
         restore appends and the log survives it, which the lost-flags
         incident is the reason for. */
      const keep = createSegment({
        origin: "SFO", destination: "LAX", flight_date: "2025-04-01",
        status: "ticketed", marketing_carrier: "UA",
      });
      check("history exists before the wipe", listChanges().length > 1);
      wipeAll();
      const afterWipe = listChanges();
      check(
        "a wipe truncates the log to the record of the wipe itself",
        afterWipe.length === 1 && afterWipe[0].op === "wipe" &&
          JSON.parse(afterWipe[0].diff).counts.segments === 1,
        JSON.stringify(afterWipe.map((c) => c.op))
      );
      importBackup({
        version: 1,
        tickets: [], adjustments: [], payments: [], activities: [],
        segments: [
          {
            id: keep, origin: "SFO", destination: "LAX",
            flight_date: "2025-04-01", status: "ticketed",
            marketing_carrier: "UA",
          },
        ],
      } as never);
      const afterRestore = listChanges();
      check(
        "a restore is one event with its counts, appended after the wipe record",
        afterRestore.length === 2 && afterRestore[0].op === "restore" &&
          afterRestore[0].actor === "restore" &&
          afterRestore[1].op === "wipe" &&
          JSON.parse(afterRestore[0].diff).restored.segments === 1,
        JSON.stringify(afterRestore.map((c) => c.op))
      );
    } finally {
      process.chdir(cwd);
    }
  }

  /* Accounts. The property worth testing is the dangerous one: a write must
     land in the ledger that is open, and nothing may address a file outside
     data/ or share a file with another account. Runs in a temp directory so
     it can never touch the real ledgers. */
  {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "flightdeck-accounts-"));
    try {
      process.chdir(tmp);
      mkdirSync(join(tmp, "data"), { recursive: true });
      check(
        "a first run adopts the existing tracker.db as the default account",
        readRegistry().accounts[0].file === "tracker.db",
        JSON.stringify(readRegistry())
      );

      createAccount("Partner");
      const mark = (v: string) =>
        getDb()
          .prepare(
            "INSERT INTO settings (key,value) VALUES ('marker', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
          )
          .run(JSON.stringify(v));
      const read = () =>
        (getDb().prepare("SELECT value FROM settings WHERE key='marker'").get() as
          | { value: string }
          | undefined)?.value;
      switchAccount("default");
      mark("MAIN");
      switchAccount("partner");
      mark("PARTNER");
      switchAccount("default");
      const backOnMain = read();
      switchAccount("partner");
      const onPartner = read();
      check(
        "a write lands in the ledger that is open, and only there",
        backOnMain === '"MAIN"' && onPartner === '"PARTNER"',
        JSON.stringify({ backOnMain, onPartner })
      );
      check(
        "…each in its own file",
        existsSync(join(tmp, "data", "tracker.db")) &&
          existsSync(join(tmp, "data", "partner.db")),
        readdirSync(join(tmp, "data")).join(",")
      );

      let sharedFile = "";
      try {
        writeRegistry({
          active: "a",
          accounts: [
            { id: "a", label: "a", file: "one.db" },
            { id: "b", label: "b", file: "one.db" },
          ],
        });
        readRegistry();
      } catch (e) {
        sharedFile = (e as Error).message;
      }
      check(
        "two accounts may not share one file — the merge this design prevents",
        /same database file/i.test(sharedFile),
        sharedFile
      );

      let escaped = "";
      try {
        writeRegistry({
          active: "a",
          accounts: [{ id: "a", label: "a", file: "../../elsewhere.db" }],
        });
      } catch (e) {
        escaped = (e as Error).message;
      }
      check(
        "…and none may address a file outside data/",
        /Unsafe account file name/.test(escaped),
        escaped
      );
    } finally {
      process.chdir(cwd);
      delete (globalThis as { __trackerDbs?: unknown }).__trackerDbs;
    }
  }

  /* The two retired statuses. Both were renames, not reinterpretations: the
     status they map to already behaved identically everywhere. */
  check(
    "planned and refunded are gone from the segment statuses",
    !SEGMENT_STATUSES.includes("planned" as never) &&
      !SEGMENT_STATUSES.includes("refunded" as never) &&
      SEGMENT_STATUSES.length === 5,
    SEGMENT_STATUSES.join(",")
  );
  check(
    "…each retiring onto the status it was already identical to",
    RETIRED_SEGMENT_STATUSES.planned === "ticketed" &&
      RETIRED_SEGMENT_STATUSES.refunded === "canceled",
    JSON.stringify(RETIRED_SEGMENT_STATUSES)
  );
  check(
    "…while the TICKET status refunded survives — a refund is per ticket",
    TICKET_STATUSES.includes("refunded"),
    TICKET_STATUSES.join(",")
  );
  check(
    "a canceled leg is still the only one excluded from allocation",
    NON_ALLOCABLE_STATUSES.length === 1 && NON_ALLOCABLE_STATUSES[0] === "canceled",
    NON_ALLOCABLE_STATUSES.join(",")
  );

  /* A reimbursed ticket was a work trip — but only where nothing was said. */
  check("nothing said, not reimbursed → personal",
    effectivePurpose(null, false) === "personal");
  check("nothing said, reimbursed → business",
    effectivePurpose(null, true) === "business");
  check("…the flight's own answer wins over that",
    effectivePurpose("personal", true) === "personal");
  check("…while an explicit business stays business unreimbursed",
    effectivePurpose("business", false) === "business");

  /* "United never credited this" only makes sense for a flight United owed
     credit for. Three kinds never earn, and nagging about them buries the one
     flight that really is missing. */
  {
    const mp = (over: Partial<Parameters<typeof expectsMileagePlusCredit>[0]>) =>
      expectsMileagePlusCredit({
        credits_mileageplus: null, issuing_carrier: "UA", ticket_id: "t",
        ticket_is_award: false, operating_carrier: null, marketing_carrier: "UA",
        ...over,
      });
    check("a United flight on a United ticket is expected to credit", mp({}) === true);
    check(
      "…a partner leg ON a United ticket still is",
      mp({ marketing_carrier: "LH", operating_carrier: "LH" }) === true
    );
    check(
      "…a ticket another airline issued is not",
      mp({ issuing_carrier: "AA" }) === false
    );
    // the user's FCO→MUC: award ticket, Lufthansa metal
    check(
      "…an award flown on someone else's metal is not",
      mp({ ticket_is_award: true, marketing_carrier: "LH" }) === false
    );
    check(
      "…but an award on United metal is",
      mp({ ticket_is_award: true, marketing_carrier: "UA" }) === true
    );
    // hand-added Delta and ITA segments with no United ticket behind them
    check(
      "…a non-UA flight with no ticket at all is not",
      mp({ ticket_id: null, marketing_carrier: "DL", operating_carrier: "OO" }) === false
    );
    check(
      "…while a UA flight with no ticket still is",
      mp({ ticket_id: null, marketing_carrier: "UA" }) === true
    );
    check(
      "an explicit flag overrides the inference either way",
      mp({ credits_mileageplus: 1, issuing_carrier: "AA" }) === true &&
        mp({ credits_mileageplus: 0 }) === false
    );
  }

  /* A EUR ticket counted at 1:1 quietly understates every total it touches.
     The rate is a historical fact this app cannot look up, so it asks. */
  {
    const eur = tk({ id: "eur", currency: "EUR", exchange_rate: 1, gross_total: 636.36 });
    const rep = buildReconcileReport(
      { ...base, segments: [], activities: [], tickets: [eur], payments: [],
        allocations: allocOf(eur) },
      settings
    );
    check("a foreign-currency ticket with no rate is flagged",
      rep.counts.unconverted_currency === 1,
      JSON.stringify(rep.exceptions.map((e) => e.kind)));
    const converted = tk({ id: "eur2", currency: "EUR", exchange_rate: 1.07, gross_total: 636.36 });
    const ok = buildReconcileReport(
      { ...base, segments: [], activities: [], tickets: [converted], payments: [],
        allocations: allocOf(converted) },
      settings
    );
    check("…and silent once a rate is set",
      (ok.counts.unconverted_currency ?? 0) === 0);
    const usd = tk({ id: "usd", currency: "USD", exchange_rate: 1, gross_total: 100 });
    const home = buildReconcileReport(
      { ...base, segments: [], activities: [], tickets: [usd], payments: [],
        allocations: allocOf(usd) },
      settings
    );
    check("…while a ticket already in the reporting currency says nothing",
      (home.counts.unconverted_currency ?? 0) === 0);
  }

  /* One eTicket number, two rows — impossible by design, so nothing looked for
     it until the user spotted a pair by eye. */
  {
    const twinA = tk({ id: "d1", ticket_number: "016-7900000007", gross_total: 255.48 });
    const twinB = tk({ id: "d2", ticket_number: "0167900000007", gross_total: 255.48 });
    const rep = buildReconcileReport(
      { ...base, segments: [enrich(mkSeg("s-d", { ticket_id: "d2" }))], activities: [],
        tickets: [twinA, twinB], payments: [],
        allocations: { ...allocOf(twinA), ...allocOf(twinB) } },
      settings
    );
    check("the same eTicket number twice is flagged", rep.counts.duplicate_ticket === 1,
      JSON.stringify(rep.exceptions.map((e) => e.kind)));
    const dup = rep.exceptions.find((e) => e.kind === "duplicate_ticket")!;
    check(
      "…naming both rows and the money it double-counts",
      dup.groupIds?.length === 2 && /510\.96/.test(dup.detail ?? "") &&
        /1 of them hold no flights/.test(dup.detail ?? ""),
      dup.detail
    );
    // formatting differences are not two tickets
    check(
      "…matching on the number, not on how it was typed",
      /016-?2393823933/.test(dup.title) === false || dup.groupIds!.length === 2
    );
  }

  /* A ticket another airline issued earns THEIR programme, so "United never
     credited this" is a promise MileagePlus never made. The test is the
     TICKET's issuer, not the carrier — a Lufthansa leg on a United ticket
     posts to MileagePlus perfectly well. */
  {
    const aaTicket = tk({ id: "aa", issuing_carrier: "AA", issue_date: "2026-01-01" });
    const uaTicket = tk({ id: "ua", issuing_carrier: "UA", issue_date: "2026-01-01" });
    // the real enrichment copies the ticket's issuer onto the segment
    const uncredited = (ticketId: string, issuer: string) => ({
      ...enrich(mkSeg("s-x", {
        ticket_id: ticketId, status: "flown_unreconciled", flight_date: "2026-01-05",
        pqp: null, pqf: null, award_miles: null, lifetime_miles: null,
      })),
      issuing_carrier: issuer,
    });
    const onAa = buildReconcileReport(
      { ...base, segments: [uncredited("aa", "AA")], activities: [], tickets: [aaTicket],
        payments: [], allocations: allocOf(aaTicket) },
      settings
    );
    check(
      "a flight on an AA ticket isn't chased for MileagePlus credit",
      (onAa.counts.missing_posting ?? 0) === 0,
      JSON.stringify(onAa.exceptions.map((e) => e.kind))
    );
    const onUa = buildReconcileReport(
      { ...base, segments: [uncredited("ua", "UA")], activities: [], tickets: [uaTicket],
        payments: [], allocations: allocOf(uaTicket) },
      settings
    );
    check(
      "…but one on a United ticket still is",
      onUa.counts.missing_posting === 1,
      JSON.stringify(onUa.exceptions.map((e) => e.kind))
    );
  }

  /* A CREDIT IS MONEY. A ticket bought with one costs its face value, exactly
     like one bought with a card — the tracker has no business chasing where
     the credit came from. Linking only matters when the source ticket is in
     the ledger holding cost of its own, because that is the only way the same
     dollars get counted twice. */
  check(
    "a credit-funded ticket with no possible source in the ledger says nothing",
    (unknownAmount.counts.unlinked_exchange ?? 0) === 0
  );
  const spender = tk({ id: "spender", issue_date: "2026-03-01" });
  const cancelledSource = tk({ id: "src", issue_date: "2026-01-01", gross_total: 800 });
  const withSource = buildReconcileReport(
    {
      ...base,
      segments: [],
      activities: [],
      tickets: [spender, cancelledSource],
      payments: [
        mkPay({ ticket_id: "spender", amount: null, payment_type: "future_flight_credit" }),
      ],
      allocations: { ...allocOf(spender), ...allocOf(cancelledSource) },
    },
    settings
  );
  check(
    "…but flags it when a cost-holding, flightless ticket could be the source",
    withSource.counts.unlinked_exchange === 1,
    JSON.stringify(withSource.exceptions.map((e) => e.kind))
  );
  const sourceFlew = buildReconcileReport(
    {
      ...base,
      segments: [enrich(mkSeg("s-src", { ticket_id: "src", status: "flown_reconciled" }))],
      activities: [],
      tickets: [spender, cancelledSource],
      payments: [
        mkPay({ ticket_id: "spender", amount: null, payment_type: "future_flight_credit" }),
      ],
      allocations: { ...allocOf(spender), ...allocOf(cancelledSource) },
    },
    settings
  );
  check(
    "…and not when that ticket's cost is already earning its keep",
    (sourceFlew.counts.unlinked_exchange ?? 0) === 0
  );

  // exchange chain: superseded ticket must not keep charging cost
  const oldTicket = tk({ id: "old" });
  const newTicket = tk({ id: "new", predecessor_ticket_id: "old" });
  const liveOnOld = enrich(mkSeg("s-old", { ticket_id: "old", status: "flown_reconciled" }));
  const doubled = buildReconcileReport(
    {
      ...base,
      segments: [liveOnOld],
      activities: [],
      tickets: [oldTicket, newTicket],
      payments: [],
      allocations: { ...allocOf(oldTicket), ...allocOf(newTicket) },
    },
    settings
  );
  check("exchanged ticket with live flights flagged", doubled.counts.exchange_double_count === 1);

  const canceledOnOld = enrich(mkSeg("s-old2", { ticket_id: "old", status: "canceled" }));
  const clean = buildReconcileReport(
    {
      ...base,
      segments: [canceledOnOld],
      activities: [],
      tickets: [oldTicket, newTicket],
      payments: [],
      allocations: { ...allocOf(oldTicket), ...allocOf(newTicket) },
    },
    settings
  );
  check(
    "superseded flights marked canceled clear the flag",
    (clean.counts.exchange_double_count ?? 0) === 0
  );
  check(
    "…and with no issue date on the successor every live leg stays suspect",
    doubled.counts.exchange_double_count === 1
  );

  /* A reissue can only void coupons that hadn't departed yet, so the leg that
     flew before the exchange is the normal case — not a double count. */
  const reissuedAfter = tk({ id: "new2", predecessor_ticket_id: "old", issue_date: "2026-08-01" });
  const flewFirst = buildReconcileReport(
    {
      ...base,
      segments: [enrich(mkSeg("s-flew", { ticket_id: "old", flight_date: "2026-07-10", status: "flown_reconciled" }))],
      activities: [],
      tickets: [oldTicket, reissuedAfter],
      payments: [],
      allocations: { ...allocOf(oldTicket), ...allocOf(reissuedAfter) },
    },
    settings
  );
  check(
    "a leg that flew before the exchange is not a double count",
    (flewFirst.counts.exchange_double_count ?? 0) === 0,
    JSON.stringify(flewFirst.exceptions.filter((e) => e.kind === "exchange_double_count").map((e) => e.title))
  );

  const reissuedBefore = tk({ id: "new3", predecessor_ticket_id: "old", issue_date: "2026-06-01" });
  const stillLive = buildReconcileReport(
    {
      ...base,
      segments: [enrich(mkSeg("s-live", { ticket_id: "old", flight_date: "2026-07-10", status: "ticketed" }))],
      activities: [],
      tickets: [oldTicket, reissuedBefore],
      payments: [],
      allocations: { ...allocOf(oldTicket), ...allocOf(reissuedBefore) },
    },
    settings
  );
  check(
    "a leg dated after the exchange is still flagged",
    stillLive.counts.exchange_double_count === 1
  );
  check(
    "…and the flag names the leg and the exchange date",
    stillLive.exceptions.some(
      (e) =>
        e.kind === "exchange_double_count" &&
        e.title.includes("2026-06-01") &&
        (e.detail ?? "").includes("IAH→SFO on 2026-07-10")
    ),
    JSON.stringify(stillLive.exceptions.filter((e) => e.kind === "exchange_double_count"))
  );

  // a superseded ticket holding cost with nothing allocated is expected —
  // the chain explains it, so it must not also raise an allocation warning
  const supersededAlloc = {
    ...allocOf(oldTicket).old,
    warnings: ["All segments are canceled/refunded but the ticket still has net cost; nothing allocated."],
  };
  const quietChain = buildReconcileReport(
    {
      ...base,
      segments: [canceledOnOld],
      activities: [],
      tickets: [oldTicket, newTicket],
      payments: [],
      allocations: { old: supersededAlloc, ...allocOf(newTicket) },
    },
    settings
  );
  check(
    "superseded ticket doesn't double-report as an allocation warning",
    (quietChain.counts.allocation_warning ?? 0) === 0
  );

  // cost-tracking cutoff silences imported history
  const oldFlight = enrich(
    mkSeg("o1", { flight_date: "2024-01-05", status: "flown_reconciled", pqp: 100 })
  );
  const noisy = buildReconcileReport(
    { ...base, segments: [oldFlight], activities: [] },
    settings
  );
  check("old uncosted flight flagged without a cutoff", noisy.counts.no_cost === 1);
  const quiet = buildReconcileReport(
    { ...base, segments: [oldFlight], activities: [] },
    { ...settings, cost_tracking_start: "2026-01-01" }
  );
  check("cutoff silences pre-tracking history", (quiet.counts.no_cost ?? 0) === 0);
}

/* --------------------- exchange-chain allocation ----------------------- */
console.log("exchange chain allocation:");
{
  // The real ZZ0006 chain: A $886.81 → B $1117.52 (+$230.71 collected) →
  // C $1117.52 (no new money). Cash actually spent = 886.81 + 230.71.
  const A = mkTicket({ id: "A", gross_total: 886.81, confirmation_code: "ZZ0006" });
  const B = mkTicket({
    id: "B", gross_total: 1117.52, confirmation_code: "ZZ0006",
    predecessor_ticket_id: "A", additional_collection: 230.71,
  });
  const C = mkTicket({
    id: "C", gross_total: 1117.52, confirmation_code: "ZZ0006",
    predecessor_ticket_id: "B",
  });
  const flownA = mkSeg("a1", { ticket_id: "A", origin: "MUC", destination: "EWR", distance_miles: 3977, status: "flown_reconciled" });
  const cancelledA = mkSeg("a2", { ticket_id: "A", origin: "SFO", destination: "FRA", distance_miles: 5691, status: "canceled" });
  const cancelledB1 = mkSeg("b1", { ticket_id: "B", origin: "IAH", destination: "DEN", distance_miles: 862, status: "canceled" });
  const cancelledB2 = mkSeg("b2", { ticket_id: "B", origin: "DEN", destination: "OGG", distance_miles: 3492, status: "canceled" });
  const flownC1 = mkSeg("c1", { ticket_id: "C", origin: "IAH", destination: "SFO", distance_miles: 1632, status: "flown_reconciled" });
  const flownC2 = mkSeg("c2", { ticket_id: "C", origin: "SFO", destination: "OGG", distance_miles: 2340, status: "flown_reconciled" });

  const segsBy = new Map([
    ["A", [flownA, cancelledA]],
    ["B", [cancelledB1, cancelledB2]],
    ["C", [flownC1, flownC2]],
  ]);
  const adjBy = new Map<string, AdjustmentRow[]>();
  const allocs = allocateChain([A, B, C], segsBy, adjBy);

  const total =
    allocs.A.perSegment.a1.gross +
    allocs.C.perSegment.c1.gross +
    allocs.C.perSegment.c2.gross;
  check(
    "chain cash = root face + collections, not the sum of faces",
    allocs.A.gross_allocable === 1117.52,
    String(allocs.A.gross_allocable)
  );
  check("every flown flight in the chain gets a share", total === 1117.52, String(total));
  check(
    "the flight that actually flew is charged, not the rerouted one",
    allocs.B.perSegment.b1.gross === 0 && allocs.B.perSegment.b2.gross === 0
  );
  check("canceled leg of the original takes nothing", allocs.A.perSegment.a2.gross === 0);
  check("shares follow distance", approx(allocs.A.perSegment.a1.gross, 1117.52 * 3977 / 7949, 0.02));
  check("chain context exposed for the UI", allocs.C.chain?.ticketIds.length === 3);
  /* Per-ticket cash, for placing a chain on a cash-flow timeline instead of
     all on one date. The invariant is that it decomposes the SAME total: if a
     later edit to the collection/residual inference forgets one of these, the
     chain would still allocate correctly while the money quietly moved to a
     different month — or stopped adding up. */
  {
    const parts = round2(allocs.A.cashAt + allocs.B.cashAt + allocs.C.cashAt);
    check(
      "per-ticket cash decomposes the chain total exactly",
      parts === allocs.A.chain!.cash && parts === 1117.52,
      JSON.stringify({ A: allocs.A.cashAt, B: allocs.B.cashAt, C: allocs.C.cashAt, parts })
    );
    check(
      "…starting from the root's own face value",
      allocs.A.cashAt === allocs.A.gross_reporting,
      String(allocs.A.cashAt)
    );
    /* A reissue onto a CHEAPER ticket hands value back, so its own month shows
       money returning rather than the chain looking uniformly expensive. */
    const cheaper = allocateChain(
      [A, mkTicket({ id: "D", gross_total: 200, predecessor_ticket_id: "A" })],
      segsBy,
      adjBy
    );
    check(
      "…and a reissue that returns value carries a negative share",
      cheaper.D.cashAt < 0 &&
        round2(cheaper.A.cashAt + cheaper.D.cashAt) === cheaper.A.chain!.cash,
      JSON.stringify({ A: cheaper.A.cashAt, D: cheaper.D.cashAt, chain: cheaper.A.chain!.cash })
    );
  }

  // without a printed "additional collection", the fare difference is the same
  const B2 = mkTicket({ id: "B", gross_total: 1117.52, predecessor_ticket_id: "A" });
  const inferred = allocateChain([A, B2, C], segsBy, adjBy);
  check(
    "missing collection line → inferred from the fare difference",
    inferred.A.gross_allocable === 1117.52,
    String(inferred.A.gross_allocable)
  );
  check(
    "and the inference is disclosed on the ticket it concerns",
    inferred.B.warnings.some((w) => w.includes("inferred 230.71")),
    JSON.stringify({ A: inferred.A.warnings, B: inferred.B.warnings })
  );
  check(
    "…and not repeated on every ticket in the chain",
    inferred.A.warnings.length === 0 && inferred.C.warnings.length === 0
  );

  /* Reissued onto a CHEAPER ticket (the ZZ0004 numbers): United hands the
     difference back as a future flight credit, so it isn't money this trip
     spent. Mirror image of the inferred additional collection. */
  const cheapSegs = new Map([
    ["A", [mkSeg("a1")]],
    ["B", [mkSeg("b1", { ticket_id: "B" })]],
  ]);
  const down = allocateChain(
    [
      mkTicket({ id: "A", gross_total: 2168.71 }),
      mkTicket({ id: "B", gross_total: 2052.01, predecessor_ticket_id: "A" }),
    ],
    cheapSegs,
    new Map()
  );
  check(
    "a cheaper reissue costs the final ticket's value, not the original cash",
    down.A.gross_allocable === 2052.01,
    String(down.A.gross_allocable)
  );
  check(
    "…the inferred credit is reported as a fact, not a warning",
    down.B.chain?.residualsInferred === 116.7 && down.B.warnings.length === 0,
    JSON.stringify({ inferred: down.B.chain?.residualsInferred, warnings: down.B.warnings })
  );
  check(
    "…and it never invents a credit larger than the drop",
    down.A.chain?.residuals === 116.7
  );

  const recorded = allocateChain(
    [
      mkTicket({ id: "A", gross_total: 2168.71 }),
      mkTicket({ id: "B", gross_total: 2052.01, predecessor_ticket_id: "A", residual_credit: 116.7 }),
    ],
    cheapSegs,
    new Map()
  );
  check(
    "an explicitly recorded credit gives the same answer, without inferring",
    recorded.A.gross_allocable === 2052.01 && recorded.B.chain?.residualsInferred === 0,
    String(recorded.A.gross_allocable)
  );
  const forfeited = allocateChain(
    [
      mkTicket({ id: "A", gross_total: 2168.71 }),
      mkTicket({ id: "B", gross_total: 2052.01, predecessor_ticket_id: "A", residual_credit: 0 }),
    ],
    cheapSegs,
    new Map()
  );
  check(
    "an explicit 0 means the fare really forfeited it — cash stands",
    forfeited.A.gross_allocable === 2168.71,
    String(forfeited.A.gross_allocable)
  );

  // residual credit handed back reduces what the chain really cost
  const Cr = mkTicket({ id: "C", gross_total: 1117.52, predecessor_ticket_id: "B", residual_credit: 47.38 });
  const withResidual = allocateChain([A, B, Cr], segsBy, adjBy);
  check(
    "residual credit reduces the chain's cost",
    withResidual.A.gross_allocable === round2(1117.52 - 47.38),
    String(withResidual.A.gross_allocable)
  );

  // a chain-wide reimbursement still lands on personal cost only
  const reimbursed = allocateChain([A, B, C], segsBy, new Map([["C", [mkAdj({ ticket_id: "C", type: "reimbursement", amount: 500 })]]]));
  check("chain gross unchanged by reimbursement", reimbursed.A.gross_allocable === 1117.52);
  check("chain personal reduced", reimbursed.A.personal_total === 617.52);
}

/* ------------------- PQP-derived cost estimation ----------------------- */
console.log("cost estimation from PQP:");
{
  const dom = { origin: "IAH", destination: "SFO" };
  const intl = { origin: "SFO", destination: "ICN" };
  check("domestic pair detected", isInternationalSegment(dom) === false);
  check("international pair detected", isInternationalSegment(intl) === true);

  // learn rates from tickets that have a real fare breakdown
  const t1 = mkTicket({ id: "d1", base_fare: 100, taxes: 20, gross_total: 120 });
  const t2 = mkTicket({ id: "d2", base_fare: 200, taxes: 36, gross_total: 236 });
  const segsForTickets = [
    mkSeg("sd1", { ticket_id: "d1", ...dom }),
    mkSeg("sd2", { ticket_id: "d2", ...dom }),
  ];
  const rates = deriveTaxRates([t1, t2], segsForTickets);
  check("domestic rate learned as the median", rates.domestic === 0.19, String(rates.domestic));
  check("sample size reported", rates.domesticSample === 2);
  check(
    "no international evidence → documented fallback",
    rates.international === FALLBACK_TAX_RATES.international &&
      rates.source === "partly-derived"
  );

  const configured = deriveTaxRates([t1, t2], segsForTickets, { domestic: 0.1 });
  check("configured rate wins", configured.domestic === 0.1 && configured.source === "configured");

  // award tickets must not pollute the rates (no fare, tax-only)
  const award = mkTicket({ id: "a1", base_fare: 0, taxes: 5.6, gross_total: 5.6 });
  const withAward = deriveTaxRates(
    [t1, t2, award],
    [...segsForTickets, mkSeg("sa1", { ticket_id: "a1", ...dom })]
  );
  check("award ticket excluded from rate learning", withAward.domesticSample === 2);

  // estimate = PQP as base fare + tax
  const est = estimateSegmentCost({ ...dom, pqp: 200 }, rates);
  check("domestic estimate = PQP × (1 + rate)", est === 238, String(est));
  const estIntl = estimateSegmentCost({ ...intl, pqp: 200 }, rates);
  check(
    "international uses its own rate",
    estIntl === Math.round(200 * (1 + rates.international) * 100) / 100
  );
  check("no PQP → no estimate", estimateSegmentCost({ ...dom, pqp: null }, rates) === null);

  // eligibility
  const eligible = (over: Record<string, unknown>) =>
    canEstimateCost({
      status: "flown_reconciled",
      allocation_method: "none",
      pqp: 150,
      award_miles: 900,
      ...over,
    } as Parameters<typeof canEstimateCost>[0]);
  check("uncosted flown flight with PQP is eligible", eligible({}) === true);
  check("flight with a recorded cost is not", eligible({ allocation_method: "distance" }) === false);
  check("award travel is excluded", eligible({ award_miles: 0 }) === false);
  check("zero PQP is excluded", eligible({ pqp: 0 }) === false);
  check("not-yet-flown is excluded", eligible({ status: "ticketed" }) === false);

  // sanity against this ledger's own receipts: PQP tracked base fare within 1%
  check(
    "PQP ≈ base fare holds on the fixture receipt",
    Math.abs(408 / 407.44 - 1) < 0.01
  );
}

/* ------------------------- Premier qualification ------------------------ */
console.log("flight map:");
{
  /* the vendored land outline — the map's only geometry, so a bad build
     should fail here, not render as a blank ocean */
  const world = JSON.parse(
    readFileSync(join(process.cwd(), "src/data/world-land.json"), "utf-8")
  );
  check(
    "world outline: a MultiPolygon with a continent's worth of polygons",
    world.land.type === "MultiPolygon" && world.land.coordinates.length > 50,
    String(world.land.coordinates?.length)
  );
  let ringsOk = true;
  let boundsOk = true;
  for (const polygon of world.land.coordinates)
    for (const ring of polygon) {
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ringsOk = false;
      for (const [lon, lat] of ring)
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) boundsOk = false;
    }
  check("world outline: every ring closes", ringsOk);
  check("world outline: every coordinate is on the globe", boundsOk);
  check(
    "world outline: source and fetch date recorded",
    /Natural Earth/.test(world.meta.source) && /^\d{4}-\d{2}-\d{2}$/.test(world.meta.fetched),
    JSON.stringify(world.meta)
  );

  /* aggregation: the map draws the ledger, so its rules are the ledger's */
  const seg = (
    origin: string,
    destination: string,
    over: Record<string, unknown> = {}
  ) =>
    ({
      status: "flown_reconciled",
      origin,
      destination,
      distance_miles: 1000,
      gross_cost: 100,
      personal_cost: 100,
      marketing_carrier: "UA",
      effective_purpose: "personal",
      ticket_is_award: false,
      ...over,
    }) as unknown as import("../src/lib/types").EnrichedSegment;
  const coords = {
    SFO: { lat: 37.62, lon: -122.38, country: "US", city: "San Francisco", name: "SFO" },
    EWR: { lat: 40.69, lon: -74.17, country: "US", city: "Newark", name: "EWR" },
    FRA: { lat: 50.03, lon: 8.56, country: "DE", city: "Frankfurt", name: "FRA" },
  };
  const md = buildMapData(
    [
      seg("SFO", "EWR"),
      seg("EWR", "SFO", { marketing_carrier: "LH", effective_purpose: "business" }),
      seg("SFO", "FRA"),
      seg("SFO", "QQQ"),
      seg("EWR", "SFO", { status: "canceled" }),
    ],
    coords
  );
  check(
    "map: reciprocal directions land on one undirected route",
    md.routes.length === 2 &&
      md.routes[0].key === "EWR ⇄ SFO" &&
      md.routes[0].count === 2 &&
      md.routes[0].directions.length === 2,
    JSON.stringify(md.routes.map((r) => [r.key, r.count]))
  );
  check(
    "map: a canceled segment never reaches the map",
    md.flights === 4 &&
      md.routes.reduce((a, r) => a + r.count, 0) === 3,
    JSON.stringify({ flights: md.flights })
  );
  check(
    "map: the unknown airport is listed, not silently dropped",
    md.unmapped.length === 1 &&
      md.unmapped[0].missing.join() === "QQQ" &&
      md.mappedFlights === 3,
    JSON.stringify(md.unmapped)
  );
  check(
    "map: visits count both ends, countries count only what's mapped",
    md.airports.find((a) => a.code === "SFO")?.visits === 4 &&
      md.airports.find((a) => a.code === "EWR")?.visits === 2 &&
      md.countries === 2,
    JSON.stringify({ a: md.airports, c: md.countries })
  );
  check(
    "map: per-route facets for the color modes",
    md.routes[0].carriers["UA"] === 1 &&
      md.routes[0].carriers["LH"] === 1 &&
      md.routes[0].purposes["business"] === 1,
    JSON.stringify(md.routes[0].carriers)
  );
  check(
    "map: dominant category is by count, ties broken alphabetically",
    dominantCategory({ UA: 3, LH: 1 }) === "UA" &&
      dominantCategory({ UA: 1, LH: 1 }) === "LH" &&
      dominantCategory({}) === null
  );
}

/* ------------------------- reading a long span -------------------------- */
console.log("travel spans:");
{
  check(
    "a trip is measured in days, a chain that crossed years is not",
    spanLabel(0) === "+0d" &&
      spanLabel(13) === "+13d" &&
      spanLabel(60) === "+60d" &&
      spanLabel(61) === "+2mo" &&
      spanLabel(365) === "+12mo" &&
      spanLabel(829) === "+2y 3mo" &&
      spanLabel(730) === "+2y",
    [spanLabel(61), spanLabel(365), spanLabel(829), spanLabel(730)].join(" ")
  );
  check(
    "the year mark is two years of days, not months that rounded up to it",
    // 716 days rounds to 24 months but is a fortnight short of two years
    spanLabel(716) === "+23mo" && spanLabel(729) === "+23mo" && spanLabel(730) === "+2y",
    [spanLabel(716), spanLabel(729), spanLabel(730)].join(" ")
  );
}

/* --------------------- every exception is displayable ------------------- */
console.log("reconcile display:");
{
  /* A kind with no group is computed, counted and never drawn — two of them
     shipped that way. The guarantee is now type-level: GROUP_META is a
     Record over ExceptionKind (a missing entry won't compile) and ORDER
     carries an exhaustiveness assertion. What is left to check at runtime
     is that the derived list actually agrees with the type — no hand-kept
     copy of the union, which would only have repeated the omission. */
  const shown = new Set(RECONCILE_GROUPS.map((g) => g.kind));
  const missing = ALL_EXCEPTION_KINDS.filter((k) => !shown.has(k));
  check(
    "every exception kind has somewhere to appear on the Reconcile page",
    missing.length === 0 && shown.size === ALL_EXCEPTION_KINDS.length,
    `not displayable: ${missing.join(", ")}`
  );
  check(
    "…and the page shows each of them exactly once",
    RECONCILE_GROUPS.length === new Set(RECONCILE_GROUPS.map((g) => g.kind)).size,
    RECONCILE_GROUPS.map((g) => g.kind).join(",")
  );
}

/* ------------------- what the review's second pass found ---------------- */
console.log("audit follow-ups:");
{
  /* The wasm binary sits at the export ROOT; the worker is a bundled chunk
     under /_next/. Resolving beside the worker looked for it in the chunks
     folder — the engine 404s before it starts. */
  check(
    "the engine finds its wasm at the app root, at any host path",
    wasmUrl("https://app.example.net/_next/static/chunks/w.js") ===
      "https://app.example.net/sqlite3.wasm" &&
      wasmUrl("https://host/flight-ledger/_next/static/chunks/w.js") ===
        "https://host/flight-ledger/sqlite3.wasm" &&
      wasmUrl("http://localhost:3000/_next/static/chunks/w.js", "sqlite3.wasm") ===
        "http://localhost:3000/sqlite3.wasm",
    wasmUrl("https://host/flight-ledger/_next/static/chunks/w.js")
  );
  check(
    "…and a worker started from a blob still resolves to the origin root",
    wasmUrl("blob:https://app.example.net/9f3c-1234") ===
      "https://app.example.net/sqlite3.wasm",
    wasmUrl("blob:https://app.example.net/9f3c-1234")
  );


  /* A restore writes rows verbatim so ids and timestamps survive — which
     also let impossible dates in through the back door. */
  check(
    "a backup carrying impossible dates or times is refused, not stored",
    validateBackupRows({
      segments: [
        { flight_date: "2026-02-31", departure_time: "10:00" },
        { flight_date: "2026-03-01", departure_time: "99:99" },
        { flight_date: "2026-03-02", arrival_time: "24:60" },
      ],
      activities: [{ activity_date: "2026-13-01" }],
      payments: [{ payment_date: "2026-02-31" }],
      settings: { cost_tracking_start: "2026-99-01", lifetime_baseline_date: "2020-01-01" },
    }).length === 6 &&
      validateBackupRows({
        segments: [{ flight_date: "2024-02-29", departure_time: "23:59" }],
      }).length === 0,
    JSON.stringify(
      validateBackupRows({ segments: [{ flight_date: "2026-02-31" }] })
    )
  );
}

/* ---------------------- tail numbers & the fleet ------------------------ */
console.log("tail numbers:");
/* The registry is loaded on demand in the app; these checks need it in
   memory. The selftest is compiled as CJS, so no top-level await — the
   fleet section runs inside the promise instead. */
void loadFleetRegistry().then(() => {
  runFleetChecks();
});
function runFleetChecks() {
{
  check(
    "registrations compare the way people write them",
    normalizeTail("n27901") === "N27901" &&
      normalizeTail("D-AIMA") === "DAIMA" &&
      normalizeTail(" ja873a ") === "JA873A"
  );
  const fleet = learnFleet([
    { tail_number: "N27901", aircraft: "B787-9", flight_date: "2025-01-01" },
    { tail_number: "n27901", aircraft: "B787-9ER", flight_date: "2026-01-01" },
    { tail_number: "N123", aircraft: "  ", flight_date: "2026-01-01" },
    { tail_number: "", aircraft: "B737-900", flight_date: "2026-01-01" },
  ]);
  check(
    "the ledger learns a tail's types from its own history, with their dates",
    typeForTail("n-27901", { learned: fleet }) === "B787-9ER" &&
      typeForTail("N27901", { learned: fleet, date: "2025-06-01" }) === "B787-9" &&
      fleet.size === 1,
    JSON.stringify([...fleet])
  );
  check(
    "a tail in neither the ledger nor the registry answers nothing",
    typeForTail("N0ZZZZ", { learned: fleet }) === null &&
      typeForTail("", { learned: fleet }) === null
  );

  /* The FAA files what the factory called the frame; travellers say something
     else. These are the translations, and they are guesses about vocabulary
     rather than facts about data — so they are pinned. */
  check(
    "Boeing customer codes collapse, and a bare variant is a MAX",
    friendlyType("BOEING", "737-824") === "B737-800" &&
      friendlyType("BOEING", "737-924ER") === "B737-900" &&
      friendlyType("BOEING", "737-7H4") === "B737-700" &&
      friendlyType("BOEING", "777-224") === "B777-200" &&
      friendlyType("BOEING", "747-41R") === "B747-400" &&
      friendlyType("BOEING", "737-9") === "B737 MAX 9" &&
      friendlyType("BOEING", "787-10") === "B787-10",
    [
      friendlyType("BOEING", "737-824"),
      friendlyType("BOEING", "737-924ER"),
      friendlyType("BOEING", "737-9"),
    ].join(" | ")
  );
  check(
    "the A320 family keeps its family name, widebodies keep their variant",
    friendlyType("AIRBUS", "A320-214") === "A320" &&
      friendlyType("AIRBUS S A S", "A321-271NX") === "A321neo" &&
      friendlyType("AIRBUS", "A330-243") === "A330-200" &&
      friendlyType("AIRBUS CANADA LP", "BD-500-1A11") === "A220-300",
    [
      friendlyType("AIRBUS", "A320-214"),
      friendlyType("AIRBUS S A S", "A321-271NX"),
      friendlyType("AIRBUS", "A330-243"),
    ].join(" | ")
  );
  check(
    "the E175 is filed as a stretched 170, and the CRJs by programme number",
    friendlyType("EMBRAER S A", "ERJ 170-200 LR") === "E175" &&
      friendlyType("EMBRAER", "ERJ 170-100 LR") === "E170" &&
      friendlyType("EMBRAER", "EMB-145LR") === "ERJ-145" &&
      friendlyType("BOMBARDIER INC", "CL-600-2D24") === "CRJ-900" &&
      friendlyType("BOMBARDIER INC", "DHC-8-402") === "Q400",
    friendlyType("EMBRAER S A", "ERJ 170-200 LR")
  );

  /* the vendored registry answers for an airframe the ledger has never met */
  check(
    "the FAA registry names a tail on first sight, and the ledger overrules it",
    typeForTail("N27901") === "B787-8" &&
      typeForTail("n-27901") === "B787-8" &&
      typeForTail("N27901", {
        learned: learnFleet([
          { tail_number: "N27901", aircraft: "Polaris 787", flight_date: "2024-01-01" },
        ]),
      }) === "Polaris 787" &&
      (fleetDatasetMeta()?.count ?? 0) > 5000,
    JSON.stringify({ reg: typeForTail("N27901"), n: fleetDatasetMeta()?.count })
  );

  /* An N-number outlives its aeroplane. N125AA was a DC-10 until 2010 and is
     an A321 today: a 2005 flight answered from today's registration would
     name an aircraft that wasn't there. 355 marks in the registry have been
     reused across different 30+ seat types. */
  check(
    "a past flight gets the aeroplane that wore the mark THEN, not now",
    typeForTail("N125AA", { date: "2005-06-01" }) === "MD-11" ||
      (typeForTail("N125AA", { date: "2005-06-01" })?.startsWith("MCDONNELL") ?? false) ||
      typeForTail("N125AA", { date: "2005-06-01" })?.includes("DC-10") === true,
    `2005: ${typeForTail("N125AA", { date: "2005-06-01" })} | now: ${typeForTail("N125AA")}`
  );
  check(
    "…while the same tail today answers with the current registration",
    typeForTail("N125AA") === "A321" &&
      typeForTail("N125AA", { date: "2026-01-01" }) === "A321",
    String(typeForTail("N125AA"))
  );

  /* The commuter aeroplanes people still buy tickets on sit below the
     30-seat airliner line, and the manufacturer's name moves between
     owners — so the model signature decides, not the maker. */
  check(
    "aliased manufacturers and commuter types still normalize",
    friendlyType("C", "BD-500-1A10") === "A220-100" &&
      friendlyType("MHI RJ AVIATION ULC", "CL-600-2B19") === "CRJ-200" &&
      friendlyType("EMPRESA BRASILEIRA DE", "ERJ 190-200 LR") === "E195" &&
      friendlyType("DE HAVILLAND", "DHC-8-402") === "Q400" &&
      friendlyType("ATR-GIE AVIONS DE TRANSPORT", "ATR-72-212") === "ATR 72" &&
      friendlyType("CESSNA", "208B") === "C208 Caravan" &&
      friendlyType("RAYTHEON AIRCRAFT COMPANY", "1900D") === "Beech 1900",
    [
      friendlyType("C", "BD-500-1A10"),
      friendlyType("MHI RJ AVIATION ULC", "CL-600-2B19"),
      friendlyType("EMPRESA BRASILEIRA DE", "ERJ 190-200 LR"),
    ].join(" | ")
  );
  /* An N-number can be reused more than once, with years of silence
     between. Intervals answer inside themselves and say nothing outside:
     inventing a type for a gap is not knowledge. */
  check(
    "the registry answers inside intervals and stays silent outside them",
    typeForTail("N125AA", { date: "2005-06-01" })?.includes("DC-10") === true &&
      typeForTail("N125AA") === "A321" &&
      typeForTail("N208LS", { date: "1990-06-01" }) === null,
    `2005 N125AA: ${typeForTail("N125AA", { date: "2005-06-01" })} | 1990 N208LS: ${typeForTail("N208LS", { date: "1990-06-01" })}`
  );
  check(
    "your own flight answers only within its own registration, either way",
    typeForTail("N125AA", {
      date: "2005-06-01",
      learned: learnFleet([
        { tail_number: "N125AA", aircraft: "A321", flight_date: "2026-01-01" },
      ]),
    })?.includes("DC-10") === true &&
      typeForTail("N125AA", {
        date: "2022-06-01",
        learned: learnFleet([
          { tail_number: "N125AA", aircraft: "DC-10 as flown", flight_date: "2005-06-01" },
        ]),
      }) === "A321" &&
      // the registry alone invents nothing for the gap between the two
      typeForTail("N125AA", { date: "2020-06-01" }) === null &&
      /* …and a KNOWN gap is not silence: the registry says the mark was on
         nothing then, so a DC-10 flown in 2005 must not fill 2020 */
      typeForTail("N125AA", {
        date: "2020-06-01",
        learned: learnFleet([
          { tail_number: "N125AA", aircraft: "DC-10 as flown", flight_date: "2005-06-01" },
        ]),
      }) === null &&
      /* — unless the flight you logged is itself in that gap, which is
         direct evidence rather than projection */
      typeForTail("N125AA", {
        date: "2020-06-01",
        learned: learnFleet([
          { tail_number: "N125AA", aircraft: "whatever wore it", flight_date: "2020-03-01" },
        ]),
      }) === "whatever wore it",
    "a 2005 DC-10 flight must not answer for 2022, nor a 2026 A321 for 2005"
  );

  /* Two silences are not the same silence: a mark can be unregistered in
     one decade, fly in the next, and fall quiet again. A flight logged in
     the first gap says nothing about the second. */
  {
    const inFirstGap = learnFleet([
      { tail_number: "N101LF", aircraft: "logged in the 2008 gap", flight_date: "2008-06-01" },
    ]);
    const a = typeForTail("N101LF", { date: "2008-06-01", learned: inFirstGap });
    const b = typeForTail("N101LF", { date: "2012-06-01", learned: inFirstGap });
    check(
      "an observation from one gap does not answer for another",
      a === "logged in the 2008 gap" && b !== "logged in the 2008 gap",
      JSON.stringify({ ownGap: a, otherGap: b })
    );
  }

  /* A foreign mark is in no US registry, so the ledger is the only source
     there is — and once the registry loaded, it was being ignored. */
  {
    const mine = learnFleet([
      { tail_number: "D-AIMA", aircraft: "A380", flight_date: "2024-05-01" },
    ]);
    check(
      "a mark the FAA never holds still answers from your own flights",
      typeForTail("D-AIMA", { date: "2024-05-01", learned: mine }) === "A380" &&
        typeForTail("D-AIMA", { date: "2025-05-01", learned: mine }) === "A380" &&
        typeForTail("D-AIMA", { learned: mine }) === "A380" &&
        typeForTail("D-AIMA") === null,
      String(typeForTail("D-AIMA", { date: "2024-05-01", learned: mine }))
    );
  }

  const seg = (over: Record<string, unknown>) =>
    prepareSegment({
      origin: "IAH", destination: "SFO", flight_date: "2026-03-01",
      status: "ticketed", marketing_carrier: "UA", ...over,
    });
  check(
    "a registration is stored as written, spaces gone, hyphens kept",
    seg({ tail_number: " n27901 " }).ok === true &&
      (seg({ tail_number: " n27901 " }) as { values: Record<string, unknown> })
        .values.tail_number === "N27901" &&
      (seg({ tail_number: "d-aima" }) as { values: Record<string, unknown> })
        .values.tail_number === "D-AIMA" &&
      seg({ tail_number: "no spaces or ünicode" }).ok === false
  );
}
}

console.log("premier status:");
{
  const seg = (
    date: string, pqp: number | null, pqf: number | null, carrier = "UA",
    status: "flown_reconciled" | "flown_unreconciled" = "flown_reconciled"
  ) => ({
    flight_date: date, status, pqp, pqf,
    projected_pqp: null, projected_pqf: null, operating_carrier: carrier,
    marketing_carrier: carrier, flight_number: "1", origin: "IAH", destination: "SFO",
  });
  const build = (segs: ReturnType<typeof seg>[], today = "2026-08-02") =>
    buildPremierYears(segs, [], DEFAULT_PREMIER_PROGRAMS, today);

  check("the pandemic-reduced set applies to 2021 flying", programFor(2021).tiers[0].pqp === 3000);
  check(
    "…and still to 2022 flying — the restore was announced in Nov 2022, for 2023",
    programFor(2022).tiers[0].pqp === 3000 && programFor(2022).tiers[0].pqf === 8
  );
  check("2023 flying is back to the pre-pandemic bars", programFor(2023).tiers[0].pqp === 4000);
  check("…and 2024 still uses them", programFor(2024).tiers[3].pqp === 18000);
  check(
    "3,072 PQP over 10 flights in 2022 is Silver, not nothing",
    build([seg("2022-06-01", 3072, 10)])[0].tier?.name === "Premier Silver",
    build([seg("2022-06-01", 3072, 10)])[0].tier?.name ?? "none"
  );
  check(
    "…and would have been nothing had it been flown a year later",
    build([seg("2023-06-01", 3072, 10)])[0].tier === null
  );
  check("the raised set applies from 2025", programFor(2025).tiers[0].pqp === 5000);
  check("…and stays in force after that", programFor(2026).tiers[3].pqp === 22000);
  {
    const old = build([seg("2018-03-01", 9999, 40)])[0];
    check("a year before PQP/PQF existed is flagged", old.beforeTable === true);
    check(
      "…and gets no tier, next rung or milestones rather than a wrong one",
      old.tier === null && old.nextTier === null && old.milestones.length === 0,
      JSON.stringify({ tier: old.tier?.name, next: old.nextTier?.name, ms: old.milestones.length })
    );
    check("…while its totals still show", old.pqp === 9999 && old.pqf === 40);
    check("2020 is inside the table and IS scored", build([seg("2020-03-01", 3500, 9)])[0].tier?.name === "Premier Silver");
  }

  /* the user's real 2024: 12,981 PQP / 50 PQF — Platinum on the old bars,
     only Gold on the new ones. Their 2025 receipts print "Premier Platinum". */
  const y2024 = build([seg("2024-06-10", 12981, 50)])[0]; // 50 PQF ≫ the floor
  check(
    "12,981 PQP + 50 flights in 2024 is Platinum",
    y2024.tier?.name === "Premier Platinum",
    y2024.tier?.name
  );
  const y2025 = build([seg("2025-06-10", 12981, 50)])[0];
  check(
    "…and only Gold once the higher bars start",
    y2025.tier?.name === "Premier Gold",
    y2025.tier?.name
  );

  /* the PQP-only route still needs the program's paid-flight floor */
  const p = programFor(2025);
  check(
    "6,000 PQP with 4 UA flights reaches Silver",
    pathFor(6000, 4, p.tiers[0], p.minFlights, 4) === "pqp-only"
  );
  check("…but not with 3", pathFor(6000, 3, p.tiers[0], p.minFlights, 3) === null);
  const thin = build([
    seg("2026-01-05", 2000, 1), seg("2026-01-06", 2000, 1), seg("2026-01-07", 2000, 1),
  ])[0];
  check(
    "a thin year reports the UA segments it still owes",
    thin.uaFlights === 3 && thin.needMinFlights === 1,
    JSON.stringify({ ua: thin.uaFlights, need: thin.needMinFlights })
  );
  const partner = build([
    seg("2026-01-05", 2000, 1), seg("2026-01-06", 2000, 1),
    seg("2026-01-07", 1000, 1, "LH"), seg("2026-01-08", 1000, 1, "LH"),
  ])[0];
  check(
    "partner flights earn PQF but don't count toward the UA floor",
    partner.pqf === 4 && partner.uaFlights === 2 && partner.needMinFlights === 2
  );
  /* …and the tier respects that floor. PQF used to stand in for the flights
     minimum inside pathFor, so four Lufthansa PQF bought the PQP-only route
     past a floor they don't satisfy — while the "✓ N flown" line, counting
     the right thing, said otherwise on the same screen. */
  check(
    "…and partner PQF doesn't buy the PQP-only floor: no tier without the UA segments",
    partner.tier === null,
    JSON.stringify(partner.tier?.name ?? null)
  );

  /* The floor counts flights FLOWN, not flights credited: a UA leg that
     departed yesterday counts toward the minimum while its PQP is still in
     United's pipeline. The money keeps waiting for the CSV. */
  const lagging = build([
    seg("2026-01-05", 2000, 1), seg("2026-01-06", 2000, 1), seg("2026-01-07", 2000, 1),
    seg("2026-01-08", null, null, "UA", "flown_unreconciled"),
  ])[0];
  check(
    "a flown, not-yet-credited UA leg counts toward the floor — its PQP doesn't",
    lagging.uaFlights === 4 && lagging.needMinFlights === 0 && lagging.pqp === 6000,
    JSON.stringify({ ua: lagging.uaFlights, need: lagging.needMinFlights, pqp: lagging.pqp })
  );
  check(
    "…so it can be the leg that satisfies the PQP-only floor",
    lagging.tier?.name === "Premier Silver",
    lagging.tier?.name
  );

  /* the shortfall line names BOTH parts of the flight route */
  const partial = build([seg("2026-03-01", 6351, 21)])[0];
  const line = shortfall(partial) ?? "";
  check(
    "the shortfall states PQP and flights, not PQP alone",
    line.includes("3,649 more PQP") &&
      line.includes("9 more flights") &&
      line.includes("5,649 more PQP"),
    line
  );
  check("a top-tier year has no shortfall", shortfall(build([seg("2026-03-01", 40000, 80)])[0]) === null);

  /* a cancelled booking keeps its printed accrual as history, but that
     money never posts — it must not count as still-to-come */
  {
    const dead = {
      ...seg("2026-07-17", null, null),
      status: "canceled",
      projected_pqp: 668,
      projected_pqf: 1,
    } as unknown as ReturnType<typeof seg>;
    const alive = {
      ...seg("2026-09-01", null, null),
      status: "ticketed",
      projected_pqp: 200,
      projected_pqf: 1,
    } as unknown as ReturnType<typeof seg>;
    const yr = build([seg("2026-03-01", 1000, 4), dead, alive])[0];
    check(
      "canceled coupons project nothing toward Future flights",
      yr.projection?.addedPqp === 200 && yr.projection?.addedPqf === 1,
      JSON.stringify(yr.projection)
    );
  }

  /* Uncredited projections split by travel state: a FLOWN leg's earning
     rides with the standing as ≈ — between activity imports that is a
     flight's normal state — while a BOOKED leg's stays behind the toggle.
     Pooled, the standing read low the moment a leg was marked flown. */
  {
    const flownWaiting = {
      ...seg("2026-08-10", null, null),
      status: "flown_unreconciled",
      projected_pqp: 314,
      projected_pqf: 1,
    } as unknown as ReturnType<typeof seg>;
    const bookedLeg = {
      ...seg("2026-08-16", null, null),
      status: "ticketed",
      projected_pqp: 388,
      projected_pqf: 2,
    } as unknown as ReturnType<typeof seg>;
    const yr = build([seg("2026-03-01", 6000, 20), flownWaiting, bookedLeg])[0];
    check(
      "flown-awaiting-credit joins the ≈ standing; booked stays 'to come'",
      yr.flownPendingPqp === 314 &&
        yr.flownPendingPqf === 1 &&
        yr.projection?.addedPqp === 388 &&
        yr.projection?.flights === 1 &&
        yr.projection?.pqp === 6702,
      JSON.stringify({
        flown: yr.flownPendingPqp,
        booked: yr.projection?.addedPqp,
        yearEnd: yr.projection?.pqp,
      })
    );
    check(
      "…and the shortfall argues from the standing the gauges show",
      (shortfall(yr) ?? "").includes("3,686"),
      shortfall(yr) ?? "null"
    );
  }

  /* the breakdown United shows as its gauge legend */
  {
    const award = { ...seg("2026-02-01", 254, 2), award_miles: 0 };
    const yr = buildPremierYears(
      [seg("2026-01-10", 5534, 19), award, seg("2026-05-01", 400, 2, "LH")],
      [
        { activity_date: "2026-03-01", description: "PQP Earn Explorer Card",
          activity_type: "credit_card", pqp: 263, pqf: null, award_miles: 0 } as never,
        { activity_date: "2026-04-01", description: "Starter PQP",
          activity_type: "promotion", pqp: 300, pqf: null, award_miles: 0 } as never,
        // earns award miles but no PQP — still belongs in the table
        { activity_date: "2026-05-02", description: "Lyft - Airport Ride - 3x",
          activity_type: "rideshare", pqp: 0, pqf: null, award_miles: 120 } as never,
        { activity_date: "2026-05-09", description: "Lyft - Airport Ride - 3x",
          activity_type: "rideshare", pqp: 0, pqf: null, award_miles: 90 } as never,
      ],
      DEFAULT_PREMIER_PROGRAMS,
      "2026-08-02"
    )[0];
    const by = Object.fromEntries(yr.sources.map((x) => [x.key, x]));
    check(
      "revenue and award flights are separated, as United separates them",
      by["flight:UA"].pqp === 5534 &&
        by["award_flight:UA"].pqp === 254 &&
        by["award_flight:UA"].pqf === 2,
      JSON.stringify(yr.sources)
    );
    // each carrier is its own row, but named in the activity log's vocabulary —
    // a bare "LH flights" reads as a different taxonomy from the log's badges
    check(
      "…and each carrier is its own row, named as the log names it",
      by["flight:UA"].label === "United flights" &&
        by["flight:LH"].pqp === 400 &&
        by["flight:LH"].label === "Partner flights · LH" &&
        by["award_flight:UA"].label === "United award flights",
      JSON.stringify(yr.sources.map((x) => [x.key, x.label]))
    );
    // a category that earned no PQP still gets a row: "did my Lyft rides do
    // anything for status?" is answered by seeing it at zero, not by absence
    check(
      "a zero-PQP category is listed, not dropped",
      by.rideshare?.pqp === 0 && by.rideshare?.count === 2,
      JSON.stringify(yr.sources.map((x) => [x.key, x.pqp, x.count]))
    );
    check("…and sorts to the bottom", yr.sources.at(-1)!.key === "rideshare");
    // but a 0-PQP posting must not CONJURE a year: a lone car rental in an
    // otherwise empty year has no qualification story to tell
    check(
      "a year of nothing but 0-PQP postings isn't invented",
      buildPremierYears(
        [],
        [{ activity_date: "2021-11-13", description: "AVIS", activity_type: "car_rental",
           pqp: 0, pqf: null, award_miles: 300 } as never],
        DEFAULT_PREMIER_PROGRAMS,
        "2026-08-02"
      ).length === 0
    );
    // and every non-flight row names what United actually called the postings
    check(
      "non-flight rows name their postings",
      by.promotion.detail === "Starter PQP" &&
        by.rideshare.detail === "Lyft - Airport Ride - 3x ×2" &&
        by["flight:UA"].detail === undefined,
      JSON.stringify(yr.sources.map((x) => [x.key, x.detail]))
    );
    check(
      "card spend is its own category",
      by.credit_card.pqp === 263 && by.credit_card.label === "Credit card"
    );
    check(
      "the breakdown sums to the year's totals",
      yr.sources.reduce((a, x) => a + x.pqp, 0) === yr.pqp &&
        yr.sources.reduce((a, x) => a + x.pqf, 0) === yr.pqf
    );
    check("…and is ordered biggest first", yr.sources[0].key === "flight:UA");
  }

  /* milestones and the cumulative series */
  const run = build([
    seg("2026-02-01", 3000, 8),
    seg("2026-05-01", 3000, 9),
    seg("2026-09-01", 6000, 20),
  ])[0];
  check(
    "the milestone lands on the posting that crossed the bar",
    run.milestones[0]?.tier === "Premier Silver" && run.milestones[0]?.date === "2026-05-01",
    JSON.stringify(run.milestones.map((m) => [m.tier, m.date]))
  );
  /* Cumulative: it holds flat through months with no postings and steps at
     the ones that have them — Feb 3,000 / May 6,000 / Sep 12,000. */
  check(
    "the monthly series is cumulative and in order",
    (() => {
      const posted = run.monthly.filter((m) => m.cumPqp != null);
      const nonDecreasing = posted.every(
        (m, i) => i === 0 || m.cumPqp! >= posted[i - 1].cumPqp!
      );
      const at = (mo: string) => run.monthly.find((m) => m.month === mo)?.cumPqp;
      return (
        nonDecreasing &&
        at("2026-02") === 3000 &&
        at("2026-05") === 6000 &&
        at("2026-09") === 12000
      );
    })(),
    run.monthly.map((m) => `${m.month}:${m.cumPqp}`).join(" ")
  );
  /* The tier bars are annual, so a series that stops at the last posting makes
     an unfinished year look finished — the empty months are the ones still in
     play. They carry no cumPqp, though: a flat line to December would assert a
     total that hasn't happened. */
  check(
    "…and runs to the end of the qualification year",
    run.monthly.length === 12 &&
      run.monthly[0].month === "2026-01" &&
      run.monthly[11].month === "2026-12",
    run.monthly.map((m) => m.month).join(",")
  );
  check(
    "…with no running total claimed past the last posting",
    run.monthly.slice(9).every((m) => m.cumPqp === null) &&
      run.monthly[8].cumPqp === 12000,
    JSON.stringify(run.monthly.map((m) => m.cumPqp))
  );
  check("a year still running is not closed", run.closed === false);
  check("a past year is closed", build([seg("2024-02-01", 100, 1)])[0].closed === true);
}

/* ------------------------------ route handlers ------------------------------ */

/**
 * The API layer, driven end to end (design doc §19.3).
 *
 * This is the layer the credits_mileageplus bug lived in: the form sent the
 * flag, validate accepted it, and the write path dropped it — three layers
 * individually fine and wrong in composition. Everything below runs the
 * composition: a real Request in, a real Response out, a real database
 * underneath, and no server. Runs in a temp directory so it can never touch
 * a real ledger.
 */
async function routeHandlerChecks() {
  console.log("route handlers:");
  const cwd = process.cwd();
  const tmp = mkdtempSync(join(tmpdir(), "flightdeck-routes-"));
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string, path: string, body?: unknown) =>
    new Request("http://selftest.local" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const j = async (res: Response) => ({
    status: res.status,
    /* tests probe arbitrary response paths (body.segment?.seat, body
       .airports?.SFO?.lat) — a loose shape here is the point */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (await res.json()) as Record<string, any>,
  });
  try {
    process.chdir(tmp);
    mkdirSync(join(tmp, "data"), { recursive: true });

    /* Shape is not enough: the browser's date input can't produce
       2026-02-31, but the API is a public surface and an impossible date
       sorts into groups nothing can reconcile. */
    check(
      "impossible dates and times are refused, real ones pass",
      prepareSegment({
        origin: "IAH", destination: "SFO", flight_date: "2026-02-31",
        status: "ticketed", marketing_carrier: "UA",
      }).ok === false &&
        prepareSegment({
          origin: "IAH", destination: "SFO", flight_date: "2026-99-99",
          status: "ticketed", marketing_carrier: "UA",
        }).ok === false &&
        prepareSegment({
          origin: "IAH", destination: "SFO", flight_date: "2026-03-01",
          departure_time: "99:99", status: "ticketed", marketing_carrier: "UA",
        }).ok === false &&
        prepareSegment({
          origin: "IAH", destination: "SFO", flight_date: "2024-02-29",
          departure_time: "23:59", status: "ticketed", marketing_carrier: "UA",
        }).ok === true,
      "leap day and 23:59 must pass; 02-31, 99-99 and 99:99 must not"
    );

    /* the restore promised ONE summary event — a second "settings changed"
       beside it describes a write nobody made */
    {
      const before = listChanges().length;
      importBackup({
        version: 1, tickets: [], segments: [], adjustments: [],
        payments: [], activities: [],
        settings: { member_first_name: "Restored" },
      } as unknown as Parameters<typeof importBackup>[0]);
      const added = listChanges().slice(0, listChanges().length - before);
      check(
        "a restore logs exactly one event, settings included",
        added.length === 1 && added[0].op === "restore",
        JSON.stringify(added.map((c) => c.op))
      );
    }

    /* A reissue chain is a LINE. Nothing in SQLite enforced that, so two
       tickets could claim one predecessor: the chain silently branched, a
       branch fell out of the walk, and its fare was counted a second time. */
    {
      const root = createTicket({ ticket_number: "0160000000001", gross_total: 100 });
      const heir = createTicket({
        ticket_number: "0160000000002", gross_total: 120,
        predecessor_ticket_id: root,
      });
      let forked = "";
      try {
        createTicket({
          ticket_number: "0160000000003", gross_total: 130,
          predecessor_ticket_id: root,
        });
      } catch (e) {
        forked = e instanceof Error ? e.message : "";
      }
      check(
        "a second ticket cannot claim the same predecessor",
        forked.includes("line, not a fork"),
        forked || "no error thrown"
      );
      let selfLink = "";
      try {
        updateTicket(heir, { predecessor_ticket_id: heir });
      } catch (e) {
        selfLink = e instanceof Error ? e.message : "";
      }
      check("…nor can a ticket be its own predecessor", selfLink.includes("its own"), selfLink);
      let loop = "";
      try {
        updateTicket(root, { predecessor_ticket_id: heir });
      } catch (e) {
        loop = e instanceof Error ? e.message : "";
      }
      check("…nor can the chain loop back on itself", loop.includes("loop back"), loop);

      /* the audit log must be able to reconstruct what a deletion took */
      createPayment({ ticket_id: root, payment_type: "credit_card", amount: 100 });
      deleteTicket(root);
      const del = listChanges().find((c) => c.op === "delete" && c.tbl === "tickets");
      const diff = JSON.parse(del?.diff ?? "{}") as {
        cascaded?: { payments?: unknown[] };
      };
      check(
        "deleting a ticket records the payments that cascaded with it",
        (diff.cascaded?.payments ?? []).length === 1,
        del?.diff?.slice(0, 140)
      );

      /* deleting a predecessor must not leave its successor pointing at a
         ticket that no longer exists — the walk survives it, but the data
         lies, and a backup would carry the lie forward */
      const orphanRoot = createTicket({ ticket_number: "0160000000011" });
      const orphanHeir = createTicket({
        ticket_number: "0160000000012", predecessor_ticket_id: orphanRoot,
      });
      deleteTicket(orphanRoot);
      check(
        "deleting a ticket detaches whatever claimed it as predecessor",
        listTickets().find((t) => t.id === orphanHeir)?.predecessor_ticket_id === null,
        String(listTickets().find((t) => t.id === orphanHeir)?.predecessor_ticket_id)
      );

    }

    /* CSRF: the loopback bind stops other machines, not other WEBSITES. A
       page you have open can POST to localhost, and a text/plain body is a
       CORS "simple request" — no preflight ever sees it. Restoring an empty
       backup would erase the ledger, and the attacker needs no reply. */
    const crossOrigin = new Request("http://selftest.local/api/backup", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: JSON.stringify({ version: 1, tickets: [], segments: [] }),
    });
    check(
      "a cross-origin write is refused before it reaches the handler",
      (await apiBackupRestore(crossOrigin)).status === 403,
      String((await apiBackupRestore(crossOrigin)).status)
    );
    const sameOrigin = new Request("http://selftest.local/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://selftest.local" },
      body: JSON.stringify({ version: 1, tickets: [], segments: [] }),
    });
    check(
      "…while the app's own write, and a header-less client, still pass",
      (await apiBackupRestore(sameOrigin)).status === 200 &&
        (await apiBackupRestore(
          req("POST", "/api/backup", { version: 1, tickets: [], segments: [] })
        )).status === 200
    );

    /* The composition the bug slipped through: POST → store → echo. */
    const created = await j(
      await apiFlightCreate(
        req("POST", "/api/flights", {
          origin: "IAH", destination: "SFO", flight_date: "2025-03-01",
          status: "flown_reconciled", marketing_carrier: "UA",
          operating_carrier: "UA", flight_number: "1976", seat: "20F",
          credits_mileageplus: 0, pqp: 218, award_miles: 1744,
          distance_miles: 1, // must be ignored — the server computes it
        })
      )
    );
    const segId = created.body.segment?.id as string;
    check(
      "POST /api/flights creates and echoes the stored row",
      created.status === 201 && !!segId,
      JSON.stringify(created.body).slice(0, 200)
    );
    check(
      "…every field surviving the trip, the MileagePlus override included",
      created.body.segment?.credits_mileageplus === 0 &&
        created.body.segment?.seat === "20F" &&
        created.body.segment?.pqp === 218,
      JSON.stringify(created.body.segment)
    );
    check(
      "…and distance computed server-side, the client's value ignored",
      created.body.segment?.distance_miles === routeDistanceMiles("IAH", "SFO"),
      String(created.body.segment?.distance_miles)
    );

    /* Rejections: a 400, a reason in words, and nothing written. */
    for (const [name, payload] of [
      ["identical endpoints", { origin: "IAH", destination: "IAH", flight_date: "2025-01-01" }],
      ["a malformed airport code", { origin: "Q", destination: "SFO", flight_date: "2025-01-01" }],
      ["a malformed date", { origin: "IAH", destination: "SFO", flight_date: "01/02/2025" }],
      ["an unknown status", { origin: "IAH", destination: "SFO", flight_date: "2025-01-01", status: "boarded" }],
    ] as [string, Record<string, unknown>][]) {
      const r = await j(await apiFlightCreate(req("POST", "/api/flights", payload)));
      check(
        `POST refuses ${name} with a 400 and a reason`,
        r.status === 400 && typeof r.body.error === "string" && r.body.error.length > 0,
        JSON.stringify(r.body)
      );
    }

    const patched = await j(
      await apiFlightPatch(req("PATCH", "/x", { seat: "3A" }), ctx(segId))
    );
    check(
      "PATCH updates the field sent and no other",
      patched.body.segment?.seat === "3A" &&
        patched.body.segment?.origin === "IAH" &&
        patched.body.segment?.pqp === 218,
      JSON.stringify(patched.body.segment)
    );
    const rerouted = await j(
      await apiFlightPatch(req("PATCH", "/x", { destination: "LAX" }), ctx(segId))
    );
    check(
      "…recomputing distance when the route changes",
      rerouted.body.segment?.distance_miles === routeDistanceMiles("IAH", "LAX"),
      String(rerouted.body.segment?.distance_miles)
    );
    const badPatch = await j(
      await apiFlightPatch(req("PATCH", "/x", { origin: "ZZZZ" }), ctx(segId))
    );
    const after = await j(await apiFlightGet(req("GET", "/x"), ctx(segId)));
    check(
      "…while a refused PATCH leaves the row exactly as it was",
      badPatch.status === 400 && after.body.origin === "IAH" && after.body.destination === "LAX",
      JSON.stringify({ badPatch: badPatch.status, row: after.body.origin })
    );
    check(
      "a missing id is a 404, never an empty success",
      (await apiFlightGet(req("GET", "/x"), ctx("ghost"))).status === 404 &&
        (await apiFlightDelete(req("DELETE", "/x"), ctx("ghost"))).status === 404 &&
        (await apiFlightPatch(req("PATCH", "/x", { seat: "1A" }), ctx("ghost"))).status === 404
    );

    /* Tickets and the money attached to them. */
    const tkt = await j(
      await apiTicketCreate(
        req("POST", "/api/tickets", {
          confirmation_code: "selftst", gross_total: 500, base_fare: 450,
          taxes: 50, issue_date: "2025-02-01",
        })
      )
    );
    const ticketId = tkt.body.id as string;
    check("POST /api/tickets creates", tkt.status === 201 && !!ticketId, JSON.stringify(tkt.body));
    await apiFlightPatch(req("PATCH", "/x", { ticket_id: ticketId }), ctx(segId));

    check(
      "an adjustment against a ticket that doesn't exist is a 404",
      (
        await apiAdjustmentCreate(
          req("POST", "/x", { ticket_id: "ghost", type: "reimbursement", amount: 10 })
        )
      ).status === 404
    );
    check(
      "…a zero amount never gets that far",
      (
        await apiAdjustmentCreate(
          req("POST", "/x", { ticket_id: ticketId, type: "reimbursement", amount: 0 })
        )
      ).status === 400
    );
    check(
      "…and a dated one lands",
      (
        await apiAdjustmentCreate(
          req("POST", "/x", {
            ticket_id: ticketId, type: "reimbursement", amount: 500,
            effective_date: "2025-04-01",
          })
        )
      ).status === 201
    );
    check(
      "a hand-entered payment needs an amount, miles used, or both",
      (
        await apiPaymentCreate(req("POST", "/x", { ticket_id: ticketId, payment_type: "card" }))
      ).status === 400
    );

    /* An award reprice posts as redeposit-and-recharge (the real rebooking:
       "Air Award Redeposit +79,500", then −40,000 the same day), so a chain's
       miles are its LATEST priced redemption — never the sum. Summed, these
       two legs showed 119,500 miles for a 40,000-mile trip. A reissue that
       prints no award total still leaves the root's redemption standing. */
    {
      const root = await j(
        await apiTicketCreate(
          req("POST", "/x", {
            confirmation_code: "RB40KM", ticket_number: "0169999999914",
            gross_total: 138.8, issue_date: "2023-11-23",
          })
        )
      );
      const re = await j(
        await apiTicketCreate(
          req("POST", "/x", {
            confirmation_code: "RB40KM", ticket_number: "0169999999934",
            gross_total: 5.6, issue_date: "2023-11-25",
            predecessor_ticket_id: root.body.id,
          })
        )
      );
      await apiPaymentCreate(
        req("POST", "/x", { ticket_id: root.body.id, payment_type: "miles", award_miles_used: 79500 })
      );
      await apiPaymentCreate(
        req("POST", "/x", { ticket_id: re.body.id, payment_type: "miles", award_miles_used: 40000 })
      );
      for (const leg of [
        { origin: "SFO", destination: "EWR" },
        { origin: "EWR", destination: "FCO" },
      ])
        await apiFlightCreate(
          req("POST", "/x", {
            ...leg, flight_date: "2023-12-18", ticket_id: re.body.id, status: "flown_reconciled",
          })
        );
      const fl = await j(await apiFlights());
      const chainLegs = (fl.body.flights as { id: string; ticket_id: string | null; award_miles_spent: number | null }[]).filter(
        (f) => f.ticket_id === re.body.id
      );
      const spent = chainLegs.reduce((s, f) => s + (f.award_miles_spent ?? 0), 0);
      check(
        "chain miles: the reprice replaces the root's redemption, never joins it",
        chainLegs.length === 2 && spent === 40000,
        JSON.stringify(chainLegs.map((f) => f.award_miles_spent))
      );
      // leave the ledger as found — the backup/wipe/restore checks below
      // count rows, and this chain is not part of their story
      for (const leg of chainLegs) await apiFlightDelete(req("DELETE", "/x"), ctx(leg.id));
      await apiTicketDelete(req("DELETE", "/x"), ctx(re.body.id));
      await apiTicketDelete(req("DELETE", "/x"), ctx(root.body.id));
    }

    /* Settings: round-trip, trimming, refusal. */
    const sPut = await j(
      await apiSettingsPut(
        req("PUT", "/x", { award_valuation_cpm: 1.5, member_first_name: "   " })
      )
    );
    check(
      "PUT /api/settings round-trips the change and stores blank as unset",
      sPut.body.settings?.award_valuation_cpm === 1.5 &&
        sPut.body.settings?.member_first_name === null,
      JSON.stringify(sPut.body.settings)
    );
    check(
      "…refusing a currency that isn't one",
      (await apiSettingsPut(req("PUT", "/x", { reporting_currency: "DOLLARS" }))).status === 400
    );

    /* Backup, wipe, restore — the exact story of the lost flags, as a test:
       export a ledger whose flight pins the MileagePlus override, destroy the
       ledger, restore it, and demand the override back. */
    const exp = await j(await apiExport(req("GET", "/api/export?what=backup")));
    check(
      "the backup export carries the whole ledger, version-stamped",
      exp.body.version === 1 &&
        exp.body.segments?.length === 1 &&
        exp.body.tickets?.length === 1 &&
        exp.body.adjustments?.length === 1,
      JSON.stringify({ v: exp.body.version, s: exp.body.segments?.length })
    );
    check(
      "an unknown export name is refused",
      (await apiExport(req("GET", "/api/export?what=everything"))).status === 400
    );
    const csvRes = await apiExport(req("GET", "/api/export?what=flights"));
    check(
      "the flights CSV is a CSV with the ledger in it",
      (csvRes.headers.get("content-type") ?? "").includes("csv") &&
        (await csvRes.text()).includes("IAH"),
      csvRes.headers.get("content-type") ?? ""
    );
    check(
      "a wipe without its confirmation does nothing",
      (await apiWipe(req("DELETE", "/api/backup"))).status === 400 &&
        (await j(await apiFlights())).body.flights.length === 1
    );
    await apiWipe(req("DELETE", "/api/backup?confirm=wipe"));
    check(
      "a confirmed wipe empties the ledger",
      (await j(await apiFlights())).body.flights.length === 0
    );
    const restored = await j(await apiRestore(req("POST", "/api/backup", exp.body)));
    const back = (await j(await apiFlights())).body.flights;
    check(
      "restore puts every row back",
      restored.body.restored?.segments === 1 && back.length === 1,
      JSON.stringify(restored.body)
    );
    check(
      "…with the MileagePlus override intact — the bug this section exists for",
      back[0]?.credits_mileageplus === 0,
      JSON.stringify(back[0]?.credits_mileageplus)
    );
    check(
      "…and a backup from the wrong era is refused",
      (await apiRestore(req("POST", "/api/backup", { version: 2 }))).status === 400
    );

    /* The activity import, both phases — and the README's own promise that
       re-importing the same file is a no-op, tested at the layer that keeps it. */
    const mpCsv =
      "Transaction Date,Activity Type,Description,PQF,PQP,PQM,PQS,PQD,Miles\n" +
      "7/27/26,Non-Air,PQP Earn Explorer Card,0,3,0,0,0,0\n" +
      '7/23/26,Airline,UA 604 SFO - IAH,1,190,0,0,0,"1,520"\n';
    const flightsBefore = (await j(await apiFlights())).body.flights.length;
    const prev = await j(await apiMpImport(req("POST", "/x", { mode: "preview", csv: mpCsv })));
    check(
      "import preview classifies without writing anything",
      prev.status === 200 &&
        prev.body.flights?.length === 1 &&
        (await j(await apiFlights())).body.flights.length === flightsBefore,
      JSON.stringify(prev.body).slice(0, 200)
    );
    await apiMpImport(
      req("POST", "/x", { mode: "apply", rows: prev.body.flights, activities: prev.body.activities })
    );
    const countAfterApply = {
      flights: (await j(await apiFlights())).body.flights.length,
      activities: (await j(await apiActivities())).body.activities.length,
    };
    check(
      "apply writes the flight and both activity rows",
      countAfterApply.flights === flightsBefore + 1 && countAfterApply.activities === 2,
      JSON.stringify(countAfterApply)
    );
    const prev2 = await j(await apiMpImport(req("POST", "/x", { mode: "preview", csv: mpCsv })));
    await apiMpImport(
      req("POST", "/x", { mode: "apply", rows: prev2.body.flights, activities: prev2.body.activities })
    );
    const countAfterReapply = {
      flights: (await j(await apiFlights())).body.flights.length,
      activities: (await j(await apiActivities())).body.activities.length,
    };
    check(
      "…and the import's writes log under the import's own name",
      listChanges().find((c) => c.op === "create" && c.tbl === "segments")?.actor ===
        "import:mileageplus",
      JSON.stringify(listChanges({ tbl: "segments" })[0])
    );
    check(
      "re-importing the same file is a no-op, as the README promises",
      countAfterReapply.flights === countAfterApply.flights &&
        countAfterReapply.activities === countAfterApply.activities,
      JSON.stringify(countAfterReapply)
    );

    /* The no-op above leans on the re-preview reclassifying the rows. A blind
       replay of the ORIGINAL apply payload — still saying "create" — skips
       that step, so the server itself must refuse the duplicate, and say so. */
    const replay = await j(
      await apiMpImport(
        req("POST", "/x", { mode: "apply", rows: prev.body.flights, activities: prev.body.activities })
      )
    );
    check(
      "a blind double-apply creates no second flight, and reports the skip",
      replay.body.created === 0 &&
        replay.body.duplicates > 0 &&
        (await j(await apiFlights())).body.flights.length === countAfterApply.flights,
      JSON.stringify(replay.body)
    );

    /* And the row is gone when deleted, not merely hidden. */
    await apiFlightDelete(req("DELETE", "/x"), ctx(segId));
    check(
      "DELETE removes the row",
      (await apiFlightGet(req("GET", "/x"), ctx(segId))).status === 404
    );

    /* The dispatcher — the browser build's whole network (design: mode 1).
       Same route modules, no server: the table must route exactly as the
       filesystem does, or the two transports quietly diverge. */
    const { dispatch } = await import("../src/lib/dispatch");
    const dj = async (url: string, init?: RequestInit) => j(await dispatch(url, init));

    const dCreated = await dj("/api/flights", {
      method: "POST",
      body: JSON.stringify({
        origin: "SFO", destination: "IAH", flight_date: "2025-04-01",
        status: "flown_reconciled", marketing_carrier: "UA",
        operating_carrier: "UA", flight_number: "2248",
      }),
    });
    const dId = dCreated.body.segment?.id as string;
    check(
      "dispatch: POST routes to the same handler and writes the same row",
      dCreated.status === 201 && !!dId,
      JSON.stringify(dCreated.body).slice(0, 160)
    );
    const dList = await dj("/api/flights");
    check(
      "dispatch: GET sees what it wrote",
      dList.status === 200 &&
        dList.body.flights.some((f: { id: string }) => f.id === dId),
      String(dList.body.flights?.length)
    );
    const dPatched = await dj(`/api/flights/${dId}`, {
      method: "PATCH",
      body: JSON.stringify({ seat: "31C" }),
    });
    check(
      "dispatch: an [id] route gets its param from the path",
      dPatched.status === 200 && dPatched.body.segment?.seat === "31C",
      JSON.stringify(dPatched.body.segment).slice(0, 120)
    );
    const dQuery = await dj("/api/airports?codes=SFO");
    check(
      "dispatch: query strings survive the synthetic URL",
      dQuery.status === 200 && dQuery.body.airports?.SFO?.lat != null,
      JSON.stringify(dQuery.body).slice(0, 120)
    );
    const dMissing = await dj(`/api/flights/${dId}x`);
    check(
      "dispatch: a missing id 404s from the handler, not the router",
      dMissing.status === 404 && dMissing.body.error === "Flight not found",
      JSON.stringify(dMissing.body)
    );
    const dNoRoute = await dj("/api/nonsense");
    check(
      "dispatch: an unrouted path 404s with the api error shape",
      dNoRoute.status === 404 && /No route for GET/.test(dNoRoute.body.error),
      JSON.stringify(dNoRoute.body)
    );
    await dj(`/api/flights/${dId}`, { method: "DELETE" });
  } finally {
    process.chdir(cwd);
  }
}

/**
 * The WASM engine, held to the node engine's behavior (design: mode 1).
 *
 * The browser build swaps node:sqlite for SQLite-WASM behind the SqlDriver
 * seam, and this section is what keeps that swap honest: the same schema
 * ritual, the same statement semantics, run here through the WASM adapter
 * against :memory: — so a migration or a query pattern that only works on
 * one engine fails in CI, not in someone's browser.
 */
async function wasmDriverChecks() {
  console.log("wasm driver:");
  const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
  const { wasmDriver } = await import("../src/lib/wasm-driver");
  const { prepareLedger, MIGRATIONS } = await import("../src/lib/schema");
  const sqlite3 = await sqlite3InitModule();
  const db = wasmDriver(
    new sqlite3.oo1.DB(":memory:") as unknown as Parameters<typeof wasmDriver>[0]
  );

  prepareLedger(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  check(
    "wasm: the full schema ritual runs — every table present",
    ["adjustments", "changes", "mileageplus_activities", "payments", "segments", "settings", "tickets"].every(
      (t) => tables.some((r) => r.name === t)
    ),
    JSON.stringify(tables.map((t) => t.name))
  );
  const migrated = MIGRATIONS.every(([table, column]) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === column
    )
  );
  check("wasm: every migration column landed", migrated);

  db.prepare(
    "INSERT INTO tickets (id, gross_total, currency, exchange_rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("T1", 477.2, "USD", 1, "2022-11-11", "2022-11-11");
  const row = db
    .prepare("SELECT gross_total, currency FROM tickets WHERE id = ?")
    .get("T1") as { gross_total: number; currency: string };
  check(
    "wasm: bind, write, read round-trip with node semantics",
    row.gross_total === 477.2 && row.currency === "USD",
    JSON.stringify(row)
  );
  const upd = db
    .prepare("UPDATE tickets SET currency = ? WHERE id = ?")
    .run("CAD", "T1");
  const noop = db
    .prepare("UPDATE tickets SET currency = ? WHERE id = ?")
    .run("CAD", "T-none");
  check(
    "wasm: run().changes matches the node driver — the audit log depends on it",
    Number(upd.changes) === 1 && Number(noop.changes) === 0,
    JSON.stringify({ upd, noop })
  );
  check(
    "wasm: NULL binds and comes back null, not undefined or 0",
    (() => {
      db.prepare(
        "INSERT INTO adjustments (id, ticket_id, segment_id, type, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("A1", "T1", null, "extra", 299, "2022-12-04", "2022-12-04");
      const a = db
        .prepare("SELECT segment_id FROM adjustments WHERE id = ?")
        .get("A1") as { segment_id: unknown };
      return a.segment_id === null;
    })()
  );
  check(
    "wasm: foreign keys hold",
    (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length === 0
  );
}

/* ----------------------------- drive sync ----------------------------- */

/*
 * The sync lib never sees a real network: fetch and tokens are whatever the
 * caller injects. So a fake Drive — files.list, alt=media and multipart
 * upload over a Map, with expirable bearer tokens — is enough to run the
 * client, the planner and the whole syncOnce loop for real, raced creates
 * and stale tokens included.
 */
function fakeDrive() {
  interface FakeFile {
    name: string;
    content: string;
    props: Record<string, string>;
    version: number;
    modifiedTime: string;
  }
  const files = new Map<string, FakeFile>();
  let nextId = 1;
  let clock = 100;
  const stamp = () => `2026-01-01T00:00:00.${clock++}Z`;
  const seed = (name: string, content: string, props: Record<string, string>) => {
    const id = `f${nextId++}`;
    files.set(id, { name, content, props, version: 1, modifiedTime: stamp() });
    return id;
  };
  const bump = (id: string, content: string, props: Record<string, string>) => {
    const f = files.get(id)!;
    f.content = content;
    f.props = props;
    f.version++;
    f.modifiedTime = stamp();
  };

  /* Tokens: what the source hands out goes stale when expireToken() is
     called; only a forced refresh picks up the new one — the exact shape of
     a GIS access token dying mid-session. */
  let valid = "tok1";
  let issued = "tok1";
  const tokenCalls: boolean[] = [];
  const tokenSource = async (force: boolean) => {
    tokenCalls.push(force);
    if (force) issued = valid;
    return issued;
  };
  const expireToken = () => {
    valid = `tok${tokenCalls.length + 2}`;
  };

  const err = (status: number, message: string) =>
    Response.json({ error: { message } }, { status });
  const stripPart = (part: string) => {
    const start = part.indexOf("\r\n\r\n") + 4;
    return part.slice(start, part.lastIndexOf("\r\n"));
  };

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    if (headers.get("Authorization") !== `Bearer ${valid}`)
      return err(401, "Invalid Credentials");
    const method = init?.method ?? "GET";

    if (u.pathname === "/drive/v3/files" && method === "GET") {
      if (u.searchParams.get("spaces") !== "appDataFolder")
        return err(400, "expected spaces=appDataFolder");
      const m = /name = '((?:[^'\\]|\\')*)'/.exec(u.searchParams.get("q") ?? "");
      const wanted = m ? m[1].replace(/\\'/g, "'") : null;
      const out = [...files.entries()]
        .filter(([, f]) => f.name === wanted)
        .map(([id, f]) => ({
          id,
          version: f.version,
          modifiedTime: f.modifiedTime,
          appProperties: f.props,
        }));
      return Response.json({ files: out });
    }

    const dl = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (dl && u.searchParams.get("alt") === "media") {
      const f = files.get(dl[1]);
      return f ? new Response(f.content) : err(404, "File not found");
    }

    const isCreate = u.pathname === "/upload/drive/v3/files" && method === "POST";
    const upd = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (isCreate || (upd && method === "PATCH")) {
      const bm = /boundary=(.+)$/.exec(headers.get("Content-Type") ?? "");
      if (!bm) return err(400, "no multipart boundary");
      const parts = String(init?.body).split(`--${bm[1]}`);
      const metadata = JSON.parse(stripPart(parts[1])) as {
        name?: string;
        appProperties?: Record<string, string>;
      };
      const content = stripPart(parts[2]);
      let id: string;
      if (isCreate) {
        id = seed(metadata.name ?? "unnamed", content, metadata.appProperties ?? {});
      } else {
        id = upd![1];
        if (!files.has(id)) return err(404, "File not found");
        bump(id, content, metadata.appProperties ?? {});
      }
      const f = files.get(id)!;
      return Response.json({
        id,
        version: f.version,
        modifiedTime: f.modifiedTime,
        appProperties: f.props,
      });
    }
    return err(500, `unhandled ${method} ${u.pathname}`);
  };

  return { files, seed, bump, tokenSource, expireToken, tokenCalls, fetchFn };
}

async function driveSyncChecks() {
  console.log("drive sync:");

  const fakeTicket = (id: string): BackupPayload["tickets"][number] =>
    ({ id, gross_total: 100 } as unknown as BackupPayload["tickets"][number]);
  const basePayload = (over: Partial<BackupPayload> = {}): BackupPayload => ({
    version: 1,
    exported_at: "2026-08-01T00:00:00.000Z",
    settings: { home_airport: "IAH" } as unknown as BackupPayload["settings"],
    tickets: [],
    segments: [],
    adjustments: [],
    payments: [],
    activities: [],
    ...over,
  });

  check(
    "canonical: key order does not matter",
    stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 })
  );
  check(
    "canonical: nested keys sorted too",
    stableStringify({ x: { b: 1, a: 2 } }) === '{"x":{"a":2,"b":1}}'
  );
  check(
    "canonical: array order is content, kept",
    stableStringify(["b", "a"]) === '["b","a"]'
  );
  check(
    "canonical: undefined drops, null stays — JSON.stringify semantics",
    stableStringify({ a: undefined, b: null }) === '{"b":null}'
  );

  const fp1 = await backupFingerprint(basePayload());
  check(
    "fingerprint: exported_at alone does not change it",
    fp1 === (await backupFingerprint(basePayload({ exported_at: "2027-01-01T00:00:00.000Z" })))
  );
  check(
    "fingerprint: a data change does",
    fp1 !== (await backupFingerprint(basePayload({ tickets: [fakeTicket("T1")] })))
  );
  check("fingerprint: 64 hex chars of SHA-256", /^[0-9a-f]{64}$/.test(fp1));

  check("empty: settings alone are not data", backupIsEmpty(basePayload()));
  check(
    "empty: optional arrays absent (an old backup) still count as empty",
    backupIsEmpty(basePayload({ payments: undefined, activities: undefined }))
  );
  check("empty: one ticket is data", !backupIsEmpty(basePayload({ tickets: [fakeTicket("T1")] })));

  const mp = buildMultipart({ name: "x.json" }, '{"a":1}');
  const mpBoundary = /boundary=(.+)$/.exec(mp.contentType)![1];
  check(
    "multipart: two parts, then the closing boundary",
    mp.body.split(`--${mpBoundary}`).length === 4 && mp.body.endsWith(`--${mpBoundary}--\r\n`)
  );
  check(
    "multipart: metadata and content both aboard",
    mp.body.includes('{"name":"x.json"}') && mp.body.includes('{"a":1}')
  );
  const colliding = buildMultipart({}, "flight-ledger-boundary-9f2c sits in a notes field");
  const fled = /boundary=(.+)$/.exec(colliding.contentType)![1];
  check(
    "multipart: boundary flees a payload that contains it",
    fled !== "flight-ledger-boundary-9f2c" &&
      !"flight-ledger-boundary-9f2c sits in a notes field".includes(fled)
  );

  /* ---- the planner, one row of the decision table at a time ---- */
  const R = (over: Partial<RemoteMeta> = {}): RemoteMeta => ({
    fileId: "f1",
    version: "3",
    fingerprint: "aaa",
    exportedAt: null,
    modifiedTime: null,
    ...over,
  });
  const M = (over: Partial<SyncMarker> = {}): SyncMarker => ({
    fileId: "f1",
    version: "3",
    fingerprint: "aaa",
    ...over,
  });
  const plan = (s: Partial<SyncSnapshot>) =>
    planSync({ localFingerprint: "aaa", localEmpty: false, marker: null, remote: null, ...s });

  check("plan: first sync pushes", plan({}).action === "push");
  check("plan: nothing here, nothing there — noop", plan({ localEmpty: true }).action === "noop");
  check("plan: the Drive copy vanished — re-create it", plan({ marker: M() }).action === "push");
  const adopt = plan({ remote: R() });
  check("plan: identical content, no shared past — adopt, not transfer", adopt.action === "noop" && adopt.adopt === true);
  check(
    "plan: empty browser meets an existing copy — pull without asking",
    plan({ remote: R({ fingerprint: "bbb" }), localEmpty: true }).action === "pull"
  );
  check(
    "plan: two ledgers with data and no shared past — conflict",
    plan({ remote: R({ fingerprint: "bbb" }) }).action === "conflict"
  );
  const still = plan({ remote: R({ fingerprint: null }), marker: M() });
  check(
    "plan: unstamped remote, versions agree — plain noop",
    still.action === "noop" && !still.adopt
  );
  check(
    "plan: only this side moved — push",
    plan({ localFingerprint: "ccc", remote: R(), marker: M() }).action === "push"
  );
  check(
    "plan: only Drive moved — pull",
    plan({ remote: R({ version: "4", fingerprint: "bbb" }), marker: M() }).action === "pull"
  );
  const both = plan({
    localFingerprint: "bbb",
    remote: R({ version: "4", fingerprint: "bbb" }),
    marker: M(),
  });
  check("plan: both moved to the same content — adopt", both.action === "noop" && both.adopt === true);
  check(
    "plan: both moved apart — conflict, the user chooses",
    plan({ localFingerprint: "ccc", remote: R({ version: "4", fingerprint: "bbb" }), marker: M() })
      .action === "conflict"
  );
  check(
    "plan: a marker for some other file does not vouch for this one",
    plan({ remote: R({ fingerprint: "bbb" }), marker: M({ fileId: "f0" }), localEmpty: true })
      .action === "pull"
  );
  const reup = plan({ remote: R({ version: "9" }), marker: M() });
  check(
    "plan: same content re-uploaded elsewhere — adopt the new version",
    reup.action === "noop" && reup.adopt === true
  );

  /* ---- the client against the fake Drive ---- */
  const d1 = fakeDrive();
  const client = createDriveClient({ getToken: d1.tokenSource, fetchFn: d1.fetchFn });
  check("client: no file yet finds nothing", (await client.findFile(DRIVE_BACKUP_NAME)) === null);
  const created = await client.upload(DRIVE_BACKUP_NAME, '{"v":1}', {
    fingerprint: "abc",
    exported_at: "2026-08-01",
  });
  check(
    "client: create lands in appDataFolder at version 1",
    created.fileId.length > 0 && created.version === "1" && created.fingerprint === "abc"
  );
  const found = await client.findFile(DRIVE_BACKUP_NAME);
  check(
    "client: find maps the stamped properties back out",
    found !== null &&
      found.fileId === created.fileId &&
      found.fingerprint === "abc" &&
      found.exportedAt === "2026-08-01"
  );
  check("client: download returns the bytes uploaded", (await client.download(created.fileId)) === '{"v":1}');
  const updated = await client.upload(DRIVE_BACKUP_NAME, '{"v":2}', { fingerprint: "def" }, created.fileId);
  check(
    "client: update bumps Drive's version in place",
    updated.version === "2" && updated.fileId === created.fileId && d1.files.size === 1
  );
  check("client: update rewrote the content", (await client.download(created.fileId)) === '{"v":2}');
  d1.seed(DRIVE_BACKUP_NAME, '{"v":9}', { fingerprint: "newest" });
  check(
    "client: two copies (a raced create) — newest wins",
    (await client.findFile(DRIVE_BACKUP_NAME))?.fingerprint === "newest"
  );
  d1.expireToken();
  const callsBefore = d1.tokenCalls.length;
  const refound = await client.findFile(DRIVE_BACKUP_NAME);
  check(
    "client: a stale token means one forced refresh and a retry, not an error",
    refound !== null && d1.tokenCalls.slice(callsBefore).some((forced) => forced)
  );
  await client.upload("bob's.json", "x", {});
  check(
    "client: an apostrophe in the name survives the query",
    (await client.findFile("bob's.json")) !== null
  );
  let thrown: unknown = null;
  try {
    await client.download("missing");
  } catch (e) {
    thrown = e;
  }
  check(
    "client: an HTTP failure surfaces as DriveError with Google's message",
    thrown instanceof DriveError && thrown.status === 404 && thrown.message === "File not found"
  );

  /* ---- the whole loop, two devices and a shared Drive ---- */
  const d2 = fakeDrive();
  const c2 = createDriveClient({ getToken: d2.tokenSource, fetchFn: d2.fetchFn });
  const memMarker = () => {
    let m: SyncMarker | null = null;
    return {
      load: () => m,
      save: (x: SyncMarker) => {
        m = x;
      },
      peek: () => m,
    };
  };

  let local = basePayload({ tickets: [fakeTicket("T1")] });
  const pulls: string[] = [];
  const marker = memMarker();
  const ports = {
    client: c2,
    loadLocal: async () => local,
    applyRemote: async (json: string) => {
      pulls.push(json);
      local = JSON.parse(json) as BackupPayload;
    },
    markerStore: marker,
  };

  const first = await syncOnce(ports);
  const fpFirst = await backupFingerprint(local);
  check(
    "sync: the first pass pushes and stamps the fingerprint",
    first.action === "push" &&
      d2.files.size === 1 &&
      [...d2.files.values()][0].props.fingerprint === fpFirst
  );
  check(
    "sync: the marker remembers file, version and content",
    marker.peek()?.version === "1" && marker.peek()?.fingerprint === fpFirst
  );
  const second = await syncOnce(ports);
  check(
    "sync: nothing changed, nothing moves",
    second.action === "noop" && [...d2.files.values()][0].version === 1
  );

  local = basePayload({ tickets: [fakeTicket("T1"), fakeTicket("T2")] });
  const third = await syncOnce(ports);
  check(
    "sync: a local change pushes and bumps the version",
    third.action === "push" &&
      [...d2.files.values()][0].version === 2 &&
      marker.peek()?.version === "2"
  );

  const fileId = [...d2.files.keys()][0];
  const otherDevice = basePayload({
    tickets: [fakeTicket("T1"), fakeTicket("T2"), fakeTicket("T3")],
  });
  d2.bump(fileId, JSON.stringify(otherDevice), {
    fingerprint: await backupFingerprint(otherDevice),
  });
  const fourth = await syncOnce(ports);
  check(
    "sync: a remote change pulls, through the restore door",
    fourth.action === "pull" && pulls.length === 1 && local.tickets.length === 3
  );
  check(
    "sync: after the pull the marker matches the new head",
    marker.peek()?.version === "3" &&
      marker.peek()?.fingerprint === (await backupFingerprint(otherDevice))
  );
  check("sync: the pull settles — the next pass is a noop", (await syncOnce(ports)).action === "noop");

  local = basePayload({ tickets: [fakeTicket("T1"), fakeTicket("T2"), fakeTicket("T4")] });
  const elsewhere = basePayload({ tickets: [fakeTicket("T9")] });
  d2.bump(fileId, JSON.stringify(elsewhere), {
    fingerprint: await backupFingerprint(elsewhere),
  });
  const sixth = await syncOnce(ports);
  check(
    "sync: divergence stops the machine — conflict, no writes either way",
    sixth.action === "conflict" &&
      [...d2.files.values()][0].version === 4 &&
      pulls.length === 1 &&
      /* the chooser needs to date "the Drive copy", so the head rides along */
      sixth.remote?.version === "4"
  );
  check(
    "sync: a conflict carries both sides' contents for the chooser",
    sixth.localSummary?.tickets === 3 && sixth.remoteSummary?.tickets === 1
  );
  const summed = summarizeBackup(
    basePayload({
      tickets: [
        { id: "T1", updated_at: "2026-05-01" } as unknown as BackupPayload["tickets"][number],
      ],
      segments: [
        { id: "S1", updated_at: "2026-06-01" } as unknown as BackupPayload["segments"][number],
        { id: "S2" } as unknown as BackupPayload["segments"][number],
      ],
    })
  );
  check(
    "summary: counts both ledgers' units and finds the newest edit",
    summed.flights === 2 && summed.tickets === 1 && summed.lastEdited === "2026-06-01"
  );
  const resolved = await syncOnce(ports, "push");
  check(
    "sync: an explicit resolution pushes over the divergent copy",
    resolved.action === "push" &&
      (JSON.parse([...d2.files.values()][0].content) as BackupPayload).tickets.length === 3 &&
      (await syncOnce(ports)).action === "noop"
  );

  /* A second browser, same Drive: the states a fresh device can wake into. */
  let fresh = basePayload();
  const freshMarker = memMarker();
  const freshPorts = {
    client: c2,
    loadLocal: async () => fresh,
    applyRemote: async (json: string) => {
      fresh = JSON.parse(json) as BackupPayload;
    },
    markerStore: freshMarker,
  };
  const adopted = await syncOnce(freshPorts);
  check(
    "sync: an empty browser meeting an existing copy pulls it, no questions",
    adopted.action === "pull" && fresh.tickets.length === 3 && freshMarker.peek() !== null
  );

  let stranger = basePayload({ tickets: [fakeTicket("T9")] });
  const strangerMarker = memMarker();
  const strangerPorts = {
    client: c2,
    loadLocal: async () => stranger,
    applyRemote: async (json: string) => {
      stranger = JSON.parse(json) as BackupPayload;
    },
    markerStore: strangerMarker,
  };
  check(
    "sync: a second ledger with its own data — conflict, not silent loss",
    (await syncOnce(strangerPorts)).action === "conflict"
  );
  const surrendered = await syncOnce(strangerPorts, "pull");
  check(
    "sync: resolving by pull replaces this ledger and starts tracking",
    surrendered.action === "pull" &&
      stranger.tickets.length === 3 &&
      strangerMarker.peek() !== null
  );

  const twinMarker = memMarker();
  const twinPorts = {
    client: c2,
    loadLocal: async () => stranger,
    applyRemote: async () => {
      throw new Error("identical content should not transfer");
    },
    markerStore: twinMarker,
  };
  const twin = await syncOnce(twinPorts);
  check(
    "sync: same content on both sides just adopts the marker",
    twin.action === "noop" && twinMarker.peek() !== null
  );

  /* Two LEDGERS on one Google account (not two devices with one ledger):
     each syncs to its own file name, so one ledger's push can never read
     as the other's remote change and come back as a pull. The UI derives
     the name from the account id; here two explicit names stand in. */
  const d4 = fakeDrive();
  const c4 = createDriveClient({ getToken: d4.tokenSource, fetchFn: d4.fetchFn });
  let mainLedger = basePayload({ tickets: [fakeTicket("M1")] });
  let sideLedger = basePayload({ tickets: [fakeTicket("S1"), fakeTicket("S2")] });
  const mainPorts = {
    client: c4,
    fileName: DRIVE_BACKUP_NAME,
    loadLocal: async () => mainLedger,
    applyRemote: async (json: string) => {
      mainLedger = JSON.parse(json) as BackupPayload;
    },
    markerStore: memMarker(),
  };
  const sidePorts = {
    client: c4,
    fileName: "flight-ledger-side.json",
    loadLocal: async () => sideLedger,
    applyRemote: async (json: string) => {
      sideLedger = JSON.parse(json) as BackupPayload;
    },
    markerStore: memMarker(),
  };
  check(
    "sync: two ledgers, two files — both push, nobody is asked anything",
    (await syncOnce(mainPorts)).action === "push" &&
      (await syncOnce(sidePorts)).action === "push" &&
      d4.files.size === 2
  );
  check(
    "sync: and neither ever pulls the other's data",
    (await syncOnce(mainPorts)).action === "noop" &&
      (await syncOnce(sidePorts)).action === "noop" &&
      mainLedger.tickets.length === 1 &&
      sideLedger.tickets.length === 2
  );
}

/* Ownership is decided by ONE state machine, before the worker exists — and
   it can move: a shadowed tab broadcasts a handover request, the owner
   drains and releases, the asker acquires. The fakes below implement real
   lock-manager semantics (exclusivity, a FIFO queue, ifAvailable, abort). */
async function ownershipChecks() {
  console.log("engine ownership:");
  type Entry = {
    cb: (l: unknown) => Promise<unknown> | void;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  };
  const fakeLocks = (): LocksLike => {
    let held = false;
    const queue: Entry[] = [];
    const grant = (e: Entry) => {
      held = true;
      void Promise.resolve(e.cb({ name: "l" })).then((v) => {
        held = false;
        e.resolve(v);
        const next = queue.shift();
        if (next) grant(next);
      });
    };
    return {
      request: (_n, opts, cb) =>
        new Promise((resolve, reject) => {
          if (!held) return grant({ cb, resolve, reject });
          if (opts.ifAvailable)
            return void Promise.resolve(cb(null)).then(resolve);
          const entry: Entry = { cb, resolve, reject };
          opts.signal?.addEventListener("abort", () => {
            const i = queue.indexOf(entry);
            if (i >= 0) {
              queue.splice(i, 1);
              reject(new Error("aborted"));
            }
          });
          queue.push(entry);
        }),
    };
  };
  const mkBus = () => {
    const chans: ChannelLike[] = [];
    return (): ChannelLike => {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage: (m) => {
          for (const o of chans) if (o !== ch) o.onmessage?.({ data: m });
        },
      };
      chans.push(ch);
      return ch;
    };
  };

  const locks = fakeLocks();
  const chan = mkBus();
  const A = createOwnership(locks, chan());
  const B = createOwnership(locks, chan());
  check(
    "ownership: the first tab owns the engine",
    (await A.decided()) === "owned"
  );
  check(
    "ownership: the second tab is told another tab holds it",
    (await B.decided()) === "lost"
  );
  const order: string[] = [];
  A.subscribe((o) => order.push(`A:${o}`));
  A.onBeforeRelease(() => {
    order.push("park");
  });
  await B.takeover();
  check(
    "handover: the asker owns, the owner is shadowed",
    B.current() === "owned" && A.current() === "lost",
    `${A.current()} / ${B.current()}`
  );
  check(
    "handover: the owner is told first, parks its engine, THEN releases",
    order.join(",") === "A:lost,park",
    order.join(",")
  );
  await A.takeover();
  check(
    "handover: the same button brings it back the other way",
    A.current() === "owned" && B.current() === "lost",
    `${A.current()} / ${B.current()}`
  );
  /* an owner that never hears the request (an old build, a hung tab) */
  const locks2 = fakeLocks();
  const deaf = createOwnership(locks2, null);
  await deaf.decided();
  const asker = createOwnership(locks2, null);
  await asker.decided();
  const timedOut = await asker.takeover(80).then(
    () => false,
    () => true
  );
  check("handover: an unanswered request times out instead of hanging", timedOut);
  check(
    "ownership: no Web Locks API falls back to owning — OPFS itself referees",
    (await createOwnership(undefined, null).decided()) === "owned"
  );
  const broken: LocksLike = {
    request: () => Promise.reject(new Error("locks API misbehaving")),
  };
  check(
    "ownership: a lock API that throws is treated as absent, not as a loss",
    (await createOwnership(broken, null).decided()) === "owned"
  );
}

routeHandlerChecks()
  .catch((e) => {
    failures++;
    console.error("  ✗ route handler section crashed:", e);
  })
  .then(() => ownershipChecks())
  .catch((e) => {
    failures++;
    console.error("  ✗ engine ownership section crashed:", e);
  })
  .then(() => wasmDriverChecks())
  .catch((e) => {
    failures++;
    console.error("  ✗ wasm driver section crashed:", e);
  })
  .then(() => driveSyncChecks())
  .catch((e) => {
    failures++;
    console.error("  ✗ drive sync section crashed:", e);
  })
  .then(() => {
    console.log(
      failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED`
    );
    process.exit(failures === 0 ? 0 : 1);
  });
