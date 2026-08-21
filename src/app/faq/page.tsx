/*
 * FAQ — the questions a visitor asks before trusting the app with a ledger.
 *
 * A static server component on purpose: no data, no hooks, nothing fetched,
 * so it prerenders to plain HTML in both the local build and the browser
 * export. Accent colors are written as CSS variables directly rather than
 * imported from charts.tsx, because pulling anything from there drags
 * Recharts into a page that renders no chart.
 *
 * The voice here is deliberately NOT the repo's: a visitor hasn't read the
 * design doc and doesn't want to. Plain sentences, no em-dashes, no jargon
 * (a flightledger.net visitor has never met 127.0.0.1). The hosted version
 * is described first in the privacy answer because that is where most
 * readers of this page are standing.
 */

import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Flight Ledger",
  description:
    "What Flight Ledger is, where your data lives, and how to start from a MileagePlus CSV, email receipts, or a Flighty / myFlightradar24 export.",
};

const ACCENT = {
  miles: "var(--color-s-miles)",
  gross: "var(--color-s-gross)",
  personal: "var(--color-s-personal)",
  pqp: "var(--color-s-pqp)",
  award: "var(--color-s-award)",
};

/* A native <details>: collapsing costs no JavaScript, so the page stays a
   static server component and the export stays inert. Collapsed by default,
   since an FAQ is scanned by question, not read top to bottom, with the first
   answer open so the page doesn't greet a visitor with bare headings. */
function QA({ q, open, children }: { q: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-t border-line px-4 first-of-type:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 pointer-coarse:py-4 text-[15px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronRight
          size={16}
          className="shrink-0 text-mute transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="space-y-2.5 pb-4 text-[13.5px] leading-relaxed text-ink2">{children}</div>
    </details>
  );
}

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-4">
        <div className="t-label mb-1 text-s-miles">Questions & answers</div>
        <h1 className="t-display text-[30px] leading-none text-ink">FAQ</h1>
      </header>

      <div className="stagger space-y-3">
        <section className="panel">
          <div
            className="panel-accent"
            style={{ "--accent": ACCENT.miles } as React.CSSProperties}
          />
          <header className="px-4 pt-3.5 pb-1">
            <h2 className="t-label">What this is</h2>
          </header>

          <QA q="What is Flight Ledger?" open>
            <p>
              A personal dashboard for your United flying: every flight, what
              it cost, and what it earned in miles, PQP and Premier progress.
              You can see your cost per mile, follow status as it builds over
              the year, and catch flights that never posted to your account.
            </p>
            <p>Not affiliated with United Airlines.</p>
          </QA>

          <QA q="How does it work?">
            <p>
              Most of the ledger builds itself from two files you already
              have: the &ldquo;My&nbsp;Activity&rdquo; CSV from united.com, which brings
              your flights and everything United posted for them, and your
              email receipts, which add the prices. You can also enter or edit
              any flight or ticket by hand. Every imported number stays
              editable, and every change is logged so you can always see what
              an import actually did.
            </p>
          </QA>

          <QA q="What is it not?">
            <p>
              It doesn&rsquo;t book travel, doesn&rsquo;t track live flights, and doesn&rsquo;t
              connect to your airline account. It only reads files you give
              it. There is no cloud account and no login; the ledger is yours,
              on your device.
            </p>
          </QA>
        </section>

        <section className="panel">
          <div
            className="panel-accent"
            style={{ "--accent": ACCENT.gross } as React.CSSProperties}
          />
          <header className="px-4 pt-3.5 pb-1">
            <h2 className="t-label">Privacy</h2>
          </header>

          <QA q="Where does my data live?">
            <p>
              In your browser. This site has no backend: the database runs
              inside your browser and stays on your device, and your receipts
              are parsed right there too. Nothing you import is sent anywhere.
              The one exception is Google Drive sync, which you can turn on in
              Settings: it copies your backup to your own Drive when you press
              sync, and never on its own. One thing to know: clearing site data in your
              browser also deletes the ledger, so export a backup from
              Settings now and then.
            </p>
            <p>
              If you instead run the app on your own computer, each account is
              a single database file on your disk, and the built-in server
              accepts connections only from that machine.
            </p>
            <p>
              The full story is on the{" "}
              <a
                href="/privacy"
                className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink"
              >
                privacy policy
              </a>{" "}
              page.
            </p>
          </QA>

          <QA q="How do I back up?">
            <p>
              <strong>Settings → Full backup (JSON)</strong>. That is the one
              file you can restore from. The CSV exports next to it are for
              taking tables into a spreadsheet. Both are plain text, so your
              data is never locked in. Google Drive sync, next to them, keeps
              that same backup file in your own Drive and carries the ledger
              between devices. If both sides have changed, it asks which one
              to keep.
            </p>
          </QA>

          <QA q="Can two people use it?">
            <p>
              Yes. Create an account for each person and switch between them
              in the sidebar. Every account is a separate database, so one
              person&rsquo;s flights and money never mix with another&rsquo;s.
            </p>
          </QA>
        </section>

        <section className="panel">
          <div
            className="panel-accent"
            style={{ "--accent": ACCENT.pqp } as React.CSSProperties}
          />
          <header className="px-4 pt-3.5 pb-1">
            <h2 className="t-label">Getting started</h2>
          </header>

          <QA q="What's the fastest way to start?">
            <p>
              Import your united.com <strong>My&nbsp;Activity</strong> CSV first (united.com →
              MileagePlus → My&nbsp;Activity). That one file creates your flights
              along with the miles and PQP United posted for them.
            </p>
            <p>
              Then add costs by dropping eTicket receipt emails on the Tickets
              page. To load years of history at once: in <strong>Gmail</strong>, search{" "}
              <code>from:receipts@united.com OR from:notifications@united.com
              OR from:unitedairlines@united.com</code>, apply a label, export
              that label with <strong>Google Takeout</strong>, and drop the resulting{" "}
              <code>.mbox</code> file here. Importing the same file twice is
              safe; nothing is duplicated.
            </p>
            <p>
              You can also start from a flight log kept in{" "}
              <strong>Flighty</strong> or <strong>myFlightradar24</strong>: drop its CSV export on the Flights page and
              your whole history loads in one go — any airline, not just
              United.
            </p>
            <p>
              Prefer to start small? Log a flight by hand and go from there.
            </p>
            <p>
              Just want to look around first? Press{" "}
              <strong>Load demo data</strong> on the empty dashboard and a
              sample ledger appears. Erase it from Settings when you&rsquo;re
              done.
            </p>
          </QA>

          <QA q="What if I don't use Gmail?">
            <p>
              Any saved email works. <strong>Thunderbird</strong> and{" "}
              <strong>Apple&nbsp;Mail</strong> can save a
              whole search result as <code>.eml</code> files, and you can drop
              those in directly. <strong>Outlook</strong> saves <code>.msg</code> files, which
              the importer can&rsquo;t read, so Outlook users should export through
              Thunderbird.
            </p>
          </QA>
        </section>

        <section className="panel">
          <div
            className="panel-accent"
            style={{ "--accent": ACCENT.award } as React.CSSProperties}
          />
          <header className="px-4 pt-3.5 pb-1">
            <h2 className="t-label">Coverage</h2>
          </header>

          <QA q="Is it United-only?">
            <p>
              The status side is: PQP, PQF, Premier tiers and lifetime miles
              are United programs. The money side isn&rsquo;t. Flights on any
              airline belong in the ledger, count toward cost per mile and the
              map, and the travel mix will show your United flying next to
              everyone else&rsquo;s.
            </p>
          </QA>

          <QA q="Can I import from Flighty or myFlightradar24?">
            <p>
              Yes. Export your log as CSV from either app&rsquo;s settings and
              drop the file on the Flights page — the format is recognized
              automatically. Routes, dates, times, cabins,
              seats, aircraft types and tail numbers come across; a flight
              logged with no airline is kept and filed under an honest{" "}
              <code>??</code> rather than refused.
            </p>
            <p>
              On flights the ledger already has, a log only fills blanks — a
              receipt&rsquo;s cabin or a hand-entered seat always outranks it. The
              one exception: Flighty&rsquo;s recorded actual departure and arrival
              times correct a stored schedule, because what actually flew
              outranks what was booked. You
              see the full list of adds and fills before anything is written,
              and can untick any row: some exports carry flights that were
              only tracked, never flown.
            </p>
          </QA>

          <QA q="Which receipts are recognized?">
            <p>
              Twenty-three email formats: United (eTicket receipts, booking
              confirmations, change notices, cancellations, and receipts for
              extras like seats and upgrades), American, Delta, Southwest,
              Alaska, Lufthansa, SAS, Azul, LATAM, Wizz Air, plus bookings
              made through Amex Travel, Chase Travel, Capital One Travel,
              ADTRAV/RezDesk, CTP, CWT and Kiwi.com.
            </p>
            <p>
              If your airline isn&rsquo;t on the list, there is a good chance its
              emails still work: many carriers embed machine-readable flight
              details that the importer reads, though prices then need to be
              typed in. And entering a ticket manually always works; it takes
              about a minute.
            </p>
          </QA>

          <QA q="What about award tickets?">
            <p>
              Fully supported. The taxes and fees count as cost, and the miles
              you redeemed are recorded alongside. Award flights stay out of
              the headline cost-per-mile figure, where a few dollars of tax on
              a long flight would look impossibly cheap; a separate
              &ldquo;effective&rdquo; figure values your miles at a rate you choose. If a
              receipt covers two travelers, only your share is recorded.
            </p>
          </QA>

          <QA q="What about reimbursed work travel?">
            <p>
              Tick one box when work paid for the whole ticket, or record
              exact amounts, refunds and statement credits when it&rsquo;s more
              complicated. The app keeps two totals side by side: what the
              flying cost, and what it cost you personally.
            </p>
          </QA>
        </section>
      </div>
    </div>
  );
}
