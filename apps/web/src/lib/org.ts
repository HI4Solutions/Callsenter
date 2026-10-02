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

// Shown as status: inactive in this call centre wins over the user's own state.
export function memberState(m: { status: string; userStatus: string }) {
  if (m.status === "disabled" || m.userStatus === "disabled") return { label: "Deaktivert", tone: "danger" as const };
  if (m.userStatus === "invited") return { label: "Invitert", tone: "warning" as const };
  return { label: "Aktiv", tone: "ok" as const };
}
