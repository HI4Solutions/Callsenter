"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart } from "@/components/admin/charts";
import { ErrorMessage } from "@/components/admin/field";
import { FindingsCard, flagColumns, Stat } from "@/components/work/dashboard-view";
import { FlagColumns, type FlagFilter } from "@/components/work/flag-charts";
import { CHANNEL, type Channel } from "@/lib/complaints";
import { type Dashboard, formatDecimal, formatNumber, type QualityDashboard, share, shortDay } from "@/lib/dashboard";
import { orgFetch } from "@/lib/org";

// Kvalitet (docs/plan.md, section 15): for compliance, who sees the whole call centre and reviews
// flags or complaints. The queue of flags now, deviations per product and seller, complaints,
// customer acceptance and, with audit.read, who opened recordings. Counts only, never content.

const DAY_MS = 86_400_000;

function useBoth(from: string, to: string) {
  const key = `${from}|${to}`;
  // at: when the answer came, to tell how long the oldest flag has waited.
  const [result, setResult] = useState<{ key: string; quality?: QualityDashboard; all?: Dashboard; at?: number; error?: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from, to });
    Promise.all([orgFetch<QualityDashboard>(`/dashboard/quality?${params}`), orgFetch<Dashboard>(`/dashboard?${params}&scope=all`)])
      .then(([quality, all]) => !cancelled && setResult({ key, quality, all, at: Date.now() }))
      .catch((e: Error) => !cancelled && setResult({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, from, to]);
  return result?.key === key ? result : null;
}

// Horizontal bars in the brand colour, with the figure to the right. The bar has its own track,
// so a long figure never pushes the row wider than the card.
function Bars({ rows }: { rows: { label: string; value: number; text?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
        >
          <span className="text-sm">{r.label}</span>
          <span className="min-w-0" aria-hidden="true">
            <span
              className="block h-3.5 rounded-r bg-brand"
              style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? "3px" : "0" }}
            />
          </span>
          <span className="text-right text-sm whitespace-nowrap">{r.text ?? formatNumber(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// One product: breaches and deviations as parts of the calls checked (the AI flag colours).
function ProductRow({ p }: { p: QualityDashboard["products"][number] }) {
  const t = useTranslations("dashboard.quality");
  const rest = Math.max(0, p.checked - p.red - p.yellow);
  const part = (n: number) => `${(n / Math.max(1, p.checked)) * 100}%`;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold [overflow-wrap:anywhere]">{p.name}</span>
        <span className="text-sm text-muted">
          {t("flaggedNote", { red: formatNumber(p.red), yellow: formatNumber(p.yellow), checked: formatNumber(p.checked) })}
        </span>
      </div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {p.red > 0 && <span style={{ width: part(p.red), background: "var(--flag-violation)" }} />}
        {p.yellow > 0 && <span style={{ width: part(p.yellow), background: "var(--flag-deviation)" }} />}
        {rest > 0 && <span style={{ width: part(rest), background: "color-mix(in srgb, var(--muted) 30%, var(--surface))" }} />}
      </div>
    </li>
  );
}

export function QualityDashboard({ from, to, onFlag }: { from: string; to: string; flag: FlagFilter; onFlag: (f: FlagFilter) => void }) {
  const t = useTranslations("dashboard.quality");
  const tCharts = useTranslations("dashboard.charts");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const result = useBoth(from, to);
  if (result?.error) return <ErrorMessage message={result.error} />;
  if (!result?.quality || !result.all) return <p className="text-muted">{tc("loading")}</p>;
  const q = result.quality;
  const all = result.all;
  const flagged = q.flags.red + q.flags.yellow;
  const oldestDays = q.flags.oldestOpenAt ? Math.floor(((result.at ?? 0) - Date.parse(q.flags.oldestOpenAt)) / DAY_MS) : null;
  const over = flagColumns(all, tCharts);
  const c = q.complaints;
  const k = q.confirmations;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat
          label={t("openNow")}
          value={formatNumber(q.flags.open)}
          note={q.flags.open === 0 ? t("noneWaiting") : oldestDays === 0 ? t("oldestToday") : t("oldestDays", { count: oldestDays ?? 0 })}
        />
        <Stat
          label={t("reviewed")}
          value={formatNumber(q.flags.reviewed)}
          note={q.flags.medianHoursToReview === null ? undefined : t("medianHours", { hours: formatDecimal(q.flags.medianHoursToReview) })}
        />
        <Stat
          label={t("flagged")}
          value={share(flagged, q.flags.checked)}
          note={t("flaggedNote", {
            red: formatNumber(q.flags.red),
            yellow: formatNumber(q.flags.yellow),
            checked: formatNumber(q.flags.checked),
          })}
        />
        {c && (
          <Stat
            label={t("complaintsReceived")}
            value={formatNumber(c.received)}
            note={t("openNowNote", { count: formatNumber(c.openNow) })}
          />
        )}
        {k && (
          <Stat
            label={t("acceptance")}
            value={t("acceptedOf", { accepted: formatNumber(k.accepted), sent: formatNumber(k.sent) })}
            note={k.identityMismatch ? t("mismatchNote", { count: formatNumber(k.identityMismatch) }) : t("allMatchedNote")}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title={t("queue.title")}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{t("queue.intro")}</p>
            <Bars
              rows={[
                { label: t("queue.underDay"), value: q.flags.openByAge.day },
                { label: t("queue.days1to3"), value: q.flags.openByAge.days3 },
                { label: t("queue.days3to7"), value: q.flags.openByAge.week },
                { label: t("queue.overWeek"), value: q.flags.openByAge.older },
              ]}
            />
            {all.calls.unreviewed > 0 && (
              <button type="button" className="self-start font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                {t("queue.showPeriod", { count: formatNumber(all.calls.unreviewed) })}
              </button>
            )}
          </div>
        </Card>
        <Card title={t("products.title")}>
          {q.products.length ? (
            <ul className="divide-y divide-line">
              {q.products.map((p) => (
                <ProductRow key={p.name} p={p} />
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("products.none")}</p>
          )}
        </Card>
      </div>

      {all.calls.total > 0 && (
        <Card title={t("overTime")}>
          <FlagColumns title={over.title} columns={over.columns} />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title={t("sellers.title")}>
          {q.sellers.length ? (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left">
                <thead className="text-sm text-muted">
                  <tr>
                    <th className="px-2 py-2 font-semibold">{t("sellers.name")}</th>
                    <th className="px-2 py-2 text-right font-semibold">{t("sellers.checked")}</th>
                    <th className="px-2 py-2 text-right font-semibold">{t("sellers.deviations")}</th>
                    <th className="px-2 py-2 text-right font-semibold">{t("sellers.violations")}</th>
                    <th className="px-2 py-2 text-right font-semibold">{t("sellers.redShare")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.sellers.map((s) => (
                    <tr key={s.userId}>
                      <td className="px-2 py-3">
                        <Link href={`/oversikt/selgere/${s.userId}`} className="font-semibold text-brand">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-2 py-3 text-right">{formatNumber(s.checked)}</td>
                      <td className="px-2 py-3 text-right">{formatNumber(s.yellow)}</td>
                      <td className="px-2 py-3 text-right">{formatNumber(s.red)}</td>
                      <td className="px-2 py-3 text-right">{share(s.red, s.checked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">{t("sellers.none")}</p>
          )}
        </Card>
        <FindingsCard data={all} />
      </div>

      {c && (
        <Card title={t("complaints.title")}>
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {(Object.keys(c.byStatus) as (keyof typeof c.byStatus)[]).map((status) => (
                <div key={status}>
                  <dt className="text-sm text-muted">{td(`complaintStatus.${status}`)}</dt>
                  <dd className="text-xl font-semibold">{formatNumber(c.byStatus[status])}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">
              {t("complaints.received")}
              {c.medianDaysToClose !== null && ` ${t("complaints.medianDays", { days: formatDecimal(c.medianDaysToClose) })}`}
              {Object.keys(c.byChannel).length > 0 &&
                ` ${t("complaints.channels", {
                  list: Object.entries(c.byChannel)
                    .map(([channel, n]) => `${channel in CHANNEL ? td(`channel.${channel as Channel}`) : channel} ${formatNumber(n)}`)
                    .join(", "),
                })}`}
            </p>
            {c.weekly.length > 1 && (
              <ColumnChart
                title={t("complaints.perWeek")}
                points={c.weekly.map((w) => ({ label: shortDay(w.week), value: w.received }))}
                unit={t("complaints.unit")}
              />
            )}
          </div>
        </Card>
      )}

      {k && (
        <Card title={t("acceptanceCard.title")}>
          <div className="flex flex-col gap-4">
            <Bars
              rows={[
                { label: t("acceptanceCard.bankid"), value: k.bankid },
                { label: t("acceptanceCard.vipps"), value: k.vipps },
                { label: t("acceptanceCard.rejected"), value: k.rejected },
                { label: t("acceptanceCard.pending"), value: k.pending },
                { label: t("acceptanceCard.expired"), value: k.expired },
                { label: t("acceptanceCard.revoked"), value: k.revoked },
              ]}
            />
            <p className="text-sm text-muted">
              {t("acceptanceCard.sent", { count: formatNumber(k.sent) })}{" "}
              {k.identityMismatch > 0
                ? t("acceptanceCard.mismatch", { count: formatNumber(k.identityMismatch) })
                : t("acceptanceCard.allMatched")}
            </p>
          </div>
        </Card>
      )}

      {q.access && (
        <Card title={t("access.title")}>
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-muted">{t("access.views")}</dt>
                <dd className="text-xl font-semibold">{formatNumber(q.access.views)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("access.plays")}</dt>
                <dd className="text-xl font-semibold">{formatNumber(q.access.plays)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("access.downloads")}</dt>
                <dd className="text-xl font-semibold">{formatNumber(q.access.downloads)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("access.searches")}</dt>
                <dd className="text-xl font-semibold">{formatNumber(q.access.searches)}</dd>
              </div>
            </dl>
            {q.access.users.length > 0 && (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-left">
                  <caption className="px-2 pb-2 text-left text-sm text-muted">{t("access.caption")}</caption>
                  <thead className="text-sm text-muted">
                    <tr>
                      <th className="px-2 py-2 font-semibold">{t("access.name")}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t("access.views")}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t("access.plays")}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t("access.searches")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.access.users.map((u) => (
                      <tr key={u.userId}>
                        <td className="px-2 py-3">{u.name}</td>
                        <td className="px-2 py-3 text-right">{formatNumber(u.views)}</td>
                        <td className="px-2 py-3 text-right">{formatNumber(u.plays)}</td>
                        <td className="px-2 py-3 text-right">{formatNumber(u.searches)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
