import type { SyncMarker, SyncMarkerStore, TokenSource } from "../drive-sync";

/*
 * The browser half of Drive sync: the Google Identity Services token client
 * and the localStorage sync marker. drive-sync.ts takes fetch and tokens as
 * arguments precisely so that this file is the only one the selftest can't
 * reach — everything decidable is decided over there.
 */

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GIS_SRC = "https://accounts.google.com/gsi/client";

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt: string;
    login_hint?: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): { requestAccessToken(): void };
}

/* Typed locally rather than via `declare global` — the GIS surface this app
   uses is three calls, not worth owning the global namespace for. */
const gisOauth2 = () =>
  (window as { google?: { accounts?: { oauth2?: GisOauth2 } } }).google
    ?.accounts?.oauth2;

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisOauth2()) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/* The token outlives the page but not the tab. In memory alone, every
   reload cost a popup flash — and a pull RELOADS, so auto mode flashed on
   exactly the syncs it was meant to make invisible. sessionStorage is the
   narrowest thing that survives a reload: per-tab, gone when the tab is.
   A bearer token in localStorage would outlive the sitting; this one
   can't. */
const TOKEN_KEY = "drive-token";
let cached: { token: string; expiresAt: number } | null = null;

function readCache(): { token: string; expiresAt: number } | null {
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    cached = raw ? (JSON.parse(raw) as typeof cached) : null;
  } catch {
    cached = null;
  }
  return cached;
}

function writeCache(value: { token: string; expiresAt: number }): void {
  cached = value;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value));
  } catch {
    /* private mode — the token just won't survive a reload */
  }
}

/* An empty prompt skips the consent screen but NOT the account chooser:
   without a hint, Google asks "which account?" on every single token. The
   hint is learned once, from the first granted token (about.get is inside
   the appdata scope), and answers the question in advance ever after —
   the popup then opens and closes itself. */
const HINT_KEY = "drive-account-hint";

function accountHint(): string | null {
  try {
    return localStorage.getItem(HINT_KEY);
  } catch {
    return null;
  }
}

async function learnAccountHint(token: string): Promise<void> {
  if (accountHint()) return;
  try {
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const body = (await res.json()) as { user?: { emailAddress?: string } };
    if (body.user?.emailAddress)
      localStorage.setItem(HINT_KEY, body.user.emailAddress);
  } catch {
    /* the hint is an optimization; without it the chooser just returns */
  }
}

/** Forget the session token and which Google account it belonged to (the
 *  "disconnect" button's half; revoking the grant itself is the user's
 *  act, in their Google account settings). Clearing the hint matters:
 *  reconnecting may well mean a different account. */
export function clearDriveToken(): void {
  cached = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(HINT_KEY);
  } catch {
    /* nothing stored, nothing to forget */
  }
}

/** Whether a sync could run right now without Google's popup. Automatic
 *  syncs check this and stand down rather than fire a popup no one asked
 *  for — a blocked popup mid-navigation reads as a broken app. */
export function hasFreshDriveToken(): boolean {
  const c = readCache();
  return c != null && Date.now() < c.expiresAt;
}

/**
 * A TokenSource over the GIS token model: access tokens only, about an hour
 * each, no refresh tokens client-side. An empty prompt keeps re-grants
 * silent once the user has consented; the consent screen appears only on
 * first connect (or a forced refresh after a 401).
 */
export function driveTokenSource(clientId: string): TokenSource {
  return async (forceRefresh: boolean): Promise<string> => {
    const c = readCache();
    if (!forceRefresh && c && Date.now() < c.expiresAt) return c.token;
    await loadGis();
    const oauth2 = gisOauth2();
    if (!oauth2) throw new Error("Google sign-in did not load");
    return new Promise<string>((resolve, reject) => {
      oauth2
        .initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          prompt: "",
          login_hint: accountHint() ?? undefined,
          callback: (resp) => {
            if (!resp.access_token)
              return reject(
                new Error(resp.error_description ?? resp.error ?? "Google sign-in was refused")
              );
            /* A minute of slack: better to fetch a fresh token than to send
               one that expires while the upload is in flight. */
            writeCache({
              token: resp.access_token,
              expiresAt: Date.now() + (Number(resp.expires_in ?? 0) - 60) * 1000,
            });
            void learnAccountHint(resp.access_token);
            resolve(resp.access_token);
          },
          error_callback: (err) =>
            reject(new Error(err.message ?? "Google sign-in failed")),
        })
        .requestAccessToken();
    });
  };
}

/** The marker lives beside the ledger, not inside it: a marker inside the
 *  backup would change the content it stamps. localStorage is per-origin,
 *  which matches one-account-per-browser (§22). */
export function localMarkerStore(key = "drive-sync-marker"): SyncMarkerStore {
  return {
    load(): SyncMarker | null {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as SyncMarker) : null;
      } catch {
        return null;
      }
    },
    save(marker: SyncMarker): void {
      localStorage.setItem(key, JSON.stringify(marker));
    },
  };
}
