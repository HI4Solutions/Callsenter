"use client";

import { type Locale, LOCALE_CODES, LOCALES } from "@veriqall/shared";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { formatDate, formatDateTime } from "@/lib/format";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { writeLocaleCookie } from "@/i18n/locale";
import {
  addPasskey,
  listPasskeys,
  type MyPasskey,
  passkeyError,
  passkeysSupported,
  removePasskey,
  suggestedPasskeyName,
} from "@/lib/passkey";

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps", passkey: "passkey" };

export default function AccountPage() {
  const router = useRouter();
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [passkeys, setPasskeys] = useState<MyPasskey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listPasskeys().then(setPasskeys), []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then(async (result) => {
      if (cancelled) return;
      if (result === "signed-out") {
        router.replace(loginPathFor("/konto"));
        return;
      }
      const user = result;
      setMe(user);
      if (user) {
        const list = await listPasskeys().catch((e: Error) => {
          setError(t(e.message === "mustLogIn" ? "mustLogIn" : "listFailed"));
          return [];
        });
        if (!cancelled) setPasskeys(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, t]);

  if (me === undefined) return <p className="text-muted">{tc("loading")}</p>;
  if (me === null) {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-4">{tc("noServer")}</p>
      </section>
    );
  }

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("signedInWith", { name: me.user.name, method: METHOD[me.provider] ?? me.provider })}</p>
      </div>
      <Language me={me} />
      <Passkeys me={me} passkeys={passkeys} onChanged={reload} />
      <ErrorMessage message={error} />
    </section>
  );
}

// The language of the pages, saved on the user (docs/plan.md, section 19). Without a choice the
// user follows the call centre's language.
function Language({ me }: { me: Me }) {
  const t = useTranslations("account");
  const current = useLocale();
  const [saved, setSaved] = useState<Locale | "" | null>(null);
  const [value, setValue] = useState<Locale | "">(me.locale ?? "");
  const orgLocale = me.organizationLocale ?? null;

  async function choose(next: Locale | "") {
    setValue(next);
    const res = await fetch(`${API_URL}/me/locale`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next || null }),
    }).catch(() => null);
    if (!res?.ok) return;
    const shown = next || orgLocale || current;
    writeLocaleCookie(shown);
    setSaved(next);
    // A full load, so every part of the page (and the header) changes language.
    if (shown !== current) window.location.reload();
  }

  return (
    <Card title={t("languageTitle")}>
      <p className="text-muted">{t("languageIntro")}</p>
      <div className="mt-4 max-w-sm">
        <Field label={t("languageTitle")}>
          <select className={inputClass} value={value} onChange={(e) => choose(e.target.value as Locale | "")}>
            <option value="">
              {orgLocale ? t("followOrganization", { language: LOCALES[orgLocale].name }) : t("followBrowser")}
            </option>
            {LOCALE_CODES.map((code) => (
              <option key={code} value={code} lang={LOCALES[code].tag}>
                {LOCALES[code].name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {saved !== null && (
        <p role="status" className="mt-3">
          {t("languageSaved")}
        </p>
      )}
    </Card>
  );
}

function Passkeys({ me, passkeys, onChanged }: { me: Me; passkeys: MyPasskey[]; onChanged: () => Promise<void> }) {
  const t = useTranslations("account");
  const tl = useTranslations("login");
  const tc = useTranslations("common");
  const [name, setName] = useState(() => (typeof navigator === "undefined" ? "Passkey" : suggestedPasskeyName(navigator.userAgent)));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canAdd = me.provider === "bankid";

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await addPasskey(name.trim() || "Passkey");
      await onChanged();
      setMessage(t("added"));
    } catch (e) {
      const problem = passkeyError(e);
      setError("message" in problem ? problem.message : problem.key === "noServer" ? tc("noServer") : tl(`passkeyErrors.${problem.key}`));
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: MyPasskey) {
    if (!window.confirm(t("removeConfirm", { name: passkey.name }))) return;
    setError(null);
    try {
      await removePasskey(passkey.id);
      await onChanged();
    } catch {
      setError(t("removeFailed"));
    }
  }

  return (
    <Card title={t("passkeys")}>
      <p className="text-muted">{t("passkeysIntro")}</p>

      {passkeys.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted">{t("passkeyAdded", { added: formatDate(p.createdAt), used: formatDateTime(p.lastUsedAt) })}</p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => remove(p)}>
                {tc("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {!passkeysSupported() ? (
          <p>{t("notSupported")}</p>
        ) : canAdd ? (
          <form onSubmit={add} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Field label={t("nameLabel")} hint={t("nameHint")}>
              <input maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? t("waitingForDevice") : t("add")}
            </button>
          </form>
        ) : (
          <p>{t("needBankId")}</p>
        )}
        <div className="mt-3">
          <ErrorMessage message={error} />
          {message && <p role="status">{message}</p>}
        </div>
      </div>
    </Card>
  );
}
