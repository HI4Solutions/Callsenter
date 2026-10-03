"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/admin/field";
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

// One seller's numbers and feedback, for their leader (or the seller themself).
export default function SellerPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const me = useWorkMe();
  const [period, setPeriod] = useStoredPeriod();
  const [flag, setFlag] = useState<FlagFilter>("all");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = me ? canSeeDashboard(me) : false;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams({ scope: "seller", target: id, from: period.from, to: period.to });
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
  }, [id, period.from, period.to, visible]);

  if (!visible) return <NoAccess text={t("page.notEnabled")} />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/oversikt" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
            {t("seller.back")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{data?.targetName ?? t("seller.fallbackName")}</h1>
          {data && (
            <p className="mt-2 text-muted">
              {formatDate(data.from)}–{formatDate(data.to)}
            </p>
          )}
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <ErrorMessage message={error} />
      {!data ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : (
        <DashboardView data={data} sellerLinks={false} flagFilter={flag} onFlag={setFlag} />
      )}
      {me && data && canSeeCalls(me) && (
        <PeriodCalls from={data.from} to={data.to} scope={{ userId: id }} filter={flag} onFilter={setFlag} />
      )}
      {data && <Coaching sellerId={id} sellerName={data.targetName} />}
    </section>
  );
}
