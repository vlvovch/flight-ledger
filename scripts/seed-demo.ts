/**
 * Seeds realistic demo data through the HTTP API (which also exercises the
 * full API + validation + allocation stack).
 *
 *   npm run seed:demo              → http://localhost:3000
 *   PORT=58809 npm run seed:demo   → custom port
 *
 * Wipe again from Settings → "Erase all data".
 */
const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

async function call<T = { id?: string }>(
  path: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

async function main() {
  console.log(`Seeding demo data via ${BASE} …`);

  await call("/api/settings", "PUT", {
    reporting_currency: "USD",
    award_valuation_cpm: 1.2,
    lifetime_baseline_miles: 512340,
    lifetime_baseline_date: "2025-12-31",
    missing_posting_delay_days: 7,
  });

  /* --------- Conference, fully reimbursed: business by inference --------- */
  const tk1 = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "D4XK2P",
    ticket_number: "016 7900000020",
    issue_date: "2026-02-20",
    currency: "USD",
    base_fare: 398.14,
    taxes: 80.46,
    gross_total: 478.6,
    payment_method: "Visa …6411",
  });
  await call("/api/adjustments", "POST", {
    ticket_id: tk1.id,
    type: "reimbursement",
    amount: 478.6,
    effective_date: "2026-05-02",
    payer: "University",
  });
  await call("/api/flights", "POST", {
    ticket_id: tk1.id,
    marketing_carrier: "UA",
    flight_number: "1071",
    origin: "IAH",
    destination: "LAX",
    flight_date: "2026-04-11",
    departure_time: "08:05",
    arrival_time: "09:41",
    cabin: "Economy",
    booking_class: "K",
    seat: "21F",
    aircraft: "B737-900",
    status: "flown_reconciled",
    pqp: 199,
    pqf: 1,
    award_miles: 995,
    lifetime_miles: 1379,
  });
  await call("/api/flights", "POST", {
    ticket_id: tk1.id,
    marketing_carrier: "UA",
    flight_number: "2402",
    origin: "LAX",
    destination: "IAH",
    flight_date: "2026-04-15",
    departure_time: "16:10",
    arrival_time: "21:32",
    cabin: "Economy",
    booking_class: "K",
    seat: "20A",
    aircraft: "B737 MAX 9",
    status: "flown_reconciled",
    pqp: 199,
    pqf: 1,
    award_miles: 995,
    lifetime_miles: 1379,
  });

  /* --- Europe family trip on a partner: unreimbursed, so personal --- */
  const tk2 = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "H8LMQ4",
    ticket_number: "016 7900000021",
    issue_date: "2026-03-05",
    currency: "USD",
    base_fare: 944.0,
    surcharges: 128.0,
    taxes: 192.0,
    gross_total: 1264.0,
    payment_method: "Visa …6411",
  });
  const legs2 = [
    ["IAH", "FRA", "2026-06-18", "UA", "46", "16:40", "09:35", "Economy", "W", "flown_reconciled", 634, 1, 3169, 5769, "B787-9"],
    ["FRA", "WAW", "2026-06-19", "LH", "1350", "12:10", "13:40", "Economy", "W", "flown_reconciled", 63, 0.5, 316, 558, "A320neo"],
    ["WAW", "FRA", "2026-07-05", "LH", "1347", "15:25", "17:05", "Economy", "W", "flown_reconciled", 63, 0.5, 316, 558, "A320neo"],
    ["FRA", "IAH", "2026-07-06", "UA", "47", "11:35", "15:50", "Economy", "W", "flown_reconciled", 634, 1, 3169, 5769, "B787-9"],
  ] as const;
  for (const [o, d, date, carrier, num, dep, arr, cabin, cls, status, pqp, pqf, award, lifetime, aircraft] of legs2) {
    await call("/api/flights", "POST", {
      ticket_id: tk2.id,
      marketing_carrier: carrier === "LH" ? "UA" : carrier, // sold as UA codeshare
      operating_carrier: carrier,
      flight_number: num,
      origin: o,
      destination: d,
      flight_date: date,
      departure_time: dep,
      arrival_time: arr,
      cabin,
      booking_class: cls,
      status,
      aircraft,
      pqp,
      pqf,
      award_miles: award,
      lifetime_miles: lifetime,
    });
  }

  /* ------- Upcoming conference (ticketed, not yet flown). Nobody has
     reimbursed it yet, so each leg has to say business for itself. ------- */
  const tk3 = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "F2NB7R",
    issue_date: "2026-07-14",
    currency: "USD",
    base_fare: 1518.0,
    surcharges: 112.0,
    taxes: 212.3,
    gross_total: 1842.3,
    payment_method: "Visa …6411",
  });
  const legs3 = [
    ["IAH", "SFO", "2026-09-05", "265", "09:15", "11:42"],
    ["SFO", "ICN", "2026-09-05", "893", "14:05", "18:55"],
    ["ICN", "SFO", "2026-09-13", "892", "20:40", "14:55"],
    ["SFO", "IAH", "2026-09-13", "1732", "17:30", "23:44"],
  ] as const;
  for (const [o, d, date, num, dep, arr] of legs3) {
    await call("/api/flights", "POST", {
      ticket_id: tk3.id,
      marketing_carrier: "UA",
      purpose: "business",
      flight_number: num,
      origin: o,
      destination: d,
      flight_date: date,
      departure_time: dep,
      arrival_time: arr,
      cabin: "Economy",
      booking_class: "L",
      status: "ticketed",
    });
  }

  /* --------- February one-way + March partially reimbursed run --------- */
  const tkFeb = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "B7JW9C",
    issue_date: "2026-01-28",
    currency: "USD",
    gross_total: 189.0,
  });
  await call("/api/flights", "POST", {
    ticket_id: tkFeb.id,
    marketing_carrier: "UA",
    flight_number: "2128",
    origin: "EWR",
    destination: "IAH",
    flight_date: "2026-02-09",
    departure_time: "17:45",
    cabin: "Economy",
    booking_class: "S",
    status: "flown_reconciled",
    purpose: "personal",
    pqp: 158,
    pqf: 1,
    award_miles: 790,
    lifetime_miles: 1400,
  });

  const tkMar = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "G3PT5V",
    issue_date: "2026-02-11",
    currency: "USD",
    gross_total: 641.2,
  });
  await call("/api/adjustments", "POST", {
    ticket_id: tkMar.id,
    type: "reimbursement",
    amount: 500,
    effective_date: "2026-04-01",
    payer: "LBNL",
  });
  for (const [o, d, date, num, status] of [
    ["IAH", "SFO", "2026-03-09", "1949", "flown_reconciled"],
    ["SFO", "IAH", "2026-03-13", "397", "flown_reconciled"],
  ] as const) {
    await call("/api/flights", "POST", {
      ticket_id: tkMar.id,
      marketing_carrier: "UA",
      flight_number: num,
      origin: o,
      destination: d,
      flight_date: date,
      cabin: "Economy",
      booking_class: "V",
      status,
      pqp: 267,
      pqf: 1,
      award_miles: 1335,
      lifetime_miles: 1635,
    });
  }

  /* ----- July Denver hop, flown 2+ weeks ago, nothing posted (issue) ----- */
  const tkJul = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "K9RD3F",
    issue_date: "2026-06-30",
    currency: "USD",
    gross_total: 312.4,
  });
  for (const [o, d, date, num] of [
    ["IAH", "DEN", "2026-07-16", "1885"],
    ["DEN", "IAH", "2026-07-18", "622"],
  ] as const) {
    await call("/api/flights", "POST", {
      ticket_id: tkJul.id,
      marketing_carrier: "UA",
      flight_number: num,
      origin: o,
      destination: d,
      flight_date: date,
      cabin: "Economy",
      booking_class: "T",
      status: "flown_unreconciled",
      purpose: "personal",
    });
  }

  /* ------------------- award ticket (taxes only) ------------------- */
  const tkAward = await call<{ id: string }>("/api/tickets", "POST", {
    confirmation_code: "M5WX8T",
    issue_date: "2026-05-10",
    currency: "USD",
    gross_total: 5.6,
    payment_method: "22,000 miles + $5.60",
    notes: "Award ticket — 22k miles redeemed",
  });
  await call("/api/flights", "POST", {
    ticket_id: tkAward.id,
    marketing_carrier: "UA",
    flight_number: "790",
    origin: "IAH",
    destination: "ORD",
    flight_date: "2026-05-22",
    cabin: "Economy",
    booking_class: "X",
    status: "flown_reconciled",
    purpose: "personal",
    pqp: 0,
    pqf: 0,
    award_miles: 0,
    lifetime_miles: 0,
    notes: "Award travel — no PQP/lifetime accrual",
  });

  console.log("Done. Open the dashboard and explore.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
