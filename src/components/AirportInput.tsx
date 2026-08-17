"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/format";

interface AirportHit {
  iata: string;
  name: string;
  city: string | null;
  country: string | null;
}

export default function AirportInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [hits, setHits] = useState<AirportHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const search = (q: string) => {
    clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const r = await api<{ airports: AirportHit[] }>(
          `/api/airports?q=${encodeURIComponent(q)}`
        );
        setHits(r.airports);
        setHi(0);
        setOpen(true);
      } catch {
        /* search is best-effort */
      }
    }, 140);
  };

  const pick = (a: AirportHit) => {
    onChange(a.iata);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <input
        className="field t-num uppercase"
        value={value}
        placeholder={placeholder ?? "IAH"}
        autoFocus={autoFocus}
        maxLength={40}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          search(e.target.value);
        }}
        onFocus={(e) => {
          if (e.target.value.trim().length >= 2) search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || hits.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[hi]);
          } else if (e.key === "Escape") {
            // close only the dropdown, not the surrounding modal
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line2 bg-panel2 py-1 shadow-[0_16px_48px_var(--shadow-pop)]">
          {hits.map((a, i) => (
            <li key={a.iata}>
              <button
                type="button"
                className={`flex w-full items-baseline gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === hi ? "bg-[var(--tint-accent)]" : "hover:bg-well"
                }`}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(a)}
              >
                <span className="t-num w-9 shrink-0 text-[13px] font-semibold text-s-miles">
                  {a.iata}
                </span>
                <span className="truncate text-[12.5px] text-ink2">
                  {a.city ? `${a.city} — ` : ""}
                  {a.name}
                </span>
                {a.country && (
                  <span className="ml-auto shrink-0 text-[10.5px] text-mute">
                    {a.country}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
