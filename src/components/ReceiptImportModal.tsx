"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, MailOpen, Upload } from "lucide-react";
import { ErrorNote, Modal, StatusChip } from "./ui";
import { api, fmtDate, fmtMoney } from "@/lib/format";
import { buildApplyItem } from "@/lib/receipt-import";
import { MAX_BATCH_MESSAGES, splitMbox } from "@/lib/mbox";
import type { ConflictDecision, ReceiptPreview } from "@/lib/receipt-import";

type Stage = "pick" | "loading" | "review" | "applying" | "done";
type FileResult = { name: string; error?: string; preview?: ReceiptPreview };
type Decision = "receipt" | "keep";

const ACTION_STYLE: Record<string, { color: string; label: string }> = {
  create: { color: "var(--color-s-miles)", label: "NEW" },
  pin: { color: "var(--color-good)", label: "PIN IT" },
  update: { color: "var(--color-good)", label: "FILL IN" },
  unchanged: { color: "var(--color-mute)", label: "UP TO DATE" },
  conflict: { color: "var(--color-warning)", label: "DECIDE" },
};

/** What to call each document format in the card header. */
const KIND_LABEL: Record<string, string> = {
  eticket_receipt: "eTicket receipt",
  booking_confirmation: "Booking confirmation",
  cancellation: "Cancellation",
  change_notice: "Change notice",
  ancillary_receipt: "United purchase",
  ancillary_refund: "United refund",
  aa_receipt: "American receipt",
  delta_receipt: "Delta receipt",
  alaska: "Alaska receipt",
  lufthansa: "Lufthansa receipt",
  azul: "Azul receipt",
  latam: "LATAM receipt",
  sas: "SAS booking",
  wizz: "Wizz Air itinerary",
  southwest: "Southwest itinerary",
  kiwi: "Kiwi.com confirmation",
  capital_one: "Capital One Travel",
  amex_travel: "Amex Travel",
  chase_travel: "Chase Travel",
  adtrav: "ADTRAV itinerary",
  ctp: "CTP itinerary",
  cwt: "CWT itinerary",
  schema_markup: "Airline flight markup",
};

/**
 * Collapse a segment's fill list into something scannable: structural changes
 * and projections stay verbatim, routine metadata collapses to a count with
 * the detail on hover.
 */
function summarizeFills(fills: string[]): { text: string; title?: string } {
  const structural = fills.filter((f) => /attach/i.test(f));
  const projections = fills.filter((f) => /^projected/i.test(f));
  const details = fills.filter(
    (f) => !structural.includes(f) && !projections.includes(f)
  );
  const parts = [...structural];
  if (details.length > 0) {
    parts.push(
      details.length <= 2
        ? details.join(" · ")
        : `fills ${details.length} details`
    );
  }
  parts.push(...projections);
  return {
    text: parts.join(" · "),
    title: details.length > 2 ? details.join(" · ") : undefined,
  };
}

/**
 * A result the user must LOOK at: anything that writes, asks a question, or
 * needs a prerequisite (an orphaned extra). Everything else — replays reading
 * as up to date, the newsletters a Takeout label drags in — is noise at mbox
 * scale, counted in the digest and collapsed behind a toggle.
 */
function isActionable(r: FileResult): boolean {
  const p = r.preview;
  if (!p) return false;
  return (
    p.ticket.action !== "unchanged" ||
    p.exchangePending != null ||
    (p.extras ?? []).some((e) => e.action !== "unchanged") ||
    p.segments.some((s) => s.action !== "unchanged") ||
    /* a re-import can find everything current EXCEPT the predecessor's dead
       legs — the healing this receipt exists to deliver writes (or asks)
       through leftBehind alone, and hiding it as "up to date" made the one
       repair unreachable */
    p.leftBehind.length > 0
  );
}

function ActionChip({ action }: { action: string }) {
  const s = ACTION_STYLE[action] ?? ACTION_STYLE.unchanged;
  return (
    <span
      className="chip !px-1.5 !text-[9px]"
      style={{
        color: s.color,
        borderColor: `color-mix(in oklab, ${s.color} 45%, transparent)`,
        background: `color-mix(in oklab, ${s.color} 10%, transparent)`,
      }}
    >
      {s.label}
    </span>
  );
}

export default function ReceiptImportModal({
  onClose,
  onApplied,
  /** files already chosen elsewhere — dropped on the page behind this modal */
  initialFiles,
}: {
  onClose: () => void;
  onApplied: () => void;
  initialFiles?: File[];
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [showUpToDate, setShowUpToDate] = useState(true);
  const [showUnrecognized, setShowUnrecognized] = useState(true);
  const [ticketDecisions, setTicketDecisions] = useState<Record<number, Decision>>({});
  const [segDecisions, setSegDecisions] = useState<Record<string, Decision>>({});
  const [lbDecisions, setLbDecisions] = useState<Record<string, Decision>>({});
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    tickets: number;
    segments: number;
    chainsLinked: number;
    /** stale funding rows a better read of the same receipt retired */
    paymentsSuperseded: number;
    errors: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFiles = async (files: FileList | File[]) => {
    const wanted = [...files].filter((f) => /\.(eml|mbox)$/i.test(f.name));
    if (wanted.length === 0) {
      setError(
        "No .eml or .mbox files — save emails from your mail client, or export a Gmail label with Google Takeout."
      );
      return;
    }
    setStage("loading");
    setError(null);
    try {
      /* An .mbox is a whole labeled mailbox in one file (Google Takeout's
         export) — split it here and every message rides the same pipeline
         as a dropped .eml. */
      const emls: { name: string; content: string }[] = [];
      for (const f of wanted) {
        const text = await f.text();
        if (/\.mbox$/i.test(f.name)) {
          const pieces = splitMbox(text);
          pieces.forEach((content, i) =>
            emls.push({ name: `${f.name} · ${i + 1}/${pieces.length}`, content })
          );
        } else {
          emls.push({ name: f.name, content: text });
        }
      }
      /* One batch, because the preview's cross-file reasoning (a reissue in
         one email deciding whether a leg in another actually flew) only
         works within one batch — a decade of receipts belongs together.
         No silent truncation. Cutting to the first N and telling the user to
         "drop the file again" was a lie: the same first N come back every
         time, so the tail is unreachable. Above the ceiling the batch is
         refused with the one instruction that actually works. */
      if (emls.length > MAX_BATCH_MESSAGES) {
        setError(
          `That's ${emls.length.toLocaleString()} messages in one file — more than one batch can reason about. Export a narrower label (receipts only, or one year at a time) and drop that instead.`
        );
        setStage("pick");
        return;
      }
      if (emls.reduce((s, e) => s + e.content.length, 0) > 100 * 1024 * 1024) {
        setError(
          "That's over 100 MB of mail in one batch — export a narrower label (receipts only) and try again."
        );
        setStage("pick");
        return;
      }
      const r = await api<{ results: FileResult[] }>("/api/import/receipt", {
        method: "POST",
        body: JSON.stringify({ mode: "preview", emls }),
      });
      setResults(r.results);
      /* Collapse the noise only when it IS noise: a big batch with real work
         in it. A small drop, or a full replay where nothing is actionable,
         shows everything — an empty review list explains nothing. */
      const actionable = r.results.filter(isActionable).length;
      const upToDate = r.results.filter((x) => x.preview && !isActionable(x)).length;
      const unrecognized = r.results.filter((x) => !x.preview).length;
      setShowUpToDate(actionable === 0 || upToDate <= 15);
      setShowUnrecognized(actionable === 0 || unrecognized <= 15);
      setTicketDecisions({});
      setSegDecisions({});
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those files");
      setStage("pick");
    }
  };

  /* Opened by a drop rather than the button: parse immediately so the user
     lands on the review list, not on a picker asking for files they just gave
     us. Runs once — `pickFiles` is stable enough and re-parsing on every
     render would re-upload the batch. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialFiles?.length) return;
    started.current = true;
    void pickFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const unresolved = useMemo(() => {
    let n = 0;
    results.forEach((r, fi) => {
      if (!r.preview) return;
      if (r.preview.ticket.action === "conflict" && !ticketDecisions[fi]) n++;
      r.preview.segments.forEach((s, si) => {
        if (s.action === "conflict" && !segDecisions[`${fi}:${si}`]) n++;
      });
      r.preview.leftBehind.forEach((lb, li) => {
        if (lb.action === "conflict" && !lbDecisions[`${fi}:${li}`]) n++;
      });
    });
    return n;
  }, [results, ticketDecisions, segDecisions, lbDecisions]);

  const groups = useMemo(() => {
    let actionable = 0;
    let upToDate = 0;
    let unrecognized = 0;
    for (const r of results) {
      if (!r.preview) unrecognized++;
      else if (isActionable(r)) actionable++;
      else upToDate++;
    }
    return { actionable, upToDate, unrecognized };
  }, [results]);

  const applyCount = useMemo(
    () =>
      results.filter(
        (r) =>
          r.preview &&
          (r.preview.ticket.action !== "unchanged" ||
            r.preview.exchangePending != null ||
            // an extras receipt touches no ticket and often no segment — its
            // work IS the extra rows (mirror buildApplyItem's emptiness rule)
            /* a pin repair writes nothing new but fixes where money sits —
               without this, Apply stays greyed out on a flown trip whose
               only problem is a smeared upgrade */
            (r.preview.extras ?? []).some(
              (e) => e.action === "create" || e.action === "pin"
            ) ||
            r.preview.segments.some((s) => s.action !== "unchanged") ||
            /* same shape as the pin repair: a reissue re-imported to heal
               its predecessor's dead legs touches nothing else */
            r.preview.leftBehind.length > 0)
      ).length,
    [results]
  );

  /** Answer every question still open the same way. */
  const resolveAll = (choice: Decision) => {
    const t: Record<number, Decision> = { ...ticketDecisions };
    const sg: Record<string, Decision> = { ...segDecisions };
    results.forEach((r, fi) => {
      if (!r.preview) return;
      if (r.preview.ticket.action === "conflict" && !t[fi]) t[fi] = choice;
      r.preview.segments.forEach((s, si) => {
        if (s.action === "conflict" && !sg[`${fi}:${si}`]) sg[`${fi}:${si}`] = choice;
      });
      /* leftBehind conflicts stay per-row on purpose: these buttons speak
         field-conflict language ("use receipt" / "keep mine"), and a
         boundary-day leg asks a FACT — did this flight depart? — that a
         batch-wide answer cannot know. The rows are rare; the unresolved
         count keeps Apply blocked until each is answered where its dates
         are visible. */
    });
    setTicketDecisions(t);
    setSegDecisions(sg);
  };

  const apply = async () => {
    setStage("applying");
    setError(null);
    // the preview → apply-item mapping lives in the library, where it is tested
    const items = results.flatMap((r, fi) => {
      if (!r.preview) return [];
      const item = buildApplyItem(r.preview, {
        ticket: ticketDecisions[fi],
        segment: (si) => segDecisions[`${fi}:${si}`],
        leftBehind: (li) => lbDecisions[`${fi}:${li}`],
      });
      return item ? [item] : [];
    });
    try {
      const res = await api<{
        ticketsCreated: number;
        ticketsUpdated: number;
        segmentsCreated: number;
        segmentsUpdated: number;
        chainsLinked: number;
        paymentsSuperseded: number;
        errors: string[];
      }>("/api/import/receipt", {
        method: "POST",
        body: JSON.stringify({ mode: "apply", items }),
      });
      setResult({
        tickets: res.ticketsCreated + res.ticketsUpdated,
        segments: res.segmentsCreated + res.segmentsUpdated,
        chainsLinked: res.chainsLinked,
        paymentsSuperseded: res.paymentsSuperseded ?? 0,
        errors: res.errors,
      });
      setStage("done");
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStage("review");
    }
  };

  return (
    <Modal
      title="Import United receipts"
      subtitle="Booking confirmations & eTicket receipts (.eml, or a Takeout .mbox) → tickets with costs, attached to your flights"
      onClose={onClose}
      wide
    >
      <ErrorNote error={error} />

      {stage === "pick" && (
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center transition-all ${
            dragOver
              ? "border-s-miles bg-[var(--tint-accent)]"
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
            pickFiles(e.dataTransfer.files);
          }}
        >
          <div className="pointer-events-none flex flex-col items-center">
            <MailOpen size={28} className={`mb-3 ${dragOver ? "text-s-miles" : "text-mute"}`} />
            <p className="text-[14px] text-ink2">
              {dragOver
                ? "Drop to parse"
                : "Drop .eml files here — or a whole .mbox from Google Takeout — or click to browse"}
            </p>
            <p className="mt-1 text-[12px] text-mute">
              Gmail: open the email → ⋮ → “Download message”. Costs come from receipts;
              posted PQP/miles still come from the activity CSV.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".eml,.mbox,message/rfc822"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) pickFiles(e.target.files);
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

      {stage === "review" && (
        <div className="space-y-3">
          {/* the whole batch at a glance, pinned while the list scrolls; the
              negative margins pull it flush with the scrollport so sticky has
              an edge to pin to */}
          <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel2 px-5 py-2.5">
            <span className="text-[12px] text-ink2">
              {results.length} message{results.length === 1 ? "" : "s"} ·{" "}
              <span className="text-ink">{groups.actionable} actionable</span>
            </span>
            <GroupToggle
              count={groups.upToDate}
              label="up to date"
              open={showUpToDate}
              onToggle={() => setShowUpToDate((v) => !v)}
            />
            <GroupToggle
              count={groups.unrecognized}
              label="not recognized"
              open={showUnrecognized}
              onToggle={() => setShowUnrecognized((v) => !v)}
            />
          </div>


          {results.map((r, fi) => {
            const show = !r.preview
              ? showUnrecognized
              : isActionable(r) || showUpToDate;
            if (!show) return null;
            return (
              <FileCard
                key={fi}
                result={r}
                ticketDecision={ticketDecisions[fi]}
                onTicketDecide={(v) => setTicketDecisions((d) => ({ ...d, [fi]: v }))}
                segDecision={(si) => segDecisions[`${fi}:${si}`]}
                onSegDecide={(si, v) =>
                  setSegDecisions((d) => ({ ...d, [`${fi}:${si}`]: v }))
                }
                lbDecision={(li) => lbDecisions[`${fi}:${li}`]}
                onLbDecide={(li, v) =>
                  setLbDecisions((d) => ({ ...d, [`${fi}:${li}`]: v }))
                }
              />
            );
          })}

          {/* pinned at the panel's bottom edge — Apply must never sit a
              thousand cards away */}
          <div className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-line bg-panel2 px-5 py-3">
            {unresolved > 0 && (
              <>
                <span className="text-[12px] text-[var(--color-warning)]">
                  {unresolved} conflict{unresolved === 1 ? "" : "s"} awaiting your decision
                </span>
                {/* Answering the same question four times is not a decision,
                    it is a chore — most batches disagree for ONE reason (a
                    ledger built by an older import, say), and the answer is
                    the same every time. Per-row buttons still win: this only
                    fills the rows you haven't decided. */}
                <span className="mr-auto flex gap-1.5">
                  <button
                    className="t-display rounded-md border border-line2 px-2 py-0.5 text-[10px] tracking-[0.08em] text-mute transition-colors hover:text-ink2"
                    onClick={() => resolveAll("receipt")}
                    title="Take the receipt's value everywhere it disagrees"
                  >
                    Use receipt for all
                  </button>
                  <button
                    className="t-display rounded-md border border-line2 px-2 py-0.5 text-[10px] tracking-[0.08em] text-mute transition-colors hover:text-ink2"
                    onClick={() => resolveAll("keep")}
                    title="Keep what the ledger already holds, everywhere"
                  >
                    Keep mine for all
                  </button>
                </span>
              </>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={unresolved > 0 || applyCount === 0}
              onClick={apply}
            >
              <Upload size={13} /> Apply {applyCount > 0 ? `(${applyCount})` : ""}
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="py-6 text-center">
          <p className="t-display text-[20px] text-ink">Import complete</p>
          <p className="mt-2 text-[13px] text-ink2">
            {result.tickets} ticket{result.tickets === 1 ? "" : "s"} ·{" "}
            {result.segments} flight{result.segments === 1 ? "" : "s"} written
            {result.chainsLinked > 0 &&
              ` · ${result.chainsLinked} exchange link${result.chainsLinked === 1 ? "" : "s"} made`}
            {/* the heal is work too — a replay that only retired stale rows
                otherwise reported "0 tickets · 0 flights" and read as a no-op */}
            {result.paymentsSuperseded > 0 &&
              ` · ${result.paymentsSuperseded} stale funding row${result.paymentsSuperseded === 1 ? "" : "s"} retired`}
          </p>
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

/* ------------------------------ file card ------------------------------ */

function FileCard({
  result,
  ticketDecision,
  onTicketDecide,
  segDecision,
  onSegDecide,
  lbDecision,
  onLbDecide,
}: {
  result: FileResult;
  ticketDecision: Decision | undefined;
  onTicketDecide: (v: Decision) => void;
  segDecision: (si: number) => Decision | undefined;
  onSegDecide: (si: number, v: Decision) => void;
  lbDecision: (li: number) => Decision | undefined;
  onLbDecide: (li: number, v: Decision) => void;
}) {
  if (result.error || !result.preview) {
    return (
      <div className="rounded-md border border-[color-mix(in_oklab,var(--color-serious)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-serious)_8%,transparent)] px-3.5 py-2.5">
        <p className="t-num truncate text-[12px] text-ink2">{result.name}</p>
        <p className="mt-0.5 text-[12px] text-[var(--ink-warning)]">{result.error}</p>
      </div>
    );
  }
  const p = result.preview;
  const t = p.parsed;
  const totalLabel =
    t.miles_redeemed != null
      ? `${t.miles_redeemed.toLocaleString()} mi + ${fmtMoney(t.gross_total, t.currency)}`
      : fmtMoney(t.gross_total, t.currency);

  return (
    <div className="rounded-lg border border-line bg-well">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3.5 py-2.5">
        <FileUp size={13} className="shrink-0 text-mute" />
        <span className="t-num text-[13px] font-medium text-ink">
          {/* an extras receipt has no PNR — the eTicket it names IS its
              identity; a Wi-Fi receipt has neither, only its flight */}
          {t.confirmation ??
            t.ticket_number ??
            (t.segments[0]
              ? `${t.segments[0].origin}–${t.segments[0].destination}`
              : "??????")}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-mute">
          {KIND_LABEL[t.kind] ?? "Booking confirmation"}
        </span>
        <span className="t-num text-[12px] text-ink2">{totalLabel}</span>
        {t.issue_date && (
          <span className="text-[11px] text-mute">issued {fmtDate(t.issue_date)}</span>
        )}
        <span className="t-num ml-auto max-w-[200px] truncate text-[10.5px] text-mute">
          {result.name}
        </span>
      </header>

      <div className="space-y-1.5 px-3.5 py-2.5">
        {/* ticket row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ActionChip action={p.ticket.action} />
          <span className="text-[12.5px] text-ink2">
            Ticket{p.ticket.existingLabel ? ` · matches ${p.ticket.existingLabel}` : ""}
          </span>
          <span className="text-[11.5px] text-mute">
            {[...p.ticket.fills, ...p.ticket.diffs].join(" · ") ||
              (p.ticket.action === "create" ? "will be created with the fare above" : "no changes")}
          </span>
          {p.ticket.note && (
            <span className="text-[11.5px] italic text-mute">{p.ticket.note}</span>
          )}
          {p.ticket.action === "conflict" && (
            <ChoicePair value={ticketDecision} onChange={onTicketDecide} />
          )}
        </div>

        {/* extras from a purchase receipt: dated "extra purchase" rows on the
            ticket — the fare stays whatever the ticket's own receipt said */}
        {(p.extras ?? []).map((e, ei) => (
          <div key={`x${ei}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ActionChip action={e.action === "orphan" ? "conflict" : e.action} />
            <span className="text-[12.5px] text-ink2">{e.label}</span>
            <span className="t-num text-[12.5px] text-ink">
              {fmtMoney(e.amount, t.currency)}
            </span>
            {e.effective_date && (
              <span className="text-[11.5px] text-mute">on {fmtDate(e.effective_date)}</span>
            )}
            <span className="text-[11.5px] text-mute">
              {e.action === "create"
                ? e.segmentLabel
                  ? `lands on ${e.segmentLabel} as a dated extra`
                  : "adds to the ticket's cost as a dated extra"
                : e.action === "pin"
                  ? `already on the ticket, but spread across the trip — pins to ${e.segmentLabel}`
                  : e.action === "unchanged"
                    ? "already on the ticket"
                    : "no ticket to attach to"}
            </span>
          </div>
        ))}

        {/* segment rows */}
        {p.segments.map((s, si) => (
          <div key={si} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ActionChip action={s.action} />
            <span className="t-num text-[12.5px] text-ink">
              {s.parsed.flight_date} · {s.parsed.carrier}
              {s.parsed.flight_number} {s.parsed.origin}→{s.parsed.destination}
            </span>
            {s.action === "create" && s.data.status != null && (
              <StatusChip status={String(s.data.status)} />
            )}
            {(() => {
              const { text, title } = summarizeFills(s.fills);
              const full = [text, ...s.diffs].filter(Boolean).join(" · ");
              return full ? (
                <span className="text-[11.5px] text-mute" title={title}>
                  {full}
                </span>
              ) : null;
            })()}
            {s.note && <span className="text-[11.5px] italic text-mute">{s.note}</span>}
            {s.action === "conflict" && (
              <ChoicePair value={segDecision(si)} onChange={(v) => onSegDecide(si, v)} />
            )}
          </div>
        ))}

        {/* legs the reissue leaves behind on the ticket it replaces — the
            preview says everything apply will do, and these rows live on a
            ticket this receipt never lists. A boundary-day leg is a DECIDE:
            it may have flown before the reissue, and only the user knows. */}
        {p.leftBehind.map((lb, li) => (
          <div key={lb.segmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ActionChip action={lb.action} />
            <span className="t-num text-[12.5px] text-ink">{lb.label}</span>
            {lb.action === "update" && <StatusChip status="canceled" />}
            <span className="text-[11.5px] text-mute">{lb.why}</span>
            {lb.action === "conflict" && (
              <ChoicePair
                value={lbDecision(li)}
                onChange={(v) => onLbDecide(li, v)}
                yes="Cancel it"
                no="It flew"
              />
            )}
          </div>
        ))}

        {p.exchangeUnresolved && (
          <p className="mt-1 text-[11px] text-mute">
            Exchange of ticket {p.exchangeUnresolved} — that ticket isn’t in the
            ledger, so the chain can’t be linked automatically.
          </p>
        )}
        {p.exchangePending && !p.exchangeInferred && (
          <p className="mt-1 text-[11px] text-mute">
            Exchange of ticket {p.exchangePending} — that ticket is in this
            import too, so the chain links once both are written and its cost
            is shared by the flights that flew.
          </p>
        )}
        {p.exchangePending && p.exchangeInferred && (
          <p className="mt-1 text-[11px] text-[var(--ink-warning)]">
            Chained to {p.exchangePending} — {p.exchangeInferred}. Inferred, so
            check it.
          </p>
        )}

        {t.warnings.length > 0 && (
          <div className="mt-1 border-t border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] pt-1.5">
            {t.warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-[var(--ink-warning)]">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupToggle({
  count,
  label,
  open,
  onToggle,
}: {
  count: number;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  return (
    <button
      onClick={onToggle}
      aria-pressed={open}
      className={`t-display rounded-md border px-2 py-0.5 text-[10px] tracking-[0.08em] transition-colors ${
        open
          ? "border-s-miles bg-[var(--tint-accent-strong)] text-ink"
          : "border-line2 text-mute hover:text-ink2"
      }`}
    >
      {open ? "hide" : "show"} {count} {label}
    </button>
  );
}

function ChoicePair({
  value,
  onChange,
  yes = "Use receipt",
  no = "Keep mine",
}: {
  value: Decision | undefined;
  onChange: (v: Decision) => void;
  /** wording for the "receipt"/"keep" pair, where the default field framing
      doesn't fit — a left-behind leg cancels or flew, it isn't a field */
  yes?: string;
  no?: string;
}) {
  return (
    <span className="ml-auto flex gap-1.5">
      {(
        [
          ["receipt", yes],
          ["keep", no],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`t-display rounded-md border px-2 py-0.5 text-[10px] tracking-[0.08em] transition-colors ${
            value === v
              ? "border-s-miles bg-[var(--tint-accent-strong)] text-ink"
              : "border-line2 text-mute hover:text-ink2"
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
