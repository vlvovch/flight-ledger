import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    /* the app pages are a UI over the visitor's own ledger — nothing there
       for a crawler, and "Settings - Flight Ledger" in search results would
       only confuse */
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/flights",
        "/tickets",
        "/activity",
        "/analysis",
        "/reconcile",
        "/settings",
        "/labs",
      ],
    },
    sitemap: "https://app.flightledger.net/sitemap.xml",
  };
}
