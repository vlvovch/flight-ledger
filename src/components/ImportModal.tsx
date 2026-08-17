"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { Modal, ErrorNote } from "./ui";
import { api, fmtInt } from "@/lib/format";
import { ACTIVITY_TYPE_LABELS } from "@/lib/types";
import type {
  ImportPreview,
  ImportPreviewRow,
} from "@/lib/mileageplus-import";

type Stage = "pick" | "loading" | "review" | "applying" | "done";
type ConflictChoice = "csv" | "keep";
type SuggestChoice = "link" | "new";

function vals(r: { pqp: number | null; pqf: number | null; award: number | null }) {
  const parts: string[] = [];
  if (r.pqp != null) parts.push(`PQP ${fmtInt(r.pqp)}`);
  if (r.pqf != null) parts.push(`PQF ${r.pqf}`);
  if (r.award != null) parts.push(`${fmtInt(r.award)} mi`);
  return parts.length ? parts.join(" · ") : "no values";
}

export default function ImportModal({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ConflictChoice>>({});
  const [suggestions, setSuggestions] = useState<Record<number, SuggestChoice>>({});
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    recorded: number;
    duplicates: number;
    errors: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const f = preview?.flights ?? [];
    return {
      conflicts: f.filter((r) => r.action === "conflict"),
      suggested: f.filter((r) => r.action === "suggested"),
      creates: f.filter((r) => r.action === "create"),
      updates: f.filter((r) => r.action === "update"),
      unchanged: f.filter((r) => r.action === "unchanged"),
    };
  }, [preview]);

  const newActivity = useMemo(
    () => (preview?.activities ?? []).filter((a) => !a.duplicate),
    [preview]
  );
  const dupActivity = (preview?.activities.length ?? 0) - newActivity.length;

  const activityByType = useMemo(() => {
    const m = new Map<string, { count: number; pqp: number; award: number }>();
    for (const a of newActivity) {
      const cur = m.get(a.type) ?? { count: 0, pqp: 0, award: 0 };
      cur.count++;
      cur.pqp += a.pqp ?? 0;
      cur.award += a.award ?? 0;
      m.set(a.type, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [newActivity]);

  const unresolved =
    groups.conflicts.filter((r) => !decisions[r.key]).length +
    groups.suggested.filter((r) => !suggestions[r.key]).length;

  const ledgerChanges =
    groups.creates.length +
    groups.updates.length +
    groups.conflicts.filter((r) => decisions[r.key] === "csv").length +
    groups.suggested.length;

  const pickFile = async (file: File) => {
    setStage("loading");
    setError(null);
    try {
      const csv = await file.text();
      const p = await api<ImportPreview>("/api/import/mileageplus", {
        method: "POST",
        body: JSON.stringify({ mode: "preview", csv }),
      });
      setPreview(p);
      setDecisions({});
      setSuggestions({});
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file");
      setStage("pick");
    }
  };

  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && !/csv|text/i.test(file.type || "")) {
      setError(
        `“${file.name}” doesn't look like a CSV — on united.com choose the CSV download (not Excel), or re-save the file as .csv.`
      );
      return;
    }
    pickFile(file);
  };

  const apply = async () => {
    if (!preview) return;
    setStage("applying");
    setError(null);

    const rows = [
      ...groups.creates.map((r) => ({ ...r, action: "create" as const })),
      ...groups.updates.map((r) => ({ ...r, action: "update" as const })),
      // nothing to write, but the statement row still belongs to this flight
      ...groups.unchanged.map((r) => ({ ...r, action: "record_only" as const })),
      ...groups.conflicts.map((r) => ({
        ...r,
        action: decisions[r.key] === "csv" ? ("update" as const) : ("record_only" as const),
      })),
      ...groups.suggested.map((r) =>
        suggestions[r.key] === "link"
          ? { ...r, action: "update" as const }
          : { ...r, action: "create" as const, segmentId: undefined }
      ),
    ].map((r) => ({
      key: r.key,
      action: r.action,
      segmentId: r.segmentId,
      date: r.date,
      carrier: r.carrier,
      number: r.number,
      origin: r.origin,
      destination: r.destination,
      pqp: r.pqp,
      pqf: r.pqf,
      award: r.award,
      lifetime: r.lifetime,
      matchScore: r.matchScore,
      matchReasons: r.matchReasons,
    }));

    try {
      const res = await api<{
        created: number;
        updated: number;
        recorded: number;
        duplicates: number;
        errors: string[];
      }>("/api/import/mileageplus", {
        method: "POST",
        body: JSON.stringify({ mode: "apply", rows, activities: preview.activities }),
      });
      setResult(res);
      setStage("done");
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStage("review");
    }
  };

  const setAll = (v: ConflictChoice) =>
    setDecisions(Object.fromEntries(groups.conflicts.map((r) => [r.key, v])));

  return (
    <Modal
      title="Import MileagePlus activity"
      subtitle="united.com → MileagePlus → My activity → download CSV. Nothing is written until you apply."
      onClose={onClose}
      wide
    >
      <ErrorNote error={error} />

      {stage === "pick" && (
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center transition-all ${
            dragOver
              ? "border-s-miles bg-[var(--tint-accent)] shadow-[inset_0_0_32px_var(--tint-accent-strong)]"
              : "border-line2 bg-well hover:border-s-miles"
          }`}
          onClick={() => fileRef.current?.click()}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            takeFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="pointer-events-none flex flex-col items-center">
            <FileUp size={28} className={`mb-3 ${dragOver ? "text-s-miles" : "text-mute"}`} />
            <p className="text-[14px] text-ink2">
              {dragOver
                ? "Drop to import"
                : "Drop the United activity CSV here, or click to browse"}
            </p>
            <p className="mt-1 text-[12px] text-mute">
              Every row is recorded — card, shopping and hotel earning
              included. Flight rows also reconcile against your ledger.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              takeFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {(stage === "loading" || stage === "applying") && (
        <p className="t-label py-12 text-center">
          {stage === "loading" ? "Parsing & matching…" : "Applying…"}
        </p>
      )}

      {stage === "review" && preview && (
        <div className="space-y-4">
          {/* account activity summary */}
          {newActivity.length > 0 && (
            <section className="rounded-md border border-line bg-well px-3.5 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="t-label !text-[10.5px]">
                  Account activity to record ({newActivity.length})
                </h3>
                {dupActivity > 0 && (
                  <span className="text-[11px] text-mute">
                    {dupActivity} already recorded — will be skipped
                  </span>
                )}
                <button
                  className="ml-auto text-[11px] text-mute hover:text-ink2"
                  onClick={() => setShowActivity((v) => !v)}
                >
                  {showActivity ? "hide" : "show rows"}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {activityByType.map(([type, v]) => (
                  <span key={type} className="text-[11.5px] text-ink2">
                    {ACTIVITY_TYPE_LABELS[type as keyof typeof ACTIVITY_TYPE_LABELS] ?? type}
                    <span className="t-num ml-1.5 text-mute">
                      ×{v.count}
                      {v.pqp > 0 ? ` · ${fmtInt(v.pqp)} PQP` : ""}
                      {v.award > 0 ? ` · ${fmtInt(v.award)} mi` : ""}
                    </span>
                  </span>
                ))}
              </div>
              {showActivity && (
                <ul className="mt-2 max-h-40 overflow-y-auto border-t border-line pt-1.5">
                  {newActivity.map((a) => (
                    <li key={a.key} className="flex gap-2 py-0.5 text-[11.5px] text-mute">
                      <span className="t-num">{a.date}</span>
                      <span className="truncate text-ink2">{a.description}</span>
                      <span className="t-num ml-auto shrink-0">{vals(a)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* low-confidence matches */}
          {groups.suggested.length > 0 && (
            <section>
              <h3 className="t-label mb-2 !text-[10.5px] !text-[var(--color-warning)]">
                Possible matches — confirm ({groups.suggested.length})
              </h3>
              <ul className="space-y-2">
                {groups.suggested.map((r) => (
                  <li
                    key={r.key}
                    className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[var(--tint-warning)] px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="t-num text-[13px] text-ink">
                        {r.date} · {r.carrier}
                        {r.number} {r.origin}→{r.destination}
                      </span>
                      <span className="text-[11.5px] text-mute">
                        looks like {r.existing?.label}
                        {r.matchScore != null &&
                          ` · ${Math.round(r.matchScore * 100)}% confidence`}
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        <Choice
                          active={suggestions[r.key] === "link"}
                          onClick={() => setSuggestions((s) => ({ ...s, [r.key]: "link" }))}
                        >
                          Same flight
                        </Choice>
                        <Choice
                          active={suggestions[r.key] === "new"}
                          onClick={() => setSuggestions((s) => ({ ...s, [r.key]: "new" }))}
                        >
                          Add separately
                        </Choice>
                      </span>
                    </div>
                    {r.matchReasons && (
                      <p className="mt-1 text-[11px] text-mute">
                        {r.matchReasons.join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* conflicts */}
          {groups.conflicts.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="t-label !text-[10.5px] !text-[var(--color-warning)]">
                  Doesn’t match your entries — decide each ({groups.conflicts.length})
                </h3>
                <div className="flex gap-1.5">
                  <button className="btn btn-ghost !px-2.5 !py-1 !text-[10px]" onClick={() => setAll("csv")}>
                    Use United’s for all
                  </button>
                  <button className="btn btn-ghost !px-2.5 !py-1 !text-[10px]" onClick={() => setAll("keep")}>
                    Keep mine for all
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {groups.conflicts.map((r) => (
                  <ConflictRow
                    key={r.key}
                    row={r}
                    decision={decisions[r.key]}
                    onDecide={(v) => setDecisions((d) => ({ ...d, [r.key]: v }))}
                  />
                ))}
              </ul>
            </section>
          )}

          {groups.creates.length > 0 && (
            <ListSection
              label={`New flights to add (${groups.creates.length})`}
              rows={groups.creates}
              detail={(r) => vals(r)}
            />
          )}
          {groups.updates.length > 0 && (
            <ListSection
              label={`Existing flights to fill in (${groups.updates.length})`}
              rows={groups.updates}
              detail={(r) => r.fills.join(" · ")}
            />
          )}

          <div className="flex gap-4 text-[11.5px] text-mute">
            {groups.unchanged.length > 0 && (
              <button className="hover:text-ink2" onClick={() => setShowUnchanged((v) => !v)}>
                {showUnchanged ? "▾" : "▸"} {groups.unchanged.length} flights already up to date
              </button>
            )}
            {preview.skipped.length > 0 && (
              <button className="hover:text-ink2" onClick={() => setShowSkipped((v) => !v)}>
                {showSkipped ? "▾" : "▸"} {preview.skipped.length} skipped
              </button>
            )}
          </div>
          {showUnchanged && (
            <ul className="rounded-md border border-line bg-well px-3 py-2">
              {groups.unchanged.map((r) => (
                <li key={r.key} className="t-num py-0.5 text-[11.5px] text-mute">
                  {r.date} {r.carrier}{r.number} {r.origin}→{r.destination} — {vals(r)}
                </li>
              ))}
            </ul>
          )}
          {showSkipped && (
            <ul className="rounded-md border border-line bg-well px-3 py-2">
              {preview.skipped.map((s, i) => (
                <li key={i} className="py-0.5 text-[11.5px] text-mute">
                  <span className="t-num">{s.date ?? "—"}</span> {s.description}
                  <span className="ml-2 text-[10px] uppercase tracking-wider">({s.reason})</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
            {unresolved > 0 && (
              <span className="text-[12px] text-[var(--color-warning)]">
                {unresolved} row{unresolved === 1 ? "" : "s"} awaiting your decision
              </span>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={unresolved > 0 || (ledgerChanges === 0 && newActivity.length === 0)}
              onClick={apply}
            >
              <Upload size={13} />
              Apply
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="py-6 text-center">
          <p className="t-display text-[20px] text-ink">Import complete</p>
          <p className="mt-2 text-[13px] text-ink2">
            {result.recorded} activity row{result.recorded === 1 ? "" : "s"} recorded
            {result.created > 0 ? ` · ${result.created} flights added` : ""}
            {result.updated > 0 ? ` · ${result.updated} flights updated` : ""}
          </p>
          {result.duplicates > 0 && (
            <p className="mt-1 text-[12px] text-mute">
              {result.duplicates} row{result.duplicates === 1 ? "" : "s"} were already
              recorded and left alone
            </p>
          )}
          {result.errors.length > 0 && (
            <div className="mx-auto mt-3 max-w-md rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[var(--tint-warning)] px-3 py-2 text-left">
              {result.errors.map((e, i) => (
                <p key={i} className="text-[12px] text-[var(--ink-warning)]">
                  ⚠ {e}
                </p>
              ))}
            </div>
          )}
          <button className="btn btn-primary mt-5" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

function ConflictRow({
  row,
  decision,
  onDecide,
}: {
  row: ImportPreviewRow;
  decision: ConflictChoice | undefined;
  onDecide: (v: ConflictChoice) => void;
}) {
  return (
    <li className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[var(--tint-warning)] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="t-num text-[13px] text-ink">
          {row.date} · {row.carrier}
          {row.number} {row.origin}→{row.destination}
        </span>
        <span className="text-[11.5px] text-mute">{row.diffs.join(" · ")}</span>
        <div className="ml-auto flex gap-1.5">
          <Choice active={decision === "csv"} onClick={() => onDecide("csv")}>
            Use United’s
          </Choice>
          <Choice active={decision === "keep"} onClick={() => onDecide("keep")}>
            Keep mine
          </Choice>
        </div>
      </div>
      <div className="t-num mt-1.5 flex flex-wrap gap-x-6 text-[11.5px] text-mute">
        <span>Yours: {row.existing ? vals(row.existing) : "—"}</span>
        <span>United: {vals(row)}</span>
      </div>
    </li>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`t-display rounded-md border px-2.5 py-1 text-[10.5px] tracking-[0.08em] transition-colors ${
        active
          ? "border-s-miles bg-[var(--tint-accent-strong)] text-ink"
          : "border-line2 text-mute hover:text-ink2"
      }`}
    >
      {children}
    </button>
  );
}

function ListSection({
  label,
  rows,
  detail,
}: {
  label: string;
  rows: ImportPreviewRow[];
  detail: (r: ImportPreviewRow) => string;
}) {
  return (
    <section>
      <h3 className="t-label mb-1.5 !text-[10.5px]">{label}</h3>
      <ul className="max-h-48 overflow-y-auto rounded-md border border-line bg-well px-3 py-1.5">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex flex-wrap items-baseline gap-x-3 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-1.5 last:border-0"
          >
            <span className="t-num text-[12.5px] text-ink">
              {r.date} · {r.carrier}
              {r.number} {r.origin}→{r.destination}
            </span>
            <span className="text-[11.5px] text-mute">{detail(r)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
