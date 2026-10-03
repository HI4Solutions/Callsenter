"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status";
import { InvoiceView } from "@/components/billing/invoice-view";
import { type EditableLine, LinesEditor } from "@/components/billing/lines-editor";
import { osloToday, useInvoiceForm } from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate, formatDateTime } from "@/lib/admin";
import { type InvoiceDetail, invoiceTitle, kr, openPdf, PAYMENT_METHOD } from "@/lib/billing";

function lastMonth() {
  const [y, m] = osloToday().split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<InvoiceDetail>(`/invoices/${id}`)
      .then((i) => !cancelled && setInvoice(i))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!invoice) return <LoadState error={error} />;
  const editable = invoice.status === "draft" || invoice.status === "scheduled";

  function changed(next: InvoiceDetail & { emailed?: boolean }, message?: string) {
    setInvoice(next);
    setNotice(message ?? null);
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 print:hidden">
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <EconomyNav />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <Link href="/admin/okonomi/faktura" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
            ← Alle fakturaer
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-extrabold tracking-tight">{invoiceTitle(invoice)}</h2>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <p className="mt-1 text-muted">
            {invoice.organizationName}, kunde {invoice.customerNumber}
          </p>
        </div>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => openPdf(`/admin/invoices/${invoice.id}/pdf`).catch((e: Error) => setError(e.message))}
        >
          {editable ? "Forhåndsvis PDF" : "Last ned PDF"}
        </button>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-bg p-3">
          {notice}
        </p>
      )}
      <ErrorMessage message={error} />
      {editable ? (
        <Draft key={`${invoice.status}-${invoice.lines.map((l) => l.id).join()}`} invoice={invoice} onChanged={changed} />
      ) : (
        <Sent invoice={invoice} onChanged={changed} />
      )}
      <InvoiceView invoice={invoice} />
    </section>
  );
}

function Draft({ invoice, onChanged }: { invoice: InvoiceDetail; onChanged: (i: InvoiceDetail & { emailed?: boolean }, message?: string) => void }) {
  const router = useRouter();
  const { packages, settings } = useInvoiceForm();
  const [lines, setLines] = useState<EditableLine[]>(() =>
    invoice.lines.length
      ? invoice.lines.map((l) => ({
          kind: l.kind,
          packageId: l.packageId,
          description: l.description,
          quantity: l.quantity.replace(/\.?0+$/, ""),
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
        }))
      : [{ kind: "text", packageId: null, description: "", quantity: "1", unitPrice: "", vatRate: 0.25 }],
  );
  const [note, setNote] = useState(invoice.note ?? "");
  const [issueDate, setIssueDate] = useState(invoice.issueDate ?? osloToday());
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [grantAccess, setGrantAccess] = useState(invoice.grantAccess);
  const [periodStart, setPeriodStart] = useState(invoice.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(invoice.periodEnd ?? "");
  const [month, setMonth] = useState(lastMonth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const future = issueDate > osloToday();

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

  const save = () =>
    adminFetch<InvoiceDetail>(`/invoices/${invoice.id}`, {
      method: "PATCH",
      body: {
        note: note.trim() || null,
        lines,
        issueDate: future ? issueDate : null,
        dueDate: dueDate || null,
        grantAccess,
        periodStart: grantAccess ? periodStart || null : null,
        periodEnd: grantAccess ? periodEnd || null : null,
      },
    });

  return (
    <Card title={invoice.status === "scheduled" ? `Planlagt: sendes ${formatDate(invoice.issueDate)}` : "Utkast"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onChanged(await save(), "Lagret."));
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fakturadato" hint="I dag sendes den nå. En dato fram i tid planlegger sendingen til den morgenen.">
            <input type="date" min={osloToday()} className={inputClass} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Forfall" hint={`Tomt: ${settings?.dueDays ?? 14} dager etter sending.`}>
            <input type="date" min={osloToday()} className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} packages={packages} fee={settings?.invoiceFee} />
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={grantAccess} onChange={(e) => setGrantAccess(e.target.checked)} />
          Aktiver tilgang for callsenteret ut perioden, og slå på pakkenes moduler
        </label>
        {grantAccess && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Periode fra" hint="Tomt: fakturadatoen.">
              <input type="date" className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </Field>
            <Field label="Periode til" hint="Tomt: like mange dager som måneden har.">
              <input type="date" className={inputClass} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Merknad" hint="Valgfritt. Vises på fakturaen.">
          <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={secondaryButton}>
            Lagre
          </button>
          <button
            type="button"
            disabled={busy}
            className={primaryButton}
            onClick={() => {
              const question = future
                ? `Planlegge sendingen til ${formatDate(issueDate)}? Den sendes automatisk den morgenen.`
                : "Sende fakturaen nå? Den får neste fakturanummer, sendes på e-post og kan ikke endres etterpå.";
              if (!window.confirm(question)) return;
              void run(async () => {
                await save();
                const sent = await adminFetch<InvoiceDetail & { emailed: boolean }>(`/invoices/${invoice.id}/send`, { method: "POST" });
                onChanged(
                  sent,
                  sent.status === "scheduled"
                    ? `Planlagt. Sendes ${formatDate(sent.issueDate)}.`
                    : sent.emailed
                      ? `Sendt på e-post til ${sent.recipient?.email}.`
                      : "Sendt. Den ble ikke sendt på e-post (e-post er ikke satt opp, eller callsenteret mangler faktura-e-post). Last ned PDF og send den selv.",
                );
              });
            }}
          >
            {future ? "Lagre og planlegg" : "Lagre og send"}
          </button>
          {invoice.status === "scheduled" && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => run(async () => onChanged(await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/unschedule`, { method: "POST" }), "Ikke lenger planlagt."))}
            >
              Avbryt planleggingen
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={secondaryButton}
            onClick={() => {
              if (!window.confirm("Slette utkastet?")) return;
              void run(async () => {
                await adminFetch(`/invoices/${invoice.id}`, { method: "DELETE" });
                router.push("/admin/okonomi/faktura");
              });
            }}
          >
            Slett
          </button>
        </div>
      </form>
      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="Legg til forbruk for måned" hint="Timer lyd og AI-kontroller, til prisene under Innstillinger.">
          <input type="month" className={inputClass} value={month} max={osloToday().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
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
    </Card>
  );
}

function Sent({ invoice, onChanged }: { invoice: InvoiceDetail; onChanged: (i: InvoiceDetail, message?: string) => void }) {
  const router = useRouter();
  const outstanding = Number(invoice.total) - Number(invoice.paid);
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding.toFixed(2).replace(".", ",") : "");
  const [paidOn, setPaidOn] = useState(osloToday);
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHOD>("bank");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [crediting, setCrediting] = useState(false);
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

  const canPay = invoice.kind === "invoice" && (invoice.status === "sent" || invoice.status === "payment_missed");
  const canCredit = invoice.kind === "invoice" && ["sent", "paid", "payment_missed"].includes(invoice.status);

  return (
    <Card title="Betaling og utsending">
      <div className="flex flex-col gap-4 print:hidden">
        {invoice.status === "payment_missed" && (
          <p>
            <strong>Betaling uteblitt</strong> {invoice.missedAt && formatDateTime(invoice.missedAt)}. Callsenteret er stengt og de faste avtalene står på pause.
            Registrer betalingen for å åpne igjen; avtalene fortsetter fra neste forfall.
          </p>
        )}
        {invoice.grantAccess && invoice.periodStart && (
          <p className="text-sm text-muted">
            Gir tilgang {formatDate(invoice.periodStart)}–{formatDate(invoice.periodEnd)}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {invoice.recipient?.email ? (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (!window.confirm(`Sende på e-post til ${invoice.recipient?.email} igjen?`)) return;
                void run(async () => onChanged(await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/email`, { method: "POST" }), "Sendt på e-post."));
              }}
            >
              {invoice.emails.length ? "Send på e-post igjen" : "Send på e-post"}
            </button>
          ) : (
            <p className="text-sm text-muted">Callsenteret hadde ingen faktura-e-post da fakturaen ble sendt. Last ned PDF og send den selv.</p>
          )}
          {invoice.emails.map((e) => (
            <span key={e.sentAt} className="text-sm text-muted">
              Sendt til {e.sentTo} {formatDateTime(e.sentAt)}
            </span>
          ))}
        </div>
        {invoice.creditNote && (
          <p>
            Kreditert med{" "}
            <Link href={`/admin/okonomi/faktura/${invoice.creditNote.id}`} className="font-semibold text-brand">
              kreditnota {invoice.creditNote.number}
            </Link>
            .
          </p>
        )}
        {invoice.kind === "credit" && invoice.creditOf && (
          <p>
            Krediterer{" "}
            <Link href={`/admin/okonomi/faktura/${invoice.creditOf}`} className="font-semibold text-brand">
              faktura {invoice.creditOfNumber}
            </Link>
            .
          </p>
        )}
        {invoice.payments.length > 0 && (
          <ul className="divide-y divide-line">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-3 py-2">
                <span className="font-semibold">{kr(p.amount)}</span>
                <span className="text-muted">
                  {formatDate(p.paidOn)} · {PAYMENT_METHOD[p.method]}
                  {p.reference && ` · ${p.reference}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canPay && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                onChanged(
                  await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/payments`, {
                    method: "POST",
                    body: { amount, paidOn, method, reference: reference.trim() || null },
                  }),
                  "Betalingen er registrert.",
                );
                setReference("");
              });
            }}
            className="grid gap-3 sm:grid-cols-2 sm:items-end xl:grid-cols-[8rem_10rem_8rem_minmax(0,1fr)_auto]"
          >
            <Field label="Beløp">
              <input required inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Betalt">
              <input required type="date" max={osloToday()} className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
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
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {invoice.status === "sent" && invoice.kind === "invoice" && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (!window.confirm("Markere betalingen som uteblitt? Callsenteret stenges med en gang, og de faste avtalene settes på pause.")) return;
                void run(async () => onChanged(await adminFetch<InvoiceDetail>(`/invoices/${invoice.id}/missed`, { method: "POST" }), "Markert som uteblitt."));
              }}
            >
              Betaling uteblitt
            </button>
          )}
          {canCredit && !crediting && (
            <button type="button" className={secondaryButton} onClick={() => setCrediting(true)}>
              Krediter fakturaen
            </button>
          )}
        </div>
        {crediting && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!window.confirm("Lage kreditnota for hele fakturaen? Den får neste fakturanummer og sendes på e-post.")) return;
              void run(async () => {
                const { id } = await adminFetch<{ id: string }>(`/invoices/${invoice.id}/credit`, { method: "POST", body: { reason: reason.trim() || null } });
                router.push(`/admin/okonomi/faktura/${id}`);
              });
            }}
            className="flex flex-col gap-3"
          >
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
        )}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}
