// Login against the API (apps/api). The API runs the OIDC flows with Vipps and Idura (BankID)
// and sets the session cookie on its own host; see docs/auth.md.

import { type Locale, safeAppPath } from "@veriqall/shared";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export type LoginProvider = "vipps" | "bankid";

// Error codes the API sends back as /logg-inn?feil=<code>; their texts are login.errors.<code>.
export const LOGIN_ERROR_CODES = [
  "avbrutt",
  "utlopt",
  "ukjent",
  "invitasjon",
  "deaktivert",
  "allerede_koblet",
  "navn_ulikt",
  "ikke_satt_opp",
  "feil",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

// A known error code, "feil" for anything else, or undefined without one.
export function loginErrorCode(code: string | undefined): LoginErrorCode | undefined {
  if (!code) return undefined;
  return (LOGIN_ERROR_CODES as readonly string[]).includes(code) ? (code as LoginErrorCode) : "feil";
}

// Only paths inside the app, never another site (the API checks this again).
export function safeNext(next: string | undefined): string | undefined {
  return safeAppPath(next);
}

export function loginStartUrl(provider: LoginProvider, options: { invite?: string; next?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.invite) params.set("invite", options.invite);
  const next = safeNext(options.next);
  if (next) params.set("next", next);
  const query = params.toString();
  return `${API_URL}/auth/${provider}/start${query ? `?${query}` : ""}`;
}

export interface Me {
  user: { id: string; name: string };
  provider: string;
  strongAuthentication: boolean;
  platformAdmin: boolean;
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  // Modules switched on for the active call centre.
  modules?: string[];
  // The user's own language for the pages (null follows the call centre), the call centre's, and
  // the language its notes are written in.
  locale?: Locale | null;
  organizationLocale?: Locale | null;
  contentLocale?: Locale | null;
  transcriptionLanguages?: string[];
}

// Where a signed-in user lands when they open the login page: their starting point (superadmin
// portal, the call centre's administration, sales, customers, or their account).
export function signedInDestination(me: Pick<Me, "platformAdmin" | "permissions" | "modules">): string {
  if (me.platformAdmin) return "/admin";
  if (me.permissions.includes("users.manage")) return "/administrasjon";
  if (me.permissions.includes("calls.upload") && (me.modules ?? []).includes("transcription")) return "/samtaler";
  if (me.permissions.includes("sales.manage")) return "/salg";
  if (me.permissions.includes("customers.read")) return "/kunder";
  return "/konto";
}

// The login page for someone who is not signed in, returning them to where they were.
export function loginPathFor(path: string): string {
  const next = safeNext(path);
  return next && next !== "/" ? `/logg-inn?neste=${encodeURIComponent(next)}` : "/logg-inn";
}

// GET /me: the user, "signed-out" when there is no valid session, or null when the API cannot be
// reached.
export async function fetchMe(): Promise<Me | "signed-out" | null> {
  try {
    const res = await fetch(`${API_URL}/me`, { credentials: "include" });
    if (res.status === 401) return "signed-out";
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}
