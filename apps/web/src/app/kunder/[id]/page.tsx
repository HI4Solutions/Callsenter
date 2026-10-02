"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, primaryButton, secondaryButton } from "@/components/admin/field";
import { CustomerForm } from "@/components/work/customer-form";
import { LinkedCalls } from "@/components/work/linked-calls";
import { SaleList } from "@/components/work/sale-list";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { canSeeSales, type Customer, CUSTOMER_KIND, formatOrgNumber, formatPhone, type SaleSummary } from "@/lib/work";

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
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

  if (!canRead) return <NoAccess text="Du har ikke tilgang til kunder i dette callsenteret." />;
  if (!customer) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;

  async function setArchived(archived: boolean) {
    if (archived && !window.confirm(`Arkivere ${customer!.name}? Kunden skjules fra listen, men historikken beholdes.`)) return;
    setError(null);
    try {
      await orgFetch(`/customers/${id}`, { method: "PATCH", body: { archived } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows: [string, string][] = [
    ["Type", CUSTOMER_KIND[customer.kind]],
    customer.kind === "person"
      ? ["Fødselsdato", customer.birthDate ? formatDate(customer.birthDate) : "–"]
      : ["Organisasjonsnummer", formatOrgNumber(customer.orgNumber)],
    ...(customer.kind === "business" ? ([["Kontaktperson", customer.contactName ?? "–"]] as [string, string][]) : []),
    ["Mobilnummer", formatPhone(customer.phone)],
    ["E-post", customer.email ?? "–"],
    ["Adresse", [customer.addressLine, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "–"],
    ["Opprettet", formatDateTime(customer.createdAt)],
    ["Sist endret", formatDateTime(customer.updatedAt)],
  ];

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/kunder" className="text-sm font-semibold text-brand">
          ← Alle kunder
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{customer.name}</h1>
        {customer.archivedAt && <p className="mt-2 text-muted">Arkivert {formatDate(customer.archivedAt)}.</p>}
      </div>
      <ErrorMessage message={error} />
      {editing ? (
        <Card title="Endre kunde">
          <CustomerForm
            customer={customer}
            submitLabel="Lagre"
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
          title="Opplysninger"
          actions={
            canManage && (
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => setEditing(true)}>
                  Endre
                </button>
                <button type="button" className={secondaryButton} onClick={() => setArchived(!customer.archivedAt)}>
                  {customer.archivedAt ? "Gjenopprett" : "Arkiver"}
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
          {customer.note && <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">{customer.note}</p>}
        </Card>
      )}
      <CustomerSales customerId={customer.id} canSell={(me?.permissions.includes("sales.manage") ?? false) && !customer.archivedAt} />
      <LinkedCalls query={`customerId=${customer.id}`} />
    </section>
  );
}

// The customer's sales that the member may see (own, team or all).
function CustomerSales({ customerId, canSell }: { customerId: string; canSell: boolean }) {
  const me = useWorkMe();
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
      title="Salg"
      actions={
        canSell && (
          <Link href={`/salg?kunde=${customerId}`} className={primaryButton}>
            Nytt salg
          </Link>
        )
      }
    >
      <ErrorMessage message={error} />
      {!sales ? (
        !error && <p className="text-muted">Laster …</p>
      ) : sales.length === 0 ? (
        <p className="text-muted">Ingen salg du har tilgang til.</p>
      ) : (
        <SaleList sales={sales} showCustomer={false} />
      )}
    </Card>
  );
}
