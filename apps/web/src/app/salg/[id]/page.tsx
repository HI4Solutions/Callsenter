"use client";

import { SALE_STATUSES, SALE_TRANSITIONS, type SaleStatus } from "@veriqall/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { LinkedCalls } from "@/components/work/linked-calls";
import { SaleStatusBadge } from "@/components/work/sale-status";
import { useWorkMe } from "@/components/work/work-shell";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { StatusBadge } from "@/components/admin/status-badge";
import { type Confirmation, CUSTOMER_KIND, days, formatPhone, formatPrice, months, SALE_ACTIONS, type SaleDetail } from "@/lib/work";

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
    ["Angrefrist", days(sale.withdrawalDays)],
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
        {sale.note && <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">{sale.note}</p>}
      </Card>
      <Confirmations sale={sale} canManage={canManage} onChanged={load} />
      <LinkedCalls query={`saleId=${sale.id}`} />
      <Card title="Historikk">
        <ol className="flex flex-col gap-4">
          {[...sale.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-line pl-4">
              <p className="font-semibold">{SALE_STATUSES[e.toStatus]}</p>
              <p className="text-sm text-muted">
                {formatDateTime(e.createdAt)}
                {e.actorName && ` · ${e.actorName}`}
              </p>
              {e.note && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{e.note}</p>}
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

const CONFIRMATION_STATUS: Record<Confirmation["status"], string> = {
  pending: "Venter på kunden",
  accepted: "Godtatt",
  rejected: "Avslått",
  revoked: "Trukket tilbake",
};

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps", none: "uten identifisering" };

// Written acceptance from the customer (module 8): a secret link the seller sends, where the
// customer reads the offer and accepts with BankID or Vipps.
function Confirmations({ sale, canManage, onChanged }: { sale: SaleDetail; canManage: boolean; onChanged: () => Promise<unknown> }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canSend = canManage && (sale.status === "registered" || sale.status === "awaiting_confirmation");
  if (!canSend && !sale.confirmations.length) return null;

  async function send() {
    const pending = sale.confirmations.some((c) => c.status === "pending");
    if (pending && !window.confirm("Lage en ny lenke? Den forrige slutter å virke.")) return;
    setError(null);
    setCopied(false);
    try {
      setLink(await orgFetch<{ url: string; expiresAt: string }>(`/sales/${sale.id}/confirmations`, { method: "POST" }));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Trekke tilbake lenken? Kunden kan da ikke svare på den.")) return;
    setError(null);
    try {
      await orgFetch(`/sales/${sale.id}/confirmations/${id}/revoke`, { method: "POST" });
      setLink(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card
      title="Kundens bekreftelse"
      actions={
        canSend && (
          <button type="button" className={primaryButton} onClick={send}>
            {sale.confirmations.some((c) => c.status === "pending") ? "Ny lenke" : "Send til kunden"}
          </button>
        )
      }
    >
      <p className="text-muted">
        Ved telefonsalg er kunden bare bundet når hen godtar tilbudet skriftlig etter samtalen. Kunden får tilbudet og vilkårene, og godtar med
        BankID eller Vipps.
      </p>
      {link && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-bg p-3">
          <p className="font-semibold">Send denne lenken til kunden på SMS eller e-post:</p>
          <p className="font-mono text-sm [overflow-wrap:anywhere]">{link.url}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondaryButton}
              onClick={() => navigator.clipboard.writeText(link.url).then(() => setCopied(true), () => setCopied(false))}
            >
              Kopier lenke
            </button>
            {copied && <span role="status">Kopiert.</span>}
          </div>
          <p className="text-sm text-muted">Lenken vises bare nå, og gjelder til {formatDateTime(link.expiresAt)}.</p>
        </div>
      )}
      <ErrorMessage message={error} />
      {sale.confirmations.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {sale.confirmations.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {c.status === "accepted" ? (
                  <StatusBadge tone="ok">{CONFIRMATION_STATUS[c.status]}</StatusBadge>
                ) : c.status === "rejected" ? (
                  <StatusBadge tone="danger">{CONFIRMATION_STATUS[c.status]}</StatusBadge>
                ) : c.status === "pending" ? (
                  <StatusBadge tone="warning">{CONFIRMATION_STATUS[c.status]}</StatusBadge>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">{CONFIRMATION_STATUS[c.status]}</span>
                )}
                <span className="text-sm text-muted">
                  Sendt {formatDateTime(c.createdAt)}
                  {c.createdByName && ` av ${c.createdByName}`}
                  {c.viewedAt && `, åpnet ${formatDateTime(c.viewedAt)}`}
                </span>
              </div>
              {c.decidedAt && (
                <p className="text-sm">
                  {c.status === "accepted" ? "Godtatt" : "Avslått"} {formatDateTime(c.decidedAt)}
                  {c.method && ` ${c.method === "none" ? "uten identifisering" : `med ${METHOD[c.method]}`}`}
                  {c.identityName && ` av ${c.identityName}`}
                  {c.identityPhone && ` (${formatPhone(c.identityPhone)})`}
                  {c.ip && `, fra ${c.ip}`}.
                </p>
              )}
              {c.status === "accepted" && c.identityMatch === "none" && (
                <p className="text-sm font-semibold">Navnet eller mobilnummeret stemmer ikke med kunden. Sjekk at riktig person har godtatt.</p>
              )}
              <p className="font-mono text-xs text-muted [overflow-wrap:anywhere]">Dokument-ID: {c.documentHash}</p>
              {c.status === "pending" && canManage && (
                <div>
                  <button type="button" className={secondaryButton} onClick={() => revoke(c.id)}>
                    Trekk tilbake
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
