"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
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
  LOGIN_RESULT,
  PROVIDER,
  type UserDetail,
} from "@/lib/admin";

const TONE = { active: "ok", invited: "warning", disabled: "danger" } as const;

export default function UserPage() {
  const t = useTranslations("admin.user");
  const tu = useTranslations("admin.users");
  const td = useTranslations("domain");
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
        <div className="mt-6">
          <LoadState error={error} />
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-10">
      <div>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {user.name}
          </h1>
          <StatusBadge tone={TONE[user.status]}>
            {td(`userStatus.${user.status}`)}
          </StatusBadge>
          {user.platformAdmin && (
            <span className="font-semibold text-brand">{tu("superadmin")}</span>
          )}
        </div>
        <p className="mt-2 text-muted">
          {t("created", { date: formatDate(user.createdAt) })} ·{" "}
          {user.lastLoginAt
            ? t("lastLogin", { date: formatDateTime(user.lastLoginAt) })
            : t("neverLoggedIn")}
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
  const t = useTranslations("admin.user");
  return (
    <Link
      href="/admin/brukere"
      className="inline-flex min-h-11 items-center font-semibold text-brand"
    >
      ← {t("back")}
    </Link>
  );
}

// Runs an action with a confirmation, and reports errors in place.
function useAction(onDone: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (
    confirmText: string | null,
    action: () => Promise<unknown>,
  ) => {
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

function Profile({
  user,
  onSaved,
}: {
  user: UserDetail;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("admin.user");
  const ts = useTranslations("admin.shared");
  const [form, setForm] = useState({
    fullName: user.name,
    phone: user.phone ?? "",
    email: user.email ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const { error, busy, run } = useAction(onSaved);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    await run(null, async () => {
      await adminFetch(`/users/${user.id}`, { method: "PATCH", body: form });
      setMessage(ts("saved"));
    });
  }

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <Card title={t("profile")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("name")}>
            <input
              required
              className={inputClass}
              value={form.fullName}
              onChange={set("fullName")}
            />
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
        {message && <p role="status">{message}</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? ts("saving") : ts("save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Access({
  user,
  onChanged,
}: {
  user: UserDetail;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.user");
  const { error, busy, run } = useAction(onChanged);
  const disabled = user.status === "disabled";

  return (
    <Card title={t("access")}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{t("account")}</p>
            <p className="text-sm text-muted">
              {disabled ? t("disabledText") : t("disableText")}
            </p>
          </div>
          {!user.self && (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() =>
                run(
                  disabled ? null : t("confirmDisable", { name: user.name }),
                  () =>
                    adminFetch(`/users/${user.id}`, {
                      method: "PATCH",
                      body: { access: disabled ? "enabled" : "disabled" },
                    }),
                )
              }
            >
              {disabled ? t("enable") : t("disable")}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{t("superadmin")}</p>
            <p className="text-sm text-muted">
              {user.platformAdmin ? t("isSuperadmin") : t("makeSuperadminText")}
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
                    ? t("confirmRemoveSuperadmin", { name: user.name })
                    : t("confirmMakeSuperadmin", { name: user.name }),
                  () =>
                    adminFetch(`/users/${user.id}/superadmin`, {
                      method: "PUT",
                      body: { enabled: !user.platformAdmin },
                    }),
                )
              }
            >
              {user.platformAdmin ? t("removeSuperadmin") : t("makeSuperadmin")}
            </button>
          )}
        </div>
        {user.self && <p className="text-sm text-muted">{t("selfNote")}</p>}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}

function Organizations({ user }: { user: UserDetail }) {
  const t = useTranslations("admin.user");
  return (
    <Card title={t("organizations")}>
      {user.organizations.length === 0 ? (
        <p className="text-muted">{t("noOrganization")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {user.organizations.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <Link
                href={`/admin/callsentre/${o.id}`}
                className="font-semibold text-brand"
              >
                {o.name}
              </Link>
              <span className="text-sm">
                {o.role}
                {o.status === "disabled" && ` · ${t("disabledHere")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Logins({
  user,
  onChanged,
}: {
  user: UserDetail;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.user");
  const tc = useTranslations("common");
  const { error, busy, run } = useAction(onChanged);

  return (
    <Card
      title={t("login")}
      actions={
        user.sessions.length > 0 && (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() =>
              run(t("confirmLogout", { name: user.name }), () =>
                adminFetch(`/users/${user.id}/logout`, { method: "POST" }),
              )
            }
          >
            {t("logoutEverywhere")}
          </button>
        )
      }
    >
      <h3 className="font-semibold">{t("methods")}</h3>
      {user.identities.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("noMethods")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {user.identities.map((i) => (
            <li
              key={i.provider}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">{PROVIDER[i.provider]}</p>
                <p className="text-sm text-muted">
                  {t("linked", {
                    date: formatDate(i.createdAt),
                    used: formatDateTime(i.lastUsedAt),
                  })}
                </p>
              </div>
              {!user.self && (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    run(
                      t("confirmRemoveMethod", {
                        method: PROVIDER[i.provider] ?? i.provider,
                        name: user.name,
                      }),
                      () =>
                        adminFetch(
                          `/users/${user.id}/identities/${i.provider}`,
                          { method: "DELETE" },
                        ),
                    )
                  }
                >
                  {tc("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 font-semibold">{t("passkeys")}</h3>
      {user.passkeys.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("noPasskeys")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {user.passkeys.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted">
                  {t("passkeyAdded", {
                    date: formatDate(p.createdAt),
                    used: formatDateTime(p.lastUsedAt),
                  })}
                </p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() =>
                  run(
                    t("confirmRemovePasskey", {
                      passkey: p.name,
                      name: user.name,
                    }),
                    () =>
                      adminFetch(`/users/${user.id}/passkeys/${p.id}`, {
                        method: "DELETE",
                      }),
                  )
                }
              >
                {tc("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 font-semibold">{t("sessions")}</h3>
      {user.sessions.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("noSessions")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {user.sessions.map((s, index) => (
            <li key={index} className="py-3 text-sm">
              <p>
                <span className="font-semibold">{PROVIDER[s.provider]}</span> ·{" "}
                {t("sessionTimes", {
                  started: formatDateTime(s.createdAt),
                  seen: formatDateTime(s.lastSeenAt),
                })}
              </p>
              <p className="text-muted">
                {s.ip ?? t("unknownIp")} · {s.userAgent ?? t("unknownBrowser")}
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
  const t = useTranslations("admin.user");
  const td = useTranslations("domain");
  return (
    <Card title={t("history")}>
      {user.logins.length === 0 ? (
        <p className="text-muted">{t("noLogins")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {user.logins.map((l, index) => (
            <li
              key={index}
              className="flex flex-wrap justify-between gap-2 py-2"
            >
              <span>{formatDateTime(l.occurredAt)}</span>
              <span>
                {PROVIDER[l.provider]} ·{" "}
                {l.result in LOGIN_RESULT
                  ? td(`loginResult.${l.result as "success"}`)
                  : l.result}{" "}
                · {l.ip ?? t("unknownIpLower")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
