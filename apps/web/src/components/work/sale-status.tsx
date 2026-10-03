import type { SaleStatus } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/admin/status-badge";
import { saleTone } from "@/lib/work";

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const t = useTranslations("domain");
  const tone = saleTone(status);
  if (!tone) {
    return (
      <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
        {t(`saleStatus.${status}`)}
      </span>
    );
  }
  return <StatusBadge tone={tone}>{t(`saleStatus.${status}`)}</StatusBadge>;
}
