import { StatusBadge } from "@/components/admin/status-badge";
import { INVOICE_STATUS, type InvoiceSummary } from "@/lib/billing";

export function InvoiceStatusBadge({ invoice }: { invoice: Pick<InvoiceSummary, "status" | "overdue"> }) {
  if (invoice.status === "payment_missed") return <StatusBadge tone="danger">{INVOICE_STATUS.payment_missed}</StatusBadge>;
  if (invoice.overdue) return <StatusBadge tone="danger">Forfalt</StatusBadge>;
  if (invoice.status === "paid") return <StatusBadge tone="ok">{INVOICE_STATUS.paid}</StatusBadge>;
  if (invoice.status === "sent") return <StatusBadge tone="warning">{INVOICE_STATUS.sent}</StatusBadge>;
  return (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">{INVOICE_STATUS[invoice.status]}</span>
  );
}
