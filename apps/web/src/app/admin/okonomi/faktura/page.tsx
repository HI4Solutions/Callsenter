"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status";
import { type EditableLine, emptyLine, LinesEditor } from "@/components/billing/lines-editor";
import { osloToday, useInvoiceForm } from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate } from "@/lib/admin";
import { type InvoiceSummary, invoiceTitle, kr } from "@/lib/billing";

export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  // From Kunder: /admin/okonomi/faktura?kunde=<id> shows one call centre's invoices.
  const [customer] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("kunde")));
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (customer) params.set("organizationId", customer);
    adminFetch<InvoiceSummary[]>(`/invoices${params.size ? `?${params}` : ""}`)
      .then((rows) => {
        if (cancelled) return;
        setInvoices(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [status, customer]);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
          <p className="mt-2 text-muted">En sendt faktura får neste nummer og kan ikke endres. Feil rettes med kreditnota.</p>
        </div>
        {!creating && (
          <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
            Ny faktura
          </button>
        )}
      </div>
      <EconomyNav />
      {creating && <NewInvoice onCancel={() => setCreating(false)} />}
      <Field label="Vis">
        <select className={`${inputClass} sm:w-64`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle</option>
          <option value="draft">Utkast</option>
          <option value="scheduled">Planlagt</option>
          <option value="sent">Sendt, ikke betalt</option>
          <option value="overdue">Forfalt</option>
          <option value="payment_missed">Betaling uteblitt</option>
          <option value="paid">Betalt</option>
          <option value="credited">Kreditert</option>
        </select>
      </Field>
      <ErrorMessage message={error} />
      {!invoices ? (
        !error && <p className="text-muted">Laster …</p>
      ) : invoices.length === 0 ? (
        <p className="text-muted">Ingen fakturaer.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/admin/okonomi/faktura/${i.id}`} className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {invoiceTitle(i)} · {i.organizationName}
                  </p>
                  <p className="text-sm text-muted">
                    Kunde {i.customerNumber} ·{" "}
                    {i.status === "scheduled"
                      ? `Sendes ${formatDate(i.issueDate)}`
                      : i.status === "draft"
                        ? `Laget ${formatDate(i.createdAt)}`
                        : `Sendt ${formatDate(i.issueDate)}`}
                    {i.dueDate && i.kind === "invoice" && i.status !== "draft" && `, forfall ${formatDate(i.dueDate)}`}
                    {i.grantAccess && i.periodEnd && ` · tilgang til ${formatDate(i.periodEnd)}`}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{kr(i.total)}</span>
                <InvoiceStatusBadge invoice={i} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewInvoice({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const { organizations, packages, settings, error: loadError } = useInvoiceForm();
  const [organizationId, setOrganizationId] = useState("");
  const [issueDate, setIssueDate] = useState(osloToday);
  const [dueDate, setDueDate] = useState("");
  const [grantAccess, setGrantAccess] = useState(true);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await adminFetch<{ id: string }>("/invoices", {
        method: "POST",
        body: {
          organizationId,
          issueDate: issueDate > osloToday() ? issueDate : null,
          dueDate: dueDate || null,
          grantAccess,
          note: note.trim() || null,
          lines,
        },
      });
      router.push(`/admin/okonomi/faktura/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="Ny faktura">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kunde">
            <select required className={inputClass} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">{organizations ? "Velg callsenter" : "Laster …"}</option>
              {organizations?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fakturadato" hint="En dato fram i tid planlegger sendingen til den morgenen.">
            <input type="date" min={osloToday()} className={inputClass} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Forfall" hint={`Tomt: ${settings?.dueDays ?? 14} dager etter sending.`}>
            <input type="date" min={osloToday()} className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} packages={packages} fee={settings?.invoiceFee} />
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={grantAccess} onChange={(e) => setGrantAccess(e.target.checked)} />
          Aktiver tilgang: callsenteret er åpent ut perioden (fra fakturadatoen, like mange dager som måneden har), og pakkenes moduler slås på
        </label>
        <Field label="Merknad" hint="Valgfritt. Vises på fakturaen.">
          <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage message={error ?? loadError} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !organizationId} className={primaryButton}>
            Lagre utkast
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Avbryt
          </button>
        </div>
      </form>
    </Card>
  );
}
