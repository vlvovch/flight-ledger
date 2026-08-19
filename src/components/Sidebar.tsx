"use client";

import Link from "next/link";
import { agoLabel, apiFetch } from "@/lib/format";
import {
  ConflictChooser,
  SYNC_DONE,
  autoSyncEnabled,
  useDriveSync,
} from "@/components/DriveSync";
import { hasFreshDriveToken } from "@/lib/browser/drive";
import { toast } from "@/components/ui";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChartSpline,
  CircleHelp,
  Menu,
  Gauge,
  PlaneTakeoff,
  Ticket,
  ListChecks,
  Scale,
  Settings,
  Users,
  ChevronsUpDown,
  Check,
  Cloud,
  Plus,
  RefreshCw,
} from "lucide-react";

type Theme = "dark" | "united" | "light";
/** Each theme shows the colour it actually is, so the control is a preview
 *  rather than three words you have to try one at a time. */
const THEMES: { id: Theme; label: string; title: string; swatch: string }[] = [
  {
    id: "dark",
    label: "Deck",
    title: "The instrument-panel navy this app was drawn in",
    swatch: "linear-gradient(140deg, #16233c 0%, #0a1120 100%)",
  },
  {
    id: "united",
    label: "United",
    title: "United's blue, for when it should look like the airline",
    swatch: "linear-gradient(140deg, #2f6fd0 0%, #041a3d 100%)",
  },
  {
    id: "light",
    label: "Light",
    title: "Light surfaces, with a series palette revalidated for them",
    swatch: "linear-gradient(140deg, #f7f9fc 0%, #c4d1e2 100%)",
  },
];

const NAV = [
  { href: "/", label: "Dashboard", icon: Gauge },
  /* The two ledgers you actually edit sit together: a flight and the ticket
     that paid for it are one thought, and they were three rows apart. Then the
     two things you check against — the airline's own postings, and what
     doesn't reconcile. Then the occasional pages. */
  { href: "/flights", label: "Flights", icon: PlaneTakeoff },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  /* "Activity" named the page after its table; this is where MileagePlus
     itself lives — status, postings, the lot — and the page's own heading
     already read "MileagePlus activity". */
  { href: "/activity", label: "MileagePlus", icon: ListChecks },
  /* Analysis reads the pages above it and edits nothing — the month ledger,
     cash flow, travel mix, fare classes. It sits with the checking pages for
     that reason: you come here with a question, not a change. */
  { href: "/analysis", label: "Analysis", icon: ChartSpline },
  { href: "/reconcile", label: "Reconcile", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
  /* The FAQ is deliberately not an eighth row here. As one it made the
     sidebar taller than a laptop viewport and pushed the account picker out
     of reach; as a tiny footer link it was invisible. It lives as the (?)
     button beside the wordmark instead — always on screen, costs no height —
     plus the page footer's link. */
];

/** The mark, bare — the favicon's arc-over-rules without its navy tile,
 *  which on the sidebar's own navy would be an invisible box. Drawn in
 *  theme variables, so Deck, United and Light each ink it their own way. */
function Mark({ size }: { size: number }) {
  return (
    <svg
      width={Math.round(size * (21 / 17.5))}
      height={size}
      viewBox="5.5 6 21 17.5"
      aria-hidden="true"
      className="shrink-0"
    >
      <g
        stroke="var(--color-ink2)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.75"
      >
        <line x1="7" y1="13.5" x2="25" y2="13.5" />
        <line x1="7" y1="20.5" x2="25" y2="20.5" />
      </g>
      <path
        d="M 9.5 20.5 C 10.5 12.5 14 7.5 23.5 13.5"
        fill="none"
        stroke="var(--color-s-miles)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="20.5" r="1.8" fill="var(--color-s-miles)" />
      <circle cx="23.5" cy="13.5" r="1.8" fill="var(--color-s-miles)" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  /* The sidebar is on every page, so it fetches this once for itself rather
     than every page threading it down. A failure is silent: an unnamed deck
     is the normal state, not an error. */
  const [memberName, setMemberName] = useState("");
  const [reg, setReg] = useState<{
    active: string;
    accounts: { id: string; label: string; file: string }[];
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /* Kept in localStorage rather than the ledger: it is a property of this
     browser, not of the account, and it must be readable before React runs
     so the first paint is already the right colours. */
  /* "united" pre-mount to match the boot script's default — the effect then
     reads what that script actually decided, which is the source of truth */
  const [theme, setTheme] = useState<Theme>("united");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "united" || t === "light" ? t : "dark");
  }, []);
  const applyTheme = (t: Theme) => {
    setTheme(t);
    if (t === "dark") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("flightdeck-theme", t);
    } catch {
      /* private mode — the theme just won't persist */
    }
  };
  useEffect(() => {
    apiFetch("/api/accounts")
      .then((r) => r.json())
      /* shape-checked: when the engine can't start, this response is
         { error } — truthy, accountless — and setting it took down every
         page that rendered reg.accounts (found via the two-tab crash) */
      .then((r) => setReg(Array.isArray(r?.accounts) ? r : null))
      .catch(() => {});
  }, [pathname]);

  /* A full reload rather than a refetch. Switching swaps the database under
     every page at once, and every list, chart and total already on screen is
     now another account's — reloading is the only way to be certain none of
     it survives the switch. */
  /* Creating does not switch: it would move the ledger out from under
     whatever you were reading. A file left behind by a removed account is
     reattached on the second attempt rather than refused forever. */
  const addAccount = async () => {
    const label = newName.trim();
    if (!label || busy) return;
    setBusy(true);
    setNote(null);
    const post = (adopt: boolean) =>
      apiFetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, adopt }),
      }).then((r) => r.json());
    let res = await post(false).catch(() => null);
    if (res?.error && /already exists/.test(res.error)) {
      res = await post(true).catch(() => null);
      if (res?.account) setNote(`Reattached data/${res.account.file}`);
    }
    setBusy(false);
    if (res?.error && !res.account) {
      setNote(res.error);
      return;
    }
    setNewName("");
    setAdding(false);
    apiFetch("/api/accounts")
      .then((r) => r.json())
      .then((r) => setReg(Array.isArray(r?.accounts) ? r : null))
      .catch(() => {});
  };

  const removeAccount = async (id: string, file: string) => {
    if (busy) return;
    setBusy(true);
    await apiFetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {}
    );
    setBusy(false);
    setNote(`Removed from the list · data/${file} kept`);
    apiFetch("/api/accounts")
      .then((r) => r.json())
      .then((r) => setReg(Array.isArray(r?.accounts) ? r : null))
      .catch(() => {});
  };

  const switchTo = async (id: string) => {
    if (busy) return;
    setBusy(true);
    await apiFetch("/api/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: id }),
    }).catch(() => {});
    window.location.reload();
  };

  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then((r) => {
        const st = r?.settings ?? {};
        setMemberName(
          [st.member_first_name, st.member_last_name].filter(Boolean).join(" ")
        );
      })
      .catch(() => {});
  }, [pathname]);
  /* Mobile: the sidebar is a drawer. 212px of permanent chrome left a phone
     ~115px of content — the stat cards were overlapping slivers before this. */
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  /* The footer line is a second sync control — same hook, same machinery as
     the Settings panel; a pull swaps the database under every page, so the
     page reloads, exactly as an account switch does. The toast rides the
     reload: shown now it would die with this document. */
  const sync = useDriveSync(() => {
    toast("Restored from Google Drive — this ledger now matches it.", {
      afterReload: true,
    });
    window.location.reload();
  });
  const [chooser, setChooser] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const pressSync = async (resolve?: "push" | "pull") => {
    setChooser(false);
    const out = await sync.run(resolve);
    if (out?.action === "conflict") setChooser(true);
    else if (out) {
      setFlash(SYNC_DONE[out.action]);
      setTimeout(() => setFlash(null), 2500);
    }
  };

  /* Unsynced work: has the ledger changed since Drive last agreed? The
     change log's newest entry is the ledger's own answer, and the sidebar
     already wakes on every navigation. A pull can't outdate itself: its
     restore entry lands before the stamp is written. */
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!sync.last) {
      setDirty(false);
      return;
    }
    const at = sync.last.at;
    apiFetch("/api/changes?limit=1")
      .then((r) => r.json())
      .then((r: { changes?: { at: string }[] }) => {
        const newest = r?.changes?.[0];
        setDirty(!!newest && Date.parse(newest.at) > Date.parse(at));
      })
      .catch(() => {});
  }, [pathname, sync.last]);

  /* Auto mode presses the button when there is something to press it for —
     but only while the Google grant is still warm. Cold grant means a
     popup, and an unasked-for popup is worse than a quiet amber nudge. */
  useEffect(() => {
    if (!dirty || sync.busy || sync.error || sync.conflict) return;
    if (!autoSyncEnabled() || !hasFreshDriveToken()) return;
    void pressSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, sync.busy]);

  return (
    <>
      {/* mobile top bar — fixed so it spans the viewport, not the flex row */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-line bg-[color:var(--color-deck)] px-4 py-3 lg:hidden">
        <button
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-ink2 transition-colors hover:text-ink pointer-coarse:p-3"
        >
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Mark size={17} />
          <span className="t-display text-[17px] leading-none text-ink">
            Flight&nbsp;Ledger
          </span>
        </Link>
        {/* FAQ reachable without opening the drawer */}
        <Link
          href="/faq"
          title="FAQ"
          aria-label="FAQ"
          className="ml-auto rounded-md p-1.5 text-ink2 transition-colors hover:text-ink pointer-coarse:p-3"
        >
          <CircleHelp size={18} />
        </Link>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(4,8,16,0.6)] backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`${open ? "fixed flex" : "hidden"} inset-y-0 left-0 z-50 h-full w-[240px] flex-col overflow-y-auto border-r border-line bg-[color:var(--color-deck)] bg-[linear-gradient(180deg,var(--tint-accent-faint),transparent_180px)] lg:sticky lg:top-0 lg:flex lg:h-[var(--vh-scaled)] lg:w-[224px] lg:shrink-0 lg:overflow-y-visible`}
      >
      {/* wordmark, with the (?) beside it — the FAQ's home. As a nav row it
          made the sidebar outgrow a laptop viewport and pushed the account
          picker out of reach; as a footer label it was invisible. A round
          button at the top is always on screen and costs no height. */}
      <div className="relative border-b border-line px-5 py-5">
        <Link href="/" className="block">
          <div className="flex items-center gap-1">
            {/* The mark rides the title row only — folding it into a column
                with the tagline is the exact squeeze the comment below warns
                about (measured: the tagline has ~23px of slack, a mark
                column needs more). Sized to the wordmark's cap height, and
                to leave the floated (?) its clearance: the row has 28px of
                room before the title runs under the button. */}
            <Mark size={15} />
            <span className="t-display text-[21px] leading-none text-ink">
              Flight&nbsp;Ledger
            </span>
          </div>
          {/* full width, under the floated (?) — squeezing it into a flex
              column broke "Flights · Costs · Miles · Status" onto two lines */}
          <div className="t-label mt-1.5 !text-[9.5px] text-s-miles">
            Flights · Costs · Miles · Status
          </div>
        </Link>
        <Link
          href="/faq"
          title="FAQ"
          aria-label="FAQ"
          className={`absolute right-4 top-4 rounded-full border p-1.5 transition-colors ${
            pathname.startsWith("/faq")
              ? "border-s-miles text-s-miles"
              : "border-line text-mute hover:border-line2 hover:text-ink"
          }`}
        >
          <CircleHelp size={16} />
        </Link>
      </div>

      {/* min-h-0 + scroll on desktop: in a short window the nav gives, not
          the footer. Without it the storage block — the part that says which
          ledger is open — was the first thing a small laptop lost. */}
      <nav className="flex-1 px-3 py-4 lg:min-h-0 lg:overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`group mb-1 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors pointer-coarse:py-3 ${
                active
                  ? "bg-[var(--tint-accent)] text-ink shadow-[inset_2px_0_0_var(--color-s-miles)]"
                  : "text-ink2 hover:bg-[var(--tint-accent-weak)] hover:text-ink"
              }`}
            >
              <Icon
                size={16}
                strokeWidth={2}
                className={active ? "text-s-miles" : "text-mute group-hover:text-ink2"}
              />
              <span className="t-display text-[14px] tracking-[0.09em]">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-5 py-4">
        {/* A knob that travels to the theme you picked, rather than three
            buttons one of which is lit. The swatch under each stop is the
            theme's own colour, so the control shows what it does. */}
        <div className="mb-3">
          <div className="relative flex rounded-full border border-line bg-well p-1">
            {/* The knob travels to the chosen stop. Animating `left` rather
                than `transform` because the stops are expressed as thirds of
                the track, which `left` takes directly. */}
            <span
              aria-hidden
              className="absolute inset-y-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-[var(--tint-accent-strong)] ring-1 ring-[var(--color-line2)] transition-[left] duration-300 ease-out"
              style={{
                left: `calc(0.25rem + ${THEMES.findIndex((t) => t.id === theme)} * ((100% - 0.5rem) / 3))`,
              }}
            />
            {THEMES.map((t) => (
              <button
                key={t.id}
                title={t.title}
                aria-label={t.label}
                aria-pressed={theme === t.id}
                onClick={() => applyTheme(t.id)}
                className="relative z-10 flex flex-1 items-center justify-center py-1"
              >
                <span
                  className={`h-3.5 w-3.5 rounded-full border transition-colors ${
                    theme === t.id ? "border-[var(--color-ink2)]" : "border-[var(--color-line2)]"
                  }`}
                  style={{ background: t.swatch }}
                />
              </button>
            ))}
          </div>
          <div className="t-label mt-1 text-center !text-[8.5px]">
            {THEMES.find((t) => t.id === theme)?.label}
          </div>
        </div>
        {/* Always present, even on a single account. Hiding it until a second
            ledger exists meant the one place you'd look to switch was also the
            one place that never mentioned accounts — so there was no way to
            find out you could have more than one. */}
        {reg && (
          <div className="relative mb-3">
            <button
              className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-left transition-colors hover:border-line2"
              onClick={() => setPicking((v) => !v)}
              disabled={busy}
            >
              <Users size={13} className="shrink-0 text-mute" />
              <span className="truncate text-[12px] text-ink">
                {reg.accounts.find((a) => a.id === reg.active)?.label ?? "Account"}
              </span>
              <ChevronsUpDown size={12} className="ml-auto shrink-0 text-mute" />
            </button>
            {picking && (
              <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-md border border-line2 bg-panel shadow-[0_12px_28px_var(--shadow-pop)]">
                {reg.accounts.map((a) => (
                  <button
                    key={a.id}
                    className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-[var(--tint-accent-weak)] ${
                      a.id === reg.active ? "text-ink" : "text-ink2"
                    }`}
                    onClick={() => a.id !== reg.active && switchTo(a.id)}
                    disabled={busy}
                  >
                    <span className="truncate">{a.label}</span>
                    {a.id === reg.active ? (
                      <Check size={12} className="ml-auto shrink-0 text-s-miles" />
                    ) : (
                      reg.accounts.length > 1 && (
                        <span
                          role="button"
                          tabIndex={0}
                          title={`Remove from the list — data/${a.file} is kept`}
                          className="ml-auto shrink-0 px-1 text-[13px] leading-none text-mute transition-colors hover:text-[var(--color-critical)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAccount(a.id, a.file);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              removeAccount(a.id, a.file);
                            }
                          }}
                        >
                          ×
                        </span>
                      )
                    )}
                  </button>
                ))}
                {/* Adding, renaming and removing stay in Settings rather than
                    being built a second time here — this menu's job is to say
                    which ledger is open and let you change it. */}
                {adding ? (
                  <div className="border-t border-line p-2">
                    <input
                      autoFocus
                      className="field !w-full !py-1 text-[12px]"
                      placeholder="Name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addAccount();
                        if (e.key === "Escape") {
                          setAdding(false);
                          setNewName("");
                        }
                      }}
                    />
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        className="btn btn-ghost flex-1 !py-1 !text-[10px]"
                        disabled={!newName.trim() || busy}
                        onClick={() => addAccount()}
                      >
                        Create
                      </button>
                      <button
                        className="btn btn-ghost !py-1 !text-[10px]"
                        onClick={() => {
                          setAdding(false);
                          setNewName("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {note && <div className="mt-1.5 text-[10.5px] text-mute">{note}</div>}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setNote(null);
                      setAdding(true);
                    }}
                    className="flex w-full items-center gap-2 border-t border-line px-2.5 py-2 text-[12px] text-mute transition-colors hover:bg-[var(--tint-accent-weak)] hover:text-ink2"
                  >
                    <Plus size={12} className="shrink-0" />
                    New account
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Whose deck this is, when it's been said. Sits with the storage
            line because both answer "where am I", not "what am I doing". */}
        {memberName && (
          <div className="mb-2.5 truncate text-[12px] text-ink2" title={memberName}>
            {memberName}
          </div>
        )}
        {/* Just "Local" — "Private" was a bigger promise than a storage label
            should make, and opt-in Drive sync (Settings) can now put a copy
            elsewhere. Where the data lives is a fact; how private it is
            belongs to the FAQ. */}
        {/* One row, and it states the situation, not the inventory: "Local
            only" until a first sync exists, then when Drive last agreed —
            and pressing it syncs, right here, because the place that shows
            the staleness is the place you want to fix it. The file name —
            a detail, not a situation — lives in the hover and in Settings. */}
        {sync.connected && sync.last ? (
          <button
            onClick={() => void pressSync()}
            disabled={sync.busy}
            className={`group flex w-full items-center gap-1.5 text-left text-[11px] transition-colors ${
              sync.conflict || sync.error || dirty
                ? "text-[var(--color-warning)] hover:text-ink"
                : "text-mute hover:text-ink2"
            }`}
            title={`data/${reg?.accounts.find((a) => a.id === reg.active)?.file ?? "tracker.db"}. Click to sync now.`}
          >
            <span className="truncate">
              {sync.busy
                ? "Syncing…"
                : flash
                  ? flash
                  : sync.error
                    ? "Sync failed, click to retry"
                    : sync.conflict
                      ? "Sync needs attention"
                      : dirty
                        ? "Changes not backed up"
                        : /* the verb lost its seat to the timestamp: at this
                             width "Synced to Google Drive · just now" ends in
                             an ellipsis, and the glyph already says what
                             pressing does */
                          `Google Drive · ${agoLabel(sync.last.at)}`}
            </span>
            {/* the glyph is what says "this is a button" — the text alone
                read as a status label, and nobody presses a label */}
            <RefreshCw
              size={11}
              className={`ml-auto shrink-0 ${
                sync.busy
                  ? "animate-spin text-s-miles"
                  : "text-mute group-hover:text-ink2"
              }`}
            />
          </button>
        ) : (
          <Link
            href="/settings#drive-sync"
            className="group flex items-center gap-1.5 truncate text-[11px] transition-colors"
            title={`data/${reg?.accounts.find((a) => a.id === reg.active)?.file ?? "tracker.db"} lives on this machine only. Click to set up Google Drive sync.`}
          >
            <span className="truncate text-mute">
              Local only ·{" "}
              {/* the invitation wears the accent: "Local only" alone read as
                  a verdict, and nobody clicks a verdict */}
              <span className="text-s-miles group-hover:text-ink">
                set up Drive sync
              </span>
            </span>
            <Cloud size={11} className="ml-auto shrink-0 text-s-miles group-hover:text-ink" />
          </Link>
        )}
      </div>
      {chooser && sync.conflict && (
        <ConflictChooser
          conflict={sync.conflict}
          onResolve={(choice) => void pressSync(choice)}
          onClose={() => setChooser(false)}
        />
      )}
    </aside>
    </>
  );
}
