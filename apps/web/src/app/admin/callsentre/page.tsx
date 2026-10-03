"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MODULE_KEYS } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  adminFetch,
  formatDateTime,
  organizationState,
  type OrganizationSummary,
} from "@/lib/admin";

export default function CallCentresPage() {
  const t = useTranslations("admin.organizations");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [organizations, setOrganizations] = useState<
    OrganizationSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<OrganizationSummary[]>("/organizations")
      .then((rows) => !cancelled && setOrganizations(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!organizations || !q) return organizations;
    return organizations.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.orgNumber?.includes(q.replace(/\s/g, "")),
    );
  }, [organizations, query]);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        {!creating && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setCreating(true)}
          >
            {t("new")}
          </button>
        )}
      </div>

      {creating && <NewCallCentre onCancel={() => setCreating(false)} />}

      <div className="mt-8">
        <Field label={t("search")}>
          <input
            type="search"
            className={`${inputClass} w-full sm:max-w-sm`}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-6">
        <ErrorMessage message={error} />
        {!shown && !error && <p className="text-muted">{tc("loading")}</p>}
        {shown && shown.length === 0 && (
          <p className="text-muted">{query ? t("noneMatch") : t("noneYet")}</p>
        )}
        {shown && shown.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {shown.map((org) => {
              const state = organizationState(org);
              return (
                <li key={org.id}>
                  <Link
                    href={`/admin/callsentre/${org.id}`}
                    className="flex flex-col gap-2 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">{org.name}</p>
                      <p className="text-sm text-muted">
                        {org.orgNumber
                          ? `${t("orgNumber", { number: org.orgNumber })} · `
                          : ""}
                        {t("members", {
                          active: org.activeMembers,
                          invited: org.invitedMembers,
                        })}{" "}
                        ·{" "}
                        {org.lastLoginAt
                          ? t("lastLogin", {
                              date: formatDateTime(org.lastLoginAt),
                            })
                          : t("noLogins")}
                      </p>
                    </div>
                    <StatusBadge tone={state.tone}>
                      {ta(`organizationState.${state.key}`, {
                        date: state.date,
                      })}
                    </StatusBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewCallCentre({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("admin.organizations");
  const ts = useTranslations("admin.shared");
  const td = useTranslations("domain");
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    orgNumber: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    trialEndsAt: "",
  });
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await adminFetch<{ id: string }>("/organizations", {
        method: "POST",
        body: { ...form, trialEndsAt: form.trialEndsAt || null, modules },
      });
      router.push(`/admin/callsentre/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <form
      onSubmit={submit}
      className="mt-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6"
    >
      <h2 className="text-xl font-bold">{t("new")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")}>
          <input
            required
            className={inputClass}
            value={form.name}
            onChange={set("name")}
          />
        </Field>
        <Field label={t("orgNumberLabel")}>
          <input
            inputMode="numeric"
            className={inputClass}
            value={form.orgNumber}
            onChange={set("orgNumber")}
          />
        </Field>
        <Field label={t("contactName")}>
          <input
            className={inputClass}
            value={form.contactName}
            onChange={set("contactName")}
          />
        </Field>
        <Field label={t("contactEmail")}>
          <input
            type="email"
            className={inputClass}
            value={form.contactEmail}
            onChange={set("contactEmail")}
          />
        </Field>
        <Field label={t("contactPhone")}>
          <input
            type="tel"
            className={inputClass}
            value={form.contactPhone}
            onChange={set("contactPhone")}
          />
        </Field>
        <Field label={t("trialUntil")} hint={t("trialHint")}>
          <input
            type="date"
            className={inputClass}
            value={form.trialEndsAt}
            onChange={set("trialEndsAt")}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">{t("modules")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {MODULE_KEYS.map((key) => (
            <label key={key} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={modules[key] ?? false}
                onChange={(e) =>
                  setModules({ ...modules, [key]: e.target.checked })
                }
              />
              {td(`modules.${key}.name`)}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton} disabled={saving}>
          {saving ? t("creating") : t("create")}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          {ts("cancel")}
        </button>
      </div>
    </form>
  );
}
