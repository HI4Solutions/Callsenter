"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { Threads } from "@/components/threads";
import {
  type AdminAnnouncement,
  adminFetch,
  announcementState,
  formatDate,
  type OrganizationSummary,
} from "@/lib/admin";

type Form = {
  title: string;
  body: string;
  linkUrl: string;
  linkText: string;
  audience: "all" | "selected";
  organizationIds: string[];
  startsAt: string;
  endsAt: string;
  active: boolean;
};

const EMPTY: Form = {
  title: "",
  body: "",
  linkUrl: "",
  linkText: "",
  audience: "all",
  organizationIds: [],
  startsAt: "",
  endsAt: "",
  active: true,
};

function Announcements() {
  const [list, setList] = useState<AdminAnnouncement[] | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [editing, setEditing] = useState<AdminAnnouncement | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      adminFetch<AdminAnnouncement[]>("/announcements")
        .then(setList)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminFetch<AdminAnnouncement[]>("/announcements"), adminFetch<OrganizationSummary[]>("/organizations")])
      .then(([announcements, orgs]) => {
        if (cancelled) return;
        setList(announcements);
        setOrganizations(orgs);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(a: AdminAnnouncement) {
    try {
      await adminFetch(`/announcements/${a.id}`, { method: "PATCH", body: { active: !a.active } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(a: AdminAnnouncement) {
    if (!window.confirm(`Slette «${a.title}»?`)) return;
    try {
      await adminFetch(`/announcements/${a.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Kunngjøringer</h2>
          <p className="mt-2 text-muted">Vises øverst for innloggede brukere.</p>
        </div>
        {editing === null && (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            Ny kunngjøring
          </button>
        )}
      </div>

      {editing !== null && (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          announcement={editing === "new" ? null : editing}
          organizations={organizations}
          onDone={async () => {
            setEditing(null);
            await reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <ErrorMessage message={error} />
      {!list && !error && <p className="text-muted">Laster …</p>}
      {list && list.length === 0 && <p className="text-muted">Ingen kunngjøringer ennå.</p>}
      {list && list.length > 0 && (
        <ul className="flex flex-col gap-4">
          {list.map((a) => {
            const state = announcementState(a);
            return (
              <li key={a.id} className="rounded-xl border border-line bg-surface p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">{a.title}</h2>
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </div>
                <p className="mt-2 whitespace-pre-line">{a.body}</p>
                {a.linkUrl && (
                  <p className="mt-1 text-sm">
                    Lenke: <span className="font-semibold">{a.linkText || "Les mer"}</span> → {a.linkUrl}
                  </p>
                )}
                <p className="mt-2 text-sm text-muted">
                  {a.audience === "all" ? "Til alle" : `Til ${a.organizations.map((o) => o.name).join(", ")}`} · fra{" "}
                  {formatDate(a.startsAt)}
                  {a.endsAt ? ` til ${formatDate(a.endsAt)}` : ""} · {a.createdByName ?? "ukjent"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setEditing(a)}>
                    Endre
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => toggle(a)}>
                    {a.active ? "Slå av" : "Slå på"}
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => remove(a)}>
                    Slett
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Editor({
  announcement,
  organizations,
  onDone,
  onCancel,
}: {
  announcement: AdminAnnouncement | null;
  organizations: OrganizationSummary[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Form>(
    announcement
      ? {
          title: announcement.title,
          body: announcement.body,
          linkUrl: announcement.linkUrl ?? "",
          linkText: announcement.linkText ?? "",
          audience: announcement.audience,
          organizationIds: announcement.organizations.map((o) => o.id),
          startsAt: announcement.startsAt.slice(0, 10),
          endsAt: announcement.endsAt?.slice(0, 10) ?? "",
          active: announcement.active,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      startsAt: form.startsAt || (announcement ? null : undefined),
      endsAt: form.endsAt || null,
      organizationIds: form.audience === "selected" ? form.organizationIds : [],
    };
    try {
      if (announcement) await adminFetch(`/announcements/${announcement.id}`, { method: "PATCH", body });
      else await adminFetch("/announcements", { method: "POST", body });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const set = (key: "title" | "body" | "linkUrl" | "linkText" | "startsAt" | "endsAt") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <Card title={announcement ? "Endre kunngjøring" : "Ny kunngjøring"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Tittel">
          <input required maxLength={200} className={inputClass} value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Tekst">
          <textarea required maxLength={2000} rows={4} className={`${inputClass} py-2`} value={form.body} onChange={set("body")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lenke" hint="Valgfri. Må begynne med https://.">
            <input type="url" className={inputClass} value={form.linkUrl} onChange={set("linkUrl")} />
          </Field>
          <Field label="Lenketekst">
            <input maxLength={100} className={inputClass} value={form.linkText} placeholder="Les mer" onChange={set("linkText")} />
          </Field>
          <Field label="Vises fra" hint="Tom = med en gang.">
            <input type="date" className={inputClass} value={form.startsAt} onChange={set("startsAt")} />
          </Field>
          <Field label="Vises til" hint="Tom = til den slås av.">
            <input type="date" className={inputClass} value={form.endsAt} onChange={set("endsAt")} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Mottakere</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="audience"
                className="size-5 accent-brand"
                checked={form.audience === "all"}
                onChange={() => setForm({ ...form, audience: "all" })}
              />
              Alle brukere
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="audience"
                className="size-5 accent-brand"
                checked={form.audience === "selected"}
                onChange={() => setForm({ ...form, audience: "selected" })}
              />
              Valgte callsentre
            </label>
          </div>
          {form.audience === "selected" && (
            <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2">
              {organizations.map((o) => (
                <label key={o.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand"
                    checked={form.organizationIds.includes(o.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        organizationIds: e.target.checked
                          ? [...form.organizationIds, o.id]
                          : form.organizationIds.filter((id) => id !== o.id),
                      })
                    }
                  />
                  {o.name}
                </label>
              ))}
              {organizations.length === 0 && <p className="text-muted">Ingen callsentre ennå.</p>}
            </div>
          )}
        </fieldset>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-brand"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Aktiv
        </label>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? "Lagrer …" : announcement ? "Lagre" : "Publiser"}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Avbryt
          </button>
        </div>
      </form>
    </Card>
  );
}

export default function MessagesPage() {
  const [section, setSection] = useState<"samtaler" | "kunngjoringer">("samtaler");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    adminFetch<OrganizationSummary[]>("/organizations")
      .then((orgs) => !cancelled && setOrganizations(orgs))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Meldinger</h1>
        <p className="mt-2 text-muted">Samtaler med admin i callsentrene, og kunngjøringer til brukerne.</p>
      </div>
      <div role="tablist" aria-label="Meldinger" className="flex flex-wrap gap-2">
        {(
          [
            ["samtaler", "Samtaler"],
            ["kunngjoringer", "Kunngjøringer"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={`min-h-11 rounded-lg px-4 font-semibold ${section === key ? "bg-brand text-on-brand" : "border border-line bg-surface"}`}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "samtaler" ? <Threads base="/admin" organizations={organizations} /> : <Announcements />}
    </section>
  );
}
