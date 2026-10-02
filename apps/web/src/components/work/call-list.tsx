import Link from "next/link";
import { Flag } from "@/components/flag";
import { CALL_STATUS, type CallSummary, FLAG_LEVEL, formatDuration } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";

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
                {showCustomer && c.title && c.customerName && <span className="font-normal text-muted"> · {c.customerName}</span>}
              </span>
              <span className="text-sm text-muted">
                {[formatDateTime(c.startedAt), c.userName, formatDuration(c.durationMs), c.productName].filter(Boolean).join(" · ")}
              </span>
              {c.match && <span className="text-sm [overflow-wrap:anywhere]">… {c.match} …</span>}
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-2">
              {c.flag ? (
                <Flag level={FLAG_LEVEL[c.flag]} />
              ) : (
                <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
                  {CALL_STATUS[c.status]}
                </span>
              )}
              {c.flag && c.flag !== "green" && !c.reviewedAt && <span className="text-sm text-muted">Ikke behandlet</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
