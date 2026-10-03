"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { ComplaintStatusBadge } from "@/components/work/complaint-status";
import { SaleDocumentationView } from "@/components/work/sale-documentation";
import { useWorkMe } from "@/components/work/work-shell";
import { CHANNEL, COMPLAINT_STATUS, type ComplaintDetail, type ComplaintStatus } from "@/lib/complaints";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { formatPhone } from "@/lib/work";

const ACTIONS: Record<ComplaintStatus, string> = {
  open: "Åpne igjen",
  investigating: "Start behandling",
  resolved: "Løs saken",
  rejected: "Avvis klagen",
};

const NEXT: Record<ComplaintStatus, ComplaintStatus[]> = {
  open: ["investigating", "resolved", "rejected"],
  investigating: ["resolved", "rejected"],
  resolved: ["investigating"],
  rejected: ["investigating"],
};

export default function ComplaintPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const canSeeCustomers = me?.permissions.includes("customers.read") ?? false;
  const [complaint, setComplaint] = useState<ComplaintDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      orgFetch<ComplaintDetail>(`/complaints/${id}`)
        .then(setComplaint)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<ComplaintDetail>(`/complaints/${id}`)
      .then((k) => !cancelled && setComplaint(k))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!complaint) return <LoadState error={error} />;
  const k = complaint;

  async function assignToMe() {
    setError(null);
    try {
      await orgFetch(`/complaints/${k.id}`, { method: "PATCH", body: { assignedTo: me?.user.id } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows: [string, React.ReactNode][] = [
    [
      "Kunde",
      canSeeCustomers ? (
        <Link href={`/kunder/${k.customerId}`} className="font-semibold text-brand">
          {k.customerName}
        </Link>
      ) : (
        (k.customerName ?? "Skjult (krever tilgang til kunder)")
      ),
    ],
    ...(k.customerPhone ? ([["Mobilnummer", formatPhone(k.customerPhone)]] as [string, string][]) : []),
    ...(k.customerEmail ? ([["E-post", k.customerEmail]] as [string, string][]) : []),
    ["Kanal", CHANNEL[k.channel]],
    ["Mottatt", formatDate(k.receivedOn)],
    ["Registrert", `${formatDateTime(k.createdAt)}${k.createdByName ? ` av ${k.createdByName}` : ""}`],
    [
      "Saksbehandler",
      <span key="a" className="flex flex-wrap items-center gap-3">
        {k.assignedName ?? "Ingen"}
        {k.assignedTo !== me?.user.id && (
          <button type="button" className={`${secondaryButton} print:hidden`} onClick={assignToMe}>
            Ta saken
          </button>
        )}
      </span>,
    ],
    ...(k.saleId
      ? ([
          [
            "Salg",
            <Link key="s" href={`/salg/${k.saleId}`} className="font-semibold text-brand">
              {k.documentation?.sale.productName ?? "Åpne salget"}
            </Link>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(k.closedAt ? ([["Lukket", formatDateTime(k.closedAt)]] as [string, string][]) : []),
  ];

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/klager" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand print:hidden">
            ← Alle klager
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere]">{k.summary}</h1>
            <ComplaintStatusBadge status={k.status} />
          </div>
          {k.customerName && <p className="mt-2 text-muted">Klage fra {k.customerName}</p>}
        </div>
        <button type="button" className={`${secondaryButton} print:hidden`} onClick={() => window.print()}>
          Skriv ut eller lagre som PDF
        </button>
      </div>
      <ErrorMessage message={error} />
      <StatusActions key={k.status} complaint={k} onChanged={load} onError={setError} />
      <Card title="Saken">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {k.description && <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">{k.description}</p>}
        {k.outcome && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-muted">Utfall</p>
            <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{k.outcome}</p>
          </div>
        )}
      </Card>
      <History complaint={k} onChanged={load} />
      {k.saleId && (
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-extrabold tracking-tight">Dokumentasjon for salget</h2>
          {k.documentation ? (
            <SaleDocumentationView doc={k.documentation} />
          ) : k.documentationHidden ? (
            <p className="text-muted">
              Du har ikke tilgang til dette salget. Salg som ikke er dine eller teamets, krever tilgang til alle samtaler og innlogging med BankID
              eller passkey.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function StatusActions({
  complaint,
  onChanged,
  onError,
}: {
  complaint: ComplaintDetail;
  onChanged: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const [next, setNext] = useState<ComplaintStatus | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState(complaint.outcome ?? "");
  const [busy, setBusy] = useState(false);
  const closing = next === "resolved" || next === "rejected";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!next) return;
    onError(null);
    setBusy(true);
    try {
      await orgFetch(`/complaints/${complaint.id}`, {
        method: "PATCH",
        body: { status: next, statusNote: note.trim() || null, ...(closing ? { outcome: outcome.trim() } : {}) },
      });
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="Behandling">
      {next ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p>
            Ny status: <strong>{COMPLAINT_STATUS[next]}</strong>
          </p>
          {closing && (
            <Field label="Utfall" hint="Hva ble avgjort, og hvorfor. Dette er svaret saken kan vises til senere.">
              <textarea required rows={4} maxLength={10000} className={`${inputClass} py-2`} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            </Field>
          )}
          <Field label="Begrunnelse" hint="Valgfritt. Vises i historikken.">
            <textarea rows={2} maxLength={1000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || (closing && !outcome.trim())} className={primaryButton}>
              Lagre
            </button>
            <button type="button" className={secondaryButton} onClick={() => setNext(null)}>
              Avbryt
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 print:hidden">
          {NEXT[complaint.status].map((status) => (
            <button key={status} type="button" className={secondaryButton} onClick={() => setNext(status)}>
              {ACTIONS[status]}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function History({ complaint, onChanged }: { complaint: ComplaintDetail; onChanged: () => Promise<unknown> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/complaints/${complaint.id}/notes`, { method: "POST", body: { note: note.trim() } });
      setNote("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title="Historikk og notater">
      <form onSubmit={add} className="flex flex-col gap-3 print:hidden">
        <Field label="Nytt notat" hint="Notater kan ikke endres eller slettes etterpå.">
          <textarea rows={3} maxLength={5000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <div>
          <button type="submit" disabled={busy || !note.trim()} className={primaryButton}>
            Legg til notat
          </button>
        </div>
      </form>
      <ol className="mt-6 flex flex-col gap-4">
        {[...complaint.events].reverse().map((e) => (
          <li key={e.id} className="border-l-2 border-line pl-4">
            <p className="font-semibold">
              {e.kind === "created" ? "Klagen registrert" : e.kind === "note" ? "Notat" : `${COMPLAINT_STATUS[e.toStatus!]}`}
            </p>
            <p className="text-sm text-muted">
              {formatDateTime(e.createdAt)}
              {e.actorName && ` · ${e.actorName}`}
            </p>
            {e.note && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{e.note}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
