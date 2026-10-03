import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/admin/status-badge";
import type { CallStatus } from "@/lib/calls";

// A call's processing status, for calls without an AI flag. A failed call stands out in the
// status colour (with the word), the others are neutral.
export function CallStatusBadge({ status }: { status: CallStatus }) {
  const t = useTranslations("domain.callStatus");
  if (status === "failed")
    return <StatusBadge tone="danger">{t("failed")}</StatusBadge>;
  return (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
      {t(status)}
    </span>
  );
}
