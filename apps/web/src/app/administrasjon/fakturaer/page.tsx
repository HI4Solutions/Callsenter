"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/admin/field";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status";
import { type InvoiceSummary, invoiceTitle, kr } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";

type OrgInvoice = Pick<InvoiceSummary, "id" | "kind" | "status" | "number" | "issueDate" | "dueDate" | "total" | "paid" | "overdue">;

// The call centre's invoices from VeriQall (billing.read).
export default function OrgInvoicesPage() {
  const [invoices, setInvoices] = useState<OrgInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgFetch<OrgInvoice[]>("/invoices")
      .then((rows) => !cancelled && setInvoices(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Fakturaer</h2>
        <p className="mt-1 text-muted">Fakturaer fra VeriQall til callsenteret.</p>
      </div>
      <ErrorMessage message={error} />
      {!invoices ? (
        !error && <p className="text-muted">Laster …</p>
      ) : invoices.length === 0 ? (
        <p className="text-muted">Ingen fakturaer ennå.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/administrasjon/fakturaer/${i.id}`} className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{invoiceTitle(i)}</p>
                  <p className="text-sm text-muted">
                    {formatDate(i.issueDate)}
                    {i.kind === "invoice" && `, forfall ${formatDate(i.dueDate)}`}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{kr(i.total)}</span>
                <InvoiceStatusBadge invoice={i} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
