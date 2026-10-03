"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch, formatDateTime } from "@/lib/admin";
import { type BillingCustomer, kr } from "@/lib/billing";
import { formatOrgNumber } from "@/lib/work";

// The call centres as invoice customers. Name, org.nr., invoice e-mail and address are edited
// under Callsentre; the customer number is fixed.
export default function CustomersPage() {
  const t = useTranslations("economy");
  const tc = useTranslations("common");
  const [customers, setCustomers] = useState<BillingCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeAccess(c: BillingCustomer) {
    const answer = window.prompt(
      t("customers.accessPrompt", { name: c.name }),
      c.accessUntil ? new Date(c.accessUntil).toISOString().slice(0, 10) : "",
    );
    if (answer === null) return;
    setError(null);
    try {
      await adminFetch(`/billing/customers/${c.id}/access`, {
        method: "PUT",
        body: { until: answer.trim() || null },
      });
      setCustomers(await adminFetch<BillingCustomer[]>("/billing/customers"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingCustomer[]>("/billing/customers")
      .then((rows) => !cancelled && setCustomers(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("customers.intro")}</p>
      </div>
      <EconomyNav />
      <ErrorMessage message={error} />
      {!customers ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : (
        <div className="-mx-2 scroll-x">
          <table className="w-full min-w-[48rem] text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">
                  {t("customers.number")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("customers.centre")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("customers.invoiceEmail")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("customers.access")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("customers.outstanding")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("customers.invoices")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-3">{c.customerNumber}</td>
                  <td className="px-2 py-3">
                    <Link
                      href={`/admin/callsentre/${c.id}`}
                      className="font-semibold text-brand"
                    >
                      {c.name}
                    </Link>
                    {c.orgNumber && (
                      <span className="block text-sm text-muted">
                        {t("customers.orgNumber", {
                          number: formatOrgNumber(c.orgNumber),
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 [overflow-wrap:anywhere]">
                    {c.invoiceEmail ?? (
                      <span className="text-muted">
                        {t("customers.missing")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {c.open ? (
                      <StatusBadge tone="ok">{t("customers.open")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">
                        {t("customers.closed")}
                      </StatusBadge>
                    )}
                    {c.accessUntil && (
                      <span className="block text-sm text-muted">
                        {t("customers.until", {
                          time: formatDateTime(c.accessUntil),
                        })}
                      </span>
                    )}
                    {c.accessUntil && (
                      <button
                        type="button"
                        className="mt-1 block text-sm font-semibold text-brand"
                        onClick={() => changeAccess(c)}
                      >
                        {t("customers.changeAccess")}
                      </button>
                    )}
                    {c.agreements > 0 && (
                      <span className="block text-sm text-muted">
                        {t("customers.recurring", { count: c.agreements })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right">{kr(c.outstanding)}</td>
                  <td className="px-2 py-3 text-right">
                    <Link
                      href={`/admin/okonomi/faktura?kunde=${c.id}`}
                      className="text-brand"
                    >
                      {c.invoices}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
