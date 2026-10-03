"use client";

// How a figure changed from the period before. Green, yellow and red are kept for AI flags and
// status, so a change is shown with an arrow and words, never in those colours. While the period
// is still running (it includes today), a percentage would compare part of a day or week with a
// whole one, so only the earlier figure is shown.

export interface Comparison {
  // "i går", "dagen før" or "forrige periode".
  label: string;
  // The earlier period's dates, for the tooltip.
  title: string;
  complete: boolean;
}

export function Change({
  now,
  before,
  comparison,
  format,
  points = false,
}: {
  now: number | null;
  before: number | null;
  comparison: Comparison;
  format: (value: number) => string;
  // Shares in percent change by percentage points, not by percent.
  points?: boolean;
}) {
  if (before === null) return null;
  const earlier = `${comparison.label[0]!.toUpperCase()}${comparison.label.slice(1)}: ${format(before)}`;
  if (!comparison.complete || now === null) {
    return (
      <span className="text-muted" title={comparison.title}>
        {earlier}
      </span>
    );
  }
  const diff = now - before;
  if (Math.abs(diff) < 1e-9) {
    return (
      <span className="text-muted" title={comparison.title}>
        Som {comparison.label} ({format(before)})
      </span>
    );
  }
  const up = diff > 0;
  const size = points
    ? `${Math.abs(Math.round(diff))} prosentpoeng`
    : before === 0
      ? null
      : `${Math.abs(Math.round((diff / before) * 100))} %`;
  return (
    <span title={comparison.title}>
      <span aria-hidden="true" className="mr-1 text-xs">
        {up ? "▲" : "▼"}
      </span>
      <span className="font-semibold">{size ? `${up ? "Opp" : "Ned"} ${size}` : up ? "Opp" : "Ned"}</span>
      <span className="text-muted">
        {" "}
        fra {comparison.label} ({format(before)})
      </span>
    </span>
  );
}
