import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    /* Everything is crawlable ON PURPOSE, including the app routes: their
       route-group layout emits robots noindex, and a crawler blocked by a
       Disallow could never see it — a blocked URL can still be indexed
       from links alone. robots.txt does crawl control; the metadata does
       index control. */
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://app.flightledger.net/sitemap.xml",
  };
}
