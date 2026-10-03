"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { apiFetch } from "@/lib/api";

interface Role {
  id: string;
  key: string;
  name: string;
  isDefault: boolean;
  archivedAt: string | null;
  permissions: string[];
  members: number;
  mine: boolean;
}

interface Permission {
  key: string;
  description: string;
  held: boolean;
  requiresBankId: boolean;
}

export default function RolesPage() {
  const [data, setData] = useState<{ roles: Role[]; permissions: Permission[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | "new" | null>(null);

  const reload = useCallback(
    () =>
      apiFetch<{ roles: Role[]; permissions: Permission[] }>("/org/roles")
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ roles: Role[]; permissions: Permission[] }>("/org/roles")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function setArchived(role: Role, archived: boolean) {
    if (archived && !window.confirm(`Arkivere rollen ${role.name}?`)) return;
    setError(null);
    try {
      await apiFetch(`/org/roles/${role.id}`, { method: "PATCH", body: { archived } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data) return <LoadState error={error} />;
  const active = data.roles.filter((r) => !r.archivedAt);
  const archived = data.roles.filter((r) => r.archivedAt);
  const describe = new Map(data.permissions.map((p) => [p.key, p.description]));

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Roller</h1>
          <p className="mt-2 max-w-2xl text-muted">
            En rolle er et sett rettigheter. Du kan bare gi rettigheter du har selv, og du kan ikke endre rollen du har selv.
          </p>
        </div>
        {editing === null && (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            Ny rolle
          </button>
        )}
      </div>

      {editing !== null && (
        <RoleEditor
          key={editing === "new" ? "new" : editing.id}
          role={editing === "new" ? null : editing}
          permissions={data.permissions}
          onDone={async () => {
            setEditing(null);
            await reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <ErrorMessage message={error} />
      <ul className="flex flex-col gap-4">
        {active.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-surface p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">
                {r.name}
                {r.mine && <span className="ml-2 text-sm font-medium text-muted">(din rolle)</span>}
              </h2>
              <span className="text-sm text-muted">
                {r.members} {r.members === 1 ? "bruker" : "brukere"}
                {r.isDefault && " · standardrolle"}
              </span>
            </div>
            <p className="mt-2 text-sm">
              {r.permissions.length ? r.permissions.map((p) => describe.get(p) ?? p).join(", ") : "Ingen rettigheter"}
            </p>
            {!r.mine && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={secondaryButton} onClick={() => setEditing(r)}>
                  Endre
                </button>
                <button type="button" className={secondaryButton} onClick={() => setArchived(r, true)}>
                  Arkiver
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <Card title="Arkiverte roller">
          <ul className="divide-y divide-line">
            {archived.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <span>{r.name}</span>
                <button type="button" className={secondaryButton} onClick={() => setArchived(r, false)}>
                  Gjenopprett
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function RoleEditor({
  role,
  permissions,
  onDone,
  onCancel,
}: {
  role: Role | null;
  permissions: Permission[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [chosen, setChosen] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = { name, permissions: [...chosen] };
    try {
      if (role) await apiFetch(`/org/roles/${role.id}`, { method: "PATCH", body });
      else await apiFetch("/org/roles", { method: "POST", body });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Card title={role ? `Endre ${role.name}` : "Ny rolle"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Navn">
          <input required maxLength={100} className={`${inputClass} sm:max-w-sm`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="text-sm font-semibold">Rettigheter</legend>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {permissions.map((p) => {
              // A permission you do not hold can stay on a role, but you cannot add it.
              const locked = !p.held && !chosen.has(p.key);
              return (
                <li key={p.key}>
                  <label className={`flex min-h-11 items-start gap-3 ${locked ? "opacity-60" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-1 size-5 accent-brand"
                      checked={chosen.has(p.key)}
                      disabled={locked}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(p.key);
                        else next.delete(p.key);
                        setChosen(next);
                      }}
                    />
                    <span>
                      {p.description}
                      <span className="block text-sm text-muted">
                        {p.requiresBankId && "Krever BankID eller passkey. "}
                        {!p.held && "Du har ikke denne selv."}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? "Lagrer …" : role ? "Lagre" : "Opprett rolle"}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Avbryt
          </button>
        </div>
      </form>
    </Card>
  );
}
