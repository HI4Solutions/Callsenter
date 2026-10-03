"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MODULES, isModuleKey } from "@veriqall/shared";
import { Card } from "@/components/admin/card";
import { LoadState } from "@/components/admin/field";
import { useMe } from "@/components/org/org-shell";
import { formatDate } from "@/lib/format";
import { orgFetch, type OrgSummary } from "@/lib/org";

// The call centre admin's overview (docs/plan.md, section 11): users and how they log in, teams,
// this month's activity and usage, invoices and modules. Counts only.

const fmt = new Intl.NumberFormat("nb-NO");
const decimal = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });
const kroner = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
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

function subscription(o: OrgSummary["organization"]): string {
  if (o.status === "suspended") return "Callsenteret er stengt. Ta kontakt med VeriQall.";
  if (o.accessUntil) return `Tilgang til ${formatDate(o.accessUntil)}.`;
  if (o.trialEndsAt) return `Prøveperiode til ${formatDate(o.trialEndsAt)}.`;
  return "Aktivt.";
}

export default function OrgOverviewPage() {
  const me = useMe();
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
  const share = (n: number) => (m.active ? `${fmt.format(n)} av ${fmt.format(m.active)}` : fmt.format(n));
  const month = new Intl.DateTimeFormat("nb-NO", { month: "long" }).format(new Date());

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Oversikt</h1>
        <p className="mt-2 text-muted">
          {data.organization.name}. {subscription(data.organization)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Aktive brukere" value={fmt.format(m.active)} note={`${fmt.format(m.loggedIn7)} innlogget siste 7 dager`} />
        <Stat
          label="Venter på første innlogging"
          value={fmt.format(m.invited)}
          note={
            m.invitationsExpired
              ? `${fmt.format(m.invitationsExpired)} med utløpt invitasjon`
              : `${fmt.format(m.invitationsPending)} gyldige invitasjoner`
          }
        />
        <Stat label="Ikke innlogget på 30 dager" value={fmt.format(m.inactive30)} note={m.disabled ? `${fmt.format(m.disabled)} deaktivert` : undefined} />
        {data.invoices ? (
          <Stat
            label="Ubetalt"
            value={`${kroner.format(data.invoices.unpaidAmount)} kr`}
            note={
              data.invoices.overdue
                ? `${fmt.format(data.invoices.overdue)} ${data.invoices.overdue === 1 ? "faktura" : "fakturaer"} forfalt`
                : data.invoices.nextDue
                  ? `Neste forfall ${formatDate(data.invoices.nextDue)}`
                  : "Ingenting forfalt"
            }
          />
        ) : (
          <Stat label={`Transkribert i ${month}`} value={`${decimal.format(data.usage.month.hours)} t`} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Innlogging" actions={<Link href="/administrasjon/brukere" className="font-semibold text-brand">Brukere</Link>}>
          <div className="flex flex-col gap-4">
            <Bars
              rows={[
                { label: "BankID", value: m.bankid, text: share(m.bankid) },
                { label: "Vipps", value: m.vipps, text: share(m.vipps) },
                { label: "Passkey", value: m.passkey, text: share(m.passkey) },
              ]}
            />
            <p className="text-sm text-muted">
              Av de aktive brukerne, etter hvilke innloggingsmåter de har koblet til. Administrasjon og innsyn i alle samtaler krever BankID eller
              passkey.
            </p>
          </div>
        </Card>
        <Card title="Team" actions={<Link href="/administrasjon/team" className="font-semibold text-brand">Team</Link>}>
          {data.teams.teams.length ? (
            <div className="flex flex-col gap-4">
              <Bars rows={data.teams.teams.map((t) => ({ label: t.name, value: t.members }))} />
              <p className="text-sm text-muted">Medlemmer per team, også de som ikke har logget inn ennå.</p>
              {data.teams.withoutTeam > 0 && <p className="text-sm text-muted">{fmt.format(data.teams.withoutTeam)} er ikke med i noe team.</p>}
            </div>
          ) : (
            <p className="text-muted">Ingen team ennå. Team trengs for teamledere og tallene per team.</p>
          )}
        </Card>
      </div>

      {data.activity && data.activity.length > 0 && (
        <Card title={`Aktivitet i ${month}`}>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold">Team</th>
                  <th className="px-2 py-2 text-right font-semibold">Samtaler</th>
                  <th className="px-2 py-2 text-right font-semibold">Salg</th>
                  <th className="px-2 py-2 text-right font-semibold">Bekreftet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.activity.map((a) => (
                  <tr key={a.teamId ?? "none"}>
                    <td className="px-2 py-3">{a.name ?? "Uten team"}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.calls)}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.sales)}</td>
                    <td className="px-2 py-3 text-right">{fmt.format(a.confirmed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            Tallene per selger og per dag står under{" "}
            <Link href="/oversikt" className="font-semibold text-brand">
              Callsenter → Oversikt
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Forbruk">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold" />
                  <th className="px-2 py-2 text-right font-semibold">Denne måneden</th>
                  <th className="px-2 py-2 text-right font-semibold">Forrige måned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-2 py-3">Timer transkribert</td>
                  <td className="px-2 py-3 text-right">{decimal.format(data.usage.month.hours)}</td>
                  <td className="px-2 py-3 text-right">{decimal.format(data.usage.previous.hours)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-3">AI-kontroller</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.month.controls)}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.previous.controls)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-3">Notater</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.month.notes)}</td>
                  <td className="px-2 py-3 text-right">{fmt.format(data.usage.previous.notes)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">Talt som på fakturaen: hver samtale én gang.</p>
        </Card>
        <Card title="Roller" actions={me?.permissions.includes("roles.manage") ? <Link href="/administrasjon/roller" className="font-semibold text-brand">Roller</Link> : undefined}>
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
          <Card title="Fakturaer" actions={<Link href="/administrasjon/fakturaer" className="font-semibold text-brand">Alle fakturaer</Link>}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-sm text-muted">Ubetalte</dt>
                <dd className="text-xl font-semibold">{fmt.format(data.invoices.unpaid)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Forfalt</dt>
                <dd className="text-xl font-semibold">{fmt.format(data.invoices.overdue)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Neste forfall</dt>
                <dd className="text-xl font-semibold">{data.invoices.nextDue ? formatDate(data.invoices.nextDue) : "–"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Siste betaling</dt>
                <dd className="text-xl font-semibold">{data.invoices.lastPaidAt ? formatDate(data.invoices.lastPaidAt) : "–"}</dd>
              </div>
            </dl>
          </Card>
        )}
        <Card title="Moduler">
          {data.modules.length ? (
            <ul className="flex flex-wrap gap-2">
              {data.modules.map((key) => (
                <li key={key} className="rounded-full border border-line px-3 py-1 text-sm">
                  {isModuleKey(key) ? MODULES[key].name : key}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Ingen moduler er slått på.</p>
          )}
          <p className="mt-3 text-sm text-muted">Moduler slås på og av av VeriQall. Send en melding under Meldinger hvis dere trenger flere.</p>
        </Card>
      </div>
    </section>
  );
}
