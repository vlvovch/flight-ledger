import type { MetadataRoute } from "next";

/* Static, for the browser export — same reason as manifest.ts. The URLs are
   the canonical public host — app.flightledger.net, where the app actually
   lives; the apex only redirects, and a sitemap naming the redirecting host
   argues with its own redirect. Only the CONTENT pages are listed — the app
   pages are a UI over the visitor's own (empty) ledger, and there is
   nothing there for a crawler to read. */
export const dynamic = "force-static";

const HOST = "https://app.flightledger.net";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${HOST}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${HOST}/faq`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${HOST}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
