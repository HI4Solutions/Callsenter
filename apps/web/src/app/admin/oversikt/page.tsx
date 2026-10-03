"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart } from "@/components/admin/charts";
import { LoadState } from "@/components/admin/field";
import { adminFetch, attention, formatDate, type PlatformOverview, waitedMinutes as waited } from "@/lib/admin";

// Superadmin → Oversikt (docs/plan.md, section 10): the whole platform at a glance, and what
// needs attention now. Counts only, never content.

const fmt = new Intl.NumberFormat("nb-NO");
const decimal = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });
const kroner = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
const kr = (n: number) => `${kroner.format(n)} kr`;

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold sm:text-3xl">{value}</p>
      {note && <div className="mt-1 text-sm text-muted">{note}</div>}
    </div>
  );
}

// Figures in a grid of label and value, two per row on a phone.
function Figures({ rows }: { rows: { label: string; value: string; note?: string }[] }) {
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
function Bars({ rows }: { rows: { label: string; value: number; text?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]">
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

const CardLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="font-semibold text-brand">
    {children}
  </Link>
);

// "3.10." under the axis, "fredag 3. oktober" in the tooltip and the table.
const short = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayPoint = (day: string, value: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  return { label: short.format(date), title: long.format(date), value };
};

export default function PlatformOverviewPage() {
  // The time of the answer, for how long the queue has waited (not read while rendering).
  const [result, setResult] = useState<{ data: PlatformOverview; at: number } | null>(null);
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
  const month = new Intl.DateTimeFormat("nb-NO", { month: "long", timeZone: "UTC" }).format(todayDate);
  const items = attention(o, at);
  const methods = o.logins.byMethod;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Oversikt</h1>
        <p className="mt-2 text-muted">Status for hele plattformen, {long.format(todayDate)}. Bare antall, aldri innhold.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Åpne callsentre"
            value={fmt.format(o.organizations.open)}
            note={`${fmt.format(o.organizations.trial)} på prøve, ${fmt.format(o.organizations.newThisMonth)} ${o.organizations.newThisMonth === 1 ? "ny" : "nye"} i ${month}`}
          />
          <Stat label="Aktive brukere" value={fmt.format(o.users.active)} note={`${fmt.format(o.users.loggedInToday)} innlogget i dag`} />
          <Stat label="Samtaler i dag" value={fmt.format(o.calls.today)} note={`${fmt.format(o.calls.week)} siste 7 dager`} />
          <Stat label="MRR" value={kr(o.money.mrr)} note={`Resultat i ${month}: ${kr(o.money.result)}`} />
        </div>

        <Card title="Trenger oppmerksomhet">
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span>{item.text}</span>
                  {item.href && <CardLink href={item.href}>Se nærmere</CardLink>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Ingenting som haster akkurat nå.</p>
          )}
        </Card>

        <Card title="Siste 30 dager">
          <div className="grid gap-10 xl:grid-cols-2 xl:gap-8 [&>*]:min-w-0">
            <ColumnChart title="Samtaler per dag" points={o.days.map((d) => dayPoint(d.day, d.calls))} unit="samtaler" labelHeading="Dag" />
            <ColumnChart
              title="Vellykkede innlogginger per dag"
              points={o.days.map((d) => dayPoint(d.day, d.logins))}
              unit="innlogginger"
              labelHeading="Dag"
            />
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card title="Drift">
            <Figures
              rows={[
                { label: "Opptak pågår", value: fmt.format(o.calls.recording) },
                {
                  label: "Under behandling",
                  value: fmt.format(o.calls.processing),
                  note: o.calls.stuck ? `${fmt.format(o.calls.stuck)} i over 30 min` : undefined,
                },
                {
                  label: "Lydbiter i kø",
                  value: fmt.format(o.calls.piecesWaiting),
                  note: o.calls.oldestPieceAt ? `Den eldste har ventet ${fmt.format(waited(o.calls.oldestPieceAt, at))} min` : undefined,
                },
                { label: "Feilet siste 7 dager", value: fmt.format(o.calls.failed7) },
                { label: `Samtaler i ${month}`, value: fmt.format(o.calls.month) },
                { label: `Transkribert i ${month}`, value: `${decimal.format(o.usage.hours)} t` },
                { label: `AI-kontroller i ${month}`, value: fmt.format(o.usage.controls) },
                { label: `Notater i ${month}`, value: fmt.format(o.usage.notes) },
              ]}
            />
            <p className="mt-4 text-sm text-muted">Timer og AI-kontroller er talt som på fakturaen: hver samtale én gang.</p>
          </Card>
          <Card title="Innlogging" actions={<CardLink href="/admin/sikkerhet">Sikkerhet</CardLink>}>
            <div className="flex flex-col gap-5">
              <Figures
                rows={[
                  { label: "I dag", value: fmt.format(o.logins.today) },
                  { label: "Siste 7 dager", value: fmt.format(o.logins.week) },
                  { label: "Mislykkede siste døgn", value: fmt.format(o.logins.failed24h) },
                  { label: "Sperrede adresser", value: fmt.format(o.logins.blockedIps) },
                ]}
              />
              <div>
                <h3 className="mb-3 font-semibold">Innloggingsmåte, siste 30 dager</h3>
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
          <Card title={`Mest aktive i ${month}`} actions={<CardLink href="/admin/callsentre">Callsentre</CardLink>}>
            {o.organizations.mostActive.length ? (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-sm text-muted">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Callsenter</th>
                      <th className="px-2 py-2 text-right font-semibold">Samtaler</th>
                      <th className="px-2 py-2 text-right font-semibold">Innlogget 30 d</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {o.organizations.mostActive.map((a) => (
                      <tr key={a.id}>
                        <td className="px-2 py-3">
                          <Link href={`/admin/callsentre/${a.id}`} className="font-semibold text-brand">
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-right">{fmt.format(a.calls)}</td>
                        <td className="px-2 py-3 text-right">{fmt.format(a.users30)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">Ingen samtaler i {month} ennå.</p>
            )}
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="Går ut snart">
              {o.organizations.ending.length ? (
                <ul className="divide-y divide-line">
                  {o.organizations.ending.map((e) => (
                    <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                      <Link href={`/admin/callsentre/${e.id}`} className="font-semibold text-brand">
                        {e.name}
                      </Link>
                      <span className="text-sm text-muted">
                        {e.kind === "trial" ? "Prøveperioden" : "Tilgangen fra faktura"} går ut {formatDate(e.endsAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Ingen prøveperioder går ut de neste 14 dagene, og ingen tilgang fra faktura de neste 7.</p>
              )}
            </Card>
            <Card title="Lite aktivitet">
              {o.organizations.quiet.length ? (
                <>
                  <ul className="divide-y divide-line">
                    {o.organizations.quiet.map((q) => (
                      <li key={q.id} className="flex flex-col gap-1 py-2">
                        <Link href={`/admin/callsentre/${q.id}`} className="font-semibold text-brand">
                          {q.name}
                        </Link>
                        <span className="text-sm text-muted">
                          Siste samtale: {q.lastCallAt ? formatDate(q.lastCallAt) : "aldri"}. Siste innlogging:{" "}
                          {q.lastLoginAt ? formatDate(q.lastLoginAt) : "aldri"}.
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-muted">Åpne callsentre med transkribering som ikke har tatt opp samtaler de siste 14 dagene.</p>
                </>
              ) : (
                <p className="text-muted">Alle åpne callsentre med transkribering har tatt opp samtaler de siste 14 dagene.</p>
              )}
            </Card>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card title="Økonomi" actions={<CardLink href="/admin/okonomi/regnskap">Regnskap</CardLink>}>
            <Figures
              rows={[
                { label: "MRR", value: kr(o.money.mrr), note: `ARR ${kr(o.money.arr)}` },
                { label: `Inntekter i ${month}`, value: kr(o.money.revenue), note: "Innbetalt, uten mva." },
                { label: `Kostnader i ${month}`, value: kr(o.money.costs) },
                { label: `Resultat i ${month}`, value: kr(o.money.result) },
                { label: "Utestående", value: kr(o.money.outstanding) },
                { label: "Forfalt", value: kr(o.money.overdue) },
              ]}
            />
          </Card>
          <Card title="Brukere" actions={<CardLink href="/admin/brukere">Brukere</CardLink>}>
            <Figures
              rows={[
                { label: "Aktive", value: fmt.format(o.users.active) },
                { label: "Innlogget siste 7 dager", value: fmt.format(o.users.loggedIn7) },
                { label: "Venter på første innlogging", value: fmt.format(o.users.invited) },
                { label: "Nye siste 30 dager", value: fmt.format(o.users.new30) },
                { label: "Deaktivert", value: fmt.format(o.users.disabled) },
              ]}
            />
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card title="Callsentre" actions={<CardLink href="/admin/callsentre">Callsentre</CardLink>}>
            <Figures
              rows={[
                { label: "Åpne", value: fmt.format(o.organizations.open) },
                { label: "På prøve", value: fmt.format(o.organizations.trial) },
                { label: "Tilgang fra faktura", value: fmt.format(o.organizations.paying) },
                { label: "Stengt", value: fmt.format(o.organizations.closed), note: "Suspendert eller utløpt" },
                { label: `Nye i ${month}`, value: fmt.format(o.organizations.newThisMonth) },
                { label: "Totalt", value: fmt.format(o.organizations.total) },
              ]}
            />
          </Card>
          <Card title="Meldinger" actions={<CardLink href="/admin/meldinger">Meldinger</CardLink>}>
            <Figures
              rows={[
                { label: "Uleste samtaler", value: fmt.format(o.support.unread) },
                { label: "Åpne samtaler", value: fmt.format(o.support.open) },
                { label: "Aktive kunngjøringer", value: fmt.format(o.support.announcements) },
              ]}
            />
          </Card>
        </div>
      </div>
    </section>
  );
}
