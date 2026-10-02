"use client";

import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch } from "@/lib/admin";
import { type BillingOverview, kr } from "@/lib/billing";

interface UsageRow {
  organizationId: string;
  organizationName: string;
  month: string;
  calls: number;
  audioSeconds: number;
  realtimeSeconds: number;
  inputTokens: string;
  outputTokens: string;
}

const number = (n: number | string) => new Intl.NumberFormat("nb-NO").format(Number(n));
const minutes = (seconds: number) => number(Math.round(seconds / 60));

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" }).format(new Date(y!, m! - 1, 1));
}

// Key figures for invoicing, and usage per call centre (audio minutes and AI tokens per month).
// docs/plan.md, sections 10 and 16.
export default function EconomyPage() {
  const [months, setMonths] = useState("3");
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<BillingOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingOverview>("/billing/overview")
      .then((o) => !cancelled && setOverview(o))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminFetch<UsageRow[]>(`/usage?months=${months}`)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [months]);

  const byMonth = new Map<string, UsageRow[]>();
  for (const r of rows ?? []) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
          <p className="mt-2 text-muted">Fakturering av callsentrene, og forbruk per callsenter.</p>
        </div>
      </div>
      <EconomyNav />
      {overview && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Faste inntekter per måned" value={kr(overview.mrr)} note="Aktive faste avtaler, eks. mva" />
          <Tile label="Fakturert denne måneden" value={kr(overview.invoicedMonth)} note={`${kr(overview.invoicedYear)} i år, eks. mva`} />
          <Tile label="Utestående" value={kr(overview.outstanding)} note={`${kr(overview.overdue)} forfalt`} />
          <Tile
            label="Å gjøre"
            value={`${overview.drafts} utkast`}
            note={overview.recurringDue ? `${overview.recurringDue} faste avtaler venter på utkast` : "Ingen faste avtaler venter"}
          />
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-2xl font-bold">Forbruk</h2>
        <Field label="Periode">
          <select className={inputClass} value={months} onChange={(e) => setMonths(e.target.value)}>
            <option value="1">Denne måneden</option>
            <option value="3">Siste 3 måneder</option>
            <option value="12">Siste 12 måneder</option>
          </select>
        </Field>
      </div>
      <ErrorMessage message={error} />
      {!rows ? (
        !error && <p className="text-muted">Laster …</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">Ingen forbruk i perioden.</p>
      ) : (
        [...byMonth].map(([month, list]) => (
          <div key={month} className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-left">
              <caption className="p-4 text-left text-xl font-bold capitalize">{monthName(month)}</caption>
              <thead className="border-y border-line text-sm text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Callsenter</th>
                  <th className="px-4 py-2 text-right font-semibold">Samtaler</th>
                  <th className="px-4 py-2 text-right font-semibold">Lydminutter</th>
                  <th className="px-4 py-2 text-right font-semibold">Herav sanntid</th>
                  <th className="px-4 py-2 text-right font-semibold">AI-tokens inn</th>
                  <th className="px-4 py-2 text-right font-semibold">AI-tokens ut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {list.map((r) => (
                  <tr key={r.organizationId}>
                    <td className="px-4 py-2">{r.organizationName}</td>
                    <td className="px-4 py-2 text-right">{number(r.calls)}</td>
                    <td className="px-4 py-2 text-right">{minutes(r.audioSeconds)}</td>
                    <td className="px-4 py-2 text-right">{minutes(r.realtimeSeconds)}</td>
                    <td className="px-4 py-2 text-right">{number(r.inputTokens)}</td>
                    <td className="px-4 py-2 text-right">{number(r.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}
