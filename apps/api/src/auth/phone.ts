// Normalizes a phone number to E.164 (+4712345678). Vipps sends Norwegian numbers with or
// without the country code. Returns undefined for anything that does not look like a number.
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[\s-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  if (/^00[1-9]\d{6,14}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^[49]\d{7}$/.test(digits)) return `+47${digits}`;
  if (/^47[49]\d{7}$/.test(digits)) return `+${digits}`;
  return undefined;
}
