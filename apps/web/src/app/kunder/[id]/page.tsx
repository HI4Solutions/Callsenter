"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  primaryButton,
  secondaryButton,
  LoadState,
} from "@/components/admin/field";
import { ComplaintStatusBadge } from "@/components/work/complaint-status";
import { CustomerForm } from "@/components/work/customer-form";
import { LinkedCalls } from "@/components/work/linked-calls";
import { SaleList } from "@/components/work/sale-list";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { type ComplaintSummary } from "@/lib/complaints";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import {
  canSeeSales,
  type Customer,
  formatOrgNumber,
  formatPhone,
  type SaleSummary,
} from "@/lib/work";

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const t = useTranslations("customers");
  const td = useTranslations("domain");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const canRead = me?.permissions.includes("customers.read") ?? false;
  const canManage = me?.permissions.includes("customers.manage") ?? false;

  const load = useCallback(
    () =>
      orgFetch<Customer>(`/customers/${id}`)
        .then(setCustomer)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    orgFetch<Customer>(`/customers/${id}`)
      .then((c) => !cancelled && setCustomer(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, canRead]);

  if (!canRead) return <NoAccess text={t("noAccess")} />;
  if (!customer) return <LoadState error={error} />;

  async function setArchived(archived: boolean) {
    if (
      archived &&
      !window.confirm(t("detail.archiveConfirm", { name: customer!.name }))
    )
      return;
    setError(null);
    try {
      await orgFetch(`/customers/${id}`, {
        method: "PATCH",
        body: { archived },
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows: [string, string][] = [
    [t("detail.type"), td(`customerKind.${customer.kind}`)],
    customer.kind === "person"
      ? [
          t("detail.birthDate"),
          customer.birthDate ? formatDate(customer.birthDate) : "–",
        ]
      : [t("detail.orgNumber"), formatOrgNumber(customer.orgNumber)],
    ...(customer.kind === "business"
      ? ([[t("detail.contactName"), customer.contactName ?? "–"]] as [
          string,
          string,
        ][])
      : []),
    [t("detail.phone"), formatPhone(customer.phone)],
    [t("detail.email"), customer.email ?? "–"],
    [
      t("detail.address"),
      [
        customer.addressLine,
        [customer.postalCode, customer.city].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ") || "–",
    ],
    [t("detail.created"), formatDateTime(customer.createdAt)],
    [t("detail.updated"), formatDateTime(customer.updatedAt)],
  ];

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link
          href="/kunder"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          {t("detail.back")}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          {customer.name}
        </h1>
        {customer.archivedAt && (
          <p className="mt-2 text-muted">
            {t("detail.archivedOn", { date: formatDate(customer.archivedAt) })}
          </p>
        )}
      </div>
      <ErrorMessage message={error} />
      {editing ? (
        <Card title={t("detail.editTitle")}>
          <CustomerForm
            customer={customer}
            submitLabel={t("detail.save")}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await orgFetch(`/customers/${id}`, { method: "PATCH", body });
              await load();
              setEditing(false);
            }}
          />
        </Card>
      ) : (
        <Card
          title={t("detail.info")}
          actions={
            canManage && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => setEditing(true)}
                >
                  {t("detail.edit")}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => setArchived(!customer.archivedAt)}
                >
                  {customer.archivedAt
                    ? t("detail.restore")
                    : t("detail.archive")}
                </button>
              </div>
            )
          }
        >
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-sm font-semibold text-muted">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {customer.note && (
            <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">
              {customer.note}
            </p>
          )}
        </Card>
      )}
      <CustomerSales
        customerId={customer.id}
        canSell={
          (me?.permissions.includes("sales.manage") ?? false) &&
          !customer.archivedAt
        }
      />
      <CustomerComplaints customerId={customer.id} />
      <LinkedCalls query={`customerId=${customer.id}`} />
    </section>
  );
}

// The customer's sales that the member may see (own, team or all).
function CustomerSales({
  customerId,
  canSell,
}: {
  customerId: string;
  canSell: boolean;
}) {
  const me = useWorkMe();
  const t = useTranslations("customers.detail");
  const tc = useTranslations("common");
  const visible = canSeeSales(me?.permissions ?? []);
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    orgFetch<SaleSummary[]>(`/sales?customerId=${customerId}`)
      .then((rows) => !cancelled && setSales(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [customerId, visible]);

  if (!visible) return null;
  return (
    <Card
      title={t("sales")}
      actions={
        canSell && (
          <Link href={`/salg?kunde=${customerId}`} className={primaryButton}>
            {t("newSale")}
          </Link>
        )
      }
    >
      <ErrorMessage message={error} />
      {!sales ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : sales.length === 0 ? (
        <p className="text-muted">{t("noSales")}</p>
      ) : (
        <SaleList sales={sales} showCustomer={false} />
      )}
    </Card>
  );
}

// The customer's complaints, for those who handle complaints.
function CustomerComplaints({ customerId }: { customerId: string }) {
  const me = useWorkMe();
  const t = useTranslations("customers.detail");
  const tc = useTranslations("common");
  const visible = me?.permissions.includes("complaints.manage") ?? false;
  const [complaints, setComplaints] = useState<ComplaintSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    orgFetch<ComplaintSummary[]>(`/complaints?customerId=${customerId}`)
      .then((rows) => !cancelled && setComplaints(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [customerId, visible]);

  if (!visible) return null;
  return (
    <Card
      title={t("complaints")}
      actions={
        <Link href={`/klager?kunde=${customerId}`} className={secondaryButton}>
          {t("newComplaint")}
        </Link>
      }
    >
      <ErrorMessage message={error} />
      {!complaints ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : complaints.length === 0 ? (
        <p className="text-muted">{t("noComplaints")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {complaints.map((k) => (
            <li key={k.id}>
              <Link
                href={`/klager/${k.id}`}
                className="flex flex-wrap items-center gap-3 py-3 hover:bg-bg"
              >
                <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                  {k.summary}
                </span>
                <span className="text-sm text-muted">
                  {formatDate(k.receivedOn)}
                </span>
                <ComplaintStatusBadge status={k.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
