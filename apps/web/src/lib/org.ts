// The call centre's admin portal (apps/api/src/org).
import { apiFetch } from "./api";

export interface OrgOverview {
  members: {
    userId: string;
    name: string;
    phone: string | null;
    email: string | null;
    userStatus: "invited" | "active" | "disabled";
    lastLoginAt: string | null;
    status: "active" | "disabled";
    createdAt: string;
    roleId: string;
    roleName: string;
    teamId: string | null;
    teamName: string | null;
  }[];
  roles: { id: string; key: string; name: string; permissions: string[]; assignable: boolean }[];
  teams: { id: string; name: string; archivedAt: string | null; members: number }[];
  invitations: { id: string; name: string; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null }[];
}

export function orgFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return apiFetch<T>(`/org${path}`, init);
}

export async function switchOrganization(organizationId: string): Promise<void> {
  await apiFetch("/me/organization", { method: "POST", body: { organizationId } });
}

// Shown as status: inactive in this call centre wins over the user's own state. key is the
// status in domain.userStatus; label is the Norwegian fallback.
export function memberState(m: { status: string; userStatus: string }) {
  if (m.status === "disabled" || m.userStatus === "disabled") return { key: "disabled" as const, label: "Deaktivert", tone: "danger" as const };
  if (m.userStatus === "invited") return { key: "invited" as const, label: "Invitert", tone: "warning" as const };
  return { key: "active" as const, label: "Aktiv", tone: "ok" as const };
}

// The admin's overview (app.org_summary). Parts without the permission are null: activity needs
// dashboard.all, invoices billing.read.
export interface OrgSummary {
  organization: { name: string; status: "active" | "suspended"; trialEndsAt: string | null; accessUntil: string | null };
  members: {
    active: number;
    invited: number;
    disabled: number;
    loggedIn7: number;
    inactive30: number;
    bankid: number;
    vipps: number;
    passkey: number;
    invitationsPending: number;
    invitationsExpired: number;
  };
  teams: { teams: { id: string; name: string; members: number }[]; withoutTeam: number };
  roles: { name: string; members: number }[];
  usage: Record<"month" | "previous", { hours: number; controls: number; notes: number }>;
  activity: { teamId: string | null; name: string | null; calls: number; sales: number; confirmed: number }[] | null;
  invoices: { unpaid: number; unpaidAmount: number; overdue: number; nextDue: string | null; lastPaidAt: string | null } | null;
  modules: string[];
}
