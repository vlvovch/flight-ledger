"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/* ------------------------------- Panel -------------------------------- */

export function Panel({
  label,
  accent,
  children,
  className = "",
  right,
}: {
  label?: string;
  accent?: string; // CSS color for the top accent stripe
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {accent && (
        <div className="panel-accent" style={{ "--accent": accent } as React.CSSProperties} />
      )}
      {/* The header wraps: in a half-width panel a title, a legend and two
          controls do not fit on one line, and without this the title broke one
          word per line while the last control was clipped off the edge. */}
      {(label || right) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-1">
          {label && <h2 className="t-label">{label}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/* ------------------------------ StatCard ------------------------------- */

export function StatCard({
  label,
  value,
  sub,
  accent,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  title?: string;
}) {
  return (
    <div className="panel px-4 py-3.5" title={title}>
      {accent && (
        <div className="panel-accent" style={{ "--accent": accent } as React.CSSProperties} />
      )}
      {/* Two lines' worth, always. A label that wraps ("United lifetime
          miles") otherwise pushes its own value down while its neighbours'
          stay put, and a row of figures that don't share a baseline reads as
          a layout fault. */}
      <div className="t-label min-h-[33px]">{label}</div>
      <div className="t-num mt-1.5 text-[24px] font-medium leading-none text-ink">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] leading-snug text-mute">{sub}</div>}
    </div>
  );
}

/* ----------------------------- StatusChip ------------------------------ */

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  ticketed: { color: "var(--color-s-miles)", label: "Ticketed" },
  flown_unreconciled: { color: "var(--color-warning)", label: "Flown" },
  flown_reconciled: { color: "var(--color-good)", label: "Reconciled" },
  canceled: { color: "var(--color-mute)", label: "Canceled" },
  missed: { color: "var(--color-serious)", label: "Missed" },
  refunded: { color: "var(--color-mute)", label: "Refunded" },
  active: { color: "var(--color-good)", label: "Active" },
  exchanged: { color: "var(--color-warning)", label: "Exchanged" },
  voided: { color: "var(--color-mute)", label: "Voided" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { color: "var(--color-mute)", label: status };
  return (
    <span
      className="chip"
      style={{
        color: s.color,
        borderColor: `color-mix(in oklab, ${s.color} 45%, transparent)`,
        background: `color-mix(in oklab, ${s.color} 10%, transparent)`,
      }}
    >
      <span className="dot" />
      {s.label}
    </span>
  );
}

/* ------------------------------- Toast --------------------------------- */

/*
 * One transient line for "your data just moved": a backup landing in Drive,
 * a ledger restored. The permanent inline statuses stay where they are —
 * this exists because they whisper, and a data move deserves to be seen
 * without hunting for a 12px caption. Module-level bus rather than context:
 * the sender may be a hook deep in a sidebar, and one host serves the app.
 */
let showToastFn: ((msg: string) => void) | null = null;
const TOAST_KEY = "flight-ledger:pending-toast";

/** afterReload: stash the message for the page that comes next — a pull
 *  reloads the app, and a toast shown now would die with this document. */
export function toast(message: string, opts?: { afterReload?: boolean }): void {
  if (opts?.afterReload) {
    try {
      sessionStorage.setItem(TOAST_KEY, message);
    } catch {
      /* private mode: the reload just arrives unannounced */
    }
    return;
  }
  showToastFn?.(message);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    showToastFn = setMsg;
    try {
      const pending = sessionStorage.getItem(TOAST_KEY);
      if (pending) {
        sessionStorage.removeItem(TOAST_KEY);
        setMsg(pending);
      }
    } catch {
      /* nothing pending */
    }
    return () => {
      if (showToastFn === setMsg) showToastFn = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return createPortal(
    <div
      role="status"
      onClick={() => setMsg(null)}
      className="reveal fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 cursor-pointer rounded-md border border-line2 border-l-2 border-l-s-miles bg-panel2 px-4 py-2.5 text-[13px] text-ink shadow-[0_12px_40px_var(--shadow-pop)]"
    >
      {msg}
    </div>,
    document.body
  );
}

/* ------------------------------- Modal --------------------------------- */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* Portaled to <body>. Rendered in place, the overlay's fixed positioning
     is at the mercy of every ancestor — one transform, filter or zoom quirk
     up the tree and "cover the viewport" becomes "cover the panel", with
     page chrome painting through the backdrop (a settings input floated
     over a conflict dialog this way). From body there is nothing to
     inherit, and last-in-DOM settles the paint order too. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!host) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(4,8,16,0.72)] p-4 backdrop-blur-[3px] sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* The panel is capped to the viewport and the CONTENT scrolls, inside
          one contained region — a taller-than-screen modal used to scroll as
          part of the overlay, which put the title and the action buttons a
          hundred cards away and let the wheel chain to whatever was behind.
          The cap is a PERCENTAGE of the overlay (a fixed inset-0 box that is
          the visual viewport), never dvh: the deck's --ui-scale zoom makes
          dvh resolve in unzoomed pixels and overflow the screen. */}
      <div
        ref={ref}
        className={`reveal panel my-4 flex max-h-[calc(100%_-_2rem)] w-full flex-col border-line2 bg-panel2 shadow-[0_24px_80px_var(--shadow-pop)] ${
          wide ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="t-display text-[19px] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-mute">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-mute transition-colors hover:bg-well hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>,
    host
  );
}

/* ------------------------------ Confirm -------------------------------- */

export function Confirm({
  message,
  detail,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  message: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="Confirm" onClose={onCancel}>
      <p className="text-[14px] text-ink">{message}</p>
      {detail && <p className="mt-1.5 text-[12.5px] text-mute">{detail}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Field --------------------------------- */

export function Field({
  label,
  children,
  className = "",
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="t-label mb-1.5 block !text-[10px]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
    </label>
  );
}

/* ----------------------------- EmptyState ------------------------------ */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="relative mb-5 h-16 w-16">
        {/* radar sweep */}
        <div className="absolute inset-0 rounded-full border border-line2" />
        <div className="absolute inset-[10px] rounded-full border border-line" />
        <div className="absolute inset-[22px] rounded-full border border-line" />
        <div className="absolute left-1/2 top-1/2 h-[1.5px] w-1/2 origin-left animate-[spin_3.2s_linear_infinite] bg-gradient-to-r from-s-miles to-transparent" />
      </div>
      <h3 className="t-display text-[17px] text-ink2">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13px] text-mute">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------ ErrorNote ------------------------------ */

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-3 rounded-md border border-[color-mix(in_oklab,var(--color-critical)_50%,transparent)] bg-[var(--tint-critical)] px-3 py-2 text-[12.5px] text-[var(--ink-critical)]">
      {error}
    </div>
  );
}

/* -------------------------- MilesBasisToggle --------------------------- */

/**
 * Flown vs United-lifetime miles — the dashboard's CPM chart and the Analysis
 * page's monthly ledger both switch on it, which is why it lives here.
 *
 * "United lifetime", not "Lifetime". The qualifier IS the meaning: lifetime
 * miles here are the ones United posts toward Million Miler, not every mile
 * flown — the gap between those two is what the lifetime chart is for.
 */
export function MilesBasisToggle({
  value,
  onChange,
}: {
  value: "flown" | "lifetime";
  onChange: (v: "flown" | "lifetime") => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line">
      {(
        [
          ["flown", "Flown"],
          ["lifetime", "United lifetime"],
        ] as const
      ).map(([mode, text]) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`t-display px-2.5 py-1 text-[10.5px] tracking-[0.1em] transition-colors pointer-coarse:py-2.5 ${
            value === mode
              ? "bg-[var(--tint-accent-strong)] text-ink"
              : "text-mute hover:text-ink2"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
