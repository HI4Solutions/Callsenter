"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart } from "@/components/admin/charts";
import { LoadState } from "@/components/admin/field";
import {
  adminFetch,
  attention,
  formatDate,
  type PlatformOverview,
  useLocaleTag,
  waitedMinutes as waited,
} from "@/lib/admin";

// Superadmin → Oversikt (docs/plan.md, section 10): the whole platform at a glance, and what
// needs attention now. Counts only, never content.

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold sm:text-3xl">{value}</p>
      {note && <div className="mt-1 text-sm text-muted">{note}</div>}
    </div>
  );
}

// Figures in a grid of label and value, two per row on a phone.
function Figures({
  rows,
}: {
  rows: { label: string; value: string; note?: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-sm text-muted">{r.label}</dt>
          <dd className="text-xl font-semibold">{r.value}</dd>
          {r.note && <dd className="text-sm text-muted">{r.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// Horizontal bars in the brand colour, with the figure to the right. The bar has its own track,
// so a long figure never pushes the row wider than the card.
function Bars({
  rows,
}: {
  rows: { label: string; value: number; text?: string }[];
}) {
  const fmt = new Intl.NumberFormat(useLocaleTag());
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]"
        >
          <span className="truncate text-sm" title={r.label}>
            {r.label}
          </span>
          <span className="min-w-0" aria-hidden="true">
            <span
              className="block h-3.5 rounded-r bg-brand"
              style={{
                width: `${(r.value / max) * 100}%`,
                minWidth: r.value > 0 ? "3px" : "0",
              }}
            />
          </span>
          <span className="text-right text-sm whitespace-nowrap">
            {r.text ?? fmt.format(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const CardLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <Link href={href} className="font-semibold text-brand">
    {children}
  </Link>
);

export default function PlatformOverviewPage() {
  const t = useTranslations("admin.overview");
  const tag = useLocaleTag();
  const fmt = new Intl.NumberFormat(tag);
  const decimal = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const kroner = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const kr = (n: number) => t("kroner", { amount: kroner.format(n) });
  // "3.10." under the axis, "fredag 3. oktober" in the tooltip and the table.
  const short = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  });
  const long = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const dayPoint = (day: string, value: number) => {
    const date = new Date(`${day}T00:00:00Z`);
    return { label: short.format(date), title: long.format(date), value };
  };
  // The time of the answer, for how long the queue has waited (not read while rendering).
  const [result, setResult] = useState<{
    data: PlatformOverview;
    at: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<PlatformOverview>("/overview")
      .then((data) => !cancelled && setResult({ data, at: Date.now() }))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) return <LoadState error={error} />;
  const { data: o, at } = result;
  const todayDate = new Date(`${o.today}T00:00:00Z`);
  const month = new Intl.DateTimeFormat(tag, {
    month: "long",
    timeZone: "UTC",
  }).format(todayDate);
  const items = attention(o, at);
  const methods = o.logins.byMethod;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">
          {t("intro", { date: long.format(todayDate) })}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label={t("openOrganizations")}
            value={fmt.format(o.organizations.open)}
            note={t("openOrganizationsNote", {
              trial: fmt.format(o.organizations.trial),
              count: o.organizations.newThisMonth,
              month,
            })}
          />
          <Stat
            label={t("activeUsers")}
            value={fmt.format(o.users.active)}
            note={t("loggedInToday", {
              count: fmt.format(o.users.loggedInToday),
            })}
          />
          <Stat
            label={t("callsToday")}
            value={fmt.format(o.calls.today)}
            note={t("last7Note", { count: fmt.format(o.calls.week) })}
          />
          <Stat
            label={t("mrr")}
            value={kr(o.money.mrr)}
            note={t("resultIn", { month, amount: kr(o.money.result) })}
          />
        </div>

        <Card title={t("attentionTitle")}>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <span>
                    {item.key === "overdue"
                      ? t("attention.overdue", {
                          amount: kroner.format(item.values.count),
                        })
                      : t(`attention.${item.key}`, item.values)}
                  </span>
                  {item.href && (
                    <CardLink href={item.href}>{t("seeMore")}</CardLink>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("nothingUrgent")}</p>
          )}
        </Card>

        <Card title={t("last30")}>
          <div className="grid gap-10 xl:grid-cols-2 xl:gap-8 [&>*]:min-w-0">
            <ColumnChart
              title={t("callsPerDay")}
              points={o.days.map((d) => dayPoint(d.day, d.calls))}
              unit={t("callsUnit")}
              labelHeading={t("day")}
            />
            <ColumnChart
              title={t("loginsPerDay")}
              points={o.days.map((d) => dayPoint(d.day, d.logins))}
              unit={t("loginsUnit")}
              labelHeading={t("day")}
            />
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card title={t("operations")}>
            <Figures
              rows={[
                { label: t("recording"), value: fmt.format(o.calls.recording) },
                {
                  label: t("processing"),
                  value: fmt.format(o.calls.processing),
                  note: o.calls.stuck
                    ? t("stuckNote", { count: fmt.format(o.calls.stuck) })
                    : undefined,
                },
                {
                  label: t("piecesWaiting"),
                  value: fmt.format(o.calls.piecesWaiting),
                  note: o.calls.oldestPieceAt
                    ? t("oldestWaited", {
                        minutes: fmt.format(waited(o.calls.oldestPieceAt, at)),
                      })
                    : undefined,
                },
                { label: t("failed7"), value: fmt.format(o.calls.failed7) },
                {
                  label: t("callsIn", { month }),
                  value: fmt.format(o.calls.month),
                },
                {
                  label: t("transcribedIn", { month }),
                  value: t("hours", { hours: decimal.format(o.usage.hours) }),
                },
                {
                  label: t("controlsIn", { month }),
                  value: fmt.format(o.usage.controls),
                },
                {
                  label: t("notesIn", { month }),
                  value: fmt.format(o.usage.notes),
                },
              ]}
            />
            <p className="mt-4 text-sm text-muted">{t("countedNote")}</p>
          </Card>
          <Card
            title={t("login")}
            actions={
              <CardLink href="/admin/sikkerhet">{t("securityLink")}</CardLink>
            }
          >
            <div className="flex flex-col gap-5">
              <Figures
                rows={[
                  { label: t("today"), value: fmt.format(o.logins.today) },
                  { label: t("last7"), value: fmt.format(o.logins.week) },
                  {
                    label: t("failed24h"),
                    value: fmt.format(o.logins.failed24h),
                  },
                  {
                    label: t("blockedIps"),
                    value: fmt.format(o.logins.blockedIps),
                  },
                ]}
              />
              <div>
                <h3 className="mb-3 font-semibold">{t("byMethod")}</h3>
                <Bars
                  rows={[
                    { label: "BankID", value: methods.bankid },
                    { label: "Vipps", value: methods.vipps },
                    { label: "Passkey", value: methods.passkey },
                  ]}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card
            title={t("mostActive", { month })}
            actions={
              <CardLink href="/admin/callsentre">
                {t("organizationsLink")}
              </CardLink>
            }
          >
            {o.organizations.mostActive.length ? (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-sm text-muted">
                    <tr>
                      <th className="px-2 py-2 font-semibold">
                        {t("organization")}
                      </th>
                      <th className="px-2 py-2 text-right font-semibold">
                        {t("calls")}
                      </th>
                      <th className="px-2 py-2 text-right font-semibold">
                        {t("loggedIn30")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {o.organizations.mostActive.map((a) => (
                      <tr key={a.id}>
                        <td className="px-2 py-3">
                          <Link
                            href={`/admin/callsentre/${a.id}`}
                            className="font-semibold text-brand"
                          >
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-right">
                          {fmt.format(a.calls)}
                        </td>
                        <td className="px-2 py-3 text-right">
                          {fmt.format(a.users30)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">{t("noCallsIn", { month })}</p>
            )}
          </Card>
          <div className="flex flex-col gap-4">
            <Card title={t("endingSoon")}>
              {o.organizations.ending.length ? (
                <ul className="divide-y divide-line">
                  {o.organizations.ending.map((e) => (
                    <li
                      key={`${e.kind}-${e.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                    >
                      <Link
                        href={`/admin/callsentre/${e.id}`}
                        className="font-semibold text-brand"
                      >
                        {e.name}
                      </Link>
                      <span className="text-sm text-muted">
                        {t(e.kind === "trial" ? "trialEnds" : "accessEnds", {
                          date: formatDate(e.endsAt),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">{t("noneEnding")}</p>
              )}
            </Card>
            <Card title={t("quiet")}>
              {o.organizations.quiet.length ? (
                <>
                  <ul className="divide-y divide-line">
                    {o.organizations.quiet.map((q) => (
                      <li key={q.id} className="flex flex-col gap-1 py-2">
                        <Link
                          href={`/admin/callsentre/${q.id}`}
                          className="font-semibold text-brand"
                        >
                          {q.name}
                        </Link>
                        <span className="text-sm text-muted">
                          {t("quietLast", {
                            call: q.lastCallAt
                              ? formatDate(q.lastCallAt)
                              : t("never"),
                            login: q.lastLoginAt
                              ? formatDate(q.lastLoginAt)
                              : t("never"),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-muted">{t("quietNote")}</p>
                </>
              ) : (
                <p className="text-muted">{t("noneQuiet")}</p>
              )}
            </Card>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card
            title={t("economy")}
            actions={
              <CardLink href="/admin/okonomi/regnskap">
                {t("accountingLink")}
              </CardLink>
            }
          >
            <Figures
              rows={[
                {
                  label: t("mrr"),
                  value: kr(o.money.mrr),
                  note: t("arr", { amount: kr(o.money.arr) }),
                },
                {
                  label: t("revenueIn", { month }),
                  value: kr(o.money.revenue),
                  note: t("revenueNote"),
                },
                { label: t("costsIn", { month }), value: kr(o.money.costs) },
                {
                  label: t("resultLabel", { month }),
                  value: kr(o.money.result),
                },
                { label: t("outstanding"), value: kr(o.money.outstanding) },
                { label: t("overdue"), value: kr(o.money.overdue) },
              ]}
            />
          </Card>
          <Card
            title={t("users")}
            actions={<CardLink href="/admin/brukere">{t("users")}</CardLink>}
          >
            <Figures
              rows={[
                { label: t("active"), value: fmt.format(o.users.active) },
                { label: t("loggedIn7"), value: fmt.format(o.users.loggedIn7) },
                { label: t("invited"), value: fmt.format(o.users.invited) },
                { label: t("new30"), value: fmt.format(o.users.new30) },
                { label: t("disabled"), value: fmt.format(o.users.disabled) },
              ]}
            />
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card
            title={t("organizationsLink")}
            actions={
              <CardLink href="/admin/callsentre">
                {t("organizationsLink")}
              </CardLink>
            }
          >
            <Figures
              rows={[
                { label: t("open"), value: fmt.format(o.organizations.open) },
                {
                  label: t("onTrial"),
                  value: fmt.format(o.organizations.trial),
                },
                {
                  label: t("paying"),
                  value: fmt.format(o.organizations.paying),
                },
                {
                  label: t("closed"),
                  value: fmt.format(o.organizations.closed),
                  note: t("closedNote"),
                },
                {
                  label: t("newIn", { month }),
                  value: fmt.format(o.organizations.newThisMonth),
                },
                { label: t("total"), value: fmt.format(o.organizations.total) },
              ]}
            />
          </Card>
          <Card
            title={t("messages")}
            actions={
              <CardLink href="/admin/meldinger">{t("messages")}</CardLink>
            }
          >
            <Figures
              rows={[
                {
                  label: t("unreadThreads"),
                  value: fmt.format(o.support.unread),
                },
                { label: t("openThreads"), value: fmt.format(o.support.open) },
                {
                  label: t("activeAnnouncements"),
                  value: fmt.format(o.support.announcements),
                },
              ]}
            />
          </Card>
        </div>
      </div>
    </section>
  );
}
