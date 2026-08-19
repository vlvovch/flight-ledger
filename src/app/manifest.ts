import type { MetadataRoute } from "next";

/*
 * Web-app manifest: lets a phone install Flight Ledger to its home screen,
 * where a local-first app belongs. The colors are the United theme's deck —
 * the default a new install sees. The SVG icon scales to every size the
 * launcher asks for; the PNG is the fallback for launchers that won't take
 * SVG. No service worker yet, deliberately: the server build is already
 * local, and the browser build's offline story deserves more than a cache
 * shell bolted on here.
 */
/* The browser build is a static export; without this the metadata route
   registers as dynamic and `next build` for that target refuses the page. */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  /* Next prefixes its own routes with basePath but leaves these literals
     alone, so a browser build exported under --base /flight-ledger must
     carry the prefix itself or install pointing outside the app. Same env
     var the build script sets; empty everywhere else.
     The SVG is the full three-rule mark (public/icon-mark.svg), NOT the
     app/icon.svg favicon — that one is deliberately simplified for 16px
     tabs, and a launcher picking the scalable icon should get the same
     brand the PNGs carry. */
  const base = process.env.BASE_PATH ?? "";
  return {
    name: "Flight Ledger",
    short_name: "Flight Ledger",
    description:
      "A local dashboard for United flyers: every flight, what it cost, and what it earned.",
    start_url: `${base}/`,
    display: "standalone",
    background_color: "#041a3d",
    theme_color: "#041a3d",
    icons: [
      { src: `${base}/icon-mark.svg`, type: "image/svg+xml", sizes: "any" },
      { src: `${base}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { src: `${base}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
  };
}
