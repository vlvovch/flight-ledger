# Flight Ledger

Flight Ledger is a private ledger of your flying: every flight, what it
cost, what United credited for it, and whether those numbers agree. Flight
trackers watch your next departure; this explains everything you already
flew. It runs entirely on your own machine.

### [Try it now at app.flightledger.net](https://app.flightledger.net)

Nothing to install, no account to create. The whole app runs inside your
browser (SQLite compiled to WebAssembly), and your ledger stays there.
No ledger contents are uploaded unless you turn on Drive sync yourself.

## Start in five minutes

Download your "My Activity" CSV from united.com (MileagePlus → My Activity)
and drop it on the Flights page, or use Flights → Import CSV. That one file builds your flight history and starts
the Premier tracker: PQP and PQF measured against the thresholds United
published for each year, drawn as the same arc gauges united.com uses, with
unlock dates, projections from booked travel, lifetime miles, and Million
Miler progress. Re-importing the same file changes nothing, so pull a fresh
CSV whenever you like.

Already keep a flight log in Flighty or myFlightradar24? Drop its CSV
export too. It loads years of history on any airline, including aircraft
types and tail numbers, and the app tells the formats apart on its own.

## Where Flight Ledger is different

Feed it your email receipts and it becomes an accounting tool. Drop `.eml`
files or a whole Gmail label exported through Takeout; 23 formats are read,
covering United, American, Delta, Southwest, Alaska, Lufthansa and others,
plus bookings made through Amex, Chase, and Capital One travel portals.
Then:

- A reissued ticket is priced as one economic unit across the flights that
  actually flew, so the value carried between tickets is never counted
  twice.
- Refunds and reimbursements are tracked properly. Refunds reduce what the
  trip cost; reimbursements reduce what it cost *you*.
- Cost per mile comes in gross, personal, and per-route flavors, and every
  figure states which flights it rests on instead of quietly averaging
  away the ones with no recorded cost.
- Cash flow gets its own view: the same money shown in the month it moved
  rather than the month you flew. The two are never blended.
- Whatever doesn't line up lands in a reconcile queue: flights United never
  credited, duplicates, foreign-currency tickets counted at 1:1, clocks
  that disagree with the distance.

## Also in the box

Statistics, mostly. A zoomable route map drawn fully offline from bundled
data, so no tile server ever learns your travel history. A sortable table
of every route you fly. Fleet statistics down to individual airframes,
enriched from the FAA registry. Travel mix, fare-class economics, and a
printable annual report. Plus a change log that records every edit, who
made it, and what changed, so "what did that import actually do?" always
has an answer. Estimates wear an `≈`, and a value you typed by hand is
never overwritten by an import. The reasoning behind each rule lives in
the [docs](#documentation).

## Your data

Your ledger stays local by default. In the browser build it lives in your
browser's own storage (OPFS); "clear site data" deletes it, so export
backups. Self-hosted, each account is one SQLite file under `data/`, and the
server binds to `127.0.0.1` only.

One exception: Google Drive sync, if you turn it on, copies the backup
from your browser to a private folder of your own Drive when you press
sync. The public site also counts page views, but never sees ledger
contents. Details in the
[privacy policy](https://app.flightledger.net/privacy).

## Run it yourself

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. To explore with sample data first, run
`npm run seed:demo` and erase it later from Settings → Erase all data.
Requires Node 22.13 or newer, the first release where `node:sqlite` runs
without a flag.

`npm run build:browser` exports the entire app as static files (`out/`)
that run with no server at all; serve them from any static host. For a
project path, rebuild with `-- --base /path`. For the official
flightledger.net deployment, copy `.env.example` to `.env`; a deployment on
any other origin needs its own Google OAuth client ID for Drive sync.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dashboard |
| `npm run build && npm start` | Production build and serve (uses `.next-build/`, so it won't disturb a running dev server) |
| `npm run selftest` | 937 checks over distance, cost allocation, parsing and status math, plus a 500-case fuzz |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint over `src/` and `scripts/` (Next's recommended rules, flat config) |
| `npm run seed:demo` | Populate sample data (needs a running server) |
| `npm run airports:build` | Refresh the bundled airport dataset from OurAirports |
| `npm run fleet:build -- <dir>` | Rebuild the tail-number to aircraft-type table from a hand-downloaded FAA Releasable Aircraft Database |
| `npm run map:build` | Refresh the bundled world outline (Natural Earth) |
| `npm run wasm:assets` | Copy the SQLite-WASM binary into public/ (browser engine) |
| `npm run build:browser [-- --base /path]` | Export the whole app as static files running on the in-browser engine (`out/`) |
| `npm run bis:build` | Rebuild the published-mileage lookup table |

## Stack

Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Recharts, d3-geo, and
Node's built-in `node:sqlite` (no ORM, no native modules). Fonts, airports,
and map data are bundled, with no third-party runtime data services.

## Documentation

| Document | What's in it |
|---|---|
| [Design](docs/flight-ledger-design.md) | Data model, metrics, workflows, import architecture |
| [Import formats](docs/importers.md) | What each email and CSV format does differently, and why |
| [Accounting rules](docs/accounting.md) | What gets counted, what doesn't, and the reasoning behind each rule |

## Status

In daily use: the ledger, receipt and CSV imports, weighted matching, the
reconcile queue, payments and exchange chains. Not built yet: Gmail
forwarding and scheduled imports.

## License

[MIT](LICENSE). The bundled datasets keep their own terms: OurAirports and
Natural Earth are public domain, the FAA aircraft registry is public data,
and the BIS city-pair table credits the FlyerTalk thread it was compiled
from in its header.

---

Not affiliated with or endorsed by United Airlines. "United", "MileagePlus"
and "Premier" are their trademarks, used here only to describe what this
tool reads.
