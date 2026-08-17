/** Client-safe formatting helpers. */

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney(
  n: number | null | undefined,
  currency = "USD",
  opts: { cents?: boolean } = {}
): string {
  if (n == null) return "—";
  const cents = opts.cents ?? true;
  try {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Cents-per-mile: "3.42¢" */
export function fmtCpm(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}¢`;
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08" → "Aug 26" */
export function fmtMonth(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return style === "short"
    ? `${MONTHS[m - 1]} ’${String(y).slice(2)}`
    : `${MONTHS[m - 1]} ${y}`;
}

/** "2026-08-01" → "Aug 1, 2026" */
export function fmtDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const STATUS_LABELS: Record<string, string> = {
  ticketed: "Ticketed",
  flown_unreconciled: "Flown",
  flown_reconciled: "Reconciled",
  canceled: "Canceled",
  missed: "Missed",
};

/* Only two of these behave differently — a refund reduces gross AND personal
   cost, everything else reduces personal only — so only two are offered.
   The rest stay here so any row already carrying one still renders. */
export const ADJUSTMENT_LABELS: Record<string, string> = {
  reimbursement: "Reimbursement",
  refund: "Refund",
  statement_credit: "Statement credit",
  employer_payment: "Employer payment",
  correction: "Correction",
  extra: "Extra purchase",
};
export const ADJUSTMENT_CHOICES = ["reimbursement", "refund", "extra"] as const;

export const METHOD_LABELS: Record<string, string> = {
  manual: "Manual",
  pqp: "PQP-weighted",
  distance: "Distance-weighted",
  equal: "Equal split",
  none: "Unallocated",
};

/* The one place the UI touches a transport. The server app fetches over
   HTTP; the browser build (mode 1) swaps in dispatch.ts via setApiTransport
   and no server exists — all 51 call sites stay exactly as written. */
type ApiTransport = (url: string, init?: RequestInit) => Promise<Response>;
let transport: ApiTransport = (url, init) => fetch(url, init);

export function setApiTransport(t: ApiTransport): void {
  transport = t;
}

/** The raw transport, for the rare caller that wants the Response itself —
   Sidebar reads error bodies without throwing. Same switch as api(). */
export const apiFetch = (url: string, init?: RequestInit): Promise<Response> =>
  transport(url, init);

/** Download through whatever transport api() uses. Over HTTP a plain link
   would do; on the browser engine there is no server for an href to reach,
   so the bytes come through the same transport and leave as a blob. */
export async function apiDownload(url: string): Promise<void> {
  const res = await transport(url, {});
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(dispo)?.[1] ?? "download";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await transport(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (body as { error?: string }).error ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}

/**
 * How long a booking's travel spans, said in a unit a reader can hold.
 *
 * Days are the right unit for a trip — "+13d" is a fortnight away and you
 * feel it. They stop being a unit somewhere past a couple of months: an
 * exchange chain that carried its value into a later year reads "+829d",
 * which is arithmetic, not information. Past sixty days the label switches
 * to months, and past two years to years and months.
 */
/** "3h ago" in one unit — spanLabel's sibling, looking backwards. Past
 *  sixty days a count of days is arithmetic, not information; the date says
 *  it better (and a sync that old is the news anyway). */
export function agoLabel(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 60) return `${days}d ago`;
  return `on ${iso.slice(0, 10)}`;
}

export function spanLabel(days: number): string {
  if (days <= 60) return `+${days}d`;
  /* The threshold is counted in DAYS, not in months already rounded: 716
     days rounds to 24 months, and calling a span a fortnight short of two
     years "+2y" claims a year the booking never reached. Under two years
     the figure is also held at 23, so the label never reads "+24mo". */
  const months = Math.round(days / 30.44);
  if (days < 730) return `+${Math.min(months, 23)}mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `+${years}y` : `+${years}y ${rest}mo`;
}
