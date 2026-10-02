// Formatting helpers shared by every page (dates, CSV, invitation state). Kept apart from the
// superadmin module so pages for call centres and users do not load superadmin code.

export function invitationState(inv: { usedAt: string | null; revokedAt: string | null; expiresAt: string }, now = new Date()) {
  if (inv.usedAt) return "Brukt";
  if (inv.revokedAt) return "Trukket tilbake";
  if (new Date(inv.expiresAt) <= now) return "Utløpt";
  return "Venter";
}

export function formatDate(value: string | null): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Aldri";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
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
