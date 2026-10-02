"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  adminFetch,
  formatDate,
  formatDateTime,
  LOGIN_RESULT,
  PROVIDER,
  USER_STATUS,
  type UserDetail,
} from "@/lib/admin";

const TONE = { active: "ok", invited: "warning", disabled: "danger" } as const;

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      adminFetch<UserDetail>(`/users/${id}`)
        .then(setUser)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<UserDetail>(`/users/${id}`)
      .then((u) => !cancelled && setUser(u))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!user) {
    return (
      <section>
        <BackLink />
        {error ? <ErrorMessage message={error} /> : <p className="mt-6 text-muted">Laster …</p>}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-10">
      <div>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">{user.name}</h1>
          <StatusBadge tone={TONE[user.status]}>{USER_STATUS[user.status]}</StatusBadge>
          {user.platformAdmin && <span className="font-semibold text-brand">Superadmin</span>}
        </div>
        <p className="mt-2 text-muted">
          Opprettet {formatDate(user.createdAt)} · sist innlogget {formatDateTime(user.lastLoginAt)}
        </p>
      </div>

      <Profile user={user} onSaved={reload} />
      <Access user={user} onChanged={reload} />
      <Organizations user={user} />
      <Logins user={user} onChanged={reload} />
      <History user={user} />
    </section>
  );
}

function BackLink() {
  return (
    <Link href="/admin/brukere" className="inline-flex min-h-11 items-center font-semibold text-brand">
      ← Alle brukere
    </Link>
  );
}

// Runs an action with a confirmation, and reports errors in place.
function useAction(onDone: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (confirmText: string | null, action: () => Promise<unknown>) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function Profile({ user, onSaved }: { user: UserDetail; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: user.name, phone: user.phone ?? "", email: user.email ?? "" });
  const [message, setMessage] = useState<string | null>(null);
  const { error, busy, run } = useAction(onSaved);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    await run(null, async () => {
      await adminFetch(`/users/${user.id}`, { method: "PATCH", body: form });
      setMessage("Lagret.");
    });
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <Card title="Profil">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Navn">
            <input required className={inputClass} value={form.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Mobilnummer" hint="Brukes til å koble første Vipps-innlogging.">
            <input type="tel" className={inputClass} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="E-post">
            <input type="email" className={inputClass} value={form.email} onChange={set("email")} />
          </Field>
        </div>
        <ErrorMessage message={error} />
        {message && <p role="status">{message}</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? "Lagrer …" : "Lagre"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Access({ user, onChanged }: { user: UserDetail; onChanged: () => Promise<void> }) {
  const { error, busy, run } = useAction(onChanged);
  const disabled = user.status === "disabled";

  return (
    <Card title="Tilgang">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Brukerkonto</p>
            <p className="text-sm text-muted">
              {disabled
                ? "Deaktivert: kan ikke logge inn i noe callsenter."
                : "En deaktivert bruker logges ut overalt og kan ikke logge inn."}
            </p>
          </div>
          {!user.self && (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() =>
                run(disabled ? null : `Deaktivere ${user.name}? Brukeren logges ut overalt.`, () =>
                  adminFetch(`/users/${user.id}`, { method: "PATCH", body: { access: disabled ? "enabled" : "disabled" } }),
                )
              }
            >
              {disabled ? "Aktiver igjen" : "Deaktiver"}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Superadmin</p>
            <p className="text-sm text-muted">
              {user.platformAdmin
                ? "Har tilgang til denne portalen og alle callsentre (bare med BankID)."
                : "Gir tilgang til denne portalen og alle callsentre (bare med BankID)."}
            </p>
          </div>
          {!user.self && (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy || (disabled && !user.platformAdmin)}
              onClick={() =>
                run(
                  user.platformAdmin
                    ? `Fjerne superadmin-tilgangen til ${user.name}?`
                    : `Gjøre ${user.name} til superadmin? Det gir full tilgang til alle callsentre.`,
                  () => adminFetch(`/users/${user.id}/superadmin`, { method: "PUT", body: { enabled: !user.platformAdmin } }),
                )
              }
            >
              {user.platformAdmin ? "Fjern superadmin" : "Gjør til superadmin"}
            </button>
          )}
        </div>
        {user.self && <p className="text-sm text-muted">Du kan ikke deaktivere deg selv eller fjerne din egen superadmin-tilgang.</p>}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}

function Organizations({ user }: { user: UserDetail }) {
  return (
    <Card title="Callsentre">
      {user.organizations.length === 0 ? (
        <p className="text-muted">Ikke medlem av noe callsenter.</p>
      ) : (
        <ul className="divide-y divide-line">
          {user.organizations.map((o) => (
            <li key={o.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Link href={`/admin/callsentre/${o.id}`} className="font-semibold text-brand">
                {o.name}
              </Link>
              <span className="text-sm">
                {o.role}
                {o.status === "disabled" && " · deaktivert i callsenteret"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Logins({ user, onChanged }: { user: UserDetail; onChanged: () => Promise<void> }) {
  const { error, busy, run } = useAction(onChanged);

  return (
    <Card
      title="Innlogging"
      actions={
        user.sessions.length > 0 && (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() =>
              run(`Logge ut ${user.name} fra alle enheter?`, () => adminFetch(`/users/${user.id}/logout`, { method: "POST" }))
            }
          >
            Logg ut overalt
          </button>
        )
      }
    >
      <h3 className="font-semibold">Innloggingsmetoder</h3>
      {user.identities.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Ingen ennå. Brukeren kobles ved første innlogging med invitasjonslenken.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {user.identities.map((i) => (
            <li key={i.provider} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{PROVIDER[i.provider]}</p>
                <p className="text-sm text-muted">
                  Koblet {formatDate(i.createdAt)} · sist brukt {formatDateTime(i.lastUsedAt)}
                </p>
              </div>
              {!user.self && (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    run(
                      `Fjerne ${PROVIDER[i.provider]} fra ${user.name}? Brukeren trenger en ny invitasjon for å koble den igjen.`,
                      () => adminFetch(`/users/${user.id}/identities/${i.provider}`, { method: "DELETE" }),
                    )
                  }
                >
                  Fjern
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 font-semibold">Aktive økter</h3>
      {user.sessions.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Ingen aktive økter.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {user.sessions.map((s, index) => (
            <li key={index} className="py-3 text-sm">
              <p>
                <span className="font-semibold">{PROVIDER[s.provider]}</span> · startet {formatDateTime(s.createdAt)} · sist
                aktiv {formatDateTime(s.lastSeenAt)}
              </p>
              <p className="text-muted">
                {s.ip ?? "Ukjent IP"} · {s.userAgent ?? "Ukjent nettleser"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}

function History({ user }: { user: UserDetail }) {
  return (
    <Card title="Siste innlogginger">
      {user.logins.length === 0 ? (
        <p className="text-muted">Ingen innlogginger registrert.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {user.logins.map((l, index) => (
            <li key={index} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{formatDateTime(l.occurredAt)}</span>
              <span>
                {PROVIDER[l.provider]} · {LOGIN_RESULT[l.result] ?? l.result} · {l.ip ?? "ukjent IP"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
