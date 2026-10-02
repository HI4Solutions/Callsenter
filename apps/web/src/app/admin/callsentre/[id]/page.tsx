"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isModuleKey, MODULES } from "@veriqall/shared";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  adminFetch,
  formatDate,
  formatDateTime,
  invitationState,
  organizationState,
  type OrganizationDetail,
} from "@/lib/admin";

const USER_STATUS: Record<string, string> = { invited: "Invitert", active: "Aktiv", disabled: "Deaktivert" };

export default function CallCentrePage() {
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
        {error ? <ErrorMessage message={error} /> : <p className="mt-6 text-muted">Laster …</p>}
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
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </div>
        <p className="mt-2 text-muted">Opprettet {formatDate(org.createdAt)}</p>
      </div>

      <Details org={org} onSaved={load} />
      <Modules org={org} onSaved={load} />
      <Members org={org} />
      <Invite org={org} onInvited={load} />
      <Invitations org={org} onChanged={load} />
    </section>
  );
}

function BackLink() {
  return (
    <Link href="/admin/callsentre" className="inline-flex min-h-11 items-center font-semibold text-brand">
      ← Alle callsentre
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Details({ org, onSaved }: { org: OrganizationDetail; onSaved: () => Promise<void> }) {
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
        body: { ...form, trialEndsAt: form.trialEndsAt || null },
      });
      await onSaved();
      setMessage("Lagret.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <Card title="Detaljer">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Navn">
            <input required className={inputClass} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Organisasjonsnummer">
            <input inputMode="numeric" className={inputClass} value={form.orgNumber} onChange={set("orgNumber")} />
          </Field>
          <Field label="Kontaktperson">
            <input className={inputClass} value={form.contactName} onChange={set("contactName")} />
          </Field>
          <Field label="E-post til kontaktperson">
            <input type="email" className={inputClass} value={form.contactEmail} onChange={set("contactEmail")} />
          </Field>
          <Field label="Telefon til kontaktperson">
            <input type="tel" className={inputClass} value={form.contactPhone} onChange={set("contactPhone")} />
          </Field>
          <Field label="Faktura-e-post">
            <input type="email" className={inputClass} value={form.invoiceEmail} onChange={set("invoiceEmail")} />
          </Field>
          <Field label="Fakturaadresse">
            <textarea rows={3} className={`${inputClass} py-2`} value={form.invoiceAddress} onChange={set("invoiceAddress")} />
          </Field>
          <Field label="Notat" hint="Bare synlig for superadmin.">
            <textarea rows={3} className={`${inputClass} py-2`} value={form.note} onChange={set("note")} />
          </Field>
          <Field label="Status" hint="Suspendert stenger callsenteret for alle brukerne der.">
            <select className={inputClass} value={form.status} onChange={set("status")}>
              <option value="active">Aktiv</option>
              <option value="suspended">Suspendert</option>
            </select>
          </Field>
          <Field label="Prøveperiode til" hint="Etter denne datoen stenges callsenteret. Tom = ingen prøveperiode.">
            <input type="date" className={inputClass} value={form.trialEndsAt} onChange={set("trialEndsAt")} />
          </Field>
        </div>
        <ErrorMessage message={error} />
        {message && <p role="status">{message}</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? "Lagrer …" : "Lagre"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Modules({ org, onSaved }: { org: OrganizationDetail; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    setError(null);
    try {
      await adminFetch(`/organizations/${org.id}`, { method: "PATCH", body: { modules: { [key]: enabled } } });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Moduler">
      <ul className="grid gap-3 sm:grid-cols-2">
        {org.modules.filter((m) => isModuleKey(m.key)).map((m) => {
          const info = MODULES[m.key as keyof typeof MODULES];
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
                  <span className="font-semibold">{info.name}</span>
                  <span className="block text-sm text-muted">{info.description}</span>
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
  return (
    <Card title={`Brukere (${org.members.length})`}>
      {org.members.length === 0 ? (
        <p className="text-muted">Ingen brukere ennå. Inviter admin for callsenteret under.</p>
      ) : (
        <ul className="divide-y divide-line">
          {org.members.map((m) => (
            <li key={m.userId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{m.name}</p>
                <p className="text-sm text-muted">{[m.phone, m.email].filter(Boolean).join(" · ") || "Ingen kontaktinfo"}</p>
              </div>
              <p className="text-sm">
                {m.roleName} · {m.status === "disabled" ? "Deaktivert i callsenteret" : USER_STATUS[m.userStatus]} · sist innlogget{" "}
                {formatDateTime(m.lastLoginAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Invite({ org, onInvited }: { org: OrganizationDetail; onInvited: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", roleKey: "admin" });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const result = await adminFetch<{ link: string; expiresAt: string }>(`/organizations/${org.id}/invitations`, {
        method: "POST",
        body: form,
      });
      setLink({ url: result.link, expiresAt: result.expiresAt });
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

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Card title="Inviter bruker">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Navn">
            <input required className={inputClass} value={form.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Rolle">
            <select className={inputClass} value={form.roleKey} onChange={set("roleKey")}>
              {org.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mobilnummer" hint="Med Vipps kobles brukeren automatisk via mobilnummeret.">
            <input type="tel" className={inputClass} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="E-post">
            <input type="email" className={inputClass} value={form.email} onChange={set("email")} />
          </Field>
        </div>
        <ErrorMessage message={error} />
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? "Lager invitasjon …" : "Lag invitasjon"}
          </button>
        </div>
      </form>
      {link && (
        <div className="mt-6 rounded-lg border border-line p-4">
          <p className="font-semibold">Invitasjonslenke</p>
          <p className="mt-1 text-sm text-muted">
            Send lenken til personen. Den kan brukes én gang og gjelder til {formatDateTime(link.expiresAt)}. Den vises bare nå.
          </p>
          <p className="mt-3 break-all rounded-lg bg-bg p-3 font-mono text-sm">{link.url}</p>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={copy}>
            {copied ? "Kopiert" : "Kopier lenke"}
          </button>
        </div>
      )}
    </Card>
  );
}

function Invitations({ org, onChanged }: { org: OrganizationDetail; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);

  async function revoke(invitationId: string) {
    setError(null);
    try {
      await adminFetch(`/organizations/${org.id}/invitations/${invitationId}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (org.invitations.length === 0) return null;
  return (
    <Card title="Invitasjoner">
      <ul className="divide-y divide-line">
        {org.invitations.map((inv) => {
          const state = invitationState(inv);
          return (
            <li key={inv.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{inv.name}</p>
                <p className="text-sm text-muted">
                  Laget {formatDateTime(inv.createdAt)} · {state}
                </p>
              </div>
              {state === "Venter" && (
                <button type="button" className={secondaryButton} onClick={() => revoke(inv.id)}>
                  Trekk tilbake
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
