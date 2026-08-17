"use client";

import { useEffect } from "react";

/**
 * Page-view counting for the PUBLIC site only — Swetrix, self-hosted at
 * swetrix-api.vovchenko.net, cookieless.
 *
 * The hostname gate is the privacy contract: a local dev server, someone's
 * self-hosted copy, and the browser build served from any other origin all
 * stay silent. This matters more here than on most sites — the whole pitch
 * of the local modes is that the ledger never phones home, so the analytics
 * must be provably scoped to flightledger.net itself. The npm package is
 * bundled in (no script from swetrix.org at runtime): the deploy stays
 * self-contained, and the code that runs is the code in this repo.
 *
 * No <noscript> pixel on purpose: the app is a WASM-SQLite SPA that cannot
 * function without JavaScript, so a no-JS visitor never becomes a user —
 * counting them would inflate visits with people who saw a blank page.
 */
export default function Analytics() {
  useEffect(() => {
    /* the app lives at app.flightledger.net (the apex only redirects) —
       accept the domain and its subdomains, nothing else */
    const h = window.location.hostname;
    if (h !== "flightledger.net" && !h.endsWith(".flightledger.net")) return;
    import("swetrix").then((swetrix) => {
      swetrix.init("Js2iOjhf3YOW", {
        apiURL: "https://swetrix-api.vovchenko.net/log",
      });
      swetrix.trackViews();
    });
  }, []);
  return null;
}
