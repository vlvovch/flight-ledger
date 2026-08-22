import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import EngineBoot from "@/components/EngineBoot";
import Analytics from "@/components/Analytics";
import { ToastHost } from "@/components/ui";

const barlow = localFont({
  src: [
    { path: "../fonts/Barlow-400.woff2", weight: "400" },
    { path: "../fonts/Barlow-500.woff2", weight: "500" },
    { path: "../fonts/Barlow-600.woff2", weight: "600" },
  ],
  variable: "--font-barlow",
});

const barlowCondensed = localFont({
  src: [
    { path: "../fonts/BarlowCondensed-500.woff2", weight: "500" },
    { path: "../fonts/BarlowCondensed-600.woff2", weight: "600" },
    { path: "../fonts/BarlowCondensed-700.woff2", weight: "700" },
  ],
  variable: "--font-barlow-condensed",
});

const plexMono = localFont({
  src: [
    { path: "../fonts/IBMPlexMono-400.woff2", weight: "400" },
    { path: "../fonts/IBMPlexMono-500.woff2", weight: "500" },
    { path: "../fonts/IBMPlexMono-600.woff2", weight: "600" },
  ],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  /* Named for what it is, not for one figure it computes. Cost per mile was
     the original question; the app now also answers what flew, what it cost,
     what United credited and where that leaves Premier status.
     The title stays United-specific on purpose. The ledger half — cost,
     distance, CPM — is airline-agnostic and takes any carrier's receipt, but
     PQP/PQF, lifetime miles and Premier have no SkyMiles or AAdvantage
     equivalent here, and they are the reason to choose this over a generic
     tracker. The other airlines belong in the description, not the name. */
  title: "Flight Ledger — United flight costs, PQP & Premier status",
  description:
    "Reconcile United flights and ticket costs against MileagePlus postings — PQP/PQF, lifetime miles, Premier status, cost per mile. Other airlines fit the same ledger.",
  /* Social crawlers accept only absolute URLs for og:image; this is the
     origin the hosted app lives at. A local or self-hosted copy still works
     — the image URL just points here, which only matters to link previews. */
  metadataBase: new URL("https://app.flightledger.net"),
  /* "./" resolves per-route against metadataBase, so every page carries a
     rel=canonical naming the hosted deployment — exported and self-hosted
     copies then point search engines at the original instead of competing
     with it. metadataBase alone does NOT emit canonicals; this does. */
  alternates: { canonical: "./" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >

      {/* suppressHydrationWarning: browser extensions (Grammarly, PerkSpot, …)
          inject attributes into <body> before React hydrates, tripping React 19's
          mismatch check. Suppression covers this element's attributes only —
          children are still fully hydration-checked. */}
      <body className="antialiased" suppressHydrationWarning>
        {/* First thing in <body> so it runs before any of the page paints.
            A <script> is not valid directly under <html>, and putting it there
            tripped a hydration error on every load. Reading the theme from a
            component instead would render the default and correct it a frame
            later — a visible flash of the wrong palette. Theme is per-browser,
            not per-account: it says how you like to look at the app.
            United is the default: no stored choice (or an unreadable one)
            lands there, while an explicit pick of any theme — Deck included,
            stored as "dark" — is honored forever. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("flightdeck-theme");if(t!=="dark"&&t!=="light")t="united";if(t!=="dark")document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="united"}`,
          }}
        />
        <div className="flex min-h-[var(--vh-scaled)]">
          <EngineBoot />
          <Analytics />
          <ToastHost />
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col px-4 pb-6 pt-16 lg:px-10 lg:py-6">
            <div className="flex-1">{children}</div>
            {/* Every page ends the same way: who made this, and the links a
                visitor goes looking for. The FAQ lives here (and in the
                sidebar's footer) rather than in the nav — it is read once,
                and the nav stays the pages an owner works in. The GitHub
                link is the trust signal for the skeptical visitor: the
                privacy claims are checkable against the source. */}
            <footer className="mt-12 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-mute">
              <span>
                © {new Date().getFullYear()} VV Labs LLC · Built by{" "}
                <a
                  href="https://github.com/vlvovch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink2"
                >
                  Volodymyr Vovchenko
                </a>
                {" · "}
                <a
                  href="https://github.com/vlvovch/flight-ledger"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink2"
                >
                  Open source on GitHub
                </a>
              </span>
              <span className="flex items-center gap-4">
                <Link href="/faq" className="transition-colors hover:text-ink2">
                  FAQ
                </Link>
                <Link href="/privacy" className="transition-colors hover:text-ink2">
                  Privacy policy
                </Link>
              </span>
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
