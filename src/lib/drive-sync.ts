import type { BackupPayload } from "./repo";

/*
 * Google Drive sync, the library half (design doc §23). The browser is the
 * custodian and the JSON backup is the exit door (§22); sync automates the
 * walk through it. What syncs is the backup payload itself — one file per
 * ledger in Drive's hidden appDataFolder (scope drive.appdata: the app sees
 * its own folder and nothing else of the user's Drive), validated on the way
 * back in by the same restore path a hand-carried file uses.
 *
 * Everything here is platform-neutral: fetch and tokens are injected, so the
 * selftest drives the whole loop — client, planner, syncOnce — against a
 * fake Drive in Node. The only browser-bound pieces (the Google Identity
 * Services token client, the localStorage marker) live in browser/drive.ts.
 */

/** The one name both phases agree on; the file lives in appDataFolder. */
export const DRIVE_BACKUP_NAME = "flight-ledger-backup.json";

/* ------------------------------ fingerprint ------------------------------ */

/**
 * Canonical JSON: object keys sorted, undefined dropped (as JSON.stringify
 * does), array order preserved — row order is meaning, key order is not.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((v) => stableStringify(v ?? null)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * SHA-256 over the canonical backup, minus exported_at — the one field that
 * changes when nothing did. Two ledgers with the same rows and settings get
 * the same fingerprint no matter when or where they were exported.
 * (crypto.subtle needs a secure context, but so does Google sign-in; any
 * origin that can sync can also hash.)
 */
export async function backupFingerprint(payload: BackupPayload): Promise<string> {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.exported_at;
  const bytes = new TextEncoder().encode(stableStringify(rest));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** Empty in the sense that matters for sync: no rows worth protecting. */
export function backupIsEmpty(payload: BackupPayload): boolean {
  return (
    !payload.tickets?.length &&
    !payload.segments?.length &&
    !payload.adjustments?.length &&
    !payload.payments?.length &&
    !payload.activities?.length
  );
}

/* -------------------------------- planner -------------------------------- */

/** What the last successful sync saw: which file, at what remote version,
 *  carrying what local content. Stored outside the ledger (localStorage) —
 *  a marker inside the backup would change the very content it stamps. */
export interface SyncMarker {
  fileId: string;
  version: string;
  fingerprint: string;
}

export interface SyncMarkerStore {
  load(): SyncMarker | null;
  save(marker: SyncMarker): void;
}

/** The remote head, as files.list reports it: Drive's monotonic version
 *  plus the fingerprint we stamped into appProperties at upload. */
export interface RemoteMeta {
  fileId: string;
  version: string;
  fingerprint: string | null;
  exportedAt: string | null;
  modifiedTime: string | null;
}

export type SyncAction = "push" | "pull" | "noop" | "conflict";

export interface SyncPlan {
  action: SyncAction;
  reason: string;
  /** noop, but the marker should be (re)written: content already matches. */
  adopt?: boolean;
}

export interface SyncSnapshot {
  localFingerprint: string;
  localEmpty: boolean;
  marker: SyncMarker | null;
  remote: RemoteMeta | null;
}

/**
 * The whole sync decision, as a pure function over four facts. Three-way
 * comparison with the marker as the base: one side moved → follow it; both
 * moved to the same content → adopt; both moved apart → conflict, and the
 * lib stops. Divergent ledgers cannot be merged row-by-row — a restore
 * replaces the database wholesale, and half a ledger from each side would
 * double-count money — so choosing a side is the user's call, passed back
 * in as an explicit resolution.
 */
export function planSync(s: SyncSnapshot): SyncPlan {
  const { localFingerprint: local, localEmpty, remote } = s;
  if (!remote) {
    if (localEmpty)
      return { action: "noop", reason: "empty ledger and no Drive copy — nothing to sync" };
    return s.marker
      ? { action: "push", reason: "the Drive copy is gone; re-creating it" }
      : { action: "push", reason: "first sync: creating the Drive copy" };
  }
  /* Covers "both changed to the same content" and "same file re-uploaded
     elsewhere": whenever content already matches, the only work left is to
     remember that it does. */
  if (local === remote.fingerprint)
    return { action: "noop", adopt: true, reason: "this ledger and the Drive copy are already identical" };
  const marker = s.marker && s.marker.fileId === remote.fileId ? s.marker : null;
  if (!marker) {
    if (localEmpty)
      return { action: "pull", reason: "this ledger is empty and the Drive copy has data" };
    return { action: "conflict", reason: "this ledger and the Drive copy both have data, and they differ" };
  }
  const localChanged = local !== marker.fingerprint;
  const remoteChanged = remote.version !== marker.version;
  if (!localChanged && !remoteChanged)
    return { action: "noop", reason: "no changes since the last sync" };
  if (localChanged && !remoteChanged)
    return { action: "push", reason: "local changes since the last sync" };
  if (!localChanged && remoteChanged)
    return { action: "pull", reason: "the Drive copy changed since the last sync" };
  return { action: "conflict", reason: "changed both here and in Drive since the last sync" };
}

/* ------------------------------ Drive client ----------------------------- */

export class DriveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DriveError";
  }
}

/** Injected so the selftest can hand in a fake Drive and the browser the
 *  real fetch. forceRefresh=true means the last token was rejected. */
export type TokenSource = (forceRefresh: boolean) => Promise<string>;
export type DriveFetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const META_FIELDS = "id,version,modifiedTime,appProperties";

/**
 * Metadata and content in one request body (uploadType=multipart). Built by
 * hand — FormData inserts its own headers and Drive wants exactly two parts.
 * The boundary is fixed for determinism and extended if the payload happens
 * to contain it (a notes field can hold anything).
 */
export function buildMultipart(
  metadata: object,
  content: string
): { contentType: string; body: string } {
  const meta = JSON.stringify(metadata);
  let boundary = "flight-ledger-boundary-9f2c";
  while (meta.includes(boundary) || content.includes(boundary)) boundary += "x";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    meta,
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

export interface DriveClient {
  findFile(name: string): Promise<RemoteMeta | null>;
  download(fileId: string): Promise<string>;
  upload(
    name: string,
    content: string,
    props: Record<string, string>,
    fileId?: string
  ): Promise<RemoteMeta>;
}

interface DriveFileResource {
  id: string;
  version: number | string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

function toMeta(f: DriveFileResource): RemoteMeta {
  return {
    fileId: f.id,
    version: String(f.version),
    fingerprint: f.appProperties?.fingerprint ?? null,
    exportedAt: f.appProperties?.exported_at ?? null,
    modifiedTime: f.modifiedTime ?? null,
  };
}

export function createDriveClient(opts: {
  getToken: TokenSource;
  fetchFn?: DriveFetch;
}): DriveClient {
  const doFetch = opts.fetchFn ?? ((url, init) => fetch(url, init));

  async function request(url: string, init?: RequestInit): Promise<Response> {
    let token = await opts.getToken(false);
    const send = async (t: string) => {
      try {
        return await doFetch(url, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${t}` },
        });
      } catch {
        throw new DriveError(0, "Google Drive is unreachable — check the connection");
      }
    };
    let res = await send(token);
    /* Access tokens live about an hour; a 401 mid-session means the cache
       went stale, not that the user is gone. One fresh token, one retry. */
    if (res.status === 401) {
      token = await opts.getToken(true);
      res = await send(token);
    }
    if (!res.ok) {
      let message = `Google Drive error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) message = body.error.message;
      } catch {
        /* non-JSON error body; the status alone will have to do */
      }
      throw new DriveError(res.status, message);
    }
    return res;
  }

  return {
    async findFile(name) {
      const q = `name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
      const url =
        `${API}/files?spaces=appDataFolder&q=${encodeURIComponent(q)}` +
        `&fields=${encodeURIComponent(`files(${META_FIELDS})`)}&pageSize=10`;
      const res = await request(url);
      const body = (await res.json()) as { files?: DriveFileResource[] };
      const files = (body.files ?? []).map(toMeta);
      if (files.length === 0) return null;
      /* Two copies can only mean a create raced a create; take the newest
         and let the planner treat the rest as if they weren't there. */
      files.sort((a, b) => (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? ""));
      return files[files.length - 1];
    },

    async download(fileId) {
      const res = await request(`${API}/files/${fileId}?alt=media`);
      return res.text();
    },

    async upload(name, content, props, fileId) {
      const metadata = fileId
        ? { appProperties: props }
        : { name, parents: ["appDataFolder"], appProperties: props };
      const { contentType, body } = buildMultipart(metadata, content);
      const url = fileId
        ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=${META_FIELDS}`
        : `${UPLOAD}/files?uploadType=multipart&fields=${META_FIELDS}`;
      const res = await request(url, {
        method: fileId ? "PATCH" : "POST",
        headers: { "Content-Type": contentType },
        body,
      });
      return toMeta((await res.json()) as DriveFileResource);
    },
  };
}

/* -------------------------------- syncOnce ------------------------------- */

/** Everything syncOnce needs, injected: the export and restore paths stay
 *  where they live (api() on the page, the routes in the worker) and the
 *  lib never learns about transports. */
export interface SyncPorts {
  client: DriveClient;
  fileName?: string;
  loadLocal(): Promise<BackupPayload>;
  applyRemote(json: string): Promise<void>;
  markerStore: SyncMarkerStore;
}

/** What a side holds, in the units a person weighs it in. Exists because a
 *  chooser that says "pick a side" without saying what is ON each side got
 *  a real ledger overwritten by a stale one: the old data's button looked
 *  like the affirmative default, and nothing on screen said it held a
 *  fraction of the flights. */
export interface LedgerSummary {
  flights: number;
  tickets: number;
  lastEdited: string | null;
}

export function summarizeBackup(p: BackupPayload): LedgerSummary {
  let last: string | null = null;
  for (const rows of [p.tickets, p.segments, p.adjustments, p.payments, p.activities])
    for (const row of rows ?? []) {
      const u = (row as { updated_at?: string }).updated_at;
      if (u && (last === null || u > last)) last = u;
    }
  return {
    flights: p.segments?.length ?? 0,
    tickets: p.tickets?.length ?? 0,
    lastEdited: last,
  };
}

export interface SyncOutcome {
  action: SyncAction;
  reason: string;
  /** The head as last seen (after a push: as uploaded). The conflict chooser
   *  shows its dates, so "the Drive copy" has a when attached. */
  remote?: RemoteMeta | null;
  /** Both sides' contents, present on a conflict so the chooser can state
   *  facts instead of asking for a blind choice. */
  localSummary?: LedgerSummary;
  remoteSummary?: LedgerSummary | null;
}

/**
 * One full pass: snapshot, plan, execute, remember. A conflict returns
 * without touching either side; the caller re-runs with `resolve` once the
 * user has chosen. No lock against a concurrent writer on another device —
 * single-user by design (§21), and the window between findFile and upload
 * is one request wide.
 */
export async function syncOnce(
  ports: SyncPorts,
  resolve?: "push" | "pull"
): Promise<SyncOutcome> {
  const name = ports.fileName ?? DRIVE_BACKUP_NAME;
  const payload = await ports.loadLocal();
  const fingerprint = await backupFingerprint(payload);
  const remote = await ports.client.findFile(name);
  let plan = planSync({
    localFingerprint: fingerprint,
    localEmpty: backupIsEmpty(payload),
    marker: ports.markerStore.load(),
    remote,
  });
  if (plan.action === "conflict" && resolve)
    plan = {
      action: resolve,
      reason: `conflict resolved by hand: kept ${resolve === "push" ? "this ledger" : "the Drive copy"}`,
    };

  if (plan.action === "push") {
    const meta = await ports.client.upload(
      name,
      JSON.stringify(payload, null, 2),
      { fingerprint, exported_at: payload.exported_at },
      remote?.fileId
    );
    ports.markerStore.save({ fileId: meta.fileId, version: meta.version, fingerprint });
    return { action: "push", reason: plan.reason, remote: meta };
  }

  if (plan.action === "pull" && remote) {
    const json = await ports.client.download(remote.fileId);
    /* Fingerprint what was actually in the file, not what its appProperties
       claim — a hand-edited Drive copy stamps itself honestly on the way in. */
    const pulled = await backupFingerprint(JSON.parse(json) as BackupPayload);
    await ports.applyRemote(json);
    ports.markerStore.save({ fileId: remote.fileId, version: remote.version, fingerprint: pulled });
    return { action: "pull", reason: plan.reason, remote };
  }

  if (plan.action === "conflict" && remote) {
    /* One extra download so the chooser can say what each side holds. Best
       effort: a summary that fails to load leaves the chooser working with
       dates alone, not blocked. */
    let remoteSummary: LedgerSummary | null = null;
    try {
      remoteSummary = summarizeBackup(
        JSON.parse(await ports.client.download(remote.fileId)) as BackupPayload
      );
    } catch {
      remoteSummary = null;
    }
    return {
      action: "conflict",
      reason: plan.reason,
      remote,
      localSummary: summarizeBackup(payload),
      remoteSummary,
    };
  }

  if (plan.adopt && remote)
    ports.markerStore.save({ fileId: remote.fileId, version: remote.version, fingerprint });
  return { action: plan.action, reason: plan.reason, remote };
}
