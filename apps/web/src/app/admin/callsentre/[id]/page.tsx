"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  isModuleKey,
  type Locale,
  LOCALE_CODES,
  LOCALES,
} from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { SpokenLanguages } from "@/components/calls/call-languages";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  LoadState,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  adminFetch,
  formatDate,
  formatDateTime,
  invitationKey,
  organizationState,
  type OrganizationDetail,
} from "@/lib/admin";
import { switchOrganization } from "@/lib/org";

export default function CallCentrePage() {
  const t = useTranslations("admin.organization");
  const ta = useTranslations("admin");
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      adminFetch<OrganizationDetail>(`/organizations/${id}`)
        .then(setOrg)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<OrganizationDetail>(`/organizations/${id}`)
      .then((detail) => !cancelled && setOrg(detail))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!org) {
    return (
      <section>
        <BackLink />
        <div className="mt-6">
          <LoadState error={error} />
        </div>
      </section>
    );
  }

  const state = organizationState(org);
  return (
    <section className="flex flex-col gap-10">
      <div>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">{org.name}</h1>
          <StatusBadge tone={state.tone}>
            {ta(`organizationState.${state.key}`, { date: state.date })}
          </StatusBadge>
        </div>
        <p className="mt-2 text-muted">
          {t("created", { date: formatDate(org.createdAt) })}
        </p>
        <OpenAsAdmin orgId={org.id} />
      </div>

      <Details org={org} onSaved={load} />
      <Languages org={org} onSaved={load} />
      <Modules org={org} onSaved={load} />
      <Members org={org} />
      <Invite org={org} onInvited={load} />
      <Invitations org={org} onChanged={load} />
    </section>
  );
}

// Steps into the call centre (the session's current call centre) and opens its admin portal.
function OpenAsAdmin({ orgId }: { orgId: string }) {
  const t = useTranslations("admin.organization");
  const [error, setError] = useState<string | null>(null);
  async function open() {
    try {
      await switchOrganization(orgId);
      // A full page load (absolute URL), so the header picks up the new call centre.
      window.location.href = new URL(
        "/administrasjon",
        window.location.origin,
      ).href;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="mt-4">
      <button type="button" className={secondaryButton} onClick={open}>
        {t("openAdmin")}
      </button>
      <ErrorMessage message={error} />
    </div>
  );
}

function BackLink() {
  const t = useTranslations("admin.organization");
  return (
    <Link
      href="/admin/callsentre"
      className="inline-flex min-h-11 items-center font-semibold text-brand"
    >
      ← {t("back")}
    </Link>
  );
}

function Details({
  org,
  onSaved,
}: {
  org: OrganizationDetail;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("admin.organization");
  const to = useTranslations("admin.organizations");
  const ts = useTranslations("admin.shared");
  const ta = useTranslations("admin");
  const [form, setForm] = useState({
    name: org.name,
    orgNumber: org.orgNumber ?? "",
    contactName: org.contactName ?? "",
    contactEmail: org.contactEmail ?? "",
    contactPhone: org.contactPhone ?? "",
    invoiceEmail: org.invoiceEmail ?? "",
    invoiceAddress: org.invoiceAddress ?? "",
    note: org.note ?? "",
    status: org.status,
    trialEndsAt: org.trialEndsAt?.slice(0, 10) ?? "",
    recordingRetentionMonths: String(org.recordingRetentionMonths ?? 12),
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await adminFetch(`/organizations/${org.id}`, {
        method: "PATCH",
        body: {
          ...form,
          trialEndsAt: form.trialEndsAt || null,
          recordingRetentionMonths: Number(form.recordingRetentionMonths),
        },
      });
      await onSaved();
      setMessage(ts("saved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const set =
    (key: keyof typeof form) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <Card title={t("details")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={to("name")}>
            <input
              required
              className={inputClass}
              value={form.name}
              onChange={set("name")}
            />
          </Field>
          <Field label={to("orgNumberLabel")}>
            <input
              inputMode="numeric"
              className={inputClass}
              value={form.orgNumber}
              onChange={set("orgNumber")}
            />
          </Field>
          <Field label={to("contactName")}>
            <input
              className={inputClass}
              value={form.contactName}
              onChange={set("contactName")}
            />
          </Field>
          <Field label={to("contactEmail")}>
            <input
              type="email"
              className={inputClass}
              value={form.contactEmail}
              onChange={set("contactEmail")}
            />
          </Field>
          <Field label={to("contactPhone")}>
            <input
              type="tel"
              className={inputClass}
              value={form.contactPhone}
              onChange={set("contactPhone")}
            />
          </Field>
          <Field label={t("invoiceEmail")}>
            <input
              type="email"
              className={inputClass}
              value={form.invoiceEmail}
              onChange={set("invoiceEmail")}
            />
          </Field>
          <Field label={t("invoiceAddress")}>
            <textarea
              rows={3}
              className={`${inputClass} py-2`}
              value={form.invoiceAddress}
              onChange={set("invoiceAddress")}
            />
          </Field>
          <Field label={t("note")} hint={t("noteHint")}>
            <textarea
              rows={3}
              className={`${inputClass} py-2`}
              value={form.note}
              onChange={set("note")}
            />
          </Field>
          <Field label={t("status")} hint={t("statusHint")}>
            <select
              className={inputClass}
              value={form.status}
              onChange={set("status")}
            >
              <option value="active">{ta("organizationState.active")}</option>
              <option value="suspended">
                {ta("organizationState.suspended")}
              </option>
            </select>
          </Field>
          <Field label={to("trialUntil")} hint={t("trialHint")}>
            <input
              type="date"
              className={inputClass}
              value={form.trialEndsAt}
              onChange={set("trialEndsAt")}
            />
          </Field>
          <Field label={t("retention")} hint={t("retentionHint")}>
            <select
              className={inputClass}
              value={form.recordingRetentionMonths}
              onChange={set("recordingRetentionMonths")}
            >
              {[3, 6, 9, 12].map((m) => (
                <option key={m} value={m}>
                  {t("retentionMonths", { count: m })}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorMessage message={error} />
        {message && <p role="status">{message}</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? ts("saving") : ts("save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

// The call centre's languages (docs/plan.md, section 19): the pages for users without their own
// choice, the notes and the AI control, and the languages spoken in its calls (for Soniox).
function Languages({
  org,
  onSaved,
}: {
  org: OrganizationDetail;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("languages");
  const [form, setForm] = useState({
    defaultLocale: org.defaultLocale ?? "nb",
    contentLocale: org.contentLocale ?? "nb",
    transcriptionLanguages: org.transcriptionLanguages?.length
      ? org.transcriptionLanguages
      : ["no"],
    contentLocaleLocked: org.contentLocaleLocked ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await adminFetch(`/organizations/${org.id}`, {
        method: "PATCH",
        body: form,
      });
      await onSaved();
      setMessage(t("saved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const choose = (key: "defaultLocale" | "contentLocale") => (
    <select
      className={inputClass}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value as Locale })}
    >
      {LOCALE_CODES.map((code) => (
        <option key={code} value={code} lang={LOCALES[code].tag}>
          {LOCALES[code].name}
        </option>
      ))}
    </select>
  );

  return (
    <Card title={t("title")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-muted">{t("orgIntro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("pageLanguage")} hint={t("pageLanguageHint")}>
            {choose("defaultLocale")}
          </Field>
          <Field label={t("contentLanguage")} hint={t("outputLanguageHint")}>
            {choose("contentLocale")}
          </Field>
        </div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={form.contentLocaleLocked}
            onChange={(e) =>
              setForm({ ...form, contentLocaleLocked: e.target.checked })
            }
          />
          <span>
            <span className="font-semibold">{t("lockContent")}</span>
            <span className="block text-sm text-muted">
              {t("lockContentHint")}
            </span>
          </span>
        </label>
        <SpokenLanguages
          label={t("transcriptionLanguages")}
          value={form.transcriptionLanguages}
          onChange={(next) =>
            setForm({ ...form, transcriptionLanguages: next })
          }
        />
        <ErrorMessage message={error} />
        {message && <p role="status">{message}</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Modules({
  org,
  onSaved,
}: {
  org: OrganizationDetail;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("admin.organizations");
  const td = useTranslations("domain");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    setError(null);
    try {
      await adminFetch(`/organizations/${org.id}`, {
        method: "PATCH",
        body: { modules: { [key]: enabled } },
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={t("modules")}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {org.modules
          .filter((m) => isModuleKey(m.key))
          .map((m) => {
            const key = m.key as "sales";
            return (
              <li key={m.key}>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-brand"
                    checked={m.enabled}
                    disabled={busy !== null}
                    onChange={(e) => toggle(m.key, e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">
                      {td(`modules.${key}.name`)}
                    </span>
                    <span className="block text-sm text-muted">
                      {td(`modules.${key}.description`)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
      </ul>
      <div className="mt-3">
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}

function Members({ org }: { org: OrganizationDetail }) {
  const t = useTranslations("admin.organization");
  const td = useTranslations("domain");
  return (
    <Card title={t("members", { count: org.members.length })}>
      {org.members.length === 0 ? (
        <p className="text-muted">{t("noMembers")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {org.members.map((m) => (
            <li
              key={m.userId}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <Link
                  href={`/admin/brukere/${m.userId}`}
                  className="font-semibold text-brand"
                >
                  {m.name}
                </Link>
                <p className="text-sm text-muted">
                  {[m.phone, m.email].filter(Boolean).join(" · ") ||
                    t("noContact")}
                </p>
              </div>
              <p className="text-sm">
                {m.roleName} ·{" "}
                {m.status === "disabled"
                  ? t("disabledHere")
                  : td(`userStatus.${m.userStatus}`)}{" "}
                · {t("lastLogin", { date: formatDateTime(m.lastLoginAt) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Invite({
  org,
  onInvited,
}: {
  org: OrganizationDetail;
  onInvited: () => Promise<void>;
}) {
  const t = useTranslations("admin.organization");
  const to = useTranslations("admin.organizations");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    roleKey: "admin",
  });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{
    url: string;
    expiresAt: string;
    emailedTo: string | null;
  } | null>(null);
  // The person already has a login elsewhere: added without a link.
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setLink(null);
    setAdded(false);
    setCopied(false);
    try {
      const result = await adminFetch<{
        link: string | null;
        expiresAt: string | null;
        emailed: boolean;
      }>(`/organizations/${org.id}/invitations`, {
        method: "POST",
        body: form,
      });
      if (result.link && result.expiresAt) {
        setLink({
          url: result.link,
          expiresAt: result.expiresAt,
          emailedTo: result.emailed ? form.email.trim() : null,
        });
      } else {
        setAdded(true);
      }
      setForm({ fullName: "", phone: "", email: "", roleKey: "admin" });
      await onInvited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <Card title={t("invite")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={to("name")}>
            <input
              required
              className={inputClass}
              value={form.fullName}
              onChange={set("fullName")}
            />
          </Field>
          <Field label={t("role")}>
            <select
              className={inputClass}
              value={form.roleKey}
              onChange={set("roleKey")}
            >
              {org.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("mobile")} hint={t("mobileHint")}>
            <input
              type="tel"
              className={inputClass}
              value={form.phone}
              onChange={set("phone")}
            />
          </Field>
          <Field label={t("email")}>
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={set("email")}
            />
          </Field>
        </div>
        <ErrorMessage message={error} />
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? t("creatingInvite") : t("createInvite")}
          </button>
        </div>
      </form>
      {added && (
        <p role="status" className="mt-6 rounded-lg border border-line p-4">
          {t("alreadyUser")}
        </p>
      )}
      {link && (
        <div className="mt-6 rounded-lg border border-line p-4">
          <p className="font-semibold">{t("inviteLink")}</p>
          {link.emailedTo && (
            <p className="mt-1" role="status">
              {t("emailedTo", { email: link.emailedTo })}
            </p>
          )}
          <p className="mt-1 text-sm text-muted">
            {link.emailedTo ? t("sendYourself") : t("sendToPerson")}{" "}
            {t("linkValid", { date: formatDateTime(link.expiresAt) })}
          </p>
          <p className="mt-3 break-all rounded-lg bg-bg p-3 font-mono text-sm">
            {link.url}
          </p>
          <button
            type="button"
            className={`${secondaryButton} mt-3`}
            onClick={copy}
          >
            {copied ? t("copied") : t("copyLink")}
          </button>
        </div>
      )}
    </Card>
  );
}

function Invitations({
  org,
  onChanged,
}: {
  org: OrganizationDetail;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.organization");
  const ta = useTranslations("admin");
  const [error, setError] = useState<string | null>(null);

  async function revoke(invitationId: string) {
    setError(null);
    try {
      await adminFetch(`/organizations/${org.id}/invitations/${invitationId}`, {
        method: "DELETE",
      });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (org.invitations.length === 0) return null;
  return (
    <Card title={t("invitations")}>
      <ul className="divide-y divide-line">
        {org.invitations.map((inv) => {
          const state = invitationKey(inv);
          return (
            <li
              key={inv.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">{inv.name}</p>
                <p className="text-sm text-muted">
                  {t("invitationMade", { date: formatDateTime(inv.createdAt) })}{" "}
                  · {ta(`invitationState.${state}`)}
                </p>
              </div>
              {state === "pending" && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => revoke(inv.id)}
                >
                  {t("revoke")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}
