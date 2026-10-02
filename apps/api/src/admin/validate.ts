// Input checks for the superadmin API. Messages are shown to the user, so they are Norwegian.
import { normalizePhone } from "../auth/phone.ts";

export class BadRequest extends Error {}

export type Body = Record<string, unknown>;

export function parseBody(raw: string | undefined, base64: boolean | undefined): Body {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(base64 ? Buffer.from(raw, "base64").toString("utf8") : raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Body;
  } catch {
    // Fall through.
  }
  throw new BadRequest("Ugyldig forespørsel.");
}

// undefined = not sent (leave as is), null = clear the field.
export function optionalText(body: Body, key: string, label: string, max = 500): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequest(`${label} må være tekst.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequest(`${label} er for lang.`);
  return trimmed || null;
}

export function requiredText(body: Body, key: string, label: string, max = 200): string {
  const value = optionalText(body, key, label, max);
  if (!value) throw new BadRequest(`${label} må fylles ut.`);
  return value;
}

export function optionalEmail(body: Body, key: string, label: string): string | null | undefined {
  const value = optionalText(body, key, label, 254);
  if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new BadRequest(`${label} er ikke en gyldig e-postadresse.`);
  return value;
}

export function optionalPhone(body: Body, key: string, label: string): string | null | undefined {
  const value = optionalText(body, key, label, 30);
  if (!value) return value;
  const phone = normalizePhone(value);
  if (!phone) throw new BadRequest(`${label} er ikke et gyldig mobilnummer.`);
  return phone;
}

export function optionalOrgNumber(body: Body, key: string): string | null | undefined {
  const value = optionalText(body, key, "Organisasjonsnummer", 20);
  if (!value) return value;
  const digits = value.replace(/\s/g, "");
  if (!/^[0-9]{9}$/.test(digits)) throw new BadRequest("Organisasjonsnummeret må ha ni siffer.");
  return digits;
}

export function optionalDate(body: Body, key: string, label: string): Date | null | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return value === undefined ? undefined : null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BadRequest(`${label} er ikke en gyldig dato.`);
  return new Date(value);
}

export function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
