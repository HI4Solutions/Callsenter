"use client";

import { MODULE_KEYS, type ModuleKey } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch } from "@/lib/admin";
import { type BillingPackage, kr, percent, VAT_RATES } from "@/lib/billing";

// Packages: what call centres buy. A package line on an invoice with access switches on the
// package's modules for the call centre.
export default function PackagesPage() {
  const t = useTranslations("economy");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
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
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("packages.intro")}</p>
      </div>
      <EconomyNav />
      {!editing && (
        <div>
          <button
            type="button"
            className={primaryButton}
            onClick={() => setEditing("new")}
          >
            {t("packages.new")}
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
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : packages.length === 0 ? (
        <p className="text-muted">{t("packages.empty")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {packages.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {p.name}
                  {!p.active && (
                    <span className="ml-2 text-sm font-normal text-muted">
                      {t("packages.archived")}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted">
                  {t("packages.priceLine", {
                    price: kr(p.unitPrice),
                    vat: percent(p.vatRate),
                    modules: p.modules.length
                      ? p.modules
                          .map((m) =>
                            (MODULE_KEYS as readonly string[]).includes(m)
                              ? td(`modules.${m as ModuleKey}.name`)
                              : m,
                          )
                          .join(", ")
                      : t("packages.noModules"),
                  })}
                </p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setEditing(p)}
              >
                {t("shared.edit")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PackageForm({
  pkg,
  onDone,
}: {
  pkg: BillingPackage | null;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations("economy");
  const td = useTranslations("domain");
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
    const body = {
      name,
      description: description.trim() || null,
      unitPrice,
      vatRate,
      modules,
      active,
    };
    try {
      if (pkg)
        await adminFetch(`/billing/packages/${pkg.id}`, {
          method: "PATCH",
          body,
        });
      else await adminFetch("/billing/packages", { method: "POST", body });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title={pkg ? pkg.name : t("packages.new")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("shared.name")}>
            <input
              required
              maxLength={200}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label={t("packages.pricePerMonth")}
            hint={t("packages.priceHint")}
          >
            <input
              required
              inputMode="decimal"
              className={inputClass}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </Field>
          <Field label={t("shared.vat")}>
            <select
              className={inputClass}
              value={vatRate}
              onChange={(e) => setVatRate(Number(e.target.value))}
            >
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {percent(r)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label={t("shared.description")}
          hint={t("packages.descriptionHint")}
        >
          <input
            maxLength={1000}
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            {t("packages.modules")}
          </legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {MODULE_KEYS.map((m) => (
              <label
                key={m}
                className="inline-flex min-h-11 items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={modules.includes(m)}
                  onChange={(e) =>
                    setModules(
                      e.target.checked
                        ? [...modules, m]
                        : modules.filter((x) => x !== m),
                    )
                  }
                />
                {td(`modules.${m}.name`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t("packages.activeHint")}
        </label>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            {t("shared.save")}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void onDone()}
          >
            {t("shared.cancel")}
          </button>
        </div>
      </form>
    </Card>
  );
}
