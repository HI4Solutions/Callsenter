"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import type { Customer } from "@/lib/work";

const KINDS: Customer["kind"][] = ["person", "business"];

type Values = Record<
  | "name"
  | "birthDate"
  | "orgNumber"
  | "contactName"
  | "phone"
  | "email"
  | "addressLine"
  | "postalCode"
  | "city"
  | "note",
  string
>;

function initialValues(c?: Customer): Values {
  return {
    name: c?.name ?? "",
    birthDate: c?.birthDate?.slice(0, 10) ?? "",
    orgNumber: c?.orgNumber ?? "",
    contactName: c?.contactName ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    addressLine: c?.addressLine ?? "",
    postalCode: c?.postalCode ?? "",
    city: c?.city ?? "",
    note: c?.note ?? "",
  };
}

// Create or edit a customer. Empty fields are sent as null, so clearing a field clears it.
export function CustomerForm({
  customer,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  customer?: Customer;
  submitLabel: string;
  onSubmit: (body: Record<string, string | null>) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations("work");
  const td = useTranslations("domain");
  const [kind, setKind] = useState<Customer["kind"]>(
    customer?.kind ?? "person",
  );
  const [values, setValues] = useState(() => initialValues(customer));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set =
    (key: keyof Values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const own =
      kind === "person" ? ["birthDate"] : ["orgNumber", "contactName"];
    const shared = [
      "name",
      "phone",
      "email",
      "addressLine",
      "postalCode",
      "city",
      "note",
    ];
    const body: Record<string, string | null> = {};
    for (const key of [...shared, ...own] as (keyof Values)[])
      body[key] = values[key].trim() || null;
    if (!customer) body.kind = kind;
    try {
      // On success the page navigates or closes the form; staying busy stops a second submit.
      await onSubmit(body);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!customer && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-semibold">
            {t("customerForm.kind")}
          </legend>
          {KINDS.map((k) => (
            <label key={k} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {td(`customerKind.${k}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={
            kind === "business"
              ? t("customerForm.companyName")
              : t("customerForm.name")
          }
        >
          <input
            required
            maxLength={200}
            className={inputClass}
            value={values.name}
            onChange={set("name")}
          />
        </Field>
        {kind === "person" ? (
          <Field label={t("customerForm.birthDate")}>
            <input
              type="date"
              min="1900-01-01"
              className={inputClass}
              value={values.birthDate}
              onChange={set("birthDate")}
            />
          </Field>
        ) : (
          <Field label={t("customerForm.orgNumber")}>
            <input
              inputMode="numeric"
              maxLength={11}
              className={inputClass}
              value={values.orgNumber}
              onChange={set("orgNumber")}
            />
          </Field>
        )}
        {kind === "business" && (
          <Field label={t("customerForm.contactName")}>
            <input
              maxLength={200}
              className={inputClass}
              value={values.contactName}
              onChange={set("contactName")}
            />
          </Field>
        )}
        <Field label={t("customerForm.phone")}>
          <input
            type="tel"
            autoComplete="off"
            maxLength={30}
            className={inputClass}
            value={values.phone}
            onChange={set("phone")}
          />
        </Field>
        <Field label={t("customerForm.email")}>
          <input
            type="email"
            autoComplete="off"
            maxLength={254}
            className={inputClass}
            value={values.email}
            onChange={set("email")}
          />
        </Field>
        <Field label={t("customerForm.address")}>
          <input
            maxLength={200}
            className={inputClass}
            value={values.addressLine}
            onChange={set("addressLine")}
          />
        </Field>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
          <Field label={t("customerForm.postalCode")}>
            <input
              inputMode="numeric"
              maxLength={4}
              className={inputClass}
              value={values.postalCode}
              onChange={set("postalCode")}
            />
          </Field>
          <Field label={t("customerForm.city")}>
            <input
              maxLength={100}
              className={inputClass}
              value={values.city}
              onChange={set("city")}
            />
          </Field>
        </div>
      </div>
      <Field label={t("customerForm.note")} hint={t("customerForm.noteHint")}>
        <textarea
          rows={3}
          maxLength={2000}
          className={`${inputClass} py-2`}
          value={values.note}
          onChange={set("note")}
        />
      </Field>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel}>
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
