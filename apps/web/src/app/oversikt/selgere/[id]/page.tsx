"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass } from "@/components/admin/field";
import { Coaching } from "@/components/work/coaching";
import { DashboardView } from "@/components/work/dashboard-view";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { canSeeDashboard, type Dashboard, PERIODS, periodStart } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// One seller's numbers and feedback, for their leader (or the seller themself).
export default function SellerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = me ? canSeeDashboard(me) : false;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams({ scope: "seller", target: id, from: periodStart(days) });
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
  }, [id, days, visible]);

  if (!visible) return <NoAccess text="Dashboard og coaching er ikke slått på for callsenteret." />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/oversikt" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
            ← Oversikt
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{data?.targetName ?? "Selger"}</h1>
          {data && (
            <p className="mt-2 text-muted">
              {formatDate(data.from)}–{formatDate(data.to)}
            </p>
          )}
        </div>
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
      <ErrorMessage message={error} />
      {!data ? !error && <p className="text-muted">Laster …</p> : <DashboardView data={data} sellerLinks={false} />}
      {data && <Coaching sellerId={id} sellerName={data.targetName} />}
    </section>
  );
}
