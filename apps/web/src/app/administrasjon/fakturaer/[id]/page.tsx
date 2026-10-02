"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorMessage, secondaryButton } from "@/components/admin/field";
import { InvoiceView } from "@/components/billing/invoice-view";
import type { InvoiceDetail } from "@/lib/billing";
import { orgFetch } from "@/lib/org";

export default function OrgInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgFetch<InvoiceDetail>(`/invoices/${id}`)
      .then((i) => !cancelled && setInvoice(i))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!invoice) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link href="/administrasjon/fakturaer" className="text-sm font-semibold text-brand">
          ← Alle fakturaer
        </Link>
        <button type="button" className={secondaryButton} onClick={() => window.print()}>
          Skriv ut eller lagre som PDF
        </button>
      </div>
      <InvoiceView invoice={invoice} />
    </section>
  );
}
