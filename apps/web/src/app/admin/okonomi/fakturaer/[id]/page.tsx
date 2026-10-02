"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status";
import { InvoiceView } from "@/components/billing/invoice-view";
import { type EditableLine, LinesEditor } from "@/components/billing/lines-editor";
import { adminFetch, formatDate } from "@/lib/admin";
import { type InvoiceDetail, invoiceTitle, kr, PAYMENT_METHOD } from "@/lib/billing";

function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

function lastMonth() {
  const [y, m] = today().split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<InvoiceDetail>(`/invoices/${id}`)
      .then((i) => !cancelled && setInvoice(i))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!invoice) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <Link href="/admin/okonomi/fakturaer" className="text-sm font-semibold text-brand">
            ← Alle fakturaer
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{invoiceTitle(invoice)}</h1>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <p className="mt-2 text-muted">{invoice.organizationName}</p>
        </div>
        <button type="button" className={secondaryButton} onClick={() => window.print()}>
          Skriv ut eller lagre som PDF
        </button>
      </div>
      <ErrorMessage message={error} />
      {invoice.status === "draft" ? (
        <Draft key={invoice.lines.map((l) => l.id).join()} invoice={invoice} onChanged={setInvoice} />
      ) : (
        <Sent invoice={invoice} onChanged={setInvoice} />
      )}
      <InvoiceView invoice={invoice} />
    </section>
  );
}

function Draft({ invoice, onChanged }: { invoice: InvoiceDetail; onChanged: (i: InvoiceDetail) => void }) {
  const router = useRouter();
  const [lines, setLines] = useState<EditableLine[]>(() =>
    invoice.lines.length
      ? invoice.lines.map((l) => ({ description: l.description, quantity: l.quantity.replace(/\.?0+$/, ""), unitPrice: l.unitPrice, vatRate: l.vatRate }))
      : [{ description: "", quantity: "1", unitPrice: "", vatRate: 0.25 }],
  );
  const [note, setNote] = useState(invoice.note ?? "");
  const [month, setMonth] = useState(lastMonth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const save = () => adminFetch<InvoiceDetail>(`/invoices/${invoice.id}`, { method: "PATCH", body: { note: note.trim() || null, lines } });

  return (
    <Card title="Utkast">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onChanged(await save()));
        }}
        className="flex flex-col gap-4"
      >
        <LinesEditor lines={lines} onChange={setLines} />
        <Field label="Merknad" hint="Valgfritt. Vises på fakturaen.">
          <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            Lagre
          </button>
          <button
            type="button"
            disabled={busy}
            className={primaryButton}
            onClick={() => {
              if (!window.confirm("Sende fakturaen? Den får neste fakturanummer og kan ikke endres etterpå.")) return;
              void run(async () => {
                await save();
                onChanged(await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/send`, { method: "POST" }));
              });
            }}
          >
            Lagre og send
          </button>
          <button
            type="button"
            disabled={busy}
            className={secondaryButton}
            onClick={() => {
              if (!window.confirm("Slette utkastet?")) return;
              void run(async () => {
                await adminFetch(`/invoices/${invoice.id}`, { method: "DELETE" });
                router.push("/admin/okonomi/fakturaer");
              });
            }}
          >
            Slett utkast
          </button>
        </div>
      </form>
      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="Legg til forbruk for måned" hint="Timer lyd og AI-kontroller, til prisene under Innstillinger.">
          <input type="month" className={inputClass} value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <button
          type="button"
          disabled={busy || !month}
          className={secondaryButton}
          onClick={() =>
            run(async () => {
              await save();
              onChanged(await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/usage`, { method: "POST", body: { month } }));
            })
          }
        >
          Legg til forbruk
        </button>
      </div>
      <p className="mt-4 text-sm text-muted">
        Fakturaen sendes ikke på e-post ennå: skriv den ut eller lagre som PDF, og send den til{" "}
        {invoice.organizationInvoiceEmail ?? "callsenterets faktura-e-post (ikke satt)"}.
      </p>
    </Card>
  );
}

function Sent({ invoice, onChanged }: { invoice: InvoiceDetail; onChanged: (i: InvoiceDetail) => void }) {
  const router = useRouter();
  const outstanding = Number(invoice.total) - Number(invoice.paid);
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding.toFixed(2).replace(".", ",") : "");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHOD>("bank");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onChanged(
        await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/payments`, {
          method: "POST",
          body: { amount, paidOn, method, reference: reference.trim() || null },
        }),
      );
      setReference("");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function credit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm("Lage kreditnota for hele fakturaen? Den får neste fakturanummer.")) return;
    setError(null);
    setBusy(true);
    try {
      const { id } = await adminFetch<{ id: string }>(`/invoices/${invoice.id}/credit`, { method: "POST", body: { reason: reason.trim() || null } });
      router.push(`/admin/okonomi/fakturaer/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const canPay = invoice.kind === "invoice" && invoice.status === "sent";
  const canCredit = invoice.kind === "invoice" && (invoice.status === "sent" || invoice.status === "paid");

  return (
    <Card title="Betaling">
      <div className="flex flex-col gap-4 print:hidden">
        {invoice.creditNote && (
          <p>
            Kreditert med{" "}
            <Link href={`/admin/okonomi/fakturaer/${invoice.creditNote.id}`} className="font-semibold text-brand">
              kreditnota {invoice.creditNote.number}
            </Link>
            .
          </p>
        )}
        {invoice.kind === "credit" && invoice.creditOf && (
          <p>
            Krediterer{" "}
            <Link href={`/admin/okonomi/fakturaer/${invoice.creditOf}`} className="font-semibold text-brand">
              faktura {invoice.creditOfNumber}
            </Link>
            .
          </p>
        )}
        {invoice.payments.length > 0 && (
          <ul className="divide-y divide-line">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-3 py-2">
                <span className="font-semibold tabular-nums">{kr(p.amount)}</span>
                <span className="text-muted">
                  {formatDate(p.paidOn)} · {PAYMENT_METHOD[p.method]}
                  {p.reference && ` · ${p.reference}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canPay && (
          <form onSubmit={pay} className="grid gap-3 sm:grid-cols-[8rem_10rem_8rem_1fr_auto] sm:items-end">
            <Field label="Beløp">
              <input required inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Betalt">
              <input required type="date" max={today()} className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Måte">
              <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as keyof typeof PAYMENT_METHOD)}>
                {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Referanse">
              <input maxLength={200} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <button type="submit" disabled={busy} className={primaryButton}>
              Registrer betaling
            </button>
          </form>
        )}
        {canCredit &&
          (crediting ? (
            <form onSubmit={credit} className="flex flex-col gap-3 border-t border-line pt-4">
              <Field label="Begrunnelse for kreditnota" hint="Vises på kreditnotaen.">
                <input maxLength={2000} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={primaryButton}>
                  Lag kreditnota
                </button>
                <button type="button" className={secondaryButton} onClick={() => setCrediting(false)}>
                  Avbryt
                </button>
              </div>
            </form>
          ) : (
            <div className="border-t border-line pt-4">
              <button type="button" className={secondaryButton} onClick={() => setCrediting(true)}>
                Krediter fakturaen
              </button>
            </div>
          ))}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}
