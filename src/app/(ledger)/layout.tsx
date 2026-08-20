import type { Metadata } from "next";

/*
 * The ledger UI, grouped so one layout can say: not for search results.
 * robots.txt deliberately does NOT block these routes — a crawler must be
 * able to FETCH a page to see its noindex, and a Disallow'd URL can still
 * be indexed from links alone. Crawl control and index control are
 * different verbs; this is the second one.
 */
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function LedgerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
