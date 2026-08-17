import { handled, jsonError } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { buildAnalytics } from "@/lib/metrics";
import { exportBackup, getEnrichedData } from "@/lib/repo";
import { activeAccount, slugify } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

function download(body: string, filename: string, mime: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const GET = handled(async (req: Request) => {
  const what = new URL(req.url).searchParams.get("what") ?? "backup";
  const stamp = new Date().toISOString().slice(0, 10);
  /* Which ledger this came from, in the name. Two accounts exporting on the
     same day otherwise produce the same filename twice, and the browser
     silently disambiguates them as "(1)" and "(2)" — which says nothing about
     whose flights are inside. Slugified because the label is free text. */
  const who = slugify(activeAccount().label);
  const name = (base: string, ext: string) => `${who}-${base}-${stamp}.${ext}`;

  if (what === "backup") {
    return download(
      JSON.stringify(exportBackup(), null, 2),
      name("backup", "json"),
      "application/json"
    );
  }

  const data = getEnrichedData();

  if (what === "flights") {
    const rows = data.segments.map((s) => [
      s.flight_date,
      s.marketing_carrier + (s.flight_number ?? ""),
      s.operating_carrier,
      s.origin,
      s.destination,
      s.cabin,
      s.booking_class,
      s.status,
      s.effective_purpose,
      s.ticket_label,
      s.distance_miles != null ? Math.round(s.distance_miles) : null,
      s.lifetime_miles,
      s.award_miles,
      s.pqp,
      s.pqf,
      s.gross_cost,
      s.personal_cost,
      s.allocation_method,
      s.distance_miles && s.distance_miles > 0
        ? round2((100 * s.gross_cost) / s.distance_miles)
        : null,
      s.distance_miles && s.distance_miles > 0
        ? round2((100 * s.personal_cost) / s.distance_miles)
        : null,
      s.seat,
      s.aircraft,
      s.notes,
    ]);
    return download(
      toCsv(
        [
          "date","flight","operating_carrier","origin","destination","cabin",
          "booking_class","status","purpose","ticket","distance_mi",
          "lifetime_miles","award_miles","pqp","pqf","gross_cost","personal_cost",
          "allocation_method","gross_cpm","personal_cpm","seat","aircraft","notes",
        ],
        rows
      ),
      name("flights", "csv"),
      "text/csv"
    );
  }

  if (what === "tickets") {
    const rows = data.tickets.map((t) => {
      const a = data.allocations[t.id];
      return [
        t.ticket_number, t.confirmation_code, t.issuing_carrier, t.issue_date,
        t.status, t.currency, t.exchange_rate, t.base_fare, t.surcharges,
        t.taxes, t.ancillary_fees, t.gross_total,
        a?.gross_reporting, a?.refunds, a?.other_adjustments, a?.personal_total,
        a?.method, t.payment_method, t.notes,
      ];
    });
    return download(
      toCsv(
        [
          "ticket_number","confirmation","carrier","issue_date","status","currency",
          "exchange_rate","base_fare","surcharges","taxes","ancillary_fees",
          "gross_total","gross_reporting","refunds","other_adjustments",
          "personal_total","allocation_method","payment_method","notes",
        ],
        rows
      ),
      name("tickets", "csv"),
      "text/csv"
    );
  }

  if (what === "adjustments") {
    const ticketLabel = (id: string) => {
      const t = data.tickets.find((x) => x.id === id);
      return t?.confirmation_code || t?.ticket_number || id;
    };
    const segmentLabel = (id: string | null | undefined) => {
      if (!id) return null;
      const s = data.segments.find((x) => x.id === id);
      return s ? `${s.origin}→${s.destination} ${s.flight_date}` : id;
    };
    const rows = data.adjustments.map((a) => [
      a.effective_date, a.type, a.amount, a.payer, ticketLabel(a.ticket_id),
      segmentLabel(a.segment_id), a.notes,
    ]);
    return download(
      toCsv(["date", "type", "amount", "payer", "ticket", "flight", "notes"], rows),
      name("adjustments", "csv"),
      "text/csv"
    );
  }

  if (what === "activity") {
    const segById = new Map(data.segments.map((s) => [s.id, s]));
    const rows = data.activities.map((a) => {
      const seg = a.segment_id ? segById.get(a.segment_id) : undefined;
      return [
        a.activity_date,
        a.description,
        a.activity_type,
        a.carrier,
        a.flight_number,
        a.origin,
        a.destination,
        a.award_miles,
        a.pqp,
        a.pqf,
        seg ? `${seg.origin}-${seg.destination} ${seg.flight_date}` : null,
        a.match_status,
        a.match_score,
        a.source,
      ];
    });
    return download(
      toCsv(
        [
          "date","description","type","carrier","flight_number","origin",
          "destination","award_miles","pqp","pqf","matched_flight",
          "match_status","match_score","source",
        ],
        rows
      ),
      name("activity", "csv"),
      "text/csv"
    );
  }

  if (what === "monthly") {
    const analytics = buildAnalytics(data);
    const rows = analytics.monthly.map((m) => [
      m.month, m.flights, m.distance, m.lifetime, m.lifetimeEst, m.award,
      m.pqp, m.pqf, m.gross, m.personal, m.cpmMiles, m.grossCpm, m.personalCpm,
      m.costPerPqp, m.missingPostings,
    ]);
    return download(
      toCsv(
        [
          "month","flights","distance_mi","lifetime_miles_posted",
          "lifetime_miles_incl_est","award_miles","pqp","pqf","gross_cost",
          "personal_cost","cpm_basis_mi","gross_cpm","personal_cpm",
          "cost_per_pqp","missing_postings",
        ],
        rows
      ),
      name("monthly", "csv"),
      "text/csv"
    );
  }

  return jsonError(`Unknown export: ${what}`);
});
