"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart } from "@/components/admin/charts";
import { ErrorMessage } from "@/components/admin/field";
import { FindingsCard, flagColumns, Stat } from "@/components/work/dashboard-view";
import { FlagColumns, type FlagFilter } from "@/components/work/flag-charts";
import { CHANNEL, COMPLAINT_STATUS } from "@/lib/complaints";
import { type Dashboard, type QualityDashboard, share } from "@/lib/dashboard";
import { orgFetch } from "@/lib/org";

// Kvalitet (docs/plan.md, section 15): for compliance, who sees the whole call centre and reviews
// flags or complaints. The queue of flags now, deviations per product and seller, complaints,
// customer acceptance and, with audit.read, who opened recordings. Counts only, never content.

const fmt = new Intl.NumberFormat("nb-NO");
const decimal = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });
const DAY_MS = 86_400_000;

function useBoth(from: string, to: string) {
  const key = `${from}|${to}`;
  // at: when the answer came, to tell how long the oldest flag has waited.
  const [result, setResult] = useState<{ key: string; quality?: QualityDashboard; all?: Dashboard; at?: number; error?: string } | null>(null);
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

// Horizontal bars in the brand colour, with the figure written at the end.
function Bars({ rows }: { rows: { label: string; value: number; text?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <span className="text-sm">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-3.5 shrink-0 rounded-r bg-brand"
              style={{ width: `${(r.value / max) * 75}%`, minWidth: r.value > 0 ? "3px" : "0" }}
              aria-hidden="true"
            />
            <span className="text-sm whitespace-nowrap">{r.text ?? fmt.format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// One product: breaches and deviations as parts of the calls checked (the AI flag colours).
function ProductRow({ p }: { p: QualityDashboard["products"][number] }) {
  const rest = Math.max(0, p.checked - p.red - p.yellow);
  const part = (n: number) => `${(n / Math.max(1, p.checked)) * 100}%`;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold [overflow-wrap:anywhere]">{p.name}</span>
        <span className="text-sm text-muted">
          {fmt.format(p.red)} brudd og {fmt.format(p.yellow)} avvik av {fmt.format(p.checked)} kontrollerte
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
  const result = useBoth(from, to);
  if (result?.error) return <ErrorMessage message={result.error} />;
  if (!result?.quality || !result.all) return <p className="text-muted">Laster …</p>;
  const q = result.quality;
  const all = result.all;
  const flagged = q.flags.red + q.flags.yellow;
  const oldestDays = q.flags.oldestOpenAt ? Math.floor(((result.at ?? 0) - Date.parse(q.flags.oldestOpenAt)) / DAY_MS) : null;
  const over = flagColumns(all);
  const c = q.complaints;
  const k = q.confirmations;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat
          label="Ubehandlede flagg nå"
          value={fmt.format(q.flags.open)}
          note={
            q.flags.open === 0
              ? "Ingen venter"
              : oldestDays === 0
                ? "Det eldste er fra i dag"
                : `Det eldste har ventet i ${fmt.format(oldestDays ?? 0)} døgn`
          }
        />
        <Stat
          label="Behandlet i perioden"
          value={fmt.format(q.flags.reviewed)}
          note={q.flags.medianHoursToReview === null ? undefined : `Median ${decimal.format(q.flags.medianHoursToReview)} timer fra kontroll til behandling`}
        />
        <Stat
          label="Flagget i perioden"
          value={share(flagged, q.flags.checked)}
          note={`${fmt.format(q.flags.red)} brudd og ${fmt.format(q.flags.yellow)} avvik av ${fmt.format(q.flags.checked)} kontrollerte`}
        />
        {c && <Stat label="Klager mottatt" value={fmt.format(c.received)} note={`${fmt.format(c.openNow)} åpne nå`} />}
        {k && (
          <Stat
            label="Kundeaksept"
            value={`${fmt.format(k.accepted)} av ${fmt.format(k.sent)}`}
            note={k.identityMismatch ? `${fmt.format(k.identityMismatch)} der identiteten ikke stemte med kunden` : "Identiteten stemte i alle"}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Køen nå">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">Gule og røde flagg som ingen har behandlet, etter hvor lenge de har ventet.</p>
            <Bars
              rows={[
                { label: "Under 1 døgn", value: q.flags.openByAge.day },
                { label: "1–3 døgn", value: q.flags.openByAge.days3 },
                { label: "3–7 døgn", value: q.flags.openByAge.week },
                { label: "Over 7 døgn", value: q.flags.openByAge.older },
              ]}
            />
            {all.calls.unreviewed > 0 && (
              <button type="button" className="self-start font-semibold text-brand" onClick={() => onFlag("unreviewed")}>
                Vis de {fmt.format(all.calls.unreviewed)} fra perioden
              </button>
            )}
          </div>
        </Card>
        <Card title="Avvik per produkt">
          {q.products.length ? (
            <ul className="divide-y divide-line">
              {q.products.map((p) => (
                <ProductRow key={p.name} p={p} />
              ))}
            </ul>
          ) : (
            <p className="text-muted">Ingen kontrollerte samtaler med produkt i perioden.</p>
          )}
        </Card>
      </div>

      {all.calls.total > 0 && (
        <Card title="AI-kontroll over tid">
          <FlagColumns title={over.title} columns={over.columns} />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Selgere med høyest andel brudd">
          {q.sellers.length ? (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left">
                <thead className="text-sm text-muted">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Navn</th>
                    <th className="px-2 py-2 text-right font-semibold">Kontrollert</th>
                    <th className="px-2 py-2 text-right font-semibold">Avvik</th>
                    <th className="px-2 py-2 text-right font-semibold">Brudd</th>
                    <th className="px-2 py-2 text-right font-semibold">Andel brudd</th>
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
                      <td className="px-2 py-3 text-right">{fmt.format(s.checked)}</td>
                      <td className="px-2 py-3 text-right">{fmt.format(s.yellow)}</td>
                      <td className="px-2 py-3 text-right">{fmt.format(s.red)}</td>
                      <td className="px-2 py-3 text-right">{share(s.red, s.checked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">Ingen selgere med brudd i minst tre kontrollerte samtaler.</p>
          )}
        </Card>
        <FindingsCard data={all} />
      </div>

      {c && (
        <Card title="Klager">
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {(Object.keys(c.byStatus) as (keyof typeof c.byStatus)[]).map((status) => (
                <div key={status}>
                  <dt className="text-sm text-muted">{COMPLAINT_STATUS[status]}</dt>
                  <dd className="text-xl font-semibold">{fmt.format(c.byStatus[status])}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">
              Mottatt i perioden, etter status i dag.
              {c.medianDaysToClose !== null && ` Saker som ble avsluttet i perioden, tok median ${decimal.format(c.medianDaysToClose)} døgn.`}
              {Object.keys(c.byChannel).length > 0 &&
                ` Kanal: ${Object.entries(c.byChannel)
                  .map(([channel, n]) => `${CHANNEL[channel as keyof typeof CHANNEL] ?? channel} ${fmt.format(n)}`)
                  .join(", ")}.`}
            </p>
            {c.weekly.length > 1 && (
              <ColumnChart
                title="Klager mottatt per uke"
                points={c.weekly.map((w) => {
                  const [, m, d] = w.week.split("-");
                  return { label: `${Number(d)}.${Number(m)}.`, value: w.received };
                })}
                unit="klager"
              />
            )}
          </div>
        </Card>
      )}

      {k && (
        <Card title="Kundeaksept">
          <div className="flex flex-col gap-4">
            <Bars
              rows={[
                { label: "Godtatt med BankID", value: k.bankid },
                { label: "Godtatt med Vipps", value: k.vipps },
                { label: "Avvist", value: k.rejected },
                { label: "Venter", value: k.pending },
                { label: "Utløpt", value: k.expired },
                { label: "Trukket tilbake", value: k.revoked },
              ]}
            />
            <p className="text-sm text-muted">
              Lenker sendt i perioden: {fmt.format(k.sent)}.{" "}
              {k.identityMismatch > 0
                ? `${fmt.format(k.identityMismatch)} ble godtatt av en person som ikke stemte med kunden på navn eller telefonnummer. De bør sjekkes.`
                : "Alle som godtok, stemte med kunden."}
            </p>
          </div>
        </Card>
      )}

      {q.access && (
        <Card title="Tilgang til opptak og transkripsjon">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-muted">Åpnet</dt>
                <dd className="text-xl font-semibold">{fmt.format(q.access.views)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Spilt av</dt>
                <dd className="text-xl font-semibold">{fmt.format(q.access.plays)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Lastet ned</dt>
                <dd className="text-xl font-semibold">{fmt.format(q.access.downloads)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Søk</dt>
                <dd className="text-xl font-semibold">{fmt.format(q.access.searches)}</dd>
              </div>
            </dl>
            {q.access.users.length > 0 && (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-left">
                  <caption className="px-2 pb-2 text-left text-sm text-muted">Hvem som har åpnet mest i perioden</caption>
                  <thead className="text-sm text-muted">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Navn</th>
                      <th className="px-2 py-2 text-right font-semibold">Åpnet</th>
                      <th className="px-2 py-2 text-right font-semibold">Spilt av</th>
                      <th className="px-2 py-2 text-right font-semibold">Søk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.access.users.map((u) => (
                      <tr key={u.userId}>
                        <td className="px-2 py-3">{u.name}</td>
                        <td className="px-2 py-3 text-right">{fmt.format(u.views)}</td>
                        <td className="px-2 py-3 text-right">{fmt.format(u.plays)}</td>
                        <td className="px-2 py-3 text-right">{fmt.format(u.searches)}</td>
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
