"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { Flag } from "@/components/flag";
import type { FlagFilter } from "@/components/work/flag-charts";
import { type CallSummary, FLAG_LEVEL, formatDuration } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

const FILTERS: FlagFilter[] = ["all", "red", "yellow", "unreviewed", "green", "unchecked"];

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
  const t = useTranslations("dashboard.calls");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const filterLabel = (f: FlagFilter) =>
    f === "red" ? td("flag.violation") : f === "yellow" ? td("flag.deviation") : f === "green" ? td("flag.approved") : t(f);
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
    <Card title={t("title")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => onFilter(f)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                filter === f ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:bg-bg"
              }`}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>
        <ErrorMessage message={error} />
        {!calls ? (
          !error && <p className="text-muted">{tc("loading")}</p>
        ) : calls.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
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
                      <span className="font-semibold">{c.userName ?? t("unknownSeller")}</span>
                      <span className="text-muted">
                        {" · "}
                        {c.customerName || c.title || c.productName || t("noCustomer")}
                        {c.teamName ? ` · ${t("team", { name: c.teamName })}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {c.flag ? (
                        <Flag level={FLAG_LEVEL[c.flag]} />
                      ) : (
                        <span className="text-sm text-muted">
                          {c.status === "analyzed" ? t("unchecked") : td(`callStatus.${c.status}`)}
                        </span>
                      )}
                      {c.flag && c.flag !== "green" && (
                        <span className="text-sm text-muted">{c.reviewedAt ? t("reviewed") : t("unreviewed")}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {calls.length === 200 && <p className="text-sm text-muted">{t("capped")}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
