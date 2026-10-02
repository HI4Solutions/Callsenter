// Calls to the superadmin API (apps/api/src/admin). The session cookie lives on the API host,
// so every call carries credentials; the API only answers this app's origin.
import { API_URL } from "./auth";

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return apiFetch<T>(`/admin${path}`, init);
}

// Any API call with the session cookie; errors carry the API's Norwegian message.
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AdminError("Får ikke kontakt med serveren. Prøv igjen.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new AdminError(data.error ?? "Noe gikk galt.", res.status, data.code);
  return data as T;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  orgNumber: string | null;
  status: "active" | "suspended";
  trialEndsAt: string | null;
  createdAt: string;
  activeMembers: number;
  invitedMembers: number;
  lastLoginAt: string | null;
}

export interface OrganizationDetail {
  id: string;
  name: string;
  orgNumber: string | null;
  status: "active" | "suspended";
  trialEndsAt: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  invoiceEmail: string | null;
  invoiceAddress: string | null;
  note: string | null;
  createdAt: string;
  modules: { key: string; enabled: boolean }[];
  members: {
    userId: string;
    name: string;
    phone: string | null;
    email: string | null;
    userStatus: "invited" | "active" | "disabled";
    lastLoginAt: string | null;
    status: "active" | "disabled";
    roleKey: string;
    roleName: string;
  }[];
  roles: { key: string; name: string }[];
  invitations: {
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    revokedAt: string | null;
  }[];
}

// Status as shown to the superadmin: a trial is an active call centre with an end date.
export function organizationState(org: { status: string; trialEndsAt: string | null }, now = new Date()) {
  if (org.status === "suspended") return { label: "Suspendert", tone: "danger" as const };
  if (org.trialEndsAt) {
    return new Date(org.trialEndsAt) > now
      ? { label: `Prøveperiode til ${formatDate(org.trialEndsAt)}`, tone: "warning" as const }
      : { label: "Prøveperiode utløpt", tone: "danger" as const };
  }
  return { label: "Aktiv", tone: "ok" as const };
}

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

export interface UserSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "invited" | "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  platformAdmin: boolean;
  organizations: { id: string; name: string; role: string; status: string }[];
}

export interface UserDetail extends Omit<UserSummary, "organizations"> {
  self: boolean;
  organizations: { id: string; name: string; role: string; status: string }[];
  identities: { provider: "bankid" | "vipps"; createdAt: string; lastUsedAt: string | null }[];
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[];
  sessions: { provider: string; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; userAgent: string | null }[];
  logins: { occurredAt: string; provider: string; result: string; ip: string | null }[];
}

export interface Catalog {
  permissions: { key: string; description: string; requiresBankId: boolean }[];
  defaultRoles: { key: string; name: string; permissions: string[] }[];
  modules: { key: string; name: string; description: string; enabledIn: number }[];
}

export const USER_STATUS: Record<string, string> = { invited: "Invitert", active: "Aktiv", disabled: "Deaktivert" };
export const PROVIDER: Record<string, string> = { bankid: "BankID", vipps: "Vipps", passkey: "Passkey" };
export const LOGIN_RESULT: Record<string, string> = {
  success: "Vellykket",
  cancelled: "Avbrutt",
  unknown_identity: "Ukjent bruker",
  invalid: "Ugyldig",
  error: "Feil",
};

// CSV for Excel with Norwegian settings: semicolon separated, with a byte order mark so
// æ, ø and å survive.
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (value: string | number | boolean | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    // A leading =, +, - or @ would be read as a formula.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}

export interface SecurityOverview {
  hours: number;
  totals: { success: number; failed: number };
  failedByIp: { ip: string; failures: number; users: number; lastAt: string; blocked: boolean }[];
  failedByUser: { id: string; name: string; failures: number; lastAt: string }[];
  recent: {
    occurredAt: string;
    provider: string;
    result: string;
    reason: string | null;
    ip: string | null;
    userAgent: string | null;
    userId: string | null;
    userName: string | null;
  }[];
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  action: "insert" | "update" | "delete";
  table: string;
  recordId: string | null;
  asPlatformAdmin: boolean;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  organizationId: string | null;
  organizationName: string | null;
  actorId: string | null;
  actorName: string | null;
}

export interface AccessRow {
  id: string;
  occurredAt: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip: string | null;
  organizationName: string;
  userId: string;
  userName: string;
}

export interface BlockedIp {
  id: string;
  network: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  createdByName: string | null;
}

export const AUDIT_ACTION: Record<string, string> = { insert: "Opprettet", update: "Endret", delete: "Slettet" };

export const AUDIT_TABLE: Record<string, string> = {
  organizations: "Callsenter",
  organization_modules: "Modul",
  users: "Bruker",
  platform_admins: "Superadmin",
  teams: "Team",
  roles: "Rolle",
  role_permissions: "Rettighet i rolle",
  memberships: "Medlemskap",
  invitations: "Invitasjon",
  identities: "Innloggingsmetode",
  sessions: "Økter",
  blocked_ips: "IP-sperring",
};

// Fields that changed in an audit row (ignoring timestamps that change on every update).
export function changedFields(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null) {
  const ignore = new Set(["updated_at"]);
  const keys = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]);
  const changes: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of [...keys].sort()) {
    if (ignore.has(field)) continue;
    const before = oldData?.[field] ?? null;
    const after = newData?.[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
  }
  return changes;
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkText: string | null;
  audience: "all" | "selected";
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  createdByName: string | null;
  organizations: { id: string; name: string }[];
}

export function announcementState(a: { active: boolean; startsAt: string; endsAt: string | null }, now = new Date()) {
  if (!a.active) return { label: "Av", tone: "danger" as const };
  if (new Date(a.startsAt) > now) return { label: `Fra ${formatDate(a.startsAt)}`, tone: "warning" as const };
  if (a.endsAt && new Date(a.endsAt) <= now) return { label: "Utløpt", tone: "danger" as const };
  return { label: "Vises nå", tone: "ok" as const };
}

export interface Growth {
  months: number;
  totals: {
    openOrganizations: number;
    trialOrganizations: number;
    closedOrganizations: number;
    activeUsers: number;
    invitedUsers: number;
    newUsers30d: number;
    allUsers: number;
    usersBefore: number;
  };
  series: { month: string; newOrganizations: number; newUsers: number; logins: number }[];
  events: { id: string; title: string; occurredOn: string }[];
}

// Running total of users at the end of each month, starting from those created before the window.
export function cumulative(start: number, values: number[]): number[] {
  let total = start;
  return values.map((v) => (total += v));
}

export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { month: "short", year: "2-digit" }).format(new Date(Date.UTC(year!, m! - 1, 1)));
}
