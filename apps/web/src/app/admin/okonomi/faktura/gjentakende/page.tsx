"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { type EditableLine, emptyLine, LinesEditor } from "@/components/billing/lines-editor";
import { osloToday, useInvoiceForm } from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate } from "@/lib/admin";
import { INTERVAL, kr, type RecurringInvoice } from "@/lib/billing";

// Fixed agreements: sent automatically every morning a set number of days before they fall due.
export default function RecurringPage() {
  const [agreements, setAgreements] = useState<RecurringInvoice[] | null>(null);
  const [editing, setEditing] = useState<RecurringInvoice | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      adminFetch<RecurringInvoice[]>("/recurring-invoices")
        .then(setAgreements)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<RecurringInvoice[]>("/recurring-invoices")
      .then((rows) => !cancelled && setAgreements(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function runNow() {
    if (!window.confirm("Kjøre morgenkjøringen nå? Planlagte fakturaer og faste avtaler som skal ut i dag, sendes på e-post.")) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { sent, emailed } = await adminFetch<{ sent: number; emailed: number }>("/billing/run", { method: "POST" });
      setMessage(sent ? `${sent} fakturaer sendt, ${emailed} på e-post.` : "Ingenting skulle sendes i dag.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const today = osloToday();
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
          <p className="mt-2 text-muted">
            Faste avtaler sendes automatisk hver morgen, et fast antall dager før forfall. Planlagte fakturaer sendes samme morgen som fakturadatoen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={secondaryButton} onClick={runNow}>
            Kjør nå
          </button>
          {!editing && (
            <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
              Ny gjentakende faktura
            </button>
          )}
        </div>
      </div>
      <EconomyNav />
      {message && <p role="status">{message}</p>}
      <ErrorMessage message={error} />
      {editing && (
        <AgreementForm
          key={editing === "new" ? "new" : editing.id}
          agreement={editing === "new" ? null : editing}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {!agreements ? (
        !error && <p className="text-muted">Laster …</p>
      ) : agreements.length === 0 ? (
        <p className="text-muted">Ingen gjentakende fakturaer.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">Kunde</th>
                <th className="px-2 py-2 font-semibold">Hvor ofte</th>
                <th className="px-2 py-2 font-semibold">Neste sending</th>
                <th className="px-2 py-2 font-semibold">Neste forfall</th>
                <th className="px-2 py-2 text-right font-semibold">Beløp eks. mva</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td className="px-2 py-3">
                    <span className="font-semibold">{a.organizationName}</span>
                    <span className="block text-sm text-muted">
                      {a.name}, kunde {a.customerNumber}
                    </span>
                  </td>
                  <td className="px-2 py-3">{INTERVAL[a.intervalMonths]}</td>
                  <td className="px-2 py-3">{a.sendDate <= today ? "I dag" : formatDate(a.sendDate)}</td>
                  <td className="px-2 py-3">{formatDate(a.nextDate)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{kr(a.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0))}</td>
                  <td className="px-2 py-3">{!a.active ? "Stoppet" : a.paused ? "På pause (betaling uteblitt)" : "Aktiv"}</td>
                  <td className="px-2 py-3 text-right">
                    <button type="button" className={secondaryButton} onClick={() => setEditing(a)}>
                      Endre
                    </button>
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

function AgreementForm({ agreement, onDone }: { agreement: RecurringInvoice | null; onDone: () => Promise<void> }) {
  const { organizations, packages, settings } = useInvoiceForm();
  const [organizationId, setOrganizationId] = useState(agreement?.organizationId ?? "");
  const [name, setName] = useState(agreement?.name ?? "Abonnement VeriQall");
  const [interval, setIntervalMonths] = useState<number>(agreement?.intervalMonths ?? 1);
  const [nextDate, setNextDate] = useState(agreement?.nextDate ?? "");
  const [daysBefore, setDaysBefore] = useState(agreement?.daysBefore === null || agreement?.daysBefore === undefined ? "" : String(agreement.daysBefore));
  const [grantAccess, setGrantAccess] = useState(agreement?.grantAccess ?? true);
  const [active, setActive] = useState(agreement?.active ?? true);
  const [lines, setLines] = useState<EditableLine[]>(
    agreement
      ? agreement.lines.map((l) => ({
          kind: l.kind ?? (l.packageId ? "package" : "text"),
          packageId: l.packageId ?? null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          vatRate: l.vatRate,
        }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const body = {
    name,
    lines,
    intervalMonths: interval,
    ...(agreement && nextDate === agreement.nextDate ? {} : { nextDate }),
    daysBefore: daysBefore === "" ? null : Number(daysBefore),
    grantAccess,
    active,
  };
  return (
    <Card title={agreement ? `${agreement.organizationName}: ${agreement.name}` : "Ny gjentakende faktura"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            agreement
              ? adminFetch(`/recurring-invoices/${agreement.id}`, { method: "PATCH", body })
              : adminFetch("/recurring-invoices", { method: "POST", body: { ...body, organizationId, nextDate } }),
          );
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!agreement && (
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
          )}
          <Field label="Navn" hint="Står som merknad på fakturaen.">
            <input required maxLength={200} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Hvor ofte">
            <select className={inputClass} value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))}>
              {Object.entries(INTERVAL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Neste forfall" hint="Forfallet gjentas samme dag hver periode. Endres datoen, telles periodene fra den nye.">
            <input required type="date" className={inputClass} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </Field>
          <Field label="Dager før forfall" hint={`Når fakturaen sendes. Tomt: standard (${settings?.recurringDaysBefore ?? 14}).`}>
            <input type="number" min={0} max={60} className={inputClass} value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} />
          </Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} packages={packages} fee={settings?.invoiceFee} />
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={grantAccess} onChange={(e) => setGrantAccess(e.target.checked)} />
          Aktiver tilgang: hver faktura holder callsenteret åpent ut perioden og slår på pakkenes moduler
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktiv
        </label>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || (!agreement && !organizationId)} className={primaryButton}>
            Lagre
          </button>
          <button type="button" className={secondaryButton} onClick={() => void onDone()}>
            Avbryt
          </button>
          {agreement && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (window.confirm("Slette den gjentakende fakturaen? Fakturaer som er sendt, blir stående.")) {
                  void run(() => adminFetch(`/recurring-invoices/${agreement.id}`, { method: "DELETE" }));
                }
              }}
            >
              Slett
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
