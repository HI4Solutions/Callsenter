"use client";

import { type Locale, LOCALE_CODES, LOCALES } from "@veriqall/shared";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { API_URL } from "@/lib/auth";
import { writeLocaleCookie } from "@/i18n/locale";

// Chooses the language of the pages. Each language is named in itself ("Svenska", "Deutsch"), so
// it can be found whatever language the page is in. Signed in, the choice is also saved on the
// user, so it follows them to other browsers.
export function LanguagePicker({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function choose(next: Locale) {
    writeLocaleCookie(next);
    if (signedIn && API_URL) {
      await fetch(`${API_URL}/me/locale`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    }
    startTransition(() => router.refresh());
  }

  return (
    <label className={`flex items-center gap-2 text-sm ${className}`}>
      <span className="sr-only">{t("language")}</span>
      <select
        className="min-h-11 rounded-lg border border-line bg-surface px-2"
        value={locale}
        disabled={pending}
        onChange={(e) => choose(e.target.value as Locale)}
      >
        {LOCALE_CODES.map((code) => (
          <option key={code} value={code} lang={LOCALES[code].tag}>
            {LOCALES[code].name}
          </option>
        ))}
      </select>
    </label>
  );
}
