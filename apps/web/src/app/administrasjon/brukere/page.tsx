"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { useMe } from "@/components/org/org-shell";
import { formatDateTime, invitationState, toCsv } from "@/lib/format";
import { memberState, orgFetch, type OrgOverview } from "@/lib/org";

// invitationState() gives the state in Norwegian; the key in org.users.invitations.state.
const INVITATION_STATE = { Brukt: "used", "Trukket tilbake": "revoked", Utløpt: "expired", Venter: "pending" } as const;

export default function MembersPage() {
  const me = useMe();
  const t = useTranslations("org.users");
  const td = useTranslations("domain");
  const [data, setData] = useState<OrgOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reload = useCallback(
    () =>
      orgFetch<OrgOverview>("/overview")
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<OrgOverview>("/overview")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <LoadState error={error} />;

  const q = query.trim().toLowerCase();
  const shown = q
    ? data.members.filter((m) => m.name.toLowerCase().includes(q) || m.phone?.includes(q.replace(/\s/g, "")) || m.email?.toLowerCase().includes(q))
    : data.members;

  function exportCsv() {
    if (!data) return;
    const csv = toCsv(
      [t("csv.name"), t("csv.phone"), t("csv.email"), t("csv.role"), t("csv.team"), t("csv.status"), t("csv.lastLogin")],
      data.members.map((m) => [
        m.name,
        m.phone,
        m.email,
        m.roleName,
        m.teamName,
        td(`userStatus.${memberState(m).key}`),
        m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "",
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = t("csvFile", { date: new Date().toISOString().slice(0, 10) });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        <button type="button" className={secondaryButton} onClick={exportCsv}>
          {t("exportCsv")}
        </button>
      </div>

      <Invite data={data} onInvited={reload} />

      <div>
        <Field label={t("search")}>
          <input
            type="search"
            className={`${inputClass} w-full sm:max-w-sm`}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <ErrorMessage message={error} />
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((m) => (
            <MemberRow key={m.userId} member={m} data={data} self={m.userId === me?.user.id} onChanged={reload} />
          ))}
          {shown.length === 0 && <li className="p-4 text-muted">{t("noMatch")}</li>}
        </ul>
      </div>

      <Invitations data={data} onChanged={reload} />
    </section>
  );
}

function MemberRow({
  member,
  data,
  self,
  onChanged,
}: {
  member: OrgOverview["members"][number];
  data: OrgOverview;
  self: boolean;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("org.users");
  const td = useTranslations("domain");
  const state = memberState(member);

  async function update(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await orgFetch(`/members/${member.userId}`, { method: "PATCH", body });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeTeams = data.teams.filter((t) => !t.archivedAt);
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {member.name}
            {self && <span className="ml-2 text-sm font-medium text-muted">{t("you")}</span>}
          </p>
          <p className="text-sm text-muted">
            {[member.phone, member.email].filter(Boolean).join(" · ") || t("noContact")} ·{" "}
            {t("lastLogin", { when: formatDateTime(member.lastLoginAt) })}
          </p>
        </div>
        <StatusBadge tone={state.tone}>{td(`userStatus.${state.key}`)}</StatusBadge>
      </div>
      {self ? (
        <p className="text-sm">
          {member.roleName}
          {member.teamName && ` · ${member.teamName}`}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("role")}>
            <select className={inputClass} value={member.roleId} disabled={busy} onChange={(e) => update({ roleId: e.target.value })}>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.assignable && r.id !== member.roleId}>
                  {r.name}
                  {!r.assignable ? ` ${t("lacksPermissions")}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("team")}>
            <select className={inputClass} value={member.teamId ?? ""} disabled={busy} onChange={(e) => update({ teamId: e.target.value || null })}>
              <option value="">{t("noTeam")}</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() =>
              member.status === "active" ? update({ status: "disabled" }, t("confirmDisable", { name: member.name })) : update({ status: "active" })
            }
          >
            {member.status === "active" ? t("disable") : t("enable")}
          </button>
        </div>
      )}
      <ErrorMessage message={error} />
    </li>
  );
}

function Invite({ data, onInvited }: { data: OrgOverview; onInvited: () => Promise<void> }) {
  const assignable = data.roles.filter((r) => r.assignable);
  const defaultRole = assignable.find((r) => r.key === "seller") ?? assignable[0];
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", roleId: defaultRole?.id ?? "", teamId: "" });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string; emailedTo: string | null } | null>(null);
  // The person already has a login elsewhere: added without a link.
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const t = useTranslations("org.users");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setLink(null);
    setAdded(false);
    setCopied(false);
    try {
      const result = await orgFetch<{ link: string | null; expiresAt: string | null; emailed: boolean }>("/invitations", {
        method: "POST",
        body: { ...form, teamId: form.teamId || null },
      });
      if (result.link && result.expiresAt) {
        setLink({ url: result.link, expiresAt: result.expiresAt, emailedTo: result.emailed ? form.email.trim() : null });
      } else {
        setAdded(true);
      }
      setForm({ ...form, fullName: "", phone: "", email: "" });
      await onInvited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <Card title={t("invite.title")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("invite.name")}>
            <input required className={inputClass} value={form.fullName} onChange={set("fullName")} />
          </Field>
          <Field label={t("invite.phone")} hint={t("invite.phoneHint")}>
            <input type="tel" className={inputClass} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label={t("invite.email")}>
            <input type="email" className={inputClass} value={form.email} onChange={set("email")} />
          </Field>
          <Field label={t("role")}>
            <select required className={inputClass} value={form.roleId} onChange={set("roleId")}>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("team")}>
            <select className={inputClass} value={form.teamId} onChange={set("teamId")}>
              <option value="">{t("noTeam")}</option>
              {data.teams
                .filter((t) => !t.archivedAt)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <ErrorMessage message={error} />
        <div>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? t("invite.creating") : t("invite.create")}
          </button>
        </div>
      </form>
      {added && (
        <p role="status" className="mt-6 rounded-lg border border-line p-4">
          {t("invite.added")}
        </p>
      )}
      {link && (
        <div className="mt-6 rounded-lg border border-line p-4">
          <p className="font-semibold">{t("invite.link")}</p>
          {link.emailedTo && (
            <p className="mt-1" role="status">
              {t("invite.emailed", { email: link.emailedTo })}
            </p>
          )}
          <p className="mt-1 text-sm text-muted">
            {link.emailedTo ? t("invite.alsoSendYourself") : t("invite.sendIt")} {t("invite.validity", { date: formatDateTime(link.expiresAt) })}
          </p>
          <p className="mt-3 break-all rounded-lg bg-bg p-3 font-mono text-sm">{link.url}</p>
          <button
            type="button"
            className={`${secondaryButton} mt-3`}
            onClick={() =>
              navigator.clipboard
                .writeText(link.url)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? t("invite.copied") : t("invite.copy")}
          </button>
        </div>
      )}
    </Card>
  );
}

function Invitations({ data, onChanged }: { data: OrgOverview; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("org.users.invitations");
  if (data.invitations.length === 0) return null;

  async function revoke(id: string) {
    setError(null);
    try {
      await orgFetch(`/invitations/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title={t("title")}>
      <ul className="divide-y divide-line">
        {data.invitations.map((inv) => {
          const state = invitationState(inv);
          return (
            <li key={inv.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{inv.name}</p>
                <p className="text-sm text-muted">
                  {t("created", { date: formatDateTime(inv.createdAt), state: t(`state.${INVITATION_STATE[state]}`) })}
                </p>
              </div>
              {state === "Venter" && (
                <button type="button" className={secondaryButton} onClick={() => revoke(inv.id)}>
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
