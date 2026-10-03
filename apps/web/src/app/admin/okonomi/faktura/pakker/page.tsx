"use client";

import { MODULE_KEYS, MODULES } from "@veriqall/shared";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch } from "@/lib/admin";
import { type BillingPackage, kr, percent, VAT_RATES } from "@/lib/billing";

// Packages: what call centres buy. A package line on an invoice with access switches on the
// package's modules for the call centre.
export default function PackagesPage() {
  const [packages, setPackages] = useState<BillingPackage[] | null>(null);
  const [editing, setEditing] = useState<BillingPackage | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      adminFetch<BillingPackage[]>("/billing/packages")
        .then(setPackages)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<BillingPackage[]>("/billing/packages")
      .then((rows) => !cancelled && setPackages(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <p className="mt-2 text-muted">Pakkene callsentrene kjøper. En pakke på en faktura med tilgang slår på modulene i pakken.</p>
      </div>
      <EconomyNav />
      {!editing && (
        <div>
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            Ny pakke
          </button>
        </div>
      )}
      <ErrorMessage message={error} />
      {editing && (
        <PackageForm
          key={editing === "new" ? "new" : editing.id}
          pkg={editing === "new" ? null : editing}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {!packages ? (
        !error && <p className="text-muted">Laster …</p>
      ) : packages.length === 0 ? (
        <p className="text-muted">Ingen pakker ennå.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {packages.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {p.name}
                  {!p.active && <span className="ml-2 text-sm font-normal text-muted">(arkivert)</span>}
                </p>
                <p className="text-sm text-muted">
                  {kr(p.unitPrice)} eks. mva ({percent(p.vatRate)} mva) · {p.modules.length ? p.modules.map((m) => MODULES[m as keyof typeof MODULES]?.name ?? m).join(", ") : "ingen moduler"}
                </p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => setEditing(p)}>
                Endre
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PackageForm({ pkg, onDone }: { pkg: BillingPackage | null; onDone: () => Promise<void> }) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [unitPrice, setUnitPrice] = useState(pkg?.unitPrice ?? "");
  const [vatRate, setVatRate] = useState(pkg?.vatRate ?? 0.25);
  const [modules, setModules] = useState<string[]>(pkg?.modules ?? []);
  const [active, setActive] = useState(pkg?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const body = { name, description: description.trim() || null, unitPrice, vatRate, modules, active };
    try {
      if (pkg) await adminFetch(`/billing/packages/${pkg.id}`, { method: "PATCH", body });
      else await adminFetch("/billing/packages", { method: "POST", body });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title={pkg ? pkg.name : "Ny pakke"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Navn">
            <input required maxLength={200} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Pris per måned eks. mva" hint="Endret pris gjelder nye fakturaer; sendte endres ikke.">
            <input required inputMode="decimal" className={inputClass} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </Field>
          <Field label="Mva">
            <select className={inputClass} value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))}>
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {percent(r)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Beskrivelse" hint="Valgfritt, bare for deg.">
          <input maxLength={1000} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Moduler som slås på</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {MODULE_KEYS.map((m) => (
              <label key={m} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={modules.includes(m)}
                  onChange={(e) => setModules(e.target.checked ? [...modules, m] : modules.filter((x) => x !== m))}
                />
                {MODULES[m].name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktiv (kan velges på nye fakturaer)
        </label>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            Lagre
          </button>
          <button type="button" className={secondaryButton} onClick={() => void onDone()}>
            Avbryt
          </button>
        </div>
      </form>
    </Card>
  );
}
