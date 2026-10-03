"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorMessage, secondaryButton, LoadState } from "@/components/admin/field";
import { InvoiceView } from "@/components/billing/invoice-view";
import { type InvoiceDetail, openPdf } from "@/lib/billing";
import { orgFetch } from "@/lib/org";

export default function OrgInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("org.invoices");
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

  if (!invoice) return <LoadState error={error} />;
  return (
    <section className="flex flex-col gap-6">
      <ErrorMessage message={error} />
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link href="/administrasjon/fakturaer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
          {t("all")}
        </Link>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => openPdf(`/org/invoices/${invoice.id}/pdf`).catch((e: Error) => setError(e.message))}
        >
          {t("downloadPdf")}
        </button>
      </div>
      <InvoiceView invoice={invoice} />
    </section>
  );
}
