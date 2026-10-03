"use client";

import { isPermission, PERMISSION_GROUPS } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { apiFetch } from "@/lib/api";
import { permissionKey } from "@/lib/format";

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

// The role's permissions under the catalog's areas (PERMISSION_GROUPS), and any unknown ones
// last ("other").
function groupPermissions(keys: string[]): { key: (typeof PERMISSION_GROUPS)[number]["key"] | "other"; permissions: string[] }[] {
  const groups: ReturnType<typeof groupPermissions> = PERMISSION_GROUPS.map((g) => ({
    key: g.key,
    permissions: g.permissions.filter((p) => keys.includes(p)) as string[],
  }));
  const known = new Set<string>(PERMISSION_GROUPS.flatMap((g) => g.permissions));
  groups.push({ key: "other", permissions: keys.filter((k) => !known.has(k)) });
  return groups.filter((g) => g.permissions.length > 0);
}

// Names of permission groups and permissions in the page language. A permission the catalog
// does not know keeps the API's description.
function useCatalogText() {
  const t = useTranslations("org.roles");
  const td = useTranslations("domain");
  return {
    group: (key: ReturnType<typeof groupPermissions>[number]["key"]) => (key === "other" ? t("otherGroup") : td(`permissionGroups.${key}`)),
    permission: (key: string, fallback?: string) => (isPermission(key) ? td(`permissions.${permissionKey(key)}`) : (fallback ?? key)),
  };
}

export default function RolesPage() {
  const t = useTranslations("org.roles");
  const text = useCatalogText();
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
    if (archived && !window.confirm(t("confirmArchive", { name: role.name }))) return;
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
          <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-muted">{t("intro")}</p>
        </div>
        {editing === null && (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            {t("new")}
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
                {r.mine && <span className="ml-2 text-sm font-medium text-muted">{t("yours")}</span>}
              </h2>
              <span className="text-sm text-muted">
                {t("users", { count: r.members })}
                {r.isDefault && ` · ${t("defaultRole")}`}
              </span>
            </div>
            {r.permissions.length ? (
              <dl className="mt-3 flex flex-col gap-2">
                {groupPermissions(r.permissions).map((g) => (
                  <div key={g.key} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                    <dt className="text-sm font-semibold text-muted sm:w-44 sm:shrink-0 sm:pt-0.5">{text.group(g.key)}</dt>
                    <dd>
                      <ul className="flex flex-wrap gap-1.5">
                        {g.permissions.map((p) => (
                          <li key={p} className="rounded-full border border-line px-2.5 py-0.5 text-sm">
                            {text.permission(p, describe.get(p))}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm">{t("noPermissions")}</p>
            )}
            {!r.mine && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={secondaryButton} onClick={() => setEditing(r)}>
                  {t("edit")}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setArchived(r, true)}>
                  {t("archive")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <Card title={t("archived")}>
          <ul className="divide-y divide-line">
            {archived.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <span>{r.name}</span>
                <button type="button" className={secondaryButton} onClick={() => setArchived(r, false)}>
                  {t("restore")}
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
  const t = useTranslations("org.roles");
  const text = useCatalogText();

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
    <Card title={role ? t("editTitle", { name: role.name }) : t("new")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("name")}>
          <input required maxLength={100} className={`${inputClass} sm:max-w-sm`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {groupPermissions(permissions.map((p) => p.key)).map((group) => (
          <fieldset key={group.key}>
            <legend className="text-sm font-semibold">{text.group(group.key)}</legend>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {permissions
                .filter((p) => group.permissions.includes(p.key))
                .map((p) => {
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
                          {text.permission(p.key, p.description)}
                          <span className="block text-sm text-muted">
                            {p.requiresBankId && `${t("requiresStrongLogin")} `}
                            {!p.held && t("notHeld")}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </fieldset>
        ))}
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? t("saving") : role ? t("save") : t("create")}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            {t("cancel")}
          </button>
        </div>
      </form>
    </Card>
  );
}
