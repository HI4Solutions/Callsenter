"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status";
import { type EditableLine, emptyLine, LinesEditor } from "@/components/billing/lines-editor";
import { adminFetch, formatDate, type OrganizationSummary } from "@/lib/admin";
import { type InvoiceSummary, invoiceTitle, kr } from "@/lib/billing";

export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<InvoiceSummary[]>(`/invoices${status ? `?status=${status}` : ""}`)
      .then((rows) => {
        if (cancelled) return;
        setInvoices(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Fakturaer</h1>
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
          <option value="sent">Sendt, ikke betalt</option>
          <option value="overdue">Forfalt</option>
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
              <Link href={`/admin/okonomi/fakturaer/${i.id}`} className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {invoiceTitle(i)} · {i.organizationName}
                  </p>
                  <p className="text-sm text-muted">
                    {i.issueDate ? `Sendt ${formatDate(i.issueDate)}` : `Laget ${formatDate(i.createdAt)}`}
                    {i.dueDate && i.kind === "invoice" && i.status !== "draft" && `, forfall ${formatDate(i.dueDate)}`}
                    {i.note && ` · ${i.note.slice(0, 80)}`}
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
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<OrganizationSummary[]>("/organizations")
      .then((rows) => !cancelled && setOrganizations(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await adminFetch<{ id: string }>("/invoices", {
        method: "POST",
        body: { organizationId, note: note.trim() || null, lines },
      });
      router.push(`/admin/okonomi/fakturaer/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="Ny faktura">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Callsenter">
          <select required className={`${inputClass} sm:max-w-md`} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
            <option value="">{organizations ? "Velg callsenter" : "Laster …"}</option>
            {organizations?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <LinesEditor lines={lines} onChange={setLines} />
        <Field label="Merknad" hint="Valgfritt. Vises på fakturaen, for eksempel perioden den gjelder.">
          <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
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
