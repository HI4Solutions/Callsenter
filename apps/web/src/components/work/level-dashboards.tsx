"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { Change, type Comparison } from "@/components/work/change";
import { FindingsCard, FlagCard, Stat, TrendCard } from "@/components/work/dashboard-view";
import type { FlagFilter } from "@/components/work/flag-charts";
import { ActivityHeatmap, FollowUp, SellerBars } from "@/components/work/team-charts";
import {
  type Benchmark,
  type Dashboard,
  dayCount,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatWholeKroner,
  osloToday,
  previousPeriod,
  share,
  type TeamDashboard,
} from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// A dashboard for each level (docs/plan.md, section 15): "Meg" for everyone, "Teamet" for
// leaders (dashboard.team) and "Callsenteret" with dashboard.all. Counts only, never content.

function percent(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 100) : null;
}

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// What the period is compared with, in words (label: the texts in dashboard.compare).
export function comparisonFor(from: string, to: string, label: (key: "yesterday" | "dayBefore" | "previous") => string): Comparison {
  const before = previousPeriod(from, to);
  const today = osloToday();
  const oneDay = dayCount(from, to) === 1;
  return {
    label: label(oneDay ? (from === today ? "yesterday" : "dayBefore") : "previous"),
    title: before.from === before.to ? formatDate(before.from) : `${formatDate(before.from)}–${formatDate(before.to)}`,
    complete: to < today,
  };
}

function dashboardQuery(from: string, to: string, scope: "me" | "team" | "all", team?: string | null) {
  const params = new URLSearchParams({ from, to });
  if (scope !== "me") params.set("scope", scope);
  if (scope === "team" && team) params.set("target", team);
  return `/dashboard?${params}`;
}

// The period and the one before it, fetched together. A result belongs to the request it was
// made for, so a slow answer for an earlier choice is never shown for a later one.
function usePair(from: string, to: string, scope: "me" | "team" | "all", team?: string | null) {
  const key = `${from}|${to}|${scope}|${team ?? ""}`;
  const [result, setResult] = useState<{ key: string; pair?: { now: Dashboard; before: Dashboard }; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const before = previousPeriod(from, to);
    Promise.all([
      orgFetch<Dashboard>(dashboardQuery(from, to, scope, team)),
      orgFetch<Dashboard>(dashboardQuery(before.from, before.to, scope, team)),
    ])
      .then(([now, earlier]) => !cancelled && setResult({ key, pair: { now, before: earlier } }))
      .catch((e: Error) => !cancelled && setResult({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, from, to, scope, team]);
  const current = result?.key === key ? result : null;
  return { pair: current?.pair ?? null, error: current?.error ?? null };
}

function useFetch<T>(path: string) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    orgFetch<T>(path)
      .then((data) => !cancelled && setResult({ path, data }))
      .catch((e: Error) => !cancelled && setResult({ path, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  const current = result?.path === path ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null };
}

// --- Meg -------------------------------------------------------------------------------------------

export function MyDashboard({ from, to, flag, onFlag }: { from: string; to: string; flag: FlagFilter; onFlag: (f: FlagFilter) => void }) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const { pair, error } = usePair(from, to, "me");
  const bench = useFetch<{ benchmark: Benchmark | null }>(`/dashboard/benchmark?${new URLSearchParams({ from, to })}`);
  const comparison = comparisonFor(from, to, (key) => t(`compare.${key}`));
  if (error) return <ErrorMessage message={error} />;
  if (!pair) return <p className="text-muted">{tc("loading")}</p>;
  const { now, before } = pair;
  const b = bench.data?.benchmark ?? null;
  const team = b && !b.tooFew && b.perSeller && b.shares ? { per: b.perSeller, shares: b.shares } : null;
  const avgCall = (d: Dashboard) => (d.calls.total ? d.calls.durationMs / d.calls.total : null);
  const teamAvgCall = team && team.per.calls ? team.per.durationMs / team.per.calls : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <Stat
            label={t("stats.calls")}
            value={formatNumber(now.calls.total)}
            change={<Change now={now.calls.total} before={before.calls.total} comparison={comparison} format={(v) => formatNumber(v)} />}
            note={team ? t("me.teamAverage", { value: formatDecimal(team.per.calls) }) : undefined}
          />
          <Stat
            label={t("stats.sales")}
            value={formatNumber(now.sales.total)}
            change={<Change now={now.sales.total} before={before.sales.total} comparison={comparison} format={(v) => formatNumber(v)} />}
            note={
              team
                ? t("me.teamAverage", { value: formatDecimal(team.per.sales) })
                : t("stats.pending", { count: formatNumber(now.sales.pending) })
            }
          />
          <Stat
            label={t("stats.confirmed")}
            value={share(now.sales.confirmed, now.sales.total)}
            change={
              <Change
                now={percent(now.sales.confirmed, now.sales.total)}
                before={percent(before.sales.confirmed, before.sales.total)}
                comparison={comparison}
                format={formatPercent}
                points
              />
            }
            note={team?.shares.confirmed != null ? t("me.teamShare", { share: formatPercent(team.shares.confirmed) }) : undefined}
          />
          <Stat
            label={t("me.avgLength")}
            value={avgCall(now) === null ? "–" : minutes(avgCall(now)!)}
            change={<Change now={null} before={avgCall(before)} comparison={{ ...comparison, complete: false }} format={minutes} />}
            note={teamAvgCall ? t("me.teamAverage", { value: minutes(teamAvgCall) }) : undefined}
          />
          <Stat
            label={t("me.approvedByAi")}
            value={share(now.calls.green, now.calls.analyzed)}
            change={
              <Change
                now={percent(now.calls.green, now.calls.analyzed)}
                before={percent(before.calls.green, before.calls.analyzed)}
                comparison={comparison}
                format={formatPercent}
                points
              />
            }
            note={team?.shares.green != null ? t("me.teamShare", { share: formatPercent(team.shares.green) }) : undefined}
          />
        </div>
        {bench.data && (
          <p className="text-sm text-muted">
            {!b
              ? t("me.noTeam")
              : b.tooFew
                ? t("me.tooFew", { team: b.teamName })
                : t("me.benchmark", { team: b.teamName, count: formatNumber(b.sellers) })}
          </p>
        )}
      </div>
      <FlagCard data={now} flagFilter={flag} onFlag={onFlag} />
      <TrendCard data={now} />
      <FindingsCard data={now} title={t("me.findingsTitle")} intro={t("me.findingsIntro")} />
    </div>
  );
}

// --- Teamet and Callsenteret ------------------------------------------------------------------------

// team: a team's id, or null for the whole call centre.
export function TeamLevel({
  team,
  from,
  to,
  flag,
  onFlag,
}: {
  team: string | null;
  from: string;
  to: string;
  flag: FlagFilter;
  onFlag: (f: FlagFilter) => void;
}) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const scope = team ? "team" : "all";
  const { pair, error } = usePair(from, to, scope, team);
  const params = new URLSearchParams({ from, to });
  if (team) params.set("team", team);
  const sellers = useFetch<TeamDashboard>(`/dashboard/team?${params}`);
  const comparison = comparisonFor(from, to, (key) => t(`compare.${key}`));
  if (error) return <ErrorMessage message={error} />;
  if (!pair) return <p className="text-muted">{tc("loading")}</p>;
  const { now, before } = pair;
  const hours = now.calls.durationMs / 3_600_000;
  const people = sellers.data?.sellers ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat
          label={t("stats.sales")}
          value={formatNumber(now.sales.total)}
          change={<Change now={now.sales.total} before={before.sales.total} comparison={comparison} format={(v) => formatNumber(v)} />}
          note={t("stats.pending", { count: formatNumber(now.sales.pending) })}
        />
        <Stat
          label={t("stats.confirmed")}
          value={share(now.sales.confirmed, now.sales.total)}
          change={
            <Change
              now={percent(now.sales.confirmed, now.sales.total)}
              before={percent(before.sales.confirmed, before.sales.total)}
              comparison={comparison}
              format={formatPercent}
              points
            />
          }
          note={t("team.perMonth", { amount: formatWholeKroner(now.sales.revenueMonthly) })}
        />
        <Stat
          label={t("stats.calls")}
          value={formatNumber(now.calls.total)}
          change={<Change now={now.calls.total} before={before.calls.total} comparison={comparison} format={(v) => formatNumber(v)} />}
          note={t("stats.hoursRecorded", { hours: hours >= 10 ? formatNumber(Math.round(hours)) : formatDecimal(hours) })}
        />
        <Stat
          label={t("stats.violations")}
          value={share(now.calls.red, now.calls.analyzed)}
          change={
            <Change
              now={percent(now.calls.red, now.calls.analyzed)}
              before={percent(before.calls.red, before.calls.analyzed)}
              comparison={comparison}
              format={formatPercent}
              points
            />
          }
          note={t("team.redAndYellow", { red: formatNumber(now.calls.red), yellow: formatNumber(now.calls.yellow) })}
        />
        <Stat
          label={t("stats.unreviewedFlags")}
          value={formatNumber(now.calls.unreviewed)}
          note={
            now.calls.unreviewed > 0 ? (
              <button type="button" className="font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                {t("team.showThem")}
              </button>
            ) : (
              t("team.allReviewed")
            )
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title={t("team.sellersTitle")}>
          {sellers.error ? (
            <ErrorMessage message={sellers.error} />
          ) : !sellers.data ? (
            <p className="text-muted">{tc("loading")}</p>
          ) : people.length ? (
            <SellerBars sellers={people} />
          ) : (
            <p className="text-muted">{t("team.noSellers")}</p>
          )}
        </Card>
        <Card title={t("team.followUpTitle")}>
          {sellers.data ? <FollowUp sellers={people} /> : <p className="text-muted">{tc("loading")}</p>}
        </Card>
      </div>

      {people.length > 0 && sellers.data && (
        <Card title={sellers.data.days.length > 31 ? t("team.activityPerWeek") : t("team.activityPerDay")}>
          <ActivityHeatmap days={sellers.data.days} sellers={people} />
        </Card>
      )}

      <FlagCard data={now} flagFilter={flag} onFlag={onFlag} />
      <TrendCard data={now} />
      <FindingsCard data={now} />
    </div>
  );
}
