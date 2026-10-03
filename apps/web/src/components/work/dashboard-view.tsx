"use client";

import Link from "next/link";
import { Card } from "@/components/admin/card";
import { ColumnChart, type Point } from "@/components/admin/charts";
import { Flag } from "@/components/flag";
import { type Dashboard, share } from "@/lib/dashboard";

const fmt = new Intl.NumberFormat("nb-NO");
const kroner = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

// Days as columns; longer periods are summed per week, so the columns stay readable.
function series(daily: Dashboard["daily"], key: "sales" | "calls"): Point[] {
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

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-semibold">{value}</p>
      {note && <div className="mt-1 text-sm text-muted">{note}</div>}
    </div>
  );
}

export function DashboardView({ data, sellerLinks }: { data: Dashboard; sellerLinks: boolean }) {
  const hours = data.calls.durationMs / 3_600_000;
  const perWeek = data.daily.length > 45;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="AI-kontroll">
          {data.calls.analyzed === 0 ? (
            <p className="text-muted">Ingen kontrollerte samtaler i perioden.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Flag level="approved">Godkjent: {fmt.format(data.calls.green)}</Flag>
                <Flag level="deviation">Avvik: {fmt.format(data.calls.yellow)}</Flag>
                <Flag level="violation">Brudd: {fmt.format(data.calls.red)}</Flag>
              </div>
              <p className="text-sm text-muted">
                {fmt.format(data.calls.analyzed)} samtaler kontrollert, {share(data.calls.green, data.calls.analyzed)} uten avvik.
                {data.calls.unreviewed > 0 && ` ${fmt.format(data.calls.unreviewed)} flagg er ikke behandlet.`}
              </p>
            </div>
          )}
        </Card>
        <Card title="Klager">
          <p>
            <span className="text-3xl font-semibold">{fmt.format(data.complaints.received)}</span>{" "}
            <span className="text-muted">mottatt i perioden, {fmt.format(data.complaints.open)} fortsatt åpne</span>
          </p>
          <p className="mt-2 text-sm text-muted">
            {data.scope === "all" ? "Alle klager i callsenteret." : "Klager på salg i utvalget."}
          </p>
        </Card>
      </div>

      <Card title="Utvikling">
        <div className="flex flex-col gap-10">
          <ColumnChart title={perWeek ? "Salg per uke" : "Salg per dag"} points={series(data.daily, "sales")} unit="salg" />
          <ColumnChart title={perWeek ? "Samtaler per uke" : "Samtaler per dag"} points={series(data.daily, "calls")} unit="samtaler" />
        </div>
      </Card>

      {data.findings.length > 0 && (
        <Card title="Hyppigste avvik">
          <p className="mb-4 text-sm text-muted">Punktene AI-kontrollen oftest flagget. Det er her coaching gir mest.</p>
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
      )}

      {data.sellers.length > 0 && (
        <Card title="Selgere">
          <div className="-mx-2 overflow-x-auto">
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
      )}
    </div>
  );
}
