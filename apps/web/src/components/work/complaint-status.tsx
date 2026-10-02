import { StatusBadge } from "@/components/admin/status-badge";
import { COMPLAINT_STATUS, type ComplaintStatus, complaintTone } from "@/lib/complaints";

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  const tone = complaintTone(status);
  return tone ? (
    <StatusBadge tone={tone}>{COMPLAINT_STATUS[status]}</StatusBadge>
  ) : (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">{COMPLAINT_STATUS[status]}</span>
  );
}
