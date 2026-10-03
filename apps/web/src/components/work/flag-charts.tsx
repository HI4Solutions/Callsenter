"use client";

import { useEffect, useRef, useState } from "react";
import { niceMax } from "@/components/admin/charts";

// The AI flags as charts. Green, yellow and red are the flag colours (the only place they are
// used); calls not checked by AI are grey. Every count is also written as text, so the meaning
// never rests on colour alone.

export type FlagFilter = "all" | "green" | "yellow" | "red" | "unchecked" | "unreviewed";

export interface FlagCounts {
  green: number;
  yellow: number;
  red: number;
  unchecked: number;
}

const fmt = new Intl.NumberFormat("nb-NO");

export const FLAG_PARTS = [
  { key: "red", label: "Brudd", color: "var(--flag-violation)" },
  { key: "yellow", label: "Avvik", color: "var(--flag-deviation)" },
  { key: "green", label: "Godkjent", color: "var(--flag-approved)" },
  { key: "unchecked", label: "Ikke kontrollert", color: "color-mix(in srgb, var(--muted) 45%, var(--surface))" },
] as const;

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

// One bar split by flag, with a legend. Each part can be chosen to list those calls.
export function FlagBar({ counts, selected, onSelect }: { counts: FlagCounts; selected: FlagFilter; onSelect: (f: FlagFilter) => void }) {
  const total = counts.green + counts.yellow + counts.red + counts.unchecked;
  if (!total) return <p className="text-muted">Ingen samtaler i perioden.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {FLAG_PARTS.filter((p) => counts[p.key] > 0).map((p) => (
          <button
            key={p.key}
            type="button"
            tabIndex={-1}
            className="h-full transition-opacity hover:opacity-80"
            style={{ width: `${(counts[p.key] / total) * 100}%`, background: p.color, minWidth: "6px" }}
            title={`${p.label}: ${fmt.format(counts[p.key])}`}
            onClick={() => onSelect(p.key)}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FLAG_PARTS.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              aria-pressed={selected === p.key}
              onClick={() => onSelect(selected === p.key ? "all" : p.key)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-bg ${
                selected === p.key ? "border-brand" : "border-line"
              }`}
            >
              <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm text-muted">{p.label}</span>
                <span className="text-xl font-semibold tabular-nums">{fmt.format(counts[p.key])}</span>
                <span className="ml-1 text-sm text-muted tabular-nums">{pct(counts[p.key], total)} %</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FlagColumn {
  label: string;
  // Shown in the tooltip and table, e.g. "1. september" or "kl. 09".
  title: string;
  green: number;
  yellow: number;
  red: number;
  unchecked: number;
}

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };

// Columns over time (days, weeks or hours), each split by flag.
export function FlagColumns({ title, columns }: { title: string; columns: FlagColumn[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const totals = columns.map((c) => c.green + c.yellow + c.red + c.unchecked);
  const max = niceMax(Math.max(0, ...totals));
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / Math.max(1, columns.length);
  const barW = Math.max(3, Math.min(24, step * 0.7));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const every = Math.ceil(columns.length / Math.max(1, Math.floor(plotW / 44)));

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-semibold">{title}</figcaption>
        <button type="button" className="min-h-11 text-sm font-semibold text-brand" onClick={() => setTable((t) => !t)}>
          {table ? "Vis som graf" : "Vis som tabell"}
        </button>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {FLAG_PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            {p.label}
          </li>
        ))}
      </ul>
      {table ? (
        <div className="-mx-2 scroll-x">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-1 font-semibold">Tid</th>
                {FLAG_PARTS.map((p) => (
                  <th key={p.key} className="px-2 py-1 text-right font-semibold">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {columns.map((c) => (
                <tr key={c.title}>
                  <td className="px-2 py-1">{c.title}</td>
                  {FLAG_PARTS.map((p) => (
                    <td key={p.key} className="px-2 py-1 text-right tabular-nums">
                      {fmt.format(c[p.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full">
          <svg width={width} height={H} role="img" aria-label={`${title}. Bruk «Vis som tabell» for tallene.`}>
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
                  {fmt.format(t)}
                </text>
              </g>
            ))}
            {columns.map((c, i) => {
              const x = PAD.left + i * step + (step - barW) / 2;
              let base = 0;
              const parts = [...FLAG_PARTS].reverse();
              return (
                <g key={c.title} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                  <rect x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} fill="transparent" />
                  {parts.map((p) => {
                    const v = c[p.key];
                    if (!v) return null;
                    const top = y(base + v);
                    const h = y(base) - top;
                    base += v;
                    return <rect key={p.key} x={x} y={top + 1} width={barW} height={Math.max(1, h - 1)} rx={2} fill={p.color} />;
                  })}
                  {i % every === 0 && (
                    <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                      {c.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {active !== null && columns[active] && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow"
              style={{ left: Math.min(width - 170, Math.max(0, PAD.left + active * step - 60)) }}
            >
              <p className="font-semibold">{columns[active].title}</p>
              {FLAG_PARTS.map((p) => (
                <p key={p.key} className="tabular-nums">
                  {p.label}: {fmt.format(columns[active]![p.key])}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
