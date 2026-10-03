"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { useMe } from "@/components/org/org-shell";
import { formatDateTime, invitationState, toCsv } from "@/lib/format";
import { memberState, orgFetch, type OrgOverview } from "@/lib/org";

export default function MembersPage() {
  const me = useMe();
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

  if (!data) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;

  const q = query.trim().toLowerCase();
  const shown = q
    ? data.members.filter(
        (m) => m.name.toLowerCase().includes(q) || m.phone?.includes(q.replace(/\s/g, "")) || m.email?.toLowerCase().includes(q),
      )
    : data.members;

  function exportCsv() {
    if (!data) return;
    const csv = toCsv(
      ["Navn", "Mobil", "E-post", "Rolle", "Team", "Status", "Sist innlogget"],
      data.members.map((m) => [
        m.name,
        m.phone,
        m.email,
        m.roleName,
        m.teamName,
        memberState(m).label,
        m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "",
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `brukere-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Brukere</h1>
          <p className="mt-2 text-muted">Inviter brukere, gi dem rolle og team, og deaktiver dem som slutter.</p>
        </div>
        <button type="button" className={secondaryButton} onClick={exportCsv}>
          Eksporter CSV
        </button>
      </div>

      <Invite data={data} onInvited={reload} />

      <div>
        <Field label="Søk">
          <input
            type="search"
            className={`${inputClass} w-full sm:max-w-sm`}
            placeholder="Navn, mobil eller e-post"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <ErrorMessage message={error} />
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((m) => (
            <MemberRow key={m.userId} member={m} data={data} self={m.userId === me?.user.id} onChanged={reload} />
          ))}
          {shown.length === 0 && <li className="p-4 text-muted">Ingen brukere passer søket.</li>}
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
            {self && <span className="ml-2 text-sm font-medium text-muted">(deg)</span>}
          </p>
          <p className="text-sm text-muted">
            {[member.phone, member.email].filter(Boolean).join(" · ") || "Ingen kontaktinfo"} · sist innlogget{" "}
            {formatDateTime(member.lastLoginAt)}
          </p>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>
      {self ? (
        <p className="text-sm">
          {member.roleName}
          {member.teamName && ` · ${member.teamName}`}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Rolle">
            <select
              className={inputClass}
              value={member.roleId}
              disabled={busy}
              onChange={(e) => update({ roleId: e.target.value })}
            >
              {data.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.assignable && r.id !== member.roleId}>
                  {r.name}
                  {!r.assignable ? " (krever rettigheter du ikke har)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team">
            <select
              className={inputClass}
              value={member.teamId ?? ""}
              disabled={busy}
              onChange={(e) => update({ teamId: e.target.value || null })}
            >
              <option value="">Uten team</option>
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
              member.status === "active"
                ? update({ status: "disabled" }, `Deaktivere ${member.name}? Brukeren mister tilgangen til callsenteret.`)
                : update({ status: "active" })
            }
          >
            {member.status === "active" ? "Deaktiver" : "Aktiver igjen"}
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

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Card title="Inviter bruker">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Navn">
            <input required className={inputClass} value={form.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Mobilnummer" hint="Med Vipps kobles brukeren via mobilnummeret.">
            <input type="tel" className={inputClass} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="E-post">
            <input type="email" className={inputClass} value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Rolle">
            <select required className={inputClass} value={form.roleId} onChange={set("roleId")}>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team">
            <select className={inputClass} value={form.teamId} onChange={set("teamId")}>
              <option value="">Uten team</option>
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
            {saving ? "Lager invitasjon …" : "Lag invitasjon"}
          </button>
        </div>
      </form>
      {added && (
        <p role="status" className="mt-6 rounded-lg border border-line p-4">
          Personen er allerede bruker av VeriQall og er lagt til. Av sikkerhetshensyn lages det ingen lenke: callsenteret vises
          når hen logger inn med sin egen BankID, Vipps eller passkey.
        </p>
      )}
      {link && (
        <div className="mt-6 rounded-lg border border-line p-4">
          <p className="font-semibold">Invitasjonslenke</p>
          {link.emailedTo && (
            <p className="mt-1" role="status">
              Sendt på e-post til {link.emailedTo}.
            </p>
          )}
          <p className="mt-1 text-sm text-muted">
            {link.emailedTo ? "Du kan også sende lenken selv, for eksempel på SMS." : "Send lenken til personen."} Den kan brukes én gang og gjelder til {formatDateTime(link.expiresAt)}. Den vises bare nå.
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
            {copied ? "Kopiert" : "Kopier lenke"}
          </button>
        </div>
      )}
    </Card>
  );
}

function Invitations({ data, onChanged }: { data: OrgOverview; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
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
    <Card title="Invitasjoner">
      <ul className="divide-y divide-line">
        {data.invitations.map((inv) => {
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
