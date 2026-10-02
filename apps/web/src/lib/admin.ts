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

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin${path}`, {
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
