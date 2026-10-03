// Formatting helpers shared by every page (dates, CSV, invitation state). Kept apart from the
// superadmin module so pages for call centres and users do not load superadmin code.

export function invitationState(inv: { usedAt: string | null; revokedAt: string | null; expiresAt: string }, now = new Date()) {
  if (inv.usedAt) return "Brukt";
  if (inv.revokedAt) return "Trukket tilbake";
  if (new Date(inv.expiresAt) <= now) return "Utløpt";
  return "Venter";
}

// The page's language for dates and numbers (BCP 47, nb-NO by default). Set by <FormatLocale/> in
// the layout as the page renders in the browser, so helpers called anywhere follow the language.
let formatTag = "nb-NO";
type CommonText = (key: "never" | "months" | "days" | "perMonth" | "once" | "none", values?: Record<string, string | number>) => string;
// Norwegian until <FormatLocale/> has run (and in tests).
let commonText: CommonText = (key, values) => {
  const n = Number(values?.count ?? 0);
  const fallback = {
    never: "Aldri",
    none: "Ingen",
    months: n === 0 ? "Ingen" : `${n} ${n === 1 ? "måned" : "måneder"}`,
    days: n === 0 ? "Ingen" : `${n} ${n === 1 ? "dag" : "dager"}`,
    perMonth: `${values?.amount}/mnd`,
    once: `${values?.amount} engangs`,
  };
  return fallback[key];
};

export function setFormatLocale(tag: string, text: CommonText) {
  formatTag = tag;
  commonText = text;
}

// Common words for helpers outside components (months(), days(), formatPrice() in lib/work.ts).
export function commonWord(key: Parameters<CommonText>[0], values?: Record<string, string | number>): string {
  return commonText(key, values);
}

export function formatTagNow(): string {
  return formatTag;
}

export function formatDate(value: string | null): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat(formatTag, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Oslo" }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string | null): string {
  if (!value) return commonText("never");
  return new Intl.DateTimeFormat(formatTag, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(value));
}

// CSV for Excel with Norwegian settings: semicolon separated, with a byte order mark so
// æ, ø and å survive.
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (value: string | number | boolean | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    // A leading =, +, - or @ would be read as a formula.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}
