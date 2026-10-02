"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { type EditableLine, emptyLine, LinesEditor } from "@/components/billing/lines-editor";
import { adminFetch, formatDate, type OrganizationSummary } from "@/lib/admin";
import { INTERVAL, kr, type RecurringInvoice } from "@/lib/billing";

// Fixed agreements (subscriptions): a draft is made for each period when the superadmin asks.
export default function RecurringPage() {
  const [agreements, setAgreements] = useState<RecurringInvoice[] | null>(null);
  const [editing, setEditing] = useState<RecurringInvoice | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function generate() {
    setError(null);
    setMessage(null);
    try {
      const { created } = await adminFetch<{ created: number }>("/recurring-invoices/generate", { method: "POST" });
      setMessage(created ? `${created} utkast laget. Se Fakturaer.` : "Ingen faste avtaler venter på utkast.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const due = agreements?.filter((a) => a.active && a.nextDate <= new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date())).length ?? 0;
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Faste avtaler</h1>
          <p className="mt-2 text-muted">Abonnementer som faktureres hver måned, kvartal, halvår eller år. Utkastene sendes som vanlige fakturaer.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={generate}>
            Lag utkast som forfaller{due ? ` (${due})` : ""}
          </button>
          {!editing && (
            <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
              Ny avtale
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
        <p className="text-muted">Ingen faste avtaler.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {agreements.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.organizationName} · {a.name}
                  {!a.active && <span className="ml-2 text-sm font-normal text-muted">(stoppet)</span>}
                </p>
                <p className="text-sm text-muted">
                  {INTERVAL[a.intervalMonths]}, neste {formatDate(a.nextDate)} ·{" "}
                  {kr(a.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0))} eks. mva
                </p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => setEditing(a)}>
                Endre
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgreementForm({ agreement, onDone }: { agreement: RecurringInvoice | null; onDone: () => Promise<void> }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [organizationId, setOrganizationId] = useState(agreement?.organizationId ?? "");
  const [name, setName] = useState(agreement?.name ?? "Abonnement VeriQall");
  const [interval, setIntervalMonths] = useState<number>(agreement?.intervalMonths ?? 1);
  const [nextDate, setNextDate] = useState(agreement?.nextDate ?? "");
  const [active, setActive] = useState(agreement?.active ?? true);
  const [lines, setLines] = useState<EditableLine[]>(
    agreement
      ? agreement.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatRate: l.vatRate }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (agreement) return;
    let cancelled = false;
    adminFetch<OrganizationSummary[]>("/organizations")
      .then((rows) => !cancelled && setOrganizations(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [agreement]);

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

  const body = { name, lines, intervalMonths: interval, nextDate, active };
  return (
    <Card title={agreement ? `${agreement.organizationName}: ${agreement.name}` : "Ny fast avtale"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            agreement
              ? adminFetch(`/recurring-invoices/${agreement.id}`, { method: "PATCH", body })
              : adminFetch("/recurring-invoices", { method: "POST", body: { ...body, organizationId } }),
          );
        }}
        className="flex flex-col gap-4"
      >
        {!agreement && (
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
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Navn" hint="Står i merknaden på fakturaen, med perioden.">
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
          <Field label="Neste faktura" hint="Første dag i perioden som faktureres.">
            <input required type="date" className={inputClass} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} />
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
                if (window.confirm("Slette avtalen? Fakturaer som er laget, blir stående.")) {
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
