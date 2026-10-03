"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/admin/card";
import { ColumnChart, type Point } from "@/components/admin/charts";
import { Flag } from "@/components/flag";
import { type FlagColumn, FlagBar, FlagColumns, type FlagFilter } from "@/components/work/flag-charts";
import { type Dashboard, formatNumber, formatWholeKroner, share, shortDay } from "@/lib/dashboard";
import { formatTagNow } from "@/lib/format";

type ChartText = ReturnType<typeof useTranslations<"dashboard.charts">>;

// Days as columns; longer periods are summed per week, so the columns stay readable.
export function series(daily: Dashboard["daily"], key: "sales" | "calls"): Point[] {
  const label = shortDay;
  if (daily.length <= 45) return daily.map((d) => ({ label: label(d.day), value: d[key] }));
  const weeks: Point[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    weeks.push({ label: label(chunk[0]!.day), value: chunk.reduce((sum, d) => sum + d[key], 0) });
  }
  return weeks;
}

// The flags over the period: hour by hour for one day, per day up to 45 days, then per week.
// t: the texts in dashboard.charts.
export function flagColumns(data: Dashboard, t: ChartText): { title: string; columns: FlagColumn[] } {
  const unchecked = (x: { calls: number; green: number; yellow: number; red: number }) => Math.max(0, x.calls - x.green - x.yellow - x.red);
  if (data.hourly.length) {
    const used = data.hourly.filter((h) => h.calls > 0).map((h) => h.hour);
    const first = Math.min(8, ...used);
    const last = Math.max(17, ...used);
    return {
      title: t("perHour"),
      columns: data.hourly
        .filter((h) => h.hour >= first && h.hour <= last)
        .map((h) => ({
          label: String(h.hour).padStart(2, "0"),
          title: t("hour", { hour: String(h.hour).padStart(2, "0") }),
          ...h,
          unchecked: unchecked(h),
        })),
    };
  }
  const label = shortDay;
  const longDay = new Intl.DateTimeFormat(formatTagNow(), { day: "numeric", month: "long", timeZone: "UTC" });
  const title = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`));
  if (data.daily.length <= 45) {
    return {
      title: t("perDay"),
      columns: data.daily.map((d) => ({ label: label(d.day), title: title(d.day), ...d, unchecked: unchecked(d) })),
    };
  }
  const columns: FlagColumn[] = [];
  for (let i = 0; i < data.daily.length; i += 7) {
    const chunk = data.daily.slice(i, i + 7);
    const sum = (k: "calls" | "green" | "yellow" | "red") => chunk.reduce((n, d) => n + d[k], 0);
    const week = { calls: sum("calls"), green: sum("green"), yellow: sum("yellow"), red: sum("red") };
    columns.push({ label: label(chunk[0]!.day), title: t("weekFrom", { day: title(chunk[0]!.day) }), ...week, unchecked: unchecked(week) });
  }
  return { title: t("perWeek"), columns };
}

export function Stat({ label, value, note, change }: { label: string; value: string; note?: React.ReactNode; change?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-semibold">{value}</p>
      {change && <div className="mt-1 text-sm">{change}</div>}
      {note && <div className="mt-1 text-sm text-muted">{note}</div>}
    </div>
  );
}

// The AI flags of the period as one bar; a part lists those calls below.
export function FlagCard({ data, flagFilter, onFlag }: { data: Dashboard; flagFilter: FlagFilter; onFlag: (f: FlagFilter) => void }) {
  const t = useTranslations("dashboard.flagCard");
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3">
        <FlagBar
          counts={{
            green: data.calls.green,
            yellow: data.calls.yellow,
            red: data.calls.red,
            unchecked: Math.max(0, data.calls.total - data.calls.analyzed),
          }}
          selected={flagFilter}
          onSelect={onFlag}
        />
        {data.calls.total > 0 && (
          <p className="text-sm text-muted">
            {data.calls.analyzed ? `${t("withoutDeviation", { share: share(data.calls.green, data.calls.analyzed) })} ` : ""}
            {data.calls.unreviewed > 0 ? (
              <button type="button" className="font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                {t("unreviewed", { count: data.calls.unreviewed })}
              </button>
            ) : (
              t("allReviewed")
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

// Flags, sales and calls over the period.
export function TrendCard({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard.trend");
  const tCharts = useTranslations("dashboard.charts");
  if (data.calls.total === 0 && data.daily.length <= 1) return null;
  const over = flagColumns(data, tCharts);
  const perWeek = data.daily.length > 45;
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-10">
        {data.calls.total > 0 && <FlagColumns title={over.title} columns={over.columns} />}
        {data.daily.length > 1 && (
          <>
            <ColumnChart
              title={perWeek ? t("salesPerWeek") : t("salesPerDay")}
              points={series(data.daily, "sales")}
              unit={t("unitSales")}
            />
            <ColumnChart
              title={perWeek ? t("callsPerWeek") : t("callsPerDay")}
              points={series(data.daily, "calls")}
              unit={t("unitCalls")}
            />
          </>
        )}
      </div>
    </Card>
  );
}

// The points the AI control flagged most often: where coaching helps most.
export function FindingsCard({ data, title, intro }: { data: Dashboard; title?: string; intro?: string }) {
  const t = useTranslations("dashboard.findings");
  if (!data.findings.length) return null;
  return (
    <Card title={title ?? t("title")}>
      <p className="mb-4 text-sm text-muted">{intro ?? t("intro")}</p>
      <ul className="divide-y divide-line">
        {data.findings.map((f) => (
          <li key={f.label} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{f.label}</span>
            {f.red > 0 && <Flag level="violation">{t("violations", { count: formatNumber(f.red) })}</Flag>}
            {f.yellow > 0 && <Flag level="deviation">{t("deviations", { count: formatNumber(f.yellow) })}</Flag>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SellersTable({ data, sellerLinks }: { data: Dashboard; sellerLinks: boolean }) {
  const t = useTranslations("dashboard.sellers");
  if (!data.sellers.length) return null;
  return (
    <Card title={t("title")}>
      <div className="-mx-2 scroll-x">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th className="px-2 py-2 font-semibold">{t("name")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("sales")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("confirmed")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("calls")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("deviations")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("violations")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("complaints")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.sellers.map((p) => (
              <tr key={p.userId}>
                <td className="px-2 py-3">
                  {sellerLinks ? (
                    <Link href={`/oversikt/selgere/${p.userId}`} className="font-semibold text-brand">
                      {p.name}
                    </Link>
                  ) : (
                    p.name
                  )}
                </td>
                <td className="px-2 py-3 text-right">{formatNumber(p.sales)}</td>
                <td className="px-2 py-3 text-right">{share(p.confirmed, p.sales)}</td>
                <td className="px-2 py-3 text-right">{formatNumber(p.calls)}</td>
                <td className="px-2 py-3 text-right">{formatNumber(p.yellow)}</td>
                <td className="px-2 py-3 text-right">{formatNumber(p.red)}</td>
                <td className="px-2 py-3 text-right">{formatNumber(p.complaints)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DashboardView({
  data,
  sellerLinks,
  flagFilter,
  onFlag,
}: {
  data: Dashboard;
  sellerLinks: boolean;
  // The flag chosen in the chart, which filters the list of calls below it.
  flagFilter: FlagFilter;
  onFlag: (f: FlagFilter) => void;
}) {
  const t = useTranslations("dashboard.stats");
  const hours = data.calls.durationMs / 3_600_000;
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label={t("sales")} value={formatNumber(data.sales.total)} note={t("pending", { count: formatNumber(data.sales.pending) })} />
        <Stat
          label={t("confirmed")}
          value={share(data.sales.confirmed, data.sales.total)}
          note={t("confirmedNote", {
            confirmed: formatNumber(data.sales.confirmed),
            rejected: formatNumber(data.sales.rejected),
            withdrawn: formatNumber(data.sales.withdrawn),
          })}
        />
        <Stat
          label={t("monthlyValue")}
          value={formatWholeKroner(data.sales.revenueMonthly)}
          note={data.sales.revenueOnce ? t("oneOff", { amount: formatWholeKroner(data.sales.revenueOnce) }) : undefined}
        />
        <Stat
          label={t("calls")}
          value={formatNumber(data.calls.total)}
          note={t("hoursRecorded", { hours: hours >= 10 ? formatNumber(Math.round(hours)) : formatNumber(hours, oneDecimal) })}
        />
        <Stat
          label={t("complaints")}
          value={formatNumber(data.complaints.received)}
          note={t("complaintsNote", { count: formatNumber(data.complaints.open), scope: data.scope === "all" ? "all" : "selection" })}
        />
      </div>
      <FlagCard data={data} flagFilter={flagFilter} onFlag={onFlag} />
      <TrendCard data={data} />
      <FindingsCard data={data} />
      <SellersTable data={data} sellerLinks={sellerLinks} />
    </div>
  );
}
