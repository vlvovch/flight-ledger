"use client";

import { useEffect } from "react";

import { startPageViews } from "@/lib/track";

/**
 * Page-view counting, entirely opt-in at BUILD time — see track.ts for the
 * three variables that enable it, the gate that scopes it, and the shared
 * loader that page views and feature events both ride behind. A build
 * without the variables sends nothing and names no endpoint.
 *
 * The npm package is bundled in (no script from a third-party origin at
 * runtime): the deploy stays self-contained, and the code that runs is the
 * code in this repo.
 *
 * No <noscript> pixel on purpose: the app is a WASM-SQLite SPA that cannot
 * function without JavaScript, so a no-JS visitor never becomes a user —
 * counting them would inflate visits with people who saw a blank page.
 */
export default function Analytics() {
  useEffect(() => {
    startPageViews();
  }, []);
  return null;
}
