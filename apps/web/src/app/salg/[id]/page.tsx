"use client";

import { SALE_STATUSES, SALE_TRANSITIONS, type SaleStatus } from "@veriqall/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { SaleStatusBadge } from "@/components/work/sale-status";
import { useWorkMe } from "@/components/work/work-shell";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { CUSTOMER_KIND, formatPhone, formatPrice, months, SALE_ACTIONS, type SaleDetail } from "@/lib/work";

export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const canManage = me?.permissions.includes("sales.manage") ?? false;
  const canSeeCustomers = me?.permissions.includes("customers.read") ?? false;
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      orgFetch<SaleDetail>(`/sales/${id}`)
        .then(setSale)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<SaleDetail>(`/sales/${id}`)
      .then((s) => !cancelled && setSale(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!sale) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;

  const rows: [string, React.ReactNode][] = [
    [
      "Kunde",
      canSeeCustomers ? (
        <Link href={`/kunder/${sale.customerId}`} className="font-semibold text-brand">
          {sale.customerName}
        </Link>
      ) : (
        (sale.customerName ?? "–")
      ),
    ],
    ...(sale.customerKind ? ([["Type kunde", CUSTOMER_KIND[sale.customerKind]]] as [string, string][]) : []),
    ...(sale.customerPhone ? ([["Mobilnummer", formatPhone(sale.customerPhone)]] as [string, string][]) : []),
    [
      "Produkt",
      <Link key="p" href={`/produkter/${sale.productId}`} className="font-semibold text-brand">
        {sale.productName}, mal versjon {sale.templateVersion}
      </Link>,
    ],
    ["Pris", formatPrice(sale)],
    ["Bindingstid", months(sale.bindingMonths)],
    ["Angrefrist", sale.withdrawalDays === 0 ? "Ingen" : `${sale.withdrawalDays} dager`],
    ["Selger", [sale.sellerName, sale.teamName].filter(Boolean).join(", ") || "–"],
    ["Registrert", formatDateTime(sale.soldAt)],
  ];

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/salg" className="text-sm font-semibold text-brand">
          ← Alle salg
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{sale.productName}</h1>
          <SaleStatusBadge status={sale.status} />
        </div>
        <p className="mt-2 text-muted">{sale.customerName}</p>
      </div>
      <ErrorMessage message={error} />
      {canManage && SALE_TRANSITIONS[sale.status].length > 0 && (
        <StatusActions key={sale.status} sale={sale} onChanged={load} onError={setError} />
      )}
      <Card title="Salget">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {sale.note && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-bg p-3">{sale.note}</p>}
      </Card>
      <Card title="Historikk">
        <ol className="flex flex-col gap-4">
          {[...sale.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-line pl-4">
              <p className="font-semibold">{SALE_STATUSES[e.toStatus]}</p>
              <p className="text-sm text-muted">
                {formatDateTime(e.createdAt)}
                {e.actorName && ` · ${e.actorName}`}
              </p>
              {e.note && <p className="mt-1 whitespace-pre-wrap">{e.note}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function StatusActions({ sale, onChanged, onError }: { sale: SaleDetail; onChanged: () => Promise<unknown>; onError: (message: string | null) => void }) {
  const [next, setNext] = useState<SaleStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!next) return;
    onError(null);
    setBusy(true);
    try {
      await orgFetch(`/sales/${sale.id}`, { method: "PATCH", body: { status: next, statusNote: note.trim() || null } });
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="Endre status">
      {next ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p>
            Ny status: <strong>{SALE_STATUSES[next]}</strong>
          </p>
          <Field label="Begrunnelse" hint="Valgfritt. Vises i historikken.">
            <textarea rows={2} maxLength={1000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              Lagre status
            </button>
            <button type="button" className={secondaryButton} onClick={() => setNext(null)}>
              Avbryt
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {SALE_TRANSITIONS[sale.status].map((status) => (
            <button key={status} type="button" className={secondaryButton} onClick={() => setNext(status)}>
              {SALE_ACTIONS[status]}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
