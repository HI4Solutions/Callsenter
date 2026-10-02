"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch, formatDateTime } from "@/lib/admin";
import type { BillingSettings } from "@/lib/billing";

type Form = Record<"companyName" | "orgNumber" | "address" | "email" | "accountNumber" | "footer" | "priceAudioHour" | "priceAiControl" | "dueDays" | "nextNumber", string> & {
  vatRegistered: boolean;
};

function toForm(s: BillingSettings): Form {
  return {
    companyName: s.companyName ?? "",
    orgNumber: s.orgNumber ?? "",
    address: s.address ?? "",
    email: s.email ?? "",
    accountNumber: s.accountNumber ?? "",
    footer: s.footer ?? "",
    priceAudioHour: s.priceAudioHour ?? "",
    priceAiControl: s.priceAiControl ?? "",
    dueDays: String(s.dueDays),
    nextNumber: String(s.nextNumber),
    vatRegistered: s.vatRegistered,
  };
}

// The seller on every invoice, payment terms, numbering and prices for usage.
export default function BillingSettingsPage() {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingSettings>("/billing/settings")
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setForm(toForm(s));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !settings) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    const nullable = (v: string) => v.trim() || null;
    try {
      const s = await adminFetch<BillingSettings>("/billing/settings", {
        method: "PATCH",
        body: {
          companyName: nullable(form.companyName),
          orgNumber: nullable(form.orgNumber),
          address: nullable(form.address),
          email: nullable(form.email),
          accountNumber: nullable(form.accountNumber),
          footer: nullable(form.footer),
          priceAudioHour: nullable(form.priceAudioHour),
          priceAiControl: nullable(form.priceAiControl),
          dueDays: Number(form.dueDays),
          vatRegistered: form.vatRegistered,
          ...(Number(form.nextNumber) !== settings.nextNumber ? { nextNumber: Number(form.nextNumber) } : {}),
        },
      });
      setSettings(s);
      setForm(toForm(s));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const field = (key: keyof Omit<Form, "vatRegistered">, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className={inputClass} value={form![key]} onChange={(e) => setForm({ ...form!, [key]: e.target.value })} {...props} />
    </Field>
  );

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Innstillinger for fakturering</h1>
        <p className="mt-2 text-muted">Avsender, betalingsvilkår og priser. Sendte fakturaer beholder opplysningene de ble sendt med.</p>
      </div>
      <EconomyNav />
      <ErrorMessage message={error} />
      {!form ? (
        !error && <p className="text-muted">Laster …</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-6">
          <Card title="Avsender">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("companyName", "Firmanavn", { maxLength: 200 })}
              {field("orgNumber", "Organisasjonsnummer", { inputMode: "numeric" })}
              {field("accountNumber", "Kontonummer", { inputMode: "numeric" })}
              {field("email", "E-post", { type: "email" })}
              <Field label="Adresse">
                <textarea rows={3} maxLength={500} className={`${inputClass} py-2`} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="Bunntekst" hint="Valgfritt. For eksempel kontaktinformasjon.">
                <textarea rows={3} maxLength={1000} className={`${inputClass} py-2`} value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} />
              </Field>
            </div>
            <label className="mt-4 inline-flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={form.vatRegistered} onChange={(e) => setForm({ ...form, vatRegistered: e.target.checked })} />
              Registrert i Merverdiavgiftsregisteret (fakturaene får mva)
            </label>
          </Card>
          <Card title="Vilkår og nummerering">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("dueDays", "Betalingsfrist (dager)", { type: "number", min: 0, max: 90 })}
              {field("nextNumber", "Neste fakturanummer", { type: "number", min: 1 }, "Kan bare settes høyere enn det siste brukte nummeret.")}
            </div>
          </Card>
          <Card title="Priser for forbruk">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("priceAudioHour", "Pris per time lyd (eks. mva)", { inputMode: "decimal" }, "Tomt: transkribering faktureres ikke som forbruk.")}
              {field("priceAiControl", "Pris per AI-kontroll (eks. mva)", { inputMode: "decimal" }, "Tomt: AI-kontroll faktureres ikke som forbruk.")}
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className={primaryButton}>
              Lagre
            </button>
            {saved && <span role="status">Lagret.</span>}
            {settings && <span className="text-sm text-muted">Sist endret {formatDateTime(settings.updatedAt)}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
