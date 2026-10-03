import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/admin/status-badge";
import type { InvoiceSummary } from "@/lib/billing";

// "Faktura 12", "Kreditnota 13" or "Faktura (utkast)" in the page's language.
export function useInvoiceTitle() {
  const t = useTranslations("economy.shared");
  return (i: Pick<InvoiceSummary, "kind" | "number">) =>
    i.number === null
      ? t("invoiceDraftTitle", { kind: i.kind })
      : t("invoiceTitle", { kind: i.kind, number: i.number });
}

export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<InvoiceSummary, "status" | "overdue">;
}) {
  const t = useTranslations("domain.invoiceStatus");
  const te = useTranslations("economy.shared");
  if (invoice.status === "payment_missed")
    return <StatusBadge tone="danger">{t("payment_missed")}</StatusBadge>;
  if (invoice.overdue)
    return <StatusBadge tone="danger">{te("overdue")}</StatusBadge>;
  if (invoice.status === "paid")
    return <StatusBadge tone="ok">{t("paid")}</StatusBadge>;
  if (invoice.status === "sent")
    return <StatusBadge tone="warning">{t("sent")}</StatusBadge>;
  return (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
      {t(invoice.status)}
    </span>
  );
}
