"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { adminFetch, formatDate, formatDateTime, toCsv, USER_STATUS, type UserSummary } from "@/lib/admin";

const TONE = { active: "ok", invited: "warning", disabled: "danger" } as const;

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Searches on the server, a moment after typing stops.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      adminFetch<UserSummary[]>(`/users?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          if (cancelled) return;
          setUsers(rows);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function exportCsv() {
    if (!users) return;
    const csv = toCsv(
      ["Navn", "Mobil", "E-post", "Status", "Callsentre", "Superadmin", "Sist innlogget", "Opprettet"],
      users.map((u) => [
        u.name,
        u.phone,
        u.email,
        USER_STATUS[u.status],
        u.organizations.map((o) => `${o.name} (${o.role})`).join(", "),
        u.platformAdmin ? "Ja" : "Nei",
        u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "",
        formatDate(u.createdAt),
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `veriqall-brukere-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Brukere</h1>
          <p className="mt-2 text-muted">Alle brukere på tvers av callsentre.</p>
        </div>
        <button type="button" className={secondaryButton} onClick={exportCsv} disabled={!users?.length}>
          Eksporter CSV
        </button>
      </div>

      <div className="mt-8">
        <Field label="Søk">
          <input
            type="search"
            className={`${inputClass} w-full sm:max-w-sm`}
            placeholder="Navn, mobil eller e-post"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-6">
        <ErrorMessage message={error} />
        {!users && !error && <p className="text-muted">Laster …</p>}
        {users && users.length === 0 && <p className="text-muted">Ingen brukere passer søket.</p>}
        {users && users.length > 0 && (
          <>
            <p className="mb-2 text-sm text-muted">
              {users.length === 500 ? "Viser de 500 første. Søk for å finne flere." : `${users.length} brukere`}
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {users.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/admin/brukere/${u.id}`}
                    className="flex flex-col gap-2 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">
                        {u.name}
                        {u.platformAdmin && <span className="ml-2 text-sm font-medium text-brand">Superadmin</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {[u.phone, u.email].filter(Boolean).join(" · ") || "Ingen kontaktinfo"}
                      </p>
                      <p className="text-sm text-muted">
                        {u.organizations.length
                          ? u.organizations.map((o) => `${o.name} (${o.role})`).join(", ")
                          : "Ikke medlem av noe callsenter"}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <StatusBadge tone={TONE[u.status]}>{USER_STATUS[u.status]}</StatusBadge>
                      <span className="text-sm text-muted">Sist innlogget {formatDateTime(u.lastLoginAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
