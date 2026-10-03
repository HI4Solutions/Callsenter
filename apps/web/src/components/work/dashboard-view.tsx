"use client";

import Link from "next/link";
import { Card } from "@/components/admin/card";
import { ColumnChart, type Point } from "@/components/admin/charts";
import { Flag } from "@/components/flag";
import { type FlagColumn, FlagBar, FlagColumns, type FlagFilter } from "@/components/work/flag-charts";
import { type Dashboard, share } from "@/lib/dashboard";

const fmt = new Intl.NumberFormat("nb-NO");
const kroner = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

// Days as columns; longer periods are summed per week, so the columns stay readable.
export function series(daily: Dashboard["daily"], key: "sales" | "calls"): Point[] {
  const label = (day: string) => {
    const [, m, d] = day.split("-");
    return `${Number(d)}.${Number(m)}.`;
  };
  if (daily.length <= 45) return daily.map((d) => ({ label: label(d.day), value: d[key] }));
  const weeks: Point[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    weeks.push({ label: label(chunk[0]!.day), value: chunk.reduce((sum, d) => sum + d[key], 0) });
  }
  return weeks;
}

const DAY = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", timeZone: "UTC" });

// The flags over the period: hour by hour for one day, per day up to 45 days, then per week.
export function flagColumns(data: Dashboard): { title: string; columns: FlagColumn[] } {
  const unchecked = (x: { calls: number; green: number; yellow: number; red: number }) => Math.max(0, x.calls - x.green - x.yellow - x.red);
  if (data.hourly.length) {
    const used = data.hourly.filter((h) => h.calls > 0).map((h) => h.hour);
    const first = Math.min(8, ...used);
    const last = Math.max(17, ...used);
    return {
      title: "AI-kontroll per time",
      columns: data.hourly
        .filter((h) => h.hour >= first && h.hour <= last)
        .map((h) => ({
          label: String(h.hour).padStart(2, "0"),
          title: `Kl. ${String(h.hour).padStart(2, "0")}`,
          ...h,
          unchecked: unchecked(h),
        })),
    };
  }
  const label = (day: string) => {
    const [, m, d] = day.split("-");
    return `${Number(d)}.${Number(m)}.`;
  };
  const title = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));
  if (data.daily.length <= 45) {
    return {
      title: "AI-kontroll per dag",
      columns: data.daily.map((d) => ({ label: label(d.day), title: title(d.day), ...d, unchecked: unchecked(d) })),
    };
  }
  const columns: FlagColumn[] = [];
  for (let i = 0; i < data.daily.length; i += 7) {
    const chunk = data.daily.slice(i, i + 7);
    const sum = (k: "calls" | "green" | "yellow" | "red") => chunk.reduce((n, d) => n + d[k], 0);
    const week = { calls: sum("calls"), green: sum("green"), yellow: sum("yellow"), red: sum("red") };
    columns.push({ label: label(chunk[0]!.day), title: `Uken fra ${title(chunk[0]!.day)}`, ...week, unchecked: unchecked(week) });
  }
  return { title: "AI-kontroll per uke", columns };
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
  return (
    <Card title="AI-kontroll">
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
            {data.calls.analyzed ? `${share(data.calls.green, data.calls.analyzed)} av de kontrollerte er uten avvik. ` : ""}
            {data.calls.unreviewed > 0 ? (
              <button type="button" className="font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                {fmt.format(data.calls.unreviewed)} flagg er ikke behandlet
              </button>
            ) : (
              "Alle flagg er behandlet."
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

// Flags, sales and calls over the period.
export function TrendCard({ data }: { data: Dashboard }) {
  if (data.calls.total === 0 && data.daily.length <= 1) return null;
  const over = flagColumns(data);
  const perWeek = data.daily.length > 45;
  return (
    <Card title="Utvikling">
      <div className="flex flex-col gap-10">
        {data.calls.total > 0 && <FlagColumns title={over.title} columns={over.columns} />}
        {data.daily.length > 1 && (
          <>
            <ColumnChart title={perWeek ? "Salg per uke" : "Salg per dag"} points={series(data.daily, "sales")} unit="salg" />
            <ColumnChart title={perWeek ? "Samtaler per uke" : "Samtaler per dag"} points={series(data.daily, "calls")} unit="samtaler" />
          </>
        )}
      </div>
    </Card>
  );
}

// The points the AI control flagged most often: where coaching helps most.
export function FindingsCard({ data, title = "Hyppigste avvik", intro }: { data: Dashboard; title?: string; intro?: string }) {
  if (!data.findings.length) return null;
  return (
    <Card title={title}>
      <p className="mb-4 text-sm text-muted">{intro ?? "Punktene AI-kontrollen oftest flagget. Det er her coaching gir mest."}</p>
      <ul className="divide-y divide-line">
        {data.findings.map((f) => (
          <li key={f.label} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{f.label}</span>
            {f.red > 0 && <Flag level="violation">Brudd: {fmt.format(f.red)}</Flag>}
            {f.yellow > 0 && <Flag level="deviation">Avvik: {fmt.format(f.yellow)}</Flag>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SellersTable({ data, sellerLinks }: { data: Dashboard; sellerLinks: boolean }) {
  if (!data.sellers.length) return null;
  return (
    <Card title="Selgere">
      <div className="-mx-2 scroll-x">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th className="px-2 py-2 font-semibold">Navn</th>
              <th className="px-2 py-2 text-right font-semibold">Salg</th>
              <th className="px-2 py-2 text-right font-semibold">Bekreftet</th>
              <th className="px-2 py-2 text-right font-semibold">Samtaler</th>
              <th className="px-2 py-2 text-right font-semibold">Avvik</th>
              <th className="px-2 py-2 text-right font-semibold">Brudd</th>
              <th className="px-2 py-2 text-right font-semibold">Klager</th>
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
                <td className="px-2 py-3 text-right">{fmt.format(p.sales)}</td>
                <td className="px-2 py-3 text-right">{share(p.confirmed, p.sales)}</td>
                <td className="px-2 py-3 text-right">{fmt.format(p.calls)}</td>
                <td className="px-2 py-3 text-right">{fmt.format(p.yellow)}</td>
                <td className="px-2 py-3 text-right">{fmt.format(p.red)}</td>
                <td className="px-2 py-3 text-right">{fmt.format(p.complaints)}</td>
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
  const hours = data.calls.durationMs / 3_600_000;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label="Salg" value={fmt.format(data.sales.total)} note={`${fmt.format(data.sales.pending)} venter på bekreftelse`} />
        <Stat
          label="Bekreftet"
          value={share(data.sales.confirmed, data.sales.total)}
          note={`${fmt.format(data.sales.confirmed)} bekreftet, ${fmt.format(data.sales.rejected)} avvist, ${fmt.format(data.sales.withdrawn)} angret`}
        />
        <Stat
          label="Bekreftet verdi per måned"
          value={`${kroner.format(data.sales.revenueMonthly)} kr`}
          note={data.sales.revenueOnce ? `+ ${kroner.format(data.sales.revenueOnce)} kr engangs` : undefined}
        />
        <Stat
          label="Samtaler"
          value={fmt.format(data.calls.total)}
          note={`${hours >= 10 ? Math.round(hours) : hours.toFixed(1).replace(".", ",")} timer opptak`}
        />
        <Stat
          label="Klager"
          value={fmt.format(data.complaints.received)}
          note={`${fmt.format(data.complaints.open)} åpne. ${data.scope === "all" ? "Alle i callsenteret." : "På salg i utvalget."}`}
        />
      </div>
      <FlagCard data={data} flagFilter={flagFilter} onFlag={onFlag} />
      <TrendCard data={data} />
      <FindingsCard data={data} />
      <SellersTable data={data} sellerLinks={sellerLinks} />
    </div>
  );
}
