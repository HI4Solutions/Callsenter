"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch, formatDateTime } from "@/lib/admin";
import { type BillingCustomer, kr } from "@/lib/billing";
import { formatOrgNumber } from "@/lib/work";

// The call centres as invoice customers. Name, org.nr., invoice e-mail and address are edited
// under Callsentre; the customer number is fixed.
export default function CustomersPage() {
  const [customers, setCustomers] = useState<BillingCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeAccess(c: BillingCustomer) {
    const answer = window.prompt(
      `Tilgang for ${c.name} til og med dato (ÅÅÅÅ-MM-DD), eller tomt for å la fakturaene slutte å styre tilgangen:`,
      c.accessUntil ? new Date(c.accessUntil).toISOString().slice(0, 10) : "",
    );
    if (answer === null) return;
    setError(null);
    try {
      await adminFetch(`/billing/customers/${c.id}/access`, { method: "PUT", body: { until: answer.trim() || null } });
      setCustomers(await adminFetch<BillingCustomer[]>("/billing/customers"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingCustomer[]>("/billing/customers")
      .then((rows) => !cancelled && setCustomers(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <p className="mt-2 text-muted">Kundene er callsentrene. Kundenummeret er fast. Faktura-e-post og -adresse endres under Callsentre.</p>
      </div>
      <EconomyNav />
      <ErrorMessage message={error} />
      {!customers ? (
        !error && <p className="text-muted">Laster …</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">Kundenr.</th>
                <th className="px-2 py-2 font-semibold">Callsenter</th>
                <th className="px-2 py-2 font-semibold">Faktura-e-post</th>
                <th className="px-2 py-2 font-semibold">Tilgang</th>
                <th className="px-2 py-2 text-right font-semibold">Utestående</th>
                <th className="px-2 py-2 text-right font-semibold">Fakturaer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-3 tabular-nums">{c.customerNumber}</td>
                  <td className="px-2 py-3">
                    <Link href={`/admin/callsentre/${c.id}`} className="font-semibold text-brand">
                      {c.name}
                    </Link>
                    {c.orgNumber && <span className="block text-sm text-muted">Org.nr. {formatOrgNumber(c.orgNumber)}</span>}
                  </td>
                  <td className="px-2 py-3 [overflow-wrap:anywhere]">{c.invoiceEmail ?? <span className="text-muted">Mangler</span>}</td>
                  <td className="px-2 py-3">
                    {c.open ? <StatusBadge tone="ok">Åpent</StatusBadge> : <StatusBadge tone="danger">Stengt</StatusBadge>}
                    {c.accessUntil && <span className="block text-sm text-muted">til {formatDateTime(c.accessUntil)}</span>}
                    {c.accessUntil && (
                      <button type="button" className="mt-1 block text-sm font-semibold text-brand" onClick={() => changeAccess(c)}>
                        Endre tilgang
                      </button>
                    )}
                    {c.agreements > 0 && <span className="block text-sm text-muted">{c.agreements} gjentakende</span>}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{kr(c.outstanding)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    <Link href={`/admin/okonomi/faktura?kunde=${c.id}`} className="text-brand">
                      {c.invoices}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
