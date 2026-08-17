"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Upload } from "lucide-react";
import type { Settings } from "@/lib/types";
import { DEFAULT_PREMIER_PROGRAMS } from "@/lib/premier";
import {
  apiDownload, api } from "@/lib/format";
import { Confirm, ErrorNote, Field, Panel, toast } from "@/components/ui";
import { DriveSyncPanel } from "@/components/DriveSync";
import { C } from "@/components/charts";
import { markColor } from "@/components/premier-ui";

interface TaxRatesView {
  domestic: number;
  international: number;
  domesticSample: number;
  internationalSample: number;
  source: string;
}

interface ChangeEntry {
  id: string;
  at: string;
  actor: string;
  op: string;
  tbl: string;
  row_id: string;
  diff: string;
}

/* The log speaks the user's words, not the schema's. "manual" is the code's
   name for "you", and a table name is nobody's name for anything. */
const CHANGE_ACTORS: Record<string, string> = {
  manual: "you",
  "import:receipt": "receipt import",
  "import:mileageplus": "CSV import",
  "import:bts": "aircraft import",
  restore: "backup restore",
};
const CHANGE_TABLES: Record<string, string> = {
  segments: "flight",
  tickets: "ticket",
  adjustments: "adjustment",
  payments: "payment",
  mileageplus_activities: "activity",
  settings: "settings",
};
const CHANGE_OPS: Record<string, string> = {
  create: "added",
  update: "changed",
  delete: "removed",
  wipe: "erased the ledger",
  restore: "restored a backup",
};

interface DatasetMeta {
  source: string;
  url: string;
  fetchedAt: string;
  count: number;
}

/** The tables that can leave as CSV. The JSON backup is deliberately not
 *  here: it is the only export that can be restored, so it keeps its own
 *  button rather than hiding as one option among six. */
const CSV_EXPORTS = [
  ["flights", "Flights"],
  ["tickets", "Tickets"],
  ["activity", "MileagePlus activity"],
  ["adjustments", "Reimbursements & adjustments"],
  ["monthly", "Monthly summary"],
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  /* These are United's numbers, not the user's. They are editable only
     because United raised them ~25% for 2025 and will again, and an old
     qualification year has to keep the bars it was actually judged against
     — so the escape hatch stays, folded away, until it is needed. */
  const [showPremier, setShowPremier] = useState(false);
  const [changes, setChanges] = useState<ChangeEntry[] | null>(null);
  useEffect(() => {
    api<{ changes: ChangeEntry[] }>("/api/changes?limit=15")
      .then((r) => setChanges(r.changes))
      .catch(() => {});
  }, []);
  const [csvExport, setCsvExport] = useState<string>("flights");
  const [accounts, setAccounts] = useState<{
    active: string;
    accounts: { id: string; label: string; file: string }[];
  } | null>(null);
  const [dataset, setDataset] = useState<DatasetMeta | null>(null);
  const [taxRates, setTaxRates] = useState<TaxRatesView | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api<{
      settings: Settings;
      airportDataset: DatasetMeta;
      taxRates: TaxRatesView;
    }>("/api/settings").then((r) => {
      setSettings(r.settings);
      setDataset(r.airportDataset);
      setTaxRates(r.taxRates);
    });
  }, []);
  useEffect(refresh, [refresh]);

  const loadAccounts = useCallback(() => {
    api<{ active: string; accounts: { id: string; label: string; file: string }[] }>(
      "/api/accounts"
    )
      .then(setAccounts)
      .catch(() => {});
  }, []);
  useEffect(loadAccounts, [loadAccounts]);

  /* The sidebar's "set up Drive sync" link arrives with #drive-sync, but
     the panels render only after the settings fetch, so the browser's own
     anchor scroll fires into a page that doesn't have the target yet.
     Scroll once it exists, and only once: a page that re-scrolls itself
     after every save has opinions about where you should be looking. */
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !settings) return;
    if (window.location.hash !== "#drive-sync") return;
    jumped.current = true;
    /* An instant jump, not smooth: the browser's own load-time scroll
       handling cancels a smooth animation started this early (observed:
       scrollY stayed 0), and there is nothing to animate away from on a
       page the reader hasn't seen yet. */
    document.getElementById("drive-sync")?.scrollIntoView();
  }, [settings]);

  const save = async () => {
    if (!settings) return;
    setError(null);
    setSaved(false);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const restore = async (file: File) => {
    setError(null);
    setRestoreMsg(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const r = await api<{ restored: Record<string, number> }>("/api/backup", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const summary = `Restored ${r.restored.segments} flights, ${r.restored.tickets} tickets, ${r.restored.adjustments} adjustments.`;
      setRestoreMsg(summary);
      toast(summary);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  };

  const wipe = async () => {
    setConfirmWipe(false);
    setError(null);
    try {
      await api("/api/backup?confirm=wipe", { method: "DELETE" });
      setRestoreMsg("All flight and ticket data erased.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wipe failed");
    }
  };

  if (!settings) return <div className="t-label p-8">Loading…</div>;

  const setNum =
    (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setSettings({
        ...settings,
        [k]: e.target.value === "" ? 0 : Number(e.target.value),
      });

  return (
    <div className="mx-auto max-w-[820px]">
      <header className="reveal mb-5">
        <div className="t-label mb-1 text-s-miles">
          Configuration & data control
        </div>
        <h1 className="t-display text-[30px] leading-none text-ink">
          Settings
        </h1>
      </header>

      <ErrorNote error={error} />
      {restoreMsg && (
        <div className="mb-3 rounded-md border border-[color-mix(in_oklab,var(--color-good)_45%,transparent)] bg-[var(--tint-good)] px-3 py-2 text-[12.5px] text-[var(--ink-good)]">
          {restoreMsg}
        </div>
      )}

      <div className="stagger space-y-3">
        {/* Optional. Nothing here changes a number; it only lets the app say
            whose ledger this is, and stays out of the way when left blank
            rather than showing empty labels. */}
        <Panel label="Account" accent={C.miles}>
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="First name" hint="Optional">
                <input
                  className="field"
                  value={settings.member_first_name ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, member_first_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Last name" hint="Optional">
                <input
                  className="field"
                  value={settings.member_last_name ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, member_last_name: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel label="Accounting" accent={C.gross}>
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
              <Field
                label="Reporting currency"
                hint="All CPM and totals shown in this currency"
              >
                <input
                  className="field t-num uppercase"
                  maxLength={3}
                  value={settings.reporting_currency}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reporting_currency: e.target.value.toUpperCase(),
                    })
                  }
                />
              </Field>
              {/* One rate, two directions: miles SPENT on an award ticket are
                added to that flight's cost, miles EARNED by flying are
                subtracted from the dashboard's effective CPM. The hint used to
                name only the second, which is the less visible of the two. */}
              <Field
                label="Award valuation ¢/mi"
                hint="What a mile is worth: priced into award flights, credited back on the dashboard"
              >
                <input
                  className="field t-num"
                  inputMode="decimal"
                  value={settings.award_valuation_cpm}
                  onChange={setNum("award_valuation_cpm")}
                />
              </Field>
              <Field
                label="Posting delay (days)"
                hint="Flag flown flights with no posting after this"
              >
                <input
                  className="field t-num"
                  inputMode="numeric"
                  value={settings.missing_posting_delay_days}
                  onChange={setNum("missing_posting_delay_days")}
                />
              </Field>
              <Field
                label="Tracking costs since"
                hint="Older flights won’t be flagged for missing cost"
              >
                <input
                  type="date"
                  className="field t-num"
                  value={settings.cost_tracking_start ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      cost_tracking_start: e.target.value || null,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel label="Cost estimation" accent={C.gross}>
          <div className="px-4 pb-4">
            <label className="mb-3 flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--color-s-miles)]"
                checked={settings.estimate_cost_from_pqp}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    estimate_cost_from_pqp: e.target.checked,
                  })
                }
              />
              <span className="text-[13px] text-ink2">
                Estimate cost from PQP for flights with no ticket
                <span className="mt-0.5 block text-[11.5px] text-mute">
                  One PQP ≈ one dollar of base fare. Estimates show as ≈ and
                  keep their own CPM, never mixed with recorded costs. Award
                  travel excluded.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
              <Field
                label="Domestic tax %"
                hint={
                  taxRates
                    ? `Blank = ${(taxRates.domestic * 100).toFixed(1)}% from your own tickets (${taxRates.domesticSample})`
                    : undefined
                }
              >
                <input
                  className="field t-num"
                  inputMode="decimal"
                  placeholder={
                    taxRates ? (taxRates.domestic * 100).toFixed(1) : ""
                  }
                  value={
                    settings.tax_rate_domestic != null
                      ? String(
                          Math.round(settings.tax_rate_domestic * 1000) / 10,
                        )
                      : ""
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      tax_rate_domestic:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value) / 100,
                    })
                  }
                />
              </Field>
              <Field
                label="International tax %"
                hint={
                  taxRates
                    ? `Blank = ${(taxRates.international * 100).toFixed(1)}% from your own tickets (${taxRates.internationalSample})`
                    : undefined
                }
              >
                <input
                  className="field t-num"
                  inputMode="decimal"
                  placeholder={
                    taxRates ? (taxRates.international * 100).toFixed(1) : ""
                  }
                  value={
                    settings.tax_rate_international != null
                      ? String(
                          Math.round(settings.tax_rate_international * 1000) /
                            10,
                        )
                      : ""
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      tax_rate_international:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value) / 100,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel label="Premier thresholds" accent={C.pqp}>
          {/* Collapsed, the section is one line — the full bottom padding then
              reads as room for entries that aren't there. */}
          <div className={`px-4 ${showPremier ? "pb-4" : "pb-2.5"}`}>
            {/* One full-width row with the chevron on the trailing edge. A
              leading chevron on a short line reads as the first bullet of a
              list — as though more entries were folded away below it — when in
              fact this is the whole section. */}
            <button
              className="group flex w-full items-center gap-2 rounded text-left text-[12px] text-ink2 transition-colors hover:text-ink"
              onClick={() => setShowPremier((v) => !v)}
            >
              <span>
                {settings.premier_programs == null ? (
                  <>
                    United&apos;s published requirements —{" "}
                    <span className="text-mute">
                      {DEFAULT_PREMIER_PROGRAMS.length} sets of rules, the
                      newest applying to{" "}
                      {
                        DEFAULT_PREMIER_PROGRAMS[
                          DEFAULT_PREMIER_PROGRAMS.length - 1
                        ].from
                      }{" "}
                      flying onward.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[var(--color-warning)]">Edited</span> — these no
                    longer match United&apos;s published requirements.
                  </>
                )}
              </span>
              <span className="ml-auto shrink-0 text-mute transition-colors group-hover:text-ink2">
                {showPremier ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
              </span>
            </button>
            {showPremier && (
              <p className="mb-3 mt-2.5 text-[12px] text-ink2">
                What each tier takes. Either route qualifies: PQP with a
                minimum number of Premier qualifying flights, or the higher
                PQP total alone (paid United segments still apply). One row
                per rule set. Change these only when United does.
              </p>
            )}
            {showPremier && (
              <div className="mt-3 overflow-x-auto">
                {(() => {
                  const base =
                    settings.premier_programs ?? DEFAULT_PREMIER_PROGRAMS;
                  const edit = (next: typeof DEFAULT_PREMIER_PROGRAMS) =>
                    setSettings({ ...settings, premier_programs: next });
                  /* Tier names come from the first rule set. United has kept the
                   same four tiers in the same order since PQP/PQF began; if a
                   fifth ever appears the header follows whatever row 1 has. */
                  const tierNames = base[0]?.tiers.map((t) => t.name) ?? [];
                  /* Sized so all fourteen columns fit the page's column without a
                   horizontal scroll: five digits is the widest value United
                   has ever published here. */
                  const cell =
                    "field t-num !w-[46px] !py-1 !px-[2px] text-center";
                  return (
                    <table className="w-full min-w-[700px] border-collapse text-[12.5px]">
                      <thead>
                        <tr>
                          <th
                            className="t-label !text-[9px] pb-1 pr-2 text-center"
                            rowSpan={2}
                          >
                            From year
                          </th>
                          <th
                            className="t-label !text-[9px] pb-1 pr-3 text-center"
                            rowSpan={2}
                          >
                            Min UA seg
                          </th>
                          {/* Twelve identical boxes in a row give the eye no
                            way to tell where one tier ends and the next
                            begins. Each group gets a rule down its left edge
                            and its own metal on the heading — the same colours
                            the tier marks use everywhere else. */}
                          {tierNames.map((n, gi) => (
                            <th
                              key={n}
                              colSpan={3}
                              className={`t-label !text-[9px] pb-1 text-center ${
                                gi > 0 ? "border-l border-l-line2" : ""
                              } ${gi % 2 === 1 ? "bg-[var(--band)]" : ""}`}
                              /* The metal both names the tier and draws the band
                               that ties its three columns together. Silver and
                               Platinum are near-neighbours as metals, so the
                               colour is a reinforcement here, never the only
                               cue — the heading text and the rules carry it. */
                              style={{
                                color: markColor(n),
                                borderBottom: `2px solid ${markColor(n)}`,
                              }}
                            >
                              {n.replace(/^Premier /, "")}
                            </th>
                          ))}
                          <th rowSpan={2} />
                        </tr>
                        <tr className="border-b border-line">
                          {tierNames.map((n, gi) => (
                            <Fragment key={n}>
                              {(["PQP", "+ fl", "PQP only"] as const).map(
                                (h, ci) => (
                                  <th
                                    key={h}
                                    className={`t-label !text-[9px] px-[2px] pb-1.5 pt-1 text-center font-normal text-mute ${
                                      gi > 0 && ci === 0
                                        ? "border-l border-l-line2"
                                        : ""
                                    } ${gi % 2 === 1 ? "bg-[var(--band)]" : ""}`}
                                  >
                                    {h}
                                  </th>
                                ),
                              )}
                            </Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {base.map((prog, pi) => (
                          <tr
                            key={pi}
                            className="border-b border-line last:border-b-0"
                          >
                            <td className="py-1.5 pr-3">
                              <input
                                className="field t-num !w-[62px] !py-1 !px-1 text-center"
                                inputMode="numeric"
                                value={prog.from === 0 ? "" : String(prog.from)}
                                placeholder="earliest"
                                onChange={(e) =>
                                  edit(
                                    base.map((x, j) =>
                                      j === pi
                                        ? {
                                            ...x,
                                            from: Number(e.target.value) || 0,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            <td className="py-1.5 pr-4">
                              <input
                                className="field t-num !w-[46px] !py-1 !px-1 text-center"
                                inputMode="numeric"
                                value={String(prog.minFlights)}
                                onChange={(e) =>
                                  edit(
                                    base.map((x, j) =>
                                      j === pi
                                        ? {
                                            ...x,
                                            minFlights:
                                              Number(e.target.value) || 0,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            {prog.tiers.map((t, ti) =>
                              (["pqp", "pqf", "pqpOnly"] as const).map((k) => (
                                <td
                                  key={`${ti}-${k}`}
                                  className={`px-[2px] py-1.5 ${
                                    ti > 0 && k === "pqp"
                                      ? "border-l border-l-line2 !pl-1.5"
                                      : ""
                                  } ${ti % 2 === 1 ? "bg-[var(--band)]" : ""}`}
                                >
                                  <input
                                    className={cell}
                                    inputMode="numeric"
                                    value={String(t[k])}
                                    onChange={(e) =>
                                      edit(
                                        base.map((x, j) =>
                                          j === pi
                                            ? {
                                                ...x,
                                                tiers: x.tiers.map((row, ri) =>
                                                  ri === ti
                                                    ? {
                                                        ...row,
                                                        [k]:
                                                          Number(
                                                            e.target.value,
                                                          ) || 0,
                                                      }
                                                    : row,
                                                ),
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                </td>
                              )),
                            )}
                            <td className="pl-2">
                              {base.length > 1 && (
                                <button
                                  className="px-1 text-[13px] leading-none text-mute transition-colors hover:text-[var(--color-critical)]"
                                  title="Remove this rule set"
                                  onClick={() =>
                                    edit(base.filter((_, j) => j !== pi))
                                  }
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
            {showPremier && (
              <button
                className="btn btn-ghost mt-2.5 !py-1.5"
                onClick={() => {
                  const base =
                    settings.premier_programs ?? DEFAULT_PREMIER_PROGRAMS;
                  /* A new set starts as a copy of the one currently in force —
                   United revises the numbers, it does not start from nothing. */
                  const last = base[base.length - 1];
                  setSettings({
                    ...settings,
                    premier_programs: [
                      ...base,
                      {
                        ...last,
                        from: last.from + 1,
                        tiers: last.tiers.map((t) => ({ ...t })),
                      },
                    ],
                  });
                }}
              >
                Add rule set
              </button>
            )}
            {showPremier && settings.premier_programs != null && (
              <button
                className="btn btn-ghost mt-1 !py-1.5"
                onClick={() =>
                  setSettings({ ...settings, premier_programs: null })
                }
              >
                Reset to United&apos;s published values
              </button>
            )}
          </div>
        </Panel>

        <Panel label="Lifetime miles baseline" accent={C.miles}>
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
              <Field
                label="Baseline miles"
                hint="Your lifetime-mile balance before the first flight tracked here"
              >
                <input
                  className="field t-num"
                  inputMode="numeric"
                  value={settings.lifetime_baseline_miles}
                  onChange={setNum("lifetime_baseline_miles")}
                />
              </Field>
              <Field label="As of date">
                <input
                  type="date"
                  className="field t-num"
                  value={settings.lifetime_baseline_date ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      lifetime_baseline_date: e.target.value || null,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>

        <div className="flex justify-end gap-2">
          {saved && (
            <span className="self-center text-[12px] text-[var(--ink-good)]">
              Saved ✓
            </span>
          )}
          <button className="btn btn-primary" onClick={save}>
            Save settings
          </button>
        </div>

        <Panel label="Export" accent={C.award}>
          <div className="px-4 pb-4">
            <p className="mb-3 text-[12.5px] text-mute">
              Exports cover the ledger that is open —{" "}
              <span className="t-num">
                data/
                {accounts?.accounts.find((a) => a.id === accounts.active)?.file ??
                  "tracker.db"}
              </span>
              . Only the JSON backup can be restored; the CSVs are for taking
              one table elsewhere. Both are plain text.
            </p>
            {/* Only one of these is qualitatively different: the JSON backup
                is the one that can be restored. The rest are all the same act
                — take a table somewhere else — so they are one control with a
                choice, not five buttons competing with the one that matters.
                A seventh table later costs a line in the list, not a row of
                wrapped buttons. */}
            <div className="mb-2">
              <button
                className="btn btn-ghost"
                onClick={() => void apiDownload("/api/export?what=backup")}
              >
                <Download size={13} /> Full backup (JSON)
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="field !w-auto !py-1.5 text-[12.5px]"
                value={csvExport}
                onChange={(e) => setCsvExport(e.target.value)}
              >
                {CSV_EXPORTS.map(([what, label]) => (
                  <option key={what} value={what}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                onClick={() => void apiDownload(`/api/export?what=${csvExport}`)}
              >
                <Download size={13} /> Download CSV
              </button>
            </div>
          </div>
        </Panel>

        {/* Below Export deliberately: sync is the automated walk through the
            same exit door, and the manual door should be learned first. The
            anchor is the sidebar's landing spot; scroll-mt clears the fixed
            mobile top bar. */}
        <div id="drive-sync" className="scroll-mt-16">
          <DriveSyncPanel
            onPulled={() => {
              /* the panel refreshes in place rather than reloading, so its
                 pull toast can show immediately */
              toast("Restored from Google Drive — this ledger now matches it.");
              refresh();
            }}
          />
        </div>

        <Panel label="Recent changes" accent={C.miles}>
          <div className="px-4 pb-4">
            <p className="mb-2 text-[12.5px] text-mute">
              Every edit to this ledger, newest first.
            </p>
            {!changes || changes.length === 0 ? (
              <p className="text-[12.5px] text-mute">
                Nothing recorded yet — the log starts with the next change.
              </p>
            ) : (
              <ul>
                {changes.map((c) => {
                  let parsed: {
                    label?: string;
                    fields?: Record<string, [unknown, unknown]>;
                    row?: Record<string, unknown>;
                    counts?: Record<string, number>;
                    restored?: Record<string, number>;
                  } = {};
                  try {
                    parsed = JSON.parse(c.diff);
                  } catch {
                    /* an unreadable diff still gets its line */
                  }
                  const v = (x: unknown) =>
                    x == null || x === "" ? "—" : String(x).slice(0, 18);
                  const fieldBits = Object.entries(parsed.fields ?? {});
                  const detail =
                    c.op === "update"
                      ? fieldBits
                          .slice(0, 3)
                          /* column names are the schema's spelling; the log
                             is read by the person, so at least unsnake them */
                          .map(([k, [a, b]]) => `${k.replace(/_/g, " ")}: ${v(a)} → ${v(b)}`)
                          .join(" · ") +
                        (fieldBits.length > 3 ? ` +${fieldBits.length - 3} more` : "")
                      : c.op === "wipe" || c.op === "restore"
                        ? Object.entries(
                            (c.op === "wipe" ? parsed.counts : parsed.restored) ?? {}
                          )
                            .filter(([, n]) => n > 0)
                            .map(([t, n]) => {
                              const one = CHANGE_TABLES[t] ?? t;
                              const many = one.endsWith("y") ? `${one.slice(0, -1)}ies` : `${one}s`;
                              return `${n} ${n === 1 ? one : many}`;
                            })
                            .join(", ") || "an empty ledger"
                        : "";
                  return (
                    <li
                      key={c.id}
                      className="border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-1.5 text-[12px] last:border-0"
                    >
                      <span className="t-num text-mute">
                        {c.at.slice(0, 16).replace("T", " ")}
                      </span>{" "}
                      <span className="text-ink2">
                        {CHANGE_ACTORS[c.actor] ?? c.actor}{" "}
                        {CHANGE_OPS[c.op] ?? c.op}
                        {c.tbl && c.tbl !== "settings"
                          ? ` a ${CHANGE_TABLES[c.tbl] ?? c.tbl}`
                          : c.tbl === "settings"
                            ? " settings"
                            : ""}
                      </span>
                      {parsed.label && c.tbl !== "settings" && (
                        <span className="t-num text-ink"> {parsed.label}</span>
                      )}
                      {detail && <span className="text-mute"> · {detail}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>

        <Panel label="Restore & danger zone" accent="var(--color-critical)">
          <div className="px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) restore(file);
                  e.target.value = "";
                }}
              />
              <button
                className="btn btn-ghost"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={13} /> Restore JSON backup
              </button>
              <button
                className="btn btn-danger ml-auto"
                onClick={() => setConfirmWipe(true)}
              >
                Erase all data
              </button>
            </div>
            <p className="mt-2 text-[11px] text-mute">
              Restore replaces everything with the backup’s contents. Erase
              keeps settings but removes every flight, ticket and adjustment.
            </p>
          </div>
        </Panel>

        {/* Provenance is worth showing — it says how much to trust a distance.
            The build command that used to sit here was a note to whoever
            maintains the app, not to whoever reads it, and it lived in the
            README already. The description of the maths was also simply out of
            date: haversine is the fallback, not the method. */}
        {dataset && (
          <p className="px-1 pb-6 text-[11px] text-mute">
            Airport dataset: {dataset.source} · {dataset.count.toLocaleString()}{" "}
            airports · fetched {dataset.fetchedAt}. Distances use United&rsquo;s
            published figure where there is one, otherwise a WGS84 geodesic.
            Posted lifetime miles always win.
          </p>
        )}
      </div>

      {confirmWipe && (
        <Confirm
          message="Erase every flight, ticket and adjustment?"
          detail="Settings are kept. Consider downloading a JSON backup first."
          confirmLabel="Erase everything"
          onConfirm={wipe}
          onCancel={() => setConfirmWipe(false)}
        />
      )}
    </div>
  );
}
