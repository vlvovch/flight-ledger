/*
 * Privacy policy — the FAQ's promises, written as the operator's own.
 *
 * Same rules as the FAQ page: a static server component, plain sentences,
 * no em-dashes, no jargon, and the hosted version described first because
 * that is where a reader of this page is standing. Nothing is promised here
 * that the code doesn't do; the analytics section describes Analytics.tsx
 * (hostname-gated, cookieless), and the sync section describes
 * lib/drive-sync.ts and browser/drive.ts, including the account email kept
 * as a login hint. If behaviour changes, this page changes in the same
 * commit or the policy is a lie.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy — Flight Ledger",
  description:
    "Where Flight Ledger keeps your data (on your device), what ever leaves it (nothing, unless you turn on Drive sync), and what the public site counts.",
};

const ACCENT = {
  miles: "var(--color-s-miles)",
  gross: "var(--color-s-gross)",
  personal: "var(--color-s-personal)",
  pqp: "var(--color-s-pqp)",
};

function Section({
  label,
  accent,
  children,
}: {
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div
        className="panel-accent"
        style={{ "--accent": accent } as React.CSSProperties}
      />
      <header className="px-4 pt-3.5 pb-1">
        <h2 className="t-label">{label}</h2>
      </header>
      <div className="space-y-2.5 px-4 pb-4 text-[13.5px] leading-relaxed text-ink2">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-4">
        <div className="t-label mb-1 text-s-miles">Flight Ledger</div>
        <h1 className="t-display text-[30px] leading-none text-ink">
          Privacy policy
        </h1>
        <p className="mt-2 text-[12.5px] text-mute">
          Last updated August 2026 · Flight Ledger is made by VV Labs LLC
        </p>
      </header>

      <div className="stagger space-y-3">
        <Section label="The short version" accent={ACCENT.miles}>
          <p>
            Your flying data is yours and stays on your device. This site has
            no accounts, no login and no database of users, and we could not
            look at your ledger if we wanted to. The only things described on
            this page are a page-view counter on this website and an optional
            Google Drive backup that you control.
          </p>
        </Section>

        <Section label="Your ledger" accent={ACCENT.gross}>
          <p>
            The app runs entirely in your browser. Flights, tickets, costs and
            anything you import are stored in your browser&rsquo;s own storage, on
            your device. Receipts and CSV files you import are read right
            there; they are never uploaded, because there is nothing to upload
            them to.
          </p>
          <p>
            If you run the app on your own computer instead, the ledger is a
            database file on your disk, and the built-in server accepts
            connections only from that machine.
          </p>
          <p>
            Because the browser holds the data, clearing this site&rsquo;s data in
            your browser also deletes the ledger. The backup and export
            buttons in Settings exist for exactly that reason.
          </p>
        </Section>

        <Section label="Google Drive sync" accent={ACCENT.personal}>
          <p>
            Sync is off until you set it up, and nothing is ever sent on its
            own. When you press sync, the app copies your backup file into a
            private folder of your own Google Drive that only this app can
            see. If you turn on automatic backup, the app repeats that same
            copy for about an hour after each sync you started yourself.
          </p>
          <p>
            The app asks Google for the narrowest Drive permission there is:
            access to its own app folder, nothing else in your Drive. Your
            data goes straight from your browser to Google; it never passes
            through our servers, because there are none. The app also asks
            Drive once for the email address of the account you picked, so
            Google stops asking you which account on every sync. That email
            is kept in your browser and nowhere else.
          </p>
          <p>
            To stop syncing, press &ldquo;Forget connection&rdquo; in Settings. That
            removes everything sync kept in your browser, but deletes nothing
            from your Drive. You can take the app&rsquo;s access away at{" "}
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink"
            >
              myaccount.google.com/connections
            </a>
            , and delete the stored backup in Google Drive under Settings,
            then &ldquo;Manage apps&rdquo;.
          </p>
        </Section>

        <Section label="This website" accent={ACCENT.pqp}>
          <p>
            flightledger.net counts page views and a few feature events by
            name only. That is how we know whether anyone visits and uses
            the app. The counter is Swetrix, a GDPR-compliant analytics tool
            running on our own server, and it works without cookies. That is
            why there is no cookie banner here: there is nothing to consent
            to. It does not identify you, does not follow you to other sites,
            and nothing about your ledger is in it. There are no ads and no
            third-party trackers.
          </p>
          <p>
            The counter runs only on flightledger.net itself. A copy you run
            on your own machine, or host yourself somewhere else, sends
            nothing at all.
          </p>
        </Section>

        <Section label="Questions" accent={ACCENT.miles}>
          <p>
            If this policy changes, the date at the top changes with it.
            Questions go to{" "}
            <a
              href="mailto:vlvovch@gmail.com"
              className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink"
            >
              vlvovch@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
