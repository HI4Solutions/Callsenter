"use client";

import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch } from "@/lib/admin";
import { type BillingOverview, kr } from "@/lib/billing";

// Regnskap: key figures from invoicing. Costs, revenue by product and the result come next
// (docs/plan.md, section 16).
export default function AccountingPage() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingOverview>("/billing/overview")
      .then((o) => !cancelled && setOverview(o))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <p className="mt-2 text-muted">Nøkkeltall fra fakturaene, uten mva.</p>
      </div>
      <EconomyNav />
      <ErrorMessage message={error} />
      {overview && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="MRR" value={kr(overview.mrr)} note={`ARR ${kr(Number(overview.mrr) * 12)}, fra aktive gjentakende fakturaer`} />
          <Tile label="Fakturert denne måneden" value={kr(overview.invoicedMonth)} note={`${kr(overview.invoicedYear)} hittil i år`} />
          <Tile label="Utestående" value={kr(overview.outstanding)} note={`${kr(overview.overdue)} forfalt, ${overview.missed} med betaling uteblitt`} />
          <Tile label="Å gjøre" value={`${overview.drafts} utkast`} note={`${overview.scheduled} planlagte`} />
        </div>
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
