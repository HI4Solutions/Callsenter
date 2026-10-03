import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import { formatPrice, type SaleSummary } from "@/lib/work";
import { SaleStatusBadge } from "./sale-status";

// Sales as a list of links; used on /salg and on the customer page.
export function SaleList({
  sales,
  showCustomer = true,
}: {
  sales: SaleSummary[];
  showCustomer?: boolean;
}) {
  const t = useTranslations("work.saleList");
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
      {sales.map((s) => (
        <li key={s.id}>
          <Link
            href={`/salg/${s.id}`}
            className="flex flex-col gap-2 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex flex-col gap-1">
              <span className="font-semibold">
                {showCustomer
                  ? `${s.customerName ?? t("customer")} · ${s.productName}`
                  : s.productName}
              </span>
              <span className="text-sm text-muted">
                {[
                  formatDateTime(s.soldAt),
                  s.sellerName,
                  formatPrice(s),
                  t("template", { version: s.templateVersion }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <SaleStatusBadge status={s.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
