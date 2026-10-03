// The language of the pages (docs/plan.md, section 19). It is kept in a cookie on the web app's
// own domain, so the server renders the right language at once: the user's saved choice, else
// the call centre's, else the browser's (Accept-Language), else Norwegian.
import { DEFAULT_LOCALE, isLocale, type Locale, localeFromAcceptLanguage } from "@veriqall/shared";

export const LOCALE_COOKIE = "vq_locale";

export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

// Saves the language in this browser for a year. On veriqall.no the cookie is set for the whole
// domain, so the API (api.<...>.veriqall.no) answers in the same language.
export function writeLocaleCookie(locale: Locale) {
  const host = window.location.hostname;
  const domain = host === "veriqall.no" || host.endsWith(".veriqall.no") ? "; Domain=veriqall.no" : "";
  // A cookie saved before without a domain would shadow the new one, so it is removed.
  if (domain) document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure${domain}`;
}

export function readLocaleCookie(): string | undefined {
  return document.cookie
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
}
