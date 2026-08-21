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
    lifetime_baseline_miles: 120000,
    lifetime_baseline_date: "2021-12-31",
    missing_posting_delay_days: 7,
  });

  /* ---------- Four prior years, so the charts have a story to tell ----------
     A ledger seeded with one year of flying leaves its own signature chart
     flat: lifetime miles ran horizontal, the ALL range had one bar, and the
     map stopped at two continents. These trips put a believable Chicago
     road warrior behind the numbers — conferences on the employer's dime,
     family summers in Portugal, a Denver ski habit — climbing from the
     120k baseline toward the current year. PQP is roughly the fare split
     per leg; award miles ride at the member earn rate; lifetime miles are
     deliberately NOT set, because posted history predates any ledger and
     the per-flight estimator wearing its ≈ is exactly the honest story. */
  type PriorLeg = [
    origin: string,
    dest: string,
    date: string,
    flight: string,
    pqp: number,
    operating?: string,
  ];
  const priorTrips: Array<{
    code: string;
    issued: string;
    total: number;
    cls: string;
    personal?: boolean;
    reimbursed?: { payer: string; date: string };
    legs: PriorLeg[];
  }> = [
    // 2022
    { code: "Q4TR82", issued: "2022-02-10", total: 260, cls: "V",
      reimbursed: { payer: "Employer", date: "2022-04-04" },
      legs: [["ORD", "SAN", "2022-03-06", "1427", 140], ["SAN", "ORD", "2022-03-10", "2054", 140]] },
    { code: "L8MV31", issued: "2022-04-02", total: 1180, cls: "W", personal: true,
      legs: [["ORD", "FRA", "2022-05-21", "944", 480], ["FRA", "ORD", "2022-06-04", "945", 480]] },
    { code: "V2KD97", issued: "2022-07-19", total: 380, cls: "S",
      reimbursed: { payer: "Employer", date: "2022-10-21" },
      legs: [["ORD", "BOS", "2022-09-12", "1104", 140], ["BOS", "ORD", "2022-09-16", "519", 140]] },
    { code: "B6PN44", issued: "2022-09-08", total: 1620, cls: "K",
      reimbursed: { payer: "Employer", date: "2022-12-12" },
      legs: [
        ["ORD", "SFO", "2022-11-01", "684", 190], ["SFO", "NRT", "2022-11-01", "837", 650],
        ["NRT", "SFO", "2022-11-09", "838", 650], ["SFO", "ORD", "2022-11-09", "2033", 190],
      ] },
    { code: "H3JW60", issued: "2022-11-20", total: 460, cls: "T", personal: true,
      legs: [["ORD", "SEA", "2022-12-17", "541", 180], ["SEA", "ORD", "2022-12-23", "226", 180]] },
    // 2023
    { code: "P7GX25", issued: "2023-01-05", total: 290, cls: "T", personal: true,
      legs: [["ORD", "DEN", "2023-02-11", "1988", 110], ["DEN", "ORD", "2023-02-15", "522", 110]] },
    { code: "W1EC58", issued: "2023-02-22", total: 1290, cls: "L",
      reimbursed: { payer: "Employer", date: "2023-05-30" },
      legs: [
        ["ORD", "FRA", "2023-04-16", "944", 460], ["FRA", "VIE", "2023-04-17", "8941", 55, "LH"],
        ["VIE", "FRA", "2023-04-22", "8942", 55, "LH"], ["FRA", "ORD", "2023-04-22", "945", 460],
      ] },
    { code: "S9HB12", issued: "2023-05-01", total: 1310, cls: "W", personal: true,
      legs: [
        ["ORD", "FRA", "2023-06-24", "944", 470], ["FRA", "LIS", "2023-06-25", "8926", 60, "LH"],
        ["LIS", "FRA", "2023-07-09", "8927", 60, "LH"], ["FRA", "ORD", "2023-07-10", "945", 470],
      ] },
    { code: "D5QK73", issued: "2023-08-14", total: 1950, cls: "K",
      reimbursed: { payer: "Employer", date: "2023-11-20" },
      legs: [
        ["ORD", "LAX", "2023-10-08", "1071", 170], ["LAX", "SYD", "2023-10-08", "839", 700],
        ["SYD", "LAX", "2023-10-15", "840", 700], ["LAX", "ORD", "2023-10-16", "2402", 170],
      ] },
    // 2024
    { code: "G2ZN86", issued: "2024-01-10", total: 400, cls: "V",
      reimbursed: { payer: "Client", date: "2024-03-25" },
      legs: [["ORD", "BOS", "2024-02-25", "1104", 150], ["BOS", "ORD", "2024-02-28", "519", 150]] },
    { code: "K9TF34", issued: "2024-03-03", total: 1090, cls: "L",
      reimbursed: { payer: "Employer", date: "2024-05-28" },
      legs: [["ORD", "LHR", "2024-04-14", "928", 450], ["LHR", "ORD", "2024-04-19", "929", 450]] },
    { code: "X3RM77", issued: "2024-05-20", total: 440, cls: "S",
      reimbursed: { payer: "Client", date: "2024-08-19" },
      legs: [["ORD", "SFO", "2024-07-11", "684", 190], ["SFO", "ORD", "2024-07-14", "2033", 190]] },
    { code: "M4CW29", issued: "2024-04-28", total: 1150, cls: "W", personal: true,
      legs: [["ORD", "FRA", "2024-06-15", "944", 470], ["FRA", "ORD", "2024-06-29", "945", 470]] },
    { code: "R8LD51", issued: "2024-07-30", total: 1680, cls: "K",
      reimbursed: { payer: "Employer", date: "2024-11-04" },
      legs: [
        ["ORD", "SFO", "2024-09-21", "684", 195], ["SFO", "NRT", "2024-09-21", "837", 660],
        ["NRT", "SFO", "2024-09-29", "838", 660], ["SFO", "ORD", "2024-09-30", "2033", 195],
      ] },
    { code: "T6VJ18", issued: "2024-10-12", total: 310, cls: "T", personal: true,
      legs: [["ORD", "DEN", "2024-12-14", "1988", 115], ["DEN", "ORD", "2024-12-18", "522", 115]] },
    // 2025
    { code: "E5WY42", issued: "2025-01-20", total: 270, cls: "V",
      reimbursed: { payer: "Employer", date: "2025-03-31" },
      legs: [["ORD", "SAN", "2025-03-02", "1427", 145], ["SAN", "ORD", "2025-03-05", "2054", 145]] },
    { code: "N2BQ69", issued: "2025-04-07", total: 1340, cls: "W", personal: true,
      legs: [
        ["ORD", "FRA", "2025-06-21", "944", 480], ["FRA", "LIS", "2025-06-22", "8926", 60, "LH"],
        ["LIS", "FRA", "2025-07-06", "8927", 60, "LH"], ["FRA", "ORD", "2025-07-07", "945", 480],
      ] },
    { code: "U7SD90", issued: "2025-07-25", total: 2050, cls: "K",
      reimbursed: { payer: "Employer", date: "2025-11-10" },
      legs: [
        ["ORD", "LAX", "2025-09-27", "1071", 175], ["LAX", "SYD", "2025-09-27", "839", 720],
        ["SYD", "LAX", "2025-10-05", "840", 720], ["LAX", "ORD", "2025-10-06", "2402", 175],
      ] },
    { code: "J1FP36", issued: "2025-09-15", total: 390, cls: "S", personal: true,
      legs: [["ORD", "EWR", "2025-11-22", "1660", 145], ["EWR", "ORD", "2025-11-30", "1661", 145]] },
    { code: "C8HT21", issued: "2025-10-30", total: 300, cls: "T", personal: true,
      legs: [["ORD", "DEN", "2025-12-20", "1988", 118], ["DEN", "ORD", "2025-12-27", "522", 118]] },
  ];
  for (const trip of priorTrips) {
    const tk = await call<{ id: string }>("/api/tickets", "POST", {
      confirmation_code: trip.code,
      issue_date: trip.issued,
      currency: "USD",
      gross_total: trip.total,
      payment_method: "Visa …6411",
    });
    if (trip.reimbursed)
      await call("/api/adjustments", "POST", {
        ticket_id: tk.id,
        type: "reimbursement",
        amount: trip.total,
        effective_date: trip.reimbursed.date,
        payer: trip.reimbursed.payer,
      });
    for (const [o, d, date, num, pqp, operating] of trip.legs) {
      await call("/api/flights", "POST", {
        ticket_id: tk.id,
        marketing_carrier: "UA",
        ...(operating ? { operating_carrier: operating } : {}),
        flight_number: num,
        origin: o,
        destination: d,
        flight_date: date,
        cabin: "Economy",
        booking_class: trip.cls,
        status: "flown_reconciled",
        ...(trip.personal ? { purpose: "personal" } : {}),
        pqp,
        pqf: 1,
        award_miles: pqp * 5,
      });
    }
  }

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
    payer: "Employer",
  });
  await call("/api/flights", "POST", {
    ticket_id: tk1.id,
    marketing_carrier: "UA",
    flight_number: "1427",
    origin: "ORD",
    destination: "SAN",
    flight_date: "2026-04-11",
    departure_time: "08:05",
    arrival_time: "10:20",
    cabin: "Economy",
    booking_class: "K",
    seat: "21F",
    aircraft: "B737-900",
    status: "flown_reconciled",
    pqp: 199,
    pqf: 1,
    award_miles: 995,
    lifetime_miles: 1723,
  });
  await call("/api/flights", "POST", {
    ticket_id: tk1.id,
    marketing_carrier: "UA",
    flight_number: "2054",
    origin: "SAN",
    destination: "ORD",
    flight_date: "2026-04-15",
    departure_time: "16:10",
    arrival_time: "22:15",
    cabin: "Economy",
    booking_class: "K",
    seat: "20A",
    aircraft: "B737 MAX 9",
    status: "flown_reconciled",
    pqp: 199,
    pqf: 1,
    award_miles: 995,
    lifetime_miles: 1723,
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
    ["ORD", "FRA", "2026-06-18", "UA", "944", "16:40", "08:10", "Economy", "W", "flown_reconciled", 560, 1, 2800, 4340, "B787-9"],
    ["FRA", "LIS", "2026-06-19", "LH", "8926", "12:10", "14:15", "Economy", "W", "flown_reconciled", 63, 0.5, 316, 1222, "A320neo"],
    ["LIS", "FRA", "2026-07-05", "LH", "8927", "15:25", "19:20", "Economy", "W", "flown_reconciled", 63, 0.5, 316, 1222, "A320neo"],
    ["FRA", "ORD", "2026-07-06", "UA", "945", "11:35", "14:10", "Economy", "W", "flown_reconciled", 560, 1, 2800, 4340, "B787-9"],
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
    ["ORD", "SFO", "2026-09-05", "684", "09:15", "12:00"],
    ["SFO", "SIN", "2026-09-05", "29", "14:05", "22:00"],
    ["SIN", "SFO", "2026-09-13", "30", "09:40", "09:15"],
    ["SFO", "ORD", "2026-09-13", "2033", "11:30", "17:55"],
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
    flight_number: "1661",
    origin: "EWR",
    destination: "ORD",
    flight_date: "2026-02-09",
    departure_time: "17:45",
    cabin: "Economy",
    booking_class: "S",
    status: "flown_reconciled",
    purpose: "personal",
    pqp: 138,
    pqf: 1,
    award_miles: 690,
    lifetime_miles: 719,
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
    payer: "Client",
  });
  for (const [o, d, date, num, status] of [
    ["ORD", "SFO", "2026-03-09", "684", "flown_reconciled"],
    ["SFO", "ORD", "2026-03-13", "2033", "flown_reconciled"],
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
      pqp: 235,
      pqf: 1,
      award_miles: 1175,
      lifetime_miles: 1846,
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
    ["ORD", "DEN", "2026-07-16", "1988"],
    ["DEN", "ORD", "2026-07-18", "522"],
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
    flight_number: "1276",
    origin: "ORD",
    destination: "MCO",
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
