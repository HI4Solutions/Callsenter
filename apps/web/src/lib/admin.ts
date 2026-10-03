// Calls to the superadmin API (apps/api/src/admin). The session cookie lives on the API host,
// so every call carries credentials; the API only answers this app's origin.
import { type Locale, LOCALES } from "@veriqall/shared";
import { useLocale } from "next-intl";
import { apiFetch } from "./api";
import { formatDate, formatTagNow } from "./format";

export { AdminError, apiFetch } from "./api";
export { formatDate, formatDateTime, invitationState, toCsv } from "./format";

export function adminFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  return apiFetch<T>(`/admin${path}`, init);
}

export interface OrganizationSummary {
  id: string;
  name: string;
  orgNumber: string | null;
  status: "active" | "suspended";
  trialEndsAt: string | null;
  // Set when invoices control access (docs/plan.md, section 16).
  accessUntil?: string | null;
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
  // Set when invoices control access (docs/plan.md, section 16).
  accessUntil?: string | null;
  recordingRetentionMonths: 3 | 6 | 9 | 12;
  // The call centre's languages (docs/plan.md, section 19).
  defaultLocale?: Locale;
  contentLocale?: Locale;
  transcriptionLanguages?: string[];
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

// The page language's BCP 47 tag (nb-NO, en-GB …), for Intl formatters in components.
export function useLocaleTag(): string {
  return LOCALES[useLocale()].tag;
}

// Status as shown to the superadmin: a trial is an active call centre with an end date. `key` is
// the text in messages/<locale>/admin.json (admin.organizationState, with {date}).
export function organizationState(
  org: {
    status: string;
    trialEndsAt: string | null;
    accessUntil?: string | null;
  },
  now = new Date(),
) {
  if (org.status === "suspended")
    return { key: "suspended" as const, tone: "danger" as const, date: "" };
  if (org.accessUntil && new Date(org.accessUntil) <= now) {
    return { key: "closed" as const, tone: "danger" as const, date: "" };
  }
  if (org.trialEndsAt) {
    return new Date(org.trialEndsAt) > now
      ? {
          key: "trial" as const,
          tone: "warning" as const,
          date: formatDate(org.trialEndsAt),
        }
      : { key: "trialExpired" as const, tone: "danger" as const, date: "" };
  }
  return { key: "active" as const, tone: "ok" as const, date: "" };
}

// An invitation's state as a key in admin.invitationState (invitationState in lib/format.ts gives
// the Norwegian text).
export function invitationKey(
  inv: { usedAt: string | null; revokedAt: string | null; expiresAt: string },
  now = new Date(),
) {
  if (inv.usedAt) return "used" as const;
  if (inv.revokedAt) return "revoked" as const;
  if (new Date(inv.expiresAt) <= now) return "expired" as const;
  return "pending" as const;
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
  identities: {
    provider: "bankid" | "vipps";
    createdAt: string;
    lastUsedAt: string | null;
  }[];
  passkeys: {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
  sessions: {
    provider: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    ip: string | null;
    userAgent: string | null;
  }[];
  logins: {
    occurredAt: string;
    provider: string;
    result: string;
    ip: string | null;
  }[];
}

export interface Catalog {
  permissions: { key: string; description: string; requiresBankId: boolean }[];
  defaultRoles: { key: string; name: string; permissions: string[] }[];
  modules: {
    key: string;
    name: string;
    description: string;
    enabledIn: number;
  }[];
}

export const USER_STATUS: Record<string, string> = {
  invited: "Invitert",
  active: "Aktiv",
  disabled: "Deaktivert",
};
export const PROVIDER: Record<string, string> = {
  bankid: "BankID",
  vipps: "Vipps",
  passkey: "Passkey",
};
export const LOGIN_RESULT: Record<string, string> = {
  success: "Vellykket",
  cancelled: "Avbrutt",
  unknown_identity: "Ukjent bruker",
  invalid: "Ugyldig",
  error: "Feil",
};

export interface SecurityOverview {
  hours: number;
  totals: { success: number; failed: number };
  failedByIp: {
    ip: string;
    failures: number;
    users: number;
    lastAt: string;
    blocked: boolean;
  }[];
  failedByUser: {
    id: string;
    name: string;
    failures: number;
    lastAt: string;
  }[];
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

export const AUDIT_ACTION: Record<string, string> = {
  insert: "Opprettet",
  update: "Endret",
  delete: "Slettet",
};

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
export function changedFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
) {
  const ignore = new Set(["updated_at"]);
  const keys = new Set([
    ...Object.keys(oldData ?? {}),
    ...Object.keys(newData ?? {}),
  ]);
  const changes: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of [...keys].sort()) {
    if (ignore.has(field)) continue;
    const before = oldData?.[field] ?? null;
    const after = newData?.[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push({ field, before, after });
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

// `key` is the text in admin.announcementState (with {date}).
export function announcementState(
  a: { active: boolean; startsAt: string; endsAt: string | null },
  now = new Date(),
) {
  if (!a.active)
    return { key: "off" as const, tone: "danger" as const, date: "" };
  if (new Date(a.startsAt) > now)
    return {
      key: "from" as const,
      tone: "warning" as const,
      date: formatDate(a.startsAt),
    };
  if (a.endsAt && new Date(a.endsAt) <= now)
    return { key: "expired" as const, tone: "danger" as const, date: "" };
  return { key: "showing" as const, tone: "ok" as const, date: "" };
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
  series: {
    month: string;
    newOrganizations: number;
    newUsers: number;
    logins: number;
  }[];
  events: { id: string; title: string; occurredOn: string }[];
}

// Running total of users at the end of each month, starting from those created before the window.
export function cumulative(start: number, values: number[]): number[] {
  let total = start;
  return values.map((v) => (total += v));
}

export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(formatTagNow(), {
    month: "short",
    year: "2-digit",
  }).format(new Date(Date.UTC(year!, m! - 1, 1)));
}

// Superadmin → Oversikt (GET /admin/overview). Counts only; money in NOK.
export interface PlatformOverview {
  today: string;
  organizations: {
    total: number;
    open: number;
    trial: number;
    paying: number;
    closed: number;
    newThisMonth: number;
    ending: {
      id: string;
      name: string;
      kind: "trial" | "access";
      endsAt: string;
    }[];
    mostActive: { id: string; name: string; calls: number; users30: number }[];
    quiet: {
      id: string;
      name: string;
      lastCallAt: string | null;
      lastLoginAt: string | null;
    }[];
  };
  users: {
    active: number;
    invited: number;
    disabled: number;
    new30: number;
    loggedInToday: number;
    loggedIn7: number;
  };
  logins: {
    today: number;
    week: number;
    byMethod: { bankid: number; vipps: number; passkey: number };
    failed24h: number;
    suspiciousIps: number;
    blockedIps: number;
  };
  calls: {
    today: number;
    week: number;
    month: number;
    failed7: number;
    recording: number;
    processing: number;
    stuck: number;
    piecesWaiting: number;
    oldestPieceAt: string | null;
  };
  usage: { hours: number; controls: number; notes: number };
  support: { open: number; unread: number; announcements: number };
  days: { day: string; calls: number; logins: number }[];
  money: {
    mrr: number;
    arr: number;
    revenue: number;
    costs: number;
    result: number;
    outstanding: number;
    overdue: number;
    missed: number;
    drafts: number;
    scheduled: number;
  };
}

export type AttentionKey =
  | "stuck"
  | "pieces"
  | "failed"
  | "ips"
  | "missed"
  | "overdue"
  | "unread"
  | "drafts";

// The text is admin.overview.attention.<key>, with `values` as its {placeholders}.
export interface Attention {
  key: AttentionKey;
  values: { count: number; minutes?: number };
  href?: string;
}

export function waitedMinutes(since: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
}

// What needs the superadmin now, most urgent first: the worker falling behind, failed calls,
// logins that look like an attack, money not paid, and messages not read. For "overdue", count is
// the amount in kroner.
export function attention(o: PlatformOverview, now: number): Attention[] {
  const items: Attention[] = [];
  if (o.calls.stuck > 0)
    items.push({ key: "stuck", values: { count: o.calls.stuck } });
  const waited = o.calls.oldestPieceAt
    ? waitedMinutes(o.calls.oldestPieceAt, now)
    : 0;
  if (o.calls.piecesWaiting > 0 && waited >= 5) {
    items.push({
      key: "pieces",
      values: { count: o.calls.piecesWaiting, minutes: waited },
    });
  }
  if (o.calls.failed7 > 0)
    items.push({ key: "failed", values: { count: o.calls.failed7 } });
  if (o.logins.suspiciousIps > 0)
    items.push({
      key: "ips",
      values: { count: o.logins.suspiciousIps },
      href: "/admin/sikkerhet",
    });
  if (o.money.missed > 0) {
    items.push({
      key: "missed",
      values: { count: o.money.missed },
      href: "/admin/okonomi/faktura",
    });
  } else if (o.money.overdue > 0) {
    items.push({
      key: "overdue",
      values: { count: o.money.overdue },
      href: "/admin/okonomi/faktura",
    });
  }
  if (o.support.unread > 0)
    items.push({
      key: "unread",
      values: { count: o.support.unread },
      href: "/admin/meldinger",
    });
  if (o.money.drafts > 0)
    items.push({
      key: "drafts",
      values: { count: o.money.drafts },
      href: "/admin/okonomi/faktura",
    });
  return items;
}
