# Flight Ledger

A local dashboard for United flyers who want to know what their flying actually
cost — and whether United credited all of it.

It keeps three records and reconciles them against each other:

- **what you flew** — segments, routes, distance
- **what it cost** — tickets, refunds, reimbursements, exchange chains
- **what United credited** — PQP, PQF, award and lifetime miles

Out of that come Premier status tracking, cost-per-mile analytics, and a queue
of everything that doesn't line up.

Everything runs on your machine. One SQLite file, no accounts, no external
services, nothing phoned home.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. Edits hot-reload, so leave it running.

To explore with sample data before entering your own, run the seed below and
erase it afterwards from **Settings → Erase all data**:

```bash
npm run seed:demo
```

## What it does

- **Flight ledger** — a segment-level record of every flight: route, date,
  cabin, fare class, status, purpose. Distances come from a bundled OurAirports
  dataset (8,800 airports, versioned in-repo) computed on the WGS84 ellipsoid.

- **MileagePlus reconciliation** — import the united.com "My Activity" CSV and a
  weighted matcher links each posting to a flight, explains why ("Flight date
  exact · UA604 exact · SFO → IAH exact"), and asks only when it's genuinely
  ambiguous. Re-importing the same file is a no-op.

- **Flight-log import** — a myFlightradar24 or Flighty CSV export drops on
  the Flights page and quick-starts the ledger with any airline's history:
  routes, times, cabins, seats, aircraft types and tail registrations
  (Flighty's ICAO airline codes are translated to the IATA codes the ledger
  files by). On flights the ledger already has, a log fills blanks only — a
  receipt's cabin or a hand-entered seat always outranks it. A flight logged
  with no airline is filed under an honest `??` rather than refused.

- **Premier status by year** — PQP and PQF against the thresholds United
  published for *that* qualification year, drawn as the same three arc gauges
  united.com uses. The rings are stacked by source, so you can see a total's
  make-up — revenue flights, award flights, card spend, everything else — plus a
  breakdown table, the date each tier was unlocked and what tipped it over, and
  projections from booked and not-yet-credited travel.

- **Receipt import** — drop `.eml` files onto the Tickets page, or a whole
  Gmail label exported as one Takeout `.mbox`. Twenty-four
  formats are read: United eTicket receipts, booking confirmations, change
  notices and purchase receipts for extras (a paid upgrade lands on its ticket
  as a dated addition, never as a fake fare), plus American, Delta, Southwest,
  Alaska (the merged Hawaiian-branded template included), Lufthansa, SAS,
  Azul, LATAM, Wizz Air, Amex Travel, Chase Travel,
  Capital One Travel, ADTRAV/RezDesk, CTP, CWT
  and Kiwi.com — and for any airline nobody wrote a parser for, the schema.org
  flight markup many carriers embed in the email itself (itinerary only; the
  money still needs a receipt). Fares, taxes, payment methods, seats and
  itineraries are extracted and attached to your flights.

- **Exchange chains costed once** — a reissued ticket is priced as one economic
  unit across the flights that actually flew, not once per document. Face values
  on a reissue include the value carried over from the ticket it replaced, so
  adding them up overcounts; the ledger doesn't.

- **Reimbursements** — one tick for the normal case of "work paid for all of
  it". Partial amounts, refunds and statement credits are there when you need
  them. Refunds reduce gross *and* personal cost; reimbursements reduce personal
  only.

- **Cost per mile** — gross, personal and effective CPM, plus cost-per-PQP, each
  over a basis the interface discloses rather than quietly averaging away
  uncosted or non-earning flights. Also per route, so you can see which city
  pairs your money actually goes on — read undirected, since a round trip is one
  fare, and stating how many of the route's flights the figure rests on.

- **Cash flow** — the same money in the month it actually moved, rather than the
  month you flew: tickets on their purchase date, money back on its own date.
  Kept as its own view because the two must never blend. An exchange chain
  spreads across the dates its money moved, so a reissue that returns value
  shows a month going negative. A reimbursement with no date on record is
  assumed into its ticket's purchase month and marked `≈` — a real date always
  replaces the guess.

- **Travel mix** — what the flying is made of: business against personal, United
  metal against every other airline's, domestic against international, and the
  airports you actually use. Each cut partitions the same segments, so the
  totals agree, and each slice carries its own cost per mile — which is how you
  find out whether the half somebody else paid for costs more than the half you
  did. Follows the range control, so you can ask it per year.

- **Fare classes** — what each booking class costs per mile and what a dollar of
  it bought in status, per airline: a booking class is the airline's own
  namespace, and United's `V` and Lufthansa's `V` are different fares. The class
  is reported as the document wrote it and nothing is read off its letters,
  because on a real ledger `XN` is an award fare and `PZ` isn't. Award bookings
  are kept out of $/PQP on both sides of the ratio, or points nobody paid for
  make a class look free.

- **Flight map** — every flown route drawn on a world map, fully offline: the
  land outline is a bundled Natural Earth silhouette, so no tiles, no API keys,
  and no tile server ever learns your travel history. Routes are great-circle
  arcs weighted by how often you flew them, colorable by airline, purpose or
  ticket type, and the same map prints in the annual report. A route the
  bundled airport data can't place is listed under the map, never silently
  dropped.

- **Million Miler progress** — the month you crossed each lifetime rung, and an
  `≈` year for the ones still ahead at your current rate, printed beside that
  rate and the window it was fitted over. A year rather than a date, because a
  straight line through a lumpy travel history doesn't support more; nothing at
  all until there's a full year of history; and rungs too far out to mean
  anything are left out rather than dashed.

- **Reconcile queue** — flights United never credited, credited flights missing
  from the ledger, one eTicket number on two ticket rows, foreign-currency
  tickets still counted at 1:1, duplicates, allocation warnings, uncosted
  flights. Confirm or reject in place.

- **Multiple accounts** — each person gets a separate database file, so two
  ledgers can never be summed by accident. Switch from the sidebar.

- **Annual report** — pick a year on Analysis and it pops up over the page:
  headline totals, the Premier outcome with the flight that clinched each
  tier, month by month, routes, the mix, and what actually left your account.
  The browser's own Print → Save as PDF is the renderer, so it works offline
  like everything else.

- **Change log** — every edit to the ledger leaves a record: who made it (you,
  an import, a restore), and what it changed, before and after. One glance at
  **Settings → Recent changes** answers "what did that import actually do" —
  the question that used to be unanswerable until something looked wrong.

- **Export** — full JSON backup (restorable) plus CSVs for flights, tickets,
  adjustments and monthly summaries.

## Your data

Each account is one SQLite file under `data/`, gitignored. It leaves the
machine only if you turn on Google Drive sync in Settings, which uploads the
JSON backup to a private app folder of your own Drive. The schema is created
on first run through Node's built-in `node:sqlite`, so there are no native
dependencies to build.

The server binds to `127.0.0.1` only, so nothing else on your network can
reach it. There is deliberately no login: the app trusts whoever is at this
machine, exactly like the SQLite file itself does — which also means a
private-browsing window sees the same ledger, since the active account lives
server-side, not in the browser.

## Browser build

`npm run build:browser` exports the entire app as static files (`out/`) that
run with **no server at all**: SQLite compiled to WebAssembly in a worker,
the same schema, parsers and accounting code, and the ledger stored in the
browser's own origin-private file system (OPFS). Serve the folder from any
static host — it needs no headers, no keys, no backend. It serves from an
origin root as built; for a project path (`example.com/flight-ledger/`),
rebuild with `npm run build:browser -- --base /flight-ledger`, since Next
bakes asset and navigation URLs at build time and no host config can rewrite
them afterwards.

The trade is custody: the browser is the custodian, one account per browser,
and "clear site data" deletes the ledger — so export backups from Settings.
The desktop app above remains the durable home; the browser build is the
try-anywhere tier of the same codebase, behind one switch.

Back up with **Settings → JSON backup**, or connect **Google Drive sync** in
the same place. Sync keeps that backup file in a private app folder of your
own Drive and carries the ledger between devices; if both sides have changed,
it asks which one to keep. You'll need a Google OAuth client ID, either your
own from the Google Cloud console or `NEXT_PUBLIC_GOOGLE_CLIENT_ID` baked
into a hosted build (`cp .env.example .env` supplies the flightledger.net
one; a self-hosted copy on another origin needs its own). If you'd rather copy the file, stop the
server first: the database runs in WAL mode, and a committed row can still live
in the `-wal` sidecar, so copying the `.db` alone can hand you a stale ledger.

## Analytics, and where they aren't

The public site at flightledger.net counts page views with self-hosted,
cookieless [Swetrix](https://swetrix.com) — bundled from npm, no third-party
script at runtime. The tracker is hard-gated to that hostname in
[Analytics.tsx](src/components/Analytics.tsx): a local dev server, a
self-hosted copy, or the browser build served from any other origin sends
nothing, ever. Ledger data never leaves the browser either way, unless you
turn on Google Drive sync, which copies the JSON backup to your own Drive
when you press sync.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dashboard |
| `npm run build && npm start` | Production build and serve (uses `.next-build/`, so it won't disturb a running dev server) |
| `npm run selftest` | 885 checks over distance, cost allocation, parsing and status math, plus a 500-case fuzz |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint over `src/` and `scripts/` (Next's recommended rules, flat config) |
| `npm run seed:demo` | Populate sample data (needs a running server) |
| `npm run airports:build` | Refresh the bundled airport dataset from OurAirports |
| `npm run fleet:build -- <dir>` | Rebuilds the tail-number → aircraft-type table from a hand-downloaded FAA Releasable Aircraft Database |
| `npm run map:build` | Refresh the bundled world outline (Natural Earth) |
| `npm run wasm:assets` | Copy the SQLite-WASM binary into public/ (browser engine) |
| `npm run build:browser [-- --base /path]` | Export the whole app as static files running on the in-browser engine (`out/`) |
| `npm run bis:build` | Rebuild the published-mileage lookup table |

## Requirements

Node **22.5 or newer** — that's when `node:sqlite` landed. Developed on Node 25.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Recharts · d3-geo ·
Node's built-in `node:sqlite` (no ORM, no native modules) · bundled fonts and
map data, so it works offline.

## Documentation

| Document | What's in it |
|---|---|
| [Design](docs/flight-ledger-design.md) | Data model, metrics, workflows, import architecture |
| [Import formats](docs/importers.md) | What each of the twenty-three email formats does differently, and why |
| [Accounting rules](docs/accounting.md) | What gets counted, what doesn't, and the reasoning behind each rule |

## Status

The manual ledger, CSV and receipt import, weighted matching, the reconcile
queue, payments and exchange chains are all in and in daily use.

Not built yet: Gmail forwarding and scheduled imports.

## License

[MIT](LICENSE). The bundled datasets keep their own terms: OurAirports and
Natural Earth are public domain, the FAA aircraft registry is public data,
and the BIS city-pair table credits the FlyerTalk thread it was compiled
from in its header.

---

Not affiliated with or endorsed by United Airlines. "United", "MileagePlus" and
"Premier" are their trademarks, used here only to describe what this tool reads.
