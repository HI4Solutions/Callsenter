"use client";

import { Flag } from "@/components/flag";
import { type CallDetail, FINDING_KIND, FLAG_LEVEL, type Finding, formatDuration, type RequiredPoint } from "@/lib/calls";

const ORDER = { red: 0, yellow: 1, green: 2 } as const;

// Varsellamper: one lamp per mandatory point in the product template, grey until the AI control
// has run, then green, yellow or red. Forbidden phrases, price and terms, and other serious
// findings get their own lamps after the points. The meaning is always written as text too.
export function WarningLamps({
  points,
  analysis,
  state,
  onSeek,
}: {
  points: RequiredPoint[];
  analysis: CallDetail["analyses"][number] | undefined;
  // What the grey lamps mean right now.
  state: "before" | "recording" | "checking" | "off";
  onSeek?: (ms: number) => void;
}) {
  const findings = analysis?.findings ?? [];
  const byPoint = new Map(findings.filter((f) => f.kind === "required_point").map((f) => [f.pointId, f]));
  const others = findings.filter((f) => f.kind !== "required_point" || !points.some((p) => p.id === f.pointId));
  others.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const waiting = {
    before: "Husk",
    recording: "Husk",
    checking: "Sjekkes …",
    off: "Ikke sjekket",
  }[state];

  if (!points.length && !findings.length) {
    return <p className="text-muted">Velg en mal for å se punktene som må med i samtalen.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {points.map((p) => {
          const f = analysis ? byPoint.get(p.id) : undefined;
          return (
            <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                {f ? <Flag level={FLAG_LEVEL[f.level]} /> : <Grey label={analysis ? "Ikke vurdert" : waiting} />}
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{p.text}</span>
              </div>
              {f && <Detail finding={f} onSeek={onSeek} />}
            </li>
          );
        })}
        {others.map((f, i) => (
          <li key={`x${i}`} className="flex flex-col gap-1 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Flag level={FLAG_LEVEL[f.level]} />
              <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{f.label}</span>
              <span className="text-sm text-muted">{FINDING_KIND[f.kind]}</span>
            </div>
            <Detail finding={f} onSeek={onSeek} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        {state === "off" && !analysis
          ? "AI-kontroll er ikke slått på for callsenteret, eller samtalen er ikke koblet til en mal."
          : analysis
            ? "Lampene er satt av AI ut fra transkripsjonen. AI kan ta feil; sjekk sitatet i opptaket."
            : "Lampene tennes når samtalen er transkribert og sjekket mot malen."}
      </p>
    </div>
  );
}

function Grey({ label }: { label: string }) {
  return <span className="flag inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium">{label}</span>;
}

function Detail({ finding, onSeek }: { finding: Finding; onSeek?: (ms: number) => void }) {
  if (!finding.comment && !finding.quote) return null;
  return (
    <div className="text-sm [overflow-wrap:anywhere]">
      {finding.comment && <p>{finding.comment}</p>}
      {finding.quote && (
        <p className="mt-1">
          {finding.startMs !== null && onSeek ? (
            <button type="button" className="mr-2 min-h-11 font-mono text-brand tabular-nums" onClick={() => onSeek(finding.startMs!)}>
              {formatDuration(finding.startMs)}
            </button>
          ) : null}
          «{finding.quote}»
        </p>
      )}
    </div>
  );
}
