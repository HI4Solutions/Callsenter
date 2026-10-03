"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { LOCALES, isModuleKey } from "@veriqall/shared";
import { Card } from "@/components/admin/card";
import { LoadState } from "@/components/admin/field";
import { useMe } from "@/components/org/org-shell";
import { formatDate } from "@/lib/format";
import { orgFetch, type OrgSummary } from "@/lib/org";

// The call centre admin's overview (docs/plan.md, section 11): users and how they log in, teams,
// this month's activity and usage, invoices and modules. Counts only.

// Number formats in the page language.
function useNumbers() {
  const tag = LOCALES[useLocale()].tag;
  return useMemo(
    () => ({
      fmt: new Intl.NumberFormat(tag),
      decimal: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
      kroner: new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      month: new Intl.DateTimeFormat(tag, { month: "long" }),
    }),
    [tag],
  );
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

// Horizontal bars in the brand colour, with the figure to the right. The bar has its own track,
// so a long figure never pushes the row wider than the card.
function Bars({ rows }: { rows: { label: string; value: number; text?: string }[] }) {
  const { fmt } = useNumbers();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
        >
          <span className="truncate text-sm" title={r.label}>
            {r.label}
          </span>
          <span className="min-w-0" aria-hidden="true">
            <span className="block h-3.5 rounded-r bg-brand" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? "3px" : "0" }} />
          </span>
          <span className="text-right text-sm whitespace-nowrap">{r.text ?? fmt.format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function subscription(o: OrgSummary["organization"], t: ReturnType<typeof useTranslations<"org.overview">>): string {
  if (o.status === "suspended") return t("subscription.suspended");
  if (o.accessUntil) return t("subscription.accessUntil", { date: formatDate(o.accessUntil) });
  if (o.trialEndsAt) return t("subscription.trialUntil", { date: formatDate(o.trialEndsAt) });
  return t("subscription.active");
}

export default function OrgOverviewPage() {
  const me = useMe();
  const t = useTranslations("org.overview");
  const td = useTranslations("domain");
  const { fmt, decimal, kroner, month: monthFormat } = useNumbers();
  const [data, setData] = useState<OrgSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgFetch<OrgSummary>("/summary")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <LoadState error={error} />;
  const m = data.members;
  const share = (n: number) => (m.active ? t("share", { count: fmt.format(n), total: fmt.format(m.active) }) : fmt.format(n));
  const month = monthFormat.format(new Date());

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro", { name: data.organization.name, subscription: subscription(data.organization, t) })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("activeUsers")} value={fmt.format(m.active)} note={t("loggedIn7", { count: fmt.format(m.loggedIn7) })} />
        <Stat
          label={t("awaitingFirstLogin")}
          value={fmt.format(m.invited)}
          note={
            m.invitationsExpired
              ? t("invitationsExpired", { count: fmt.format(m.invitationsExpired) })
              : t("invitationsPending", { count: fmt.format(m.invitationsPending) })
          }
        />
        <Stat
          label={t("inactive30")}
          value={fmt.format(m.inactive30)}
          note={m.disabled ? t("disabled", { count: fmt.format(m.disabled) }) : undefined}
        />
        {data.invoices ? (
          <Stat
            label={t("unpaid")}
            value={t("amount", { amount: kroner.format(data.invoices.unpaidAmount) })}
            note={
              data.invoices.overdue
                ? t("overdueInvoices", { count: data.invoices.overdue })
                : data.invoices.nextDue
                  ? t("nextDue", { date: formatDate(data.invoices.nextDue) })
                  : t("nothingOverdue")
            }
          />
        ) : (
          <Stat label={t("transcribedIn", { month })} value={t("hours", { hours: decimal.format(data.usage.month.hours) })} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card
          title={t("login.title")}
          actions={
            <Link href="/administrasjon/brukere" className="font-semibold text-brand">
              {t("login.link")}
            </Link>
          }
        >
          <div className="flex flex-col gap-4">
            <Bars
              rows={[
                { label: "BankID", value: m.bankid, text: share(m.bankid) },
                { label: "Vipps", value: m.vipps, text: share(m.vipps) },
                { label: t("login.passkey"), value: m.passkey, text: share(m.passkey) },
              ]}
            />
            <p className="text-sm text-muted">{t("login.note")}</p>
          </div>
        </Card>
        <Card
          title={t("teams.title")}
          actions={
            <Link href="/administrasjon/team" className="font-semibold text-brand">
              {t("teams.link")}
            </Link>
          }
        >
          {data.teams.teams.length ? (
            <div className="flex flex-col gap-4">
              <Bars rows={data.teams.teams.map((t) => ({ label: t.name, value: t.members }))} />
              <p className="text-sm text-muted">{t("teams.note")}</p>
              {data.teams.withoutTeam > 0 && (
                <p className="text-sm text-muted">{t("teams.withoutTeam", { count: fmt.format(data.teams.withoutTeam) })}</p>
              )}
            </div>
          ) : (
            <p className="text-muted">{t("teams.empty")}</p>
          )}
        </Card>
      </div>

      {data.activity && data.activity.length > 0 && (
        <Card title={t("activity.title", { month })}>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold">{t("activity.team")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("activity.calls")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("activity.sales")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("activity.confirmed")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.activity.map((a) => (
                  <tr key={a.teamId ?? "none"}>
                    <td className="px-2 py-3">{a.name ?? t("activity.noTeam")}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.calls)}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.sales)}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.confirmed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            {t.rich("activity.more", {
              link: (chunks) => (
                <Link href="/oversikt" className="font-semibold text-brand">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title={t("usage.title")}>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold" />
                  <th className="px-2 py-2 text-right font-semibold">{t("usage.thisMonth")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("usage.previousMonth")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-2 py-3">{t("usage.hours")}</td>
                  <td className="px-2 py-3 text-right">{decimal.format(data.usage.month.hours)}</td>
                  <td className="px-2 py-3 text-right">{decimal.format(data.usage.previous.hours)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-3">{t("usage.controls")}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.month.controls)}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.previous.controls)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-3">{t("usage.notes")}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.month.notes)}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.previous.notes)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">{t("usage.note")}</p>
        </Card>
        <Card
          title={t("roles.title")}
          actions={
            me?.permissions.includes("roles.manage") ? (
              <Link href="/administrasjon/roller" className="font-semibold text-brand">
                {t("roles.link")}
              </Link>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {data.roles.map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-4 py-2">
                <span>{r.name}</span>
                <span className="text-muted">{fmt.format(r.members)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {data.invoices && (
          <Card
            title={t("invoices.title")}
            actions={
              <Link href="/administrasjon/fakturaer" className="font-semibold text-brand">
                {t("invoices.link")}
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-sm text-muted">{t("invoices.unpaid")}</dt>
                <dd className="text-xl font-semibold">{fmt.format(data.invoices.unpaid)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("invoices.overdue")}</dt>
                <dd className="text-xl font-semibold">{fmt.format(data.invoices.overdue)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("invoices.nextDue")}</dt>
                <dd className="text-xl font-semibold">{data.invoices.nextDue ? formatDate(data.invoices.nextDue) : "–"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t("invoices.lastPaid")}</dt>
                <dd className="text-xl font-semibold">{data.invoices.lastPaidAt ? formatDate(data.invoices.lastPaidAt) : "–"}</dd>
              </div>
            </dl>
          </Card>
        )}
        <Card title={t("modules.title")}>
          {data.modules.length ? (
            <ul className="flex flex-wrap gap-2">
              {data.modules.map((key) => (
                <li key={key} className="rounded-full border border-line px-3 py-1 text-sm">
                  {isModuleKey(key) ? td(`modules.${key}.name`) : key}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("modules.empty")}</p>
          )}
          <p className="mt-3 text-sm text-muted">{t("modules.note")}</p>
        </Card>
      </div>
    </section>
  );
}
