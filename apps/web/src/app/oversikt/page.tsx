"use client";

import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass } from "@/components/admin/field";
import { Coaching } from "@/components/work/coaching";
import { DashboardView } from "@/components/work/dashboard-view";
import type { FlagFilter } from "@/components/work/flag-charts";
import { PeriodCalls } from "@/components/work/period-calls";
import { PeriodPicker, useStoredPeriod } from "@/components/work/period-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { canSeeCalls } from "@/lib/calls";
import { canSeeDashboard, type Dashboard } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// Who the numbers are for: "me", "all", or a team id.
export default function DashboardPage() {
  const me = useWorkMe();
  const [view, setView] = useState("me");
  // Leaders start with what they lead: the whole call centre, or their team.
  const [chosen, setChosen] = useState(false);
  const [period, setPeriod] = useStoredPeriod();
  const [flag, setFlag] = useState<FlagFilter>("all");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = me ? canSeeDashboard(me) : false;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams({ from: period.from, to: period.to });
    if (view === "all") params.set("scope", "all");
    else if (view !== "me") {
      params.set("scope", "team");
      params.set("target", view);
    }
    orgFetch<Dashboard>(`/dashboard?${params}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [view, period.from, period.to, visible]);

  if (data && !chosen && view === "me" && (data.canSeeAll || data.teams.length === 1)) {
    setChosen(true);
    setView(data.canSeeAll ? "all" : data.teams[0]!.id);
  }

  if (!visible) return <NoAccess text="Dashboard og coaching er ikke slått på for callsenteret." />;
  const choices = (data?.teams ?? []).map((t) => ({ value: t.id, label: `Team ${t.name}` }));

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Oversikt</h1>
          <p className="mt-2 text-muted">
            {data ? `${data.from === data.to ? formatDate(data.from) : `${formatDate(data.from)}–${formatDate(data.to)}`}. ` : ""}
            Tallene viser antall, ikke innhold: samtalene åpnes bare med tilgang til dem.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(choices.length > 0 || data?.canSeeAll) && (
            <Field label="Vis">
              <select
                className={inputClass}
                value={view}
                onChange={(e) => {
                  setChosen(true);
                  setView(e.target.value);
                }}
              >
                <option value="me">Meg</option>
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                {data?.canSeeAll && <option value="all">Hele callsenteret</option>}
              </select>
            </Field>
          )}
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>
      <ErrorMessage message={error} />
      {!data ? (
        !error && <p className="text-muted">Laster …</p>
      ) : (
        <DashboardView
          data={data}
          sellerLinks
          flagFilter={flag}
          onFlag={(f) => {
            setFlag(f);
            document.getElementById("samtaler-i-perioden")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}
      {me && data && canSeeCalls(me) && (
        <div id="samtaler-i-perioden" className="scroll-mt-4">
          <PeriodCalls
            from={data.from}
            to={data.to}
            scope={view === "me" ? { userId: me.user.id } : view === "all" ? {} : { teamId: view }}
            filter={flag}
            onFilter={setFlag}
          />
        </div>
      )}
      {me && view === "me" && <Coaching sellerId={me.user.id} title="Tilbakemeldinger til deg" />}
    </section>
  );
}
