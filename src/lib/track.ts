/*
 * Analytics configuration and the one gate every call answers to.
 *
 * Everything is driven by three build-time variables, and all three must be
 * set or the built app sends no analytics and contains no project or
 * endpoint configuration — a plain clone of this repo builds an app that
 * never phones anywhere, and the repository itself names no endpoint and no
 * project. The deploy that wants counting declares it in its own .env:
 *
 *   NEXT_PUBLIC_SWETRIX_PROJECT_ID  the Swetrix project
 *   NEXT_PUBLIC_SWETRIX_API_URL     the Swetrix event endpoint
 *   NEXT_PUBLIC_SWETRIX_HOST        the ONLY hostname (plus subdomains)
 *                                   the counter may run on
 *
 * The host variable is why a dev server reading the same .env stays silent:
 * localhost never matches it. Beyond that, a browser can opt itself out for
 * good with localStorage.setItem("fl-analytics", "off") — the owner's own
 * devices shouldn't pad the numbers, and cookieless counting has no other
 * way to recognize them.
 *
 * An event is a NAME and nothing else: no values, no filenames, nothing
 * derived from a ledger. Fire-and-forget on purpose — analytics must never
 * surface as an app error.
 */

/* static property access, so Next can inline the values at build time */
const PROJECT_ID = process.env.NEXT_PUBLIC_SWETRIX_PROJECT_ID;
const API_URL = process.env.NEXT_PUBLIC_SWETRIX_API_URL;
const HOST = process.env.NEXT_PUBLIC_SWETRIX_HOST;

function analyticsAllowed(): boolean {
  if (!PROJECT_ID || !API_URL || !HOST) return false;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  if (h !== HOST && !h.endsWith("." + HOST)) return false;
  try {
    if (localStorage.getItem("fl-analytics") === "off") return false;
  } catch {
    /* storage blocked: fall through and count the visit */
  }
  return true;
}

/* ONE loader that imports and initializes exactly once, shared by page
   views and events alike. The SDK treats track() before init() as a silent
   no-op, so letting two call sites import independently made the first
   event a race against the layout effect — a fast demo click could simply
   vanish. Behind a memoized promise there is no ordering to lose. */
let loader: Promise<typeof import("swetrix")> | null = null;
function swetrixReady(): Promise<typeof import("swetrix")> | null {
  if (!analyticsAllowed()) return null;
  const projectId = PROJECT_ID!;
  const apiURL = API_URL!;
  loader ??= import("swetrix").then((swetrix) => {
    swetrix.init(projectId, { apiURL });
    return swetrix;
  });
  return loader;
}

/** page-view counting — called once from the Analytics component */
export function startPageViews(): void {
  swetrixReady()
    ?.then((swetrix) => swetrix.trackViews())
    .catch(() => {});
}

/** a name-only feature event; `unique` counts it once per session (a
 *  Swetrix session ends after 30 minutes of quiet, or at midnight UTC) */
export function trackEvent(ev: string, unique = false): void {
  swetrixReady()
    ?.then((swetrix) => swetrix.track({ ev, unique }))
    .catch(() => {});
}
