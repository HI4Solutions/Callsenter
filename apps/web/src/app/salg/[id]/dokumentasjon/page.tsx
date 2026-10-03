"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { primaryButton, LoadState } from "@/components/admin/field";
import { SaleDocumentationView } from "@/components/work/sale-documentation";
import type { SaleDocumentation } from "@/lib/complaints";
import { orgFetch } from "@/lib/org";

export default function SaleDocumentationPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("sales.documentation");
  const [doc, setDoc] = useState<SaleDocumentation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgFetch<SaleDocumentation>(`/sales/${id}/documentation`)
      .then((d) => !cancelled && setDoc(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!doc) return <LoadState error={error} />;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <Link
            href={`/salg/${id}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
          >
            {t("back")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        <button
          type="button"
          className={primaryButton}
          onClick={() => window.print()}
        >
          {t("print")}
        </button>
      </div>
      <h1 className="hidden text-2xl font-extrabold print:block">
        {t("printTitle", {
          customer: doc.sale.customerName,
          product: doc.sale.productName,
        })}
      </h1>
      <SaleDocumentationView doc={doc} />
    </section>
  );
}
