"use client";

import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass } from "@/components/admin/field";
import { Coaching } from "@/components/work/coaching";
import { DashboardView } from "@/components/work/dashboard-view";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { canSeeDashboard, type Dashboard, PERIODS, periodStart } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// Who the numbers are for: "me", "all", or a team id.
export default function DashboardPage() {
  const me = useWorkMe();
  const [view, setView] = useState("me");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = me ? canSeeDashboard(me) : false;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams({ from: periodStart(days) });
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
  }, [view, days, visible]);

  if (!visible) return <NoAccess text="Dashboard og coaching er ikke slått på for callsenteret." />;
  const choices = (data?.teams ?? []).map((t) => ({ value: t.id, label: `Team ${t.name}` }));

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Oversikt</h1>
          <p className="mt-2 text-muted">
            {data ? `${formatDate(data.from)}–${formatDate(data.to)}. ` : ""}
            Tallene viser antall, ikke innhold: samtalene åpnes bare med tilgang til dem.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(choices.length > 0 || data?.canSeeAll) && (
            <Field label="Vis">
              <select className={inputClass} value={view} onChange={(e) => setView(e.target.value)}>
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
          <Field label="Periode">
            <select className={inputClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((p) => (
                <option key={p.days} value={p.days}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <ErrorMessage message={error} />
      {!data ? !error && <p className="text-muted">Laster …</p> : <DashboardView data={data} sellerLinks />}
      {me && view === "me" && <Coaching sellerId={me.user.id} title="Tilbakemeldinger til deg" />}
    </section>
  );
}
