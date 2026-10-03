"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { adminFetch, formatDateTime } from "@/lib/admin";
import { API_URL } from "@/lib/auth";
import type { BillingSettings } from "@/lib/billing";

type Form = Record<
  | "companyName"
  | "orgNumber"
  | "address"
  | "email"
  | "accountNumber"
  | "footer"
  | "priceAudioHour"
  | "priceAiControl"
  | "dueDays"
  | "nextNumber"
  | "invoiceFee"
  | "recurringDaysBefore"
  | "copyEmail",
  string
> & {
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
    invoiceFee: s.invoiceFee ?? "",
    recurringDaysBefore: String(s.recurringDaysBefore),
    copyEmail: s.copyEmail ?? "",
    vatRegistered: s.vatRegistered,
  };
}

// The seller on every invoice, payment terms, numbering and prices for usage.
export default function BillingSettingsPage() {
  const t = useTranslations("economy");
  const tc = useTranslations("common");
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
          invoiceFee: nullable(form.invoiceFee),
          recurringDaysBefore: Number(form.recurringDaysBefore),
          copyEmail: nullable(form.copyEmail),
          vatRegistered: form.vatRegistered,
          ...(Number(form.nextNumber) !== settings.nextNumber
            ? { nextNumber: Number(form.nextNumber) }
            : {}),
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

  const field = (
    key: keyof Omit<Form, "vatRegistered">,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        className={inputClass}
        value={form![key]}
        onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
        {...props}
      />
    </Field>
  );

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("settings.intro")}</p>
      </div>
      <EconomyNav />
      <ErrorMessage message={error} />
      {!form ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-6">
          <Card title={t("settings.sender")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("companyName", t("settings.companyName"), {
                maxLength: 200,
              })}
              {field("orgNumber", t("settings.orgNumber"), {
                inputMode: "numeric",
              })}
              {field("accountNumber", t("settings.accountNumber"), {
                inputMode: "numeric",
              })}
              {field("email", t("settings.email"), { type: "email" })}
              <Field label={t("settings.address")}>
                <textarea
                  rows={3}
                  maxLength={500}
                  className={`${inputClass} py-2`}
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </Field>
              <Field
                label={t("settings.footer")}
                hint={t("settings.footerHint")}
              >
                <textarea
                  rows={3}
                  maxLength={1000}
                  className={`${inputClass} py-2`}
                  value={form.footer}
                  onChange={(e) => setForm({ ...form, footer: e.target.value })}
                />
              </Field>
            </div>
            <label className="mt-4 inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={form.vatRegistered}
                onChange={(e) =>
                  setForm({ ...form, vatRegistered: e.target.checked })
                }
              />
              {t("settings.vatRegistered")}
            </label>
          </Card>
          <Logo settings={settings!} onChanged={setSettings} />
          <Card title={t("settings.terms")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("dueDays", t("settings.dueDays"), {
                type: "number",
                min: 0,
                max: 90,
              })}
              {field("recurringDaysBefore", t("settings.recurringDaysBefore"), {
                type: "number",
                min: 0,
                max: 60,
              })}
              {field(
                "invoiceFee",
                t("settings.invoiceFee"),
                { inputMode: "decimal" },
                t("settings.invoiceFeeHint"),
              )}
              {field(
                "nextNumber",
                t("settings.nextNumber"),
                { type: "number", min: 1 },
                t("settings.nextNumberHint"),
              )}
            </div>
          </Card>
          <Card title={t("settings.emailTitle")}>
            <p className="mb-4 text-sm text-muted">
              {settings?.emailEnabled
                ? t("settings.emailEnabled")
                : t("settings.emailDisabled")}
            </p>
            {field(
              "copyEmail",
              t("settings.copyEmail"),
              { type: "email" },
              t("settings.copyEmailHint"),
            )}
          </Card>
          <Card title={t("settings.usagePrices")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                "priceAudioHour",
                t("settings.priceAudioHour"),
                { inputMode: "decimal" },
                t("settings.priceAudioHourHint"),
              )}
              {field(
                "priceAiControl",
                t("settings.priceAiControl"),
                { inputMode: "decimal" },
                t("settings.priceAiControlHint"),
              )}
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className={primaryButton}>
              {t("shared.save")}
            </button>
            {saved && <span role="status">{t("shared.saved")}</span>}
            {settings && (
              <span className="text-sm text-muted">
                {t("shared.lastChanged", {
                  time: formatDateTime(settings.updatedAt),
                })}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

// The logo on invoices (PNG or JPEG, up to 500 kB). No logo: the seller's name in bold instead.
function Logo({
  settings,
  onChanged,
}: {
  settings: BillingSettings;
  onChanged: (s: BillingSettings) => void;
}) {
  const t = useTranslations("economy.settings");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings.hasLogo) return;
    let url: string | null = null;
    let cancelled = false;
    fetch(`${API_URL}/admin/billing/logo`, { credentials: "include" })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings.hasLogo, settings.updatedAt]);

  async function upload(file: File) {
    setError(null);
    if (file.type !== "image/png" && file.type !== "image/jpeg")
      return setError(t("logoType"));
    if (file.size > 500_000) return setError(t("logoSize"));
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      await adminFetch("/billing/logo", {
        method: "PUT",
        body: { type: file.type, data: btoa(binary) },
      });
      onChanged(await adminFetch<BillingSettings>("/billing/settings"));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(t("confirmRemoveLogo"))) return;
    setBusy(true);
    try {
      await adminFetch("/billing/logo", { method: "DELETE" });
      setPreview(null);
      onChanged(await adminFetch<BillingSettings>("/billing/settings"));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("logo")}>
      <div className="flex flex-col gap-3">
        {settings.hasLogo && preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob from the API, not a static asset
          <img
            src={preview}
            alt={t("logoAlt")}
            className="max-h-16 max-w-48 self-start rounded bg-white p-2"
          />
        ) : (
          <p className="text-sm text-muted">{t("noLogo")}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${secondaryButton} cursor-pointer`}>
            {settings.hasLogo ? t("replaceLogo") : t("uploadLogo")}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          {settings.hasLogo && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={remove}
            >
              {t("removeLogo")}
            </button>
          )}
        </div>
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}
