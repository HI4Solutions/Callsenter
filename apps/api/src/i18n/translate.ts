// The API's own texts in the user's language (docs/plan.md, section 19). The code keeps writing
// its messages in Norwegian, the source language; each response is translated on its way out
// (json() in http.ts), using the language of the request. A message with a {placeholder}
// matches whatever stands there, and the value is translated too when it is a known word (the
// field names in validate.ts). messages.ts holds the translations; a test checks that every
// message in the code has one in every language.
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_LOCALE, isLocale, type Locale, localeFromAcceptLanguage } from "@veriqall/shared";
import { LABELS, MESSAGES } from "./messages.ts";

const storage = new AsyncLocalStorage<Locale>();

// The cookie the web app sets for the language of the pages, on the parent domain so the API
// gets it too (apps/web/src/i18n/locale.ts).
export const LOCALE_COOKIE = "vq_locale";

export function requestLocale(cookie: string | undefined, acceptLanguage: string | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

// The language of the request being handled; Norwegian outside one (the worker, tests).
export function currentLocale(): Locale {
  return storage.getStore() ?? DEFAULT_LOCALE;
}

interface Pattern {
  regex: RegExp;
  names: string[];
  template: string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function compile(template: string): Pattern {
  const names: string[] = [];
  const source = template
    .split(PLACEHOLDER)
    .map((part, i) => {
      if (i % 2 === 1) {
        names.push(part);
        return "(.+?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { regex: new RegExp(`^${source}$`, "s"), names, template };
}

// Templates without placeholders are looked up directly; the others are tried longest first, so
// the most specific wins.
const exact = new Set<string>();
const patterns: Pattern[] = [];
for (const template of Object.keys(MESSAGES.en)) {
  if (PLACEHOLDER.test(template)) patterns.push(compile(template));
  else exact.add(template);
  PLACEHOLDER.lastIndex = 0;
}
patterns.sort((a, b) => b.template.replace(PLACEHOLDER, "").length - a.template.replace(PLACEHOLDER, "").length);

function label(value: string, locale: Exclude<Locale, "nb">): string {
  return LABELS[locale][value] ?? LABELS[locale][value.toLowerCase()]?.toLowerCase() ?? value;
}

// A Norwegian message from the code in another language; unknown text is left as it is.
// exactOnly: only whole messages, never patterns (for fields that may hold what a user wrote).
export function translateMessage(text: string, locale: Locale = currentLocale(), exactOnly = false): string {
  if (locale === "nb") return text;
  const messages = MESSAGES[locale];
  if (exact.has(text)) return messages[text] ?? text;
  if (exactOnly) return text;
  for (const p of patterns) {
    const match = p.regex.exec(text);
    if (!match) continue;
    const values = Object.fromEntries(p.names.map((name, i) => [name, label(match[i + 1]!, locale)]));
    return (messages[p.template] ?? p.template).replace(PLACEHOLDER, (_, name: string) => values[name] ?? "");
  }
  return text;
}

// The fields of a response the API writes itself, translated wherever they are in the body: an
// error (from a request, a failed call or note), and status notes written by the system. Notes
// may also be what a user wrote, so only whole known messages are translated there.
const TRANSLATED_KEYS = new Map([
  ["error", false],
  ["statusNote", true],
  ["note", true],
]);

export function translateBody(body: unknown, locale: Locale = currentLocale()): unknown {
  if (locale === "nb" || body === null || typeof body !== "object") return body;
  if (Array.isArray(body)) return body.map((item) => translateBody(item, locale));
  if (body instanceof Date || ArrayBuffer.isView(body)) return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      typeof value === "string" && TRANSLATED_KEYS.has(key)
        ? translateMessage(value, locale, TRANSLATED_KEYS.get(key))
        : translateBody(value, locale),
    ]),
  );
}
