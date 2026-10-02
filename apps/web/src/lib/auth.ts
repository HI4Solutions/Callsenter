// Login against the API (apps/api). The API runs the OIDC flows with Vipps and Idura (BankID)
// and sets the session cookie on its own host; see docs/auth.md.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export type LoginProvider = "vipps" | "bankid";

// Error codes the API sends back as /logg-inn?feil=<code>.
export const LOGIN_ERRORS: Record<string, string> = {
  avbrutt: "Innloggingen ble avbrutt. Prøv igjen når du er klar.",
  utlopt: "Innloggingen tok for lang tid eller økten er utløpt. Prøv igjen.",
  ukjent:
    "Vi fant ingen bruker knyttet til denne innloggingen. Be lederen din om en invitasjon, eller logg inn med BankID hvis kontoen din er satt opp med det.",
  invitasjon: "Invitasjonen er ugyldig, brukt eller utløpt. Be om en ny invitasjon.",
  deaktivert: "Brukeren din er deaktivert. Ta kontakt med lederen din.",
  allerede_koblet: "Denne innloggingen er allerede koblet til en annen bruker.",
  ikke_satt_opp: "Denne innloggingsmetoden er ikke satt opp ennå.",
  feil: "Noe gikk galt under innloggingen. Prøv igjen om litt.",
};

export function loginErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.feil;
}

// Only paths inside the app, never another site (the API checks this again).
export function safeNext(next: string | undefined): string | undefined {
  if (!next || !/^\/[^/\\]/.test(next) || /[\r\n]/.test(next) || next.length > 512) return undefined;
  return next;
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
}

// Where a signed-in user lands when they open the login page: the requested page, or their
// starting point (superadmin portal, the call centre's administration, or their account).
export function signedInDestination(me: Pick<Me, "platformAdmin" | "permissions">, next?: string): string {
  const requested = safeNext(next);
  if (requested && requested !== "/logg-inn" && !requested.startsWith("/logg-inn?")) return requested;
  if (me.platformAdmin) return "/admin";
  if (me.permissions.includes("users.manage")) return "/administrasjon";
  return "/konto";
}
