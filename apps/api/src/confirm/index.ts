// The customer's side of sale verification (docs/plan.md, section 14): public, no session. The
// secret link token is only ever compared by hash, through app_auth functions. Accepting goes
// through BankID or Vipps with the normal login callback (the state carries the confirmation),
// so no extra redirect URL has to be registered with the providers.
import type pg from "pg";
import { randomToken, sha256, pkceChallenge } from "../auth/crypto.ts";
import { callbackUri, type RequestMeta } from "../auth/flow.ts";
import { authorizationUrl } from "../auth/oidc.ts";
import { normalizePhone } from "../auth/phone.ts";
import type { AuthDeps, Identity, Provider } from "../auth/types.ts";

export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface ConfirmationView {
  id: string;
  status: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  document: Record<string, unknown>;
  documentHash: string;
  expiresAt: string;
  decidedAt: string | null;
  method: string | null;
}

export async function viewConfirmation(authDb: pg.Pool, token: string): Promise<ConfirmationView | null> {
  const { rows } = await authDb.query<{ v: ConfirmationView | null }>("select app.confirmation_view($1) as v", [sha256(token)]);
  return rows[0]?.v ?? null;
}

export function resultPage(deps: AuthDeps, result: string): string {
  return new URL(`/bekreft/ferdig?resultat=${encodeURIComponent(result)}`, deps.config.appOrigin).toString();
}

// The cookie that ties the identification to the browser that opened the offer.
export const CONFIRM_COOKIE = "vq_confirm";

function closedResult(status: ConfirmationView["status"]): string {
  return status === "expired" ? "utlopt" : status === "revoked" ? "trukket" : "avgjort";
}

// Starts identification for accepting: a redirect to BankID or Vipps, and a cookie (binding) that
// the callback requires, so the redirect cannot be passed on to someone who never saw the offer.
export async function startConfirmation(
  deps: AuthDeps,
  token: string,
  provider: Provider,
): Promise<{ location: string; binding?: string }> {
  const settings = deps.config.providers[provider];
  if (!settings) return { location: resultPage(deps, "ikke_satt_opp") };
  const view = await viewConfirmation(deps.authDb, token);
  if (!view) return { location: resultPage(deps, "ukjent") };
  if (view.status !== "pending") return { location: resultPage(deps, closedResult(view.status)) };
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const binding = randomToken();
  await deps.authDb.query(
    `insert into auth_states (state_hash, provider, nonce, code_verifier, confirmation_id, browser_hash, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(state), provider, nonce, verifier, view.id, sha256(binding), deps.now()],
  );
  const location = await authorizationUrl(deps.fetch, settings, {
    redirectUri: callbackUri(deps, provider),
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });
  return { location, binding };
}

// Called from the login callback when the state belongs to a confirmation.
export async function acceptConfirmation(deps: AuthDeps, confirmationId: string, identity: Identity, meta: RequestMeta) {
  const ref = sha256(`${identity.provider}:${identity.subject}`).toString("hex");
  const { rows } = await deps.authDb.query<{ r: string }>(
    "select app.confirmation_decide($1, 'accepted', $2, $3, $4, $5, $6, $7, $8) as r",
    [confirmationId, identity.provider, identity.name ?? null, normalizePhone(identity.phone) ?? null, ref, identity.acr ?? null, meta.ip ?? null, meta.userAgent ?? null],
  );
  const r = rows[0]?.r;
  // Only the buyer can accept: someone else's BankID or Vipps leaves the link open (0035).
  return r === "accepted" ? "godtatt" : r === "wrong_person" ? "feil_person" : r === "expired" ? "utlopt" : "avgjort";
}

export async function rejectConfirmation(authDb: pg.Pool, token: string, meta: RequestMeta) {
  const view = await viewConfirmation(authDb, token);
  if (!view) return "ukjent";
  const { rows } = await authDb.query<{ r: string }>(
    "select app.confirmation_decide($1, 'rejected', 'none', null, null, null, null, $2, $3) as r",
    [view.id, meta.ip ?? null, meta.userAgent ?? null],
  );
  return rows[0]?.r === "rejected" ? "avslatt" : rows[0]?.r === "expired" ? "utlopt" : view.status === "revoked" ? "trukket" : "avgjort";
}
