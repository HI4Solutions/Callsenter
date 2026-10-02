import { SALE_STATUSES, type SaleStatus } from "@veriqall/shared";
import { StatusBadge } from "@/components/admin/status-badge";
import { saleTone } from "@/lib/work";

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const tone = saleTone(status);
  if (!tone) {
    return <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">{SALE_STATUSES[status]}</span>;
  }
  return <StatusBadge tone={tone}>{SALE_STATUSES[status]}</StatusBadge>;
}
