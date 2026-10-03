"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { Flag } from "@/components/flag";
import type { FlagFilter } from "@/components/work/flag-charts";
import { CALL_STATUS, type CallSummary, FLAG_LEVEL, formatDuration } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

const FILTERS: { key: FlagFilter; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "red", label: "Brudd" },
  { key: "yellow", label: "Avvik" },
  { key: "unreviewed", label: "Ikke behandlet" },
  { key: "green", label: "Godkjent" },
  { key: "unchecked", label: "Ikke kontrollert" },
];

const PARAMS: Record<FlagFilter, Record<string, string>> = {
  all: {},
  red: { flag: "red" },
  yellow: { flag: "yellow" },
  green: { flag: "green" },
  unchecked: { unchecked: "1" },
  unreviewed: { review: "1" },
};

// The calls of the period on the overview: who made them, and how the AI control went. A leader
// picks a flag (here or in the chart) to follow up the calls with deviations or breaches.
export function PeriodCalls({
  from,
  to,
  scope,
  filter,
  onFilter,
}: {
  from: string;
  to: string;
  // Whose calls: one seller, a team, or everything the user may see.
  scope: { userId?: string; teamId?: string };
  filter: FlagFilter;
  onFilter: (f: FlagFilter) => void;
}) {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from, to, ...PARAMS[filter] });
    if (scope.userId) params.set("userId", scope.userId);
    if (scope.teamId) params.set("teamId", scope.teamId);
    orgFetch<CallSummary[]>(`/calls?${params}`)
      .then((rows) => {
        if (cancelled) return;
        setCalls(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [from, to, scope.userId, scope.teamId, filter]);

  return (
    <Card title="Samtaler i perioden">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Vis samtaler">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                filter === f.key ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:bg-bg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ErrorMessage message={error} />
        {!calls ? (
          !error && <p className="text-muted">Laster …</p>
        ) : calls.length === 0 ? (
          <p className="text-muted">Ingen samtaler her i perioden.</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {calls.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/samtaler/${c.id}`}
                    className="-mx-2 grid gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-bg sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                  >
                    <span className="text-sm whitespace-nowrap text-muted tabular-nums">
                      {formatDateTime(c.startedAt)}
                      {c.durationMs ? ` · ${formatDuration(c.durationMs)}` : ""}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-semibold">{c.userName ?? "Ukjent selger"}</span>
                      <span className="text-muted">
                        {" · "}
                        {c.customerName || c.title || c.productName || "Uten kunde"}
                        {c.teamName ? ` · Team ${c.teamName}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {c.flag ? (
                        <Flag level={FLAG_LEVEL[c.flag]} />
                      ) : (
                        <span className="text-sm text-muted">{c.status === "analyzed" ? "Ikke kontrollert" : CALL_STATUS[c.status]}</span>
                      )}
                      {c.flag && c.flag !== "green" && (
                        <span className="text-sm text-muted">{c.reviewedAt ? "Behandlet" : "Ikke behandlet"}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {calls.length === 200 && <p className="text-sm text-muted">Viser de 200 nyeste. Velg en kortere periode for å se alle.</p>}
          </>
        )}
      </div>
    </Card>
  );
}
