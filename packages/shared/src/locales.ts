// The languages VeriQall is available in (docs/plan.md, section 19). One entry per language: the
// pages, the notes and the AI control's text can all be in any of them. Adding a language means
// an entry here, a row in the locales table (a migration), and its message files in
// apps/web/messages/<code>/ and apps/api/src/i18n/. Tests check that every language has them all.
export const LOCALES = {
  nb: {
    // The language's own name, shown in the language picker.
    name: "Norsk (bokmål)",
    // BCP 47 tag for Intl (dates, numbers) and <html lang>.
    tag: "nb-NO",
    // How the AI is told which language to write in.
    aiName: "Norwegian bokmål",
    // Soniox's code for the spoken language (language hints and identification).
    soniox: "no",
    // PostgreSQL text search configuration for transcripts in this language.
    search: "norwegian",
  },
  en: { name: "English", tag: "en-GB", aiName: "English", soniox: "en", search: "english" },
  sv: { name: "Svenska", tag: "sv-SE", aiName: "Swedish", soniox: "sv", search: "swedish" },
  da: { name: "Dansk", tag: "da-DK", aiName: "Danish", soniox: "da", search: "danish" },
  de: { name: "Deutsch", tag: "de-DE", aiName: "German", soniox: "de", search: "german" },
} as const satisfies Record<string, { name: string; tag: string; aiName: string; soniox: string; search: string }>;

export type Locale = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

// Norwegian is the source language: every text is written in it first.
export const DEFAULT_LOCALE: Locale = "nb";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

// The best supported language for an Accept-Language header ("sv-SE,sv;q=0.9,en;q=0.8").
// Norwegian nn and no count as nb.
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(",")
    .map((part) => {
      const [range, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { range: (range ?? "").trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((w) => w.range && Number.isFinite(w.q) && w.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { range } of wanted) {
    const primary = range.split("-")[0]!;
    const code = primary === "no" || primary === "nn" ? "nb" : primary;
    if (isLocale(code)) return code;
  }
  return null;
}

// Languages Soniox may be told to expect in a call, as Soniox codes. Soniox recognises more than
// 60; a call centre lists the ones its calls are in (organizations.transcription_languages).
export const SONIOX_LANGUAGE = /^[a-z]{2,3}$/;

// The languages Soniox transcribes (https://soniox.com/docs/stt/concepts/supported-languages), as
// offered in the pickers. Their names come from the browser (Intl.DisplayNames) in the language
// of the page, so the list needs no translations.
export const SONIOX_LANGUAGES = [
  "af", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr",
  "gl", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kk", "kn", "ko", "lt", "lv", "mk", "ml", "mr", "ms", "nl", "no",
  "pa", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "zh",
] as const;
export const MAX_TRANSCRIPTION_LANGUAGES = 10;

// The supported language a Soniox language code belongs to, if any (for the transcript's search).
export function localeFromSoniox(code: string | null | undefined): Locale | null {
  if (!code) return null;
  const found = LOCALE_CODES.find((l) => LOCALES[l].soniox === code);
  return found ?? null;
}
