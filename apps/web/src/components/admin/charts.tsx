"use client";

import { useEffect, useRef, useState } from "react";

// Single-series charts for the growth tab: one hue (the brand color), hairline grid, 2px line,
// columns at most 24px with a 4px rounded top, a hover/focus tooltip, and a table view. No
// legend: the title names the one series.

export interface Point {
  label: string;
  value: number;
}

export interface Marker {
  index: number;
  title: string;
}

const H = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 40 };

// Drawn at the container's real width, so text keeps its size on a phone.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

// A clean axis maximum whose four steps are whole numbers (these are counts).
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  if (max <= 20) return Math.ceil(max / 4) * 4;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 4, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

function ticks(max: number): number[] {
  return [0, max / 4, max / 2, (3 * max) / 4, max];
}

const fmt = new Intl.NumberFormat("nb-NO");

function Frame({
  title,
  points,
  max,
  children,
  active,
  tooltip,
  W,
  frameRef,
}: {
  title: string;
  points: Point[];
  max: number;
  children: React.ReactNode;
  active: number | null;
  tooltip: React.ReactNode;
  W: number;
  frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  const plotH = H - PAD.top - PAD.bottom;
  const band = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  // Month labels need about 48px each; skip some when the bands are narrower.
  const every = Math.max(1, Math.ceil(48 / band));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-semibold">{title}</figcaption>
      <div className="relative" ref={frameRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full overflow-visible" role="img" aria-label={title}>
          {ticks(max).map((t) => {
            const y = PAD.top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                  {fmt.format(t)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) =>
            i % every === 0 ? (
              <text
                key={p.label}
                x={PAD.left + band * i + band / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted)"
              >
                {p.label}
              </text>
            ) : null,
          )}
          {children}
        </svg>
        {active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow"
            style={{ left: `${((PAD.left + band * active + band / 2) / W) * 100}%` }}
          >
            {tooltip}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Vis som tabell</summary>
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-1 font-semibold">
                Måned
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Antall
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-b border-line">
                <td className="py-1">{p.label}</td>
                <td className="py-1 text-right tabular-nums">{fmt.format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// Hit targets span the whole month band, larger than the mark; keyboard users tab through them.
function HitTargets({ points, onActive, W }: { points: Point[]; onActive: (i: number | null) => void; W: number }) {
  const band = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  return (
    <g>
      {points.map((p, i) => (
        <rect
          key={p.label}
          x={PAD.left + band * i}
          y={PAD.top}
          width={band}
          height={H - PAD.top - PAD.bottom}
          fill="transparent"
          tabIndex={0}
          aria-label={`${p.label}: ${fmt.format(p.value)}`}
          onMouseEnter={() => onActive(i)}
          onMouseLeave={() => onActive(null)}
          onFocus={() => onActive(i)}
          onBlur={() => onActive(null)}
        />
      ))}
    </g>
  );
}

function MarkerLines({ markers, count, active, W }: { markers: Marker[]; count: number; active: number | null; W: number }) {
  const band = (W - PAD.left - PAD.right) / Math.max(count, 1);
  return (
    <g>
      {markers.map((m) => {
        const x = PAD.left + band * m.index + band / 2;
        return (
          <g key={`${m.index}-${m.title}`} opacity={active === null || active === m.index ? 1 : 0.5}>
            <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x} cy={PAD.top} r={4} fill="var(--muted)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        );
      })}
    </g>
  );
}

function markerText(markers: Marker[], index: number) {
  const here = markers.filter((m) => m.index === index);
  return here.length ? <p className="text-muted">{here.map((m) => m.title).join(", ")}</p> : null;
}

export function ColumnChart({ title, points, unit, markers = [] }: { title: string; points: Point[]; unit: string; markers?: Marker[] }) {
  const [active, setActive] = useState<number | null>(null);
  const { ref, width: W } = useWidth();
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotH = H - PAD.top - PAD.bottom;
  const band = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  const width = Math.min(24, band * 0.6);
  const base = PAD.top + plotH;
  return (
    <Frame
      title={title}
      points={points}
      max={max}
      active={active}
      W={W}
      frameRef={ref}
      tooltip={
        active !== null && (
          <>
            <p className="font-semibold">{points[active]!.label}</p>
            <p>
              {fmt.format(points[active]!.value)} {unit}
            </p>
            {markerText(markers, active)}
          </>
        )
      }
    >
      <MarkerLines markers={markers} count={points.length} active={active} W={W} />
      {points.map((p, i) => {
        const h = (p.value / max) * plotH;
        if (h <= 0) return null;
        const x = PAD.left + band * i + (band - width) / 2;
        const r = Math.min(4, h, width / 2);
        // Rounded at the data end, square at the baseline.
        const d = `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + width - r} Q${x + width},${base - h} ${x + width},${base - h + r} V${base} Z`;
        return <path key={p.label} d={d} fill="var(--brand)" opacity={active === null || active === i ? 1 : 0.55} />;
      })}
      <HitTargets points={points} onActive={setActive} W={W} />
    </Frame>
  );
}

export function LineChart({ title, points, unit, markers = [] }: { title: string; points: Point[]; unit: string; markers?: Marker[] }) {
  const [active, setActive] = useState<number | null>(null);
  const { ref, width: W } = useWidth();
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotH = H - PAD.top - PAD.bottom;
  const band = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  const xy = points.map((p, i) => [PAD.left + band * i + band / 2, PAD.top + plotH - (p.value / max) * plotH] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const last = xy[xy.length - 1];
  return (
    <Frame
      title={title}
      points={points}
      max={max}
      active={active}
      W={W}
      frameRef={ref}
      tooltip={
        active !== null && (
          <>
            <p className="font-semibold">{points[active]!.label}</p>
            <p>
              {fmt.format(points[active]!.value)} {unit}
            </p>
            {markerText(markers, active)}
          </>
        )
      }
    >
      <MarkerLines markers={markers} count={points.length} active={active} W={W} />
      {xy.length > 0 && (
        <path
          d={`${line} L${last![0]},${PAD.top + plotH} L${xy[0]![0]},${PAD.top + plotH} Z`}
          fill="var(--brand)"
          opacity={0.1}
        />
      )}
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {active !== null && xy[active] && (
        <>
          <line x1={xy[active][0]} x2={xy[active][0]} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border)" strokeWidth={1} />
          <circle cx={xy[active][0]} cy={xy[active][1]} r={5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
        </>
      )}
      {last && active === null && (
        <>
          <circle cx={last[0]} cy={last[1]} r={4} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
          <text x={last[0]} y={last[1] - 10} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--fg)">
            {fmt.format(points[points.length - 1]!.value)}
          </text>
        </>
      )}
      <HitTargets points={points} onActive={setActive} W={W} />
    </Frame>
  );
}
