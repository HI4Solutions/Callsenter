import Link from "next/link";
import { CallStatusBadge } from "@/components/calls/call-status";
import { Flag } from "@/components/flag";
import { type CallSummary, FLAG_LEVEL, formatDuration } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";

// The customer after the title, unless the title already names them.
function customerAfterTitle(c: CallSummary): string | null {
  if (!c.title || !c.customerName) return null;
  return c.title.toLowerCase().includes(c.customerName.toLowerCase()) ? null : c.customerName;
}

// Calls as a list of links; used on /samtaler, the customer page and the sale page.
export function CallList({ calls, showCustomer = true }: { calls: CallSummary[]; showCustomer?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
      {calls.map((c) => (
        <li key={c.id}>
          <Link href={`/samtaler/${c.id}`} className="flex flex-col gap-2 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold">
                {c.title || (showCustomer && c.customerName) || c.productName || "Samtale"}
                {showCustomer && customerAfterTitle(c) && <span className="font-normal text-muted"> · {customerAfterTitle(c)}</span>}
              </span>
              <span className="text-sm text-muted">
                {[formatDateTime(c.startedAt), c.userName, formatDuration(c.durationMs), c.productName].filter(Boolean).join(" · ")}
              </span>
              {c.match && <span className="text-sm [overflow-wrap:anywhere]">… {c.match} …</span>}
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-2">
              {c.flag ? <Flag level={FLAG_LEVEL[c.flag]} /> : <CallStatusBadge status={c.status} />}
              {c.flag && c.flag !== "green" && !c.reviewedAt && <span className="text-sm text-muted">Ikke behandlet</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
