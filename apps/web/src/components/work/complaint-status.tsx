import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/admin/status-badge";
import { type ComplaintStatus, complaintTone } from "@/lib/complaints";

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  const t = useTranslations("domain");
  const tone = complaintTone(status);
  return tone ? (
    <StatusBadge tone={tone}>{t(`complaintStatus.${status}`)}</StatusBadge>
  ) : (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
      {t(`complaintStatus.${status}`)}
    </span>
  );
}
