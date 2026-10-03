"use client";

import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass } from "@/components/admin/field";
import { Coaching } from "@/components/work/coaching";
import type { FlagFilter } from "@/components/work/flag-charts";
import { MyDashboard, TeamLevel } from "@/components/work/level-dashboards";
import { PeriodCalls } from "@/components/work/period-calls";
import { PeriodPicker, useStoredPeriod } from "@/components/work/period-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { canSeeCalls } from "@/lib/calls";
import { canSeeDashboard, type Dashboard } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// A dashboard for each level (docs/plan.md, section 15): Meg for everyone, Teamet with
// dashboard.team (or dashboard.all), Callsenteret with dashboard.all. The choice is remembered
// on the device; the first time, leaders start with what they lead.
type Level = "me" | "team" | "all";

const LEVEL_KEY = "veriqall.oversikt.niva";

function storedLevel(): Level | null {
  try {
    const value = localStorage.getItem(LEVEL_KEY);
    return value === "me" || value === "team" || value === "all" ? value : null;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const me = useWorkMe();
  const [period, setPeriod] = useStoredPeriod();
  const [flag, setFlag] = useState<FlagFilter>("all");
  const [access, setAccess] = useState<{ teams: { id: string; name: string }[]; canSeeAll: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const visible = me ? canSeeDashboard(me) : false;

  // Which teams the user may look at (all of them with dashboard.all, otherwise their own).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    orgFetch<Dashboard>(`/dashboard?${new URLSearchParams({ from: period.to, to: period.to })}`)
      .then((d) => {
        if (cancelled) return;
        setAccess({ teams: d.teams, canSeeAll: d.canSeeAll });
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [visible, period.to]);

  const teams = access?.teams ?? [];
  const canSeeAll = access?.canSeeAll ?? false;
  const levels: { key: Level; label: string }[] = [{ key: "me", label: "Meg" }];
  if (teams.length) levels.push({ key: "team", label: teams.length === 1 && !canSeeAll ? `Team ${teams[0]!.name}` : "Teamet" });
  if (canSeeAll) levels.push({ key: "all", label: "Callsenteret" });

  // The first time: the highest level the user has. Later: the last one chosen on this device.
  if (access && level === null) {
    const saved = storedLevel();
    const allowed = (l: Level) => levels.some((x) => x.key === l);
    setLevel(saved && allowed(saved) ? saved : canSeeAll ? "all" : teams.length ? "team" : "me");
  }
  if (teams.length && (team === null || !teams.some((t) => t.id === team))) setTeam(teams[0]!.id);

  const choose = (next: Level) => {
    setLevel(next);
    setFlag("all");
    try {
      localStorage.setItem(LEVEL_KEY, next);
    } catch {
      // Not remembered; the choice still applies on this page.
    }
  };

  // A flag chosen in a chart lists those calls below it.
  const pickFlag = (f: FlagFilter) => {
    setFlag(f);
    document.getElementById("samtaler-i-perioden")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!visible) return <NoAccess text="Dashboard og coaching er ikke slått på for callsenteret." />;

  const shown: Level = level && levels.some((l) => l.key === level) ? level : "me";
  const teamName = teams.find((t) => t.id === team)?.name;
  const scope = shown === "me" ? { userId: me!.user.id } : shown === "team" ? { teamId: team ?? undefined } : {};

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Oversikt</h1>
          <p className="mt-2 text-muted">
            {period.from === period.to ? formatDate(period.from) : `${formatDate(period.from)}–${formatDate(period.to)}`}.{" "}
            {shown === "me" ? "Dine egne tall." : shown === "team" ? `Team ${teamName ?? ""}.` : "Hele callsenteret."} Tallene viser
            antall, ikke innhold.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {shown === "team" && teams.length > 1 && (
            <Field label="Team">
              <select className={inputClass} value={team ?? ""} onChange={(e) => setTeam(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {levels.length > 1 && (
        <div role="tablist" aria-label="Nivå" className="-mt-4 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
          {levels.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={shown === l.key}
              onClick={() => choose(l.key)}
              className={`min-h-11 shrink-0 border-b-2 px-4 font-semibold whitespace-nowrap ${
                shown === l.key ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <ErrorMessage message={error} />
      {!access ? (
        !error && <p className="text-muted">Laster …</p>
      ) : shown === "me" ? (
        <MyDashboard from={period.from} to={period.to} flag={flag} onFlag={pickFlag} />
      ) : shown === "team" && team ? (
        <TeamLevel key={team} team={team} from={period.from} to={period.to} flag={flag} onFlag={pickFlag} />
      ) : (
        <TeamLevel key="all" team={null} from={period.from} to={period.to} flag={flag} onFlag={pickFlag} />
      )}

      {me && access && canSeeCalls(me) && (
        <div id="samtaler-i-perioden" className="scroll-mt-4">
          <PeriodCalls from={period.from} to={period.to} scope={scope} filter={flag} onFilter={setFlag} />
        </div>
      )}
      {me && shown === "me" && <Coaching sellerId={me.user.id} title="Tilbakemeldinger til deg" />}
    </section>
  );
}
