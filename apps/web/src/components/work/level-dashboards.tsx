"use client";

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
  osloToday,
  previousPeriod,
  share,
  type TeamDashboard,
} from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// A dashboard for each level (docs/plan.md, section 15): "Meg" for everyone, "Teamet" for
// leaders (dashboard.team) and "Callsenteret" with dashboard.all. Counts only, never content.

const fmt = new Intl.NumberFormat("nb-NO");
const kroner = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });

function percent(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 100) : null;
}

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// What the period is compared with, in words.
export function comparisonFor(from: string, to: string): Comparison {
  const before = previousPeriod(from, to);
  const today = osloToday();
  const oneDay = dayCount(from, to) === 1;
  return {
    label: oneDay ? (from === today ? "i går" : "dagen før") : "forrige periode",
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
  const { pair, error } = usePair(from, to, "me");
  const bench = useFetch<{ benchmark: Benchmark | null }>(`/dashboard/benchmark?${new URLSearchParams({ from, to })}`);
  const comparison = comparisonFor(from, to);
  if (error) return <ErrorMessage message={error} />;
  if (!pair) return <p className="text-muted">Laster …</p>;
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
            label="Samtaler"
            value={fmt.format(now.calls.total)}
            change={<Change now={now.calls.total} before={before.calls.total} comparison={comparison} format={(v) => fmt.format(v)} />}
            note={team ? `Snitt i teamet: ${decimal.format(team.per.calls)}` : undefined}
          />
          <Stat
            label="Salg"
            value={fmt.format(now.sales.total)}
            change={<Change now={now.sales.total} before={before.sales.total} comparison={comparison} format={(v) => fmt.format(v)} />}
            note={team ? `Snitt i teamet: ${decimal.format(team.per.sales)}` : `${fmt.format(now.sales.pending)} venter på bekreftelse`}
          />
          <Stat
            label="Bekreftet"
            value={share(now.sales.confirmed, now.sales.total)}
            change={
              <Change
                now={percent(now.sales.confirmed, now.sales.total)}
                before={percent(before.sales.confirmed, before.sales.total)}
                comparison={comparison}
                format={(v) => `${v} %`}
                points
              />
            }
            note={team?.shares.confirmed != null ? `Teamet: ${team.shares.confirmed} %` : undefined}
          />
          <Stat
            label="Snittlengde"
            value={avgCall(now) === null ? "–" : minutes(avgCall(now)!)}
            change={<Change now={null} before={avgCall(before)} comparison={{ ...comparison, complete: false }} format={minutes} />}
            note={teamAvgCall ? `Snitt i teamet: ${minutes(teamAvgCall)}` : undefined}
          />
          <Stat
            label="Godkjent av AI"
            value={share(now.calls.green, now.calls.analyzed)}
            change={
              <Change
                now={percent(now.calls.green, now.calls.analyzed)}
                before={percent(before.calls.green, before.calls.analyzed)}
                comparison={comparison}
                format={(v) => `${v} %`}
                points
              />
            }
            note={team?.shares.green != null ? `Teamet: ${team.shares.green} %` : undefined}
          />
        </div>
        {bench.data && (
          <p className="text-sm text-muted">
            {!b
              ? "Du er ikke med i et team, så det er ikke noe snitt å sammenligne med."
              : b.tooFew
                ? `Snittet i team ${b.teamName} vises når minst tre har vært aktive i perioden, så ingen kan regne ut hva en kollega har gjort.`
                : `Snittet er per selger i team ${b.teamName} (${fmt.format(b.sellers)} aktive i perioden), uten navn.`}
          </p>
        )}
      </div>
      <FlagCard data={now} flagFilter={flag} onFlag={onFlag} />
      <TrendCard data={now} />
      <FindingsCard
        data={now}
        title="Det du oftest glemmer"
        intro="Punktene AI-kontrollen oftest flagget i samtalene dine. Åpne samtalene under for å se hva som ble sagt."
      />
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
  const scope = team ? "team" : "all";
  const { pair, error } = usePair(from, to, scope, team);
  const params = new URLSearchParams({ from, to });
  if (team) params.set("team", team);
  const sellers = useFetch<TeamDashboard>(`/dashboard/team?${params}`);
  const comparison = comparisonFor(from, to);
  if (error) return <ErrorMessage message={error} />;
  if (!pair) return <p className="text-muted">Laster …</p>;
  const { now, before } = pair;
  const hours = now.calls.durationMs / 3_600_000;
  const people = sellers.data?.sellers ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat
          label="Salg"
          value={fmt.format(now.sales.total)}
          change={<Change now={now.sales.total} before={before.sales.total} comparison={comparison} format={(v) => fmt.format(v)} />}
          note={`${fmt.format(now.sales.pending)} venter på bekreftelse`}
        />
        <Stat
          label="Bekreftet"
          value={share(now.sales.confirmed, now.sales.total)}
          change={
            <Change
              now={percent(now.sales.confirmed, now.sales.total)}
              before={percent(before.sales.confirmed, before.sales.total)}
              comparison={comparison}
              format={(v) => `${v} %`}
              points
            />
          }
          note={`${kroner.format(now.sales.revenueMonthly)} kr per måned`}
        />
        <Stat
          label="Samtaler"
          value={fmt.format(now.calls.total)}
          change={<Change now={now.calls.total} before={before.calls.total} comparison={comparison} format={(v) => fmt.format(v)} />}
          note={`${hours >= 10 ? Math.round(hours) : decimal.format(hours)} timer opptak`}
        />
        <Stat
          label="Brudd"
          value={share(now.calls.red, now.calls.analyzed)}
          change={
            <Change
              now={percent(now.calls.red, now.calls.analyzed)}
              before={percent(before.calls.red, before.calls.analyzed)}
              comparison={comparison}
              format={(v) => `${v} %`}
              points
            />
          }
          note={`${fmt.format(now.calls.red)} brudd og ${fmt.format(now.calls.yellow)} avvik`}
        />
        <Stat
          label="Ubehandlede flagg"
          value={fmt.format(now.calls.unreviewed)}
          note={
            now.calls.unreviewed > 0 ? (
              <button type="button" className="font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                Vis dem
              </button>
            ) : (
              "Alle er behandlet"
            )
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Selgerne">
          {sellers.error ? <ErrorMessage message={sellers.error} /> : !sellers.data ? <p className="text-muted">Laster …</p> : people.length ? <SellerBars sellers={people} /> : <p className="text-muted">Ingen selgere i perioden.</p>}
        </Card>
        <Card title="Trenger oppfølging">
          {sellers.data ? <FollowUp sellers={people} /> : <p className="text-muted">Laster …</p>}
        </Card>
      </div>

      {people.length > 0 && sellers.data && (
        <Card title={sellers.data.days.length > 31 ? "Aktivitet per uke" : "Aktivitet per dag"}>
          <ActivityHeatmap days={sellers.data.days} sellers={people} />
        </Card>
      )}

      <FlagCard data={now} flagFilter={flag} onFlag={onFlag} />
      <TrendCard data={now} />
      <FindingsCard data={now} />
    </div>
  );
}
