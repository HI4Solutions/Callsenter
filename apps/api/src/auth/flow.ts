// The login flow from docs/auth.md: start -> provider -> callback -> session.
import { timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { acceptConfirmation, resultPage } from "../confirm/index.ts";
import { safeAppPath, SESSION_MAX_HOURS } from "@veriqall/shared";
import { pkceChallenge, randomToken, sha256 } from "./crypto.ts";
import { authorizationUrl, completeLogin } from "./oidc.ts";
import { normalizePhone } from "./phone.ts";
import { AuthFailure, type AuthDeps, type Identity, type LoginError, type LoginMethod, type Provider } from "./types.ts";

const STATE_LIFETIME_MINUTES = 10;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  // The cookie set when accepting a sale started (confirm/index.ts).
  confirmBinding?: string;
}

export interface LoginRedirect {
  location: string;
  // Raw session id for the cookie; only its hash is stored.
  sessionToken?: string;
}

export function callbackUri(deps: AuthDeps, provider: Provider): string {
  return `${deps.config.callbackBase}/auth/${provider}/callback`;
}

// Only paths inside the app; anything else becomes "/". The rule is shared with the web app
// (safeAppPath in packages/shared) and backed by the check constraint on auth_states.return_to.
export function safeReturnPath(next: string | undefined): string {
  return safeAppPath(next) ?? "/";
}

export function loginPage(deps: AuthDeps, error: LoginError, extra: Record<string, string> = {}): string {
  const url = new URL("/logg-inn", deps.config.appOrigin);
  url.searchParams.set("feil", error);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

export async function withTransaction<T>(db: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function logEvent(
  deps: AuthDeps,
  provider: LoginMethod,
  result: "success" | "cancelled" | "unknown_identity" | "invalid" | "error",
  meta: RequestMeta,
  userId?: string,
  reason?: string,
) {
  try {
    await deps.authDb.query(
      "insert into login_events (provider, result, reason, user_id, ip, user_agent) values ($1, $2, $3, $4, $5, $6)",
      [provider, result, reason?.slice(0, 500) ?? null, userId ?? null, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
    );
  } catch (error) {
    console.error("login_events insert failed", error);
  }
}

// Step 1: remember state, nonce and PKCE verifier, and send the browser to the provider.
export async function startLogin(
  deps: AuthDeps,
  provider: Provider,
  options: { invite?: string; next?: string; linkUserId?: string },
): Promise<string> {
  const settings = deps.config.providers[provider];
  if (!settings) return loginPage(deps, "ikke_satt_opp");

  let invitationId: string | null = null;
  if (options.invite) {
    const { rows } = await deps.authDb.query<{ id: string }>(
      `select id from invitations
       where token_hash = $1 and used_at is null and revoked_at is null and expires_at > $2`,
      [sha256(options.invite), deps.now()],
    );
    if (!rows[0]) return loginPage(deps, "invitasjon");
    invitationId = rows[0].id;
  }

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  await deps.authDb.query(
    `insert into auth_states (state_hash, provider, nonce, code_verifier, return_to, invitation_id, link_user_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [sha256(state), provider, nonce, verifier, safeReturnPath(options.next), invitationId, options.linkUserId ?? null, deps.now()],
  );
  return authorizationUrl(deps.fetch, settings, {
    redirectUri: callbackUri(deps, provider),
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });
}

interface StoredState {
  nonce: string;
  code_verifier: string;
  return_to: string | null;
  invitation_id: string | null;
  link_user_id: string | null;
  confirmation_id: string | null;
  browser_hash: Buffer | null;
}

// Finds or links the user for an identity, inside the login transaction.
async function linkUser(db: pg.PoolClient, deps: AuthDeps, identity: Identity, state: StoredState): Promise<string> {
  const now = deps.now();
  const existing = await db.query<{ user_id: string }>(
    "select user_id from identities where provider = $1 and subject = $2",
    [identity.provider, identity.subject],
  );
  const known = existing.rows[0]?.user_id;

  // Adding a second login method from the profile.
  if (state.link_user_id) {
    if (known && known !== state.link_user_id) {
      throw new AuthFailure("allerede_koblet", "invalid", "identity belongs to another user");
    }
    if (!known) await insertIdentity(db, state.link_user_id, identity, now);
    return state.link_user_id;
  }
  if (known) return known;

  // First login with an invitation link.
  if (state.invitation_id) {
    const { rows } = await db.query<{ user_id: string }>(
      `update invitations set used_at = $2
       where id = $1 and used_at is null and revoked_at is null and expires_at > $2
       returning user_id`,
      [state.invitation_id, now],
    );
    if (!rows[0]) throw new AuthFailure("invitasjon", "invalid", "invitation no longer valid");
    await insertIdentity(db, rows[0].user_id, identity, now);
    return rows[0].user_id;
  }

  // First Vipps login of an invited user: the verified phone number matches, the user has no
  // Vipps login yet, and holds a valid invitation (a number can change owner).
  const phone = identity.provider === "vipps" ? normalizePhone(identity.phone) : undefined;
  if (phone) {
    const { rows } = await db.query<{ invitation_id: string; user_id: string }>(
      `select i.id as invitation_id, u.id as user_id
       from users u
       join invitations i on i.user_id = u.id
       where u.phone = $1 and u.status = 'invited'
         and i.used_at is null and i.revoked_at is null and i.expires_at > $2
         and not exists (select 1 from identities x where x.user_id = u.id and x.provider = 'vipps')
       order by i.created_at
       limit 1`,
      [phone, now],
    );
    if (rows[0]) {
      await db.query("update invitations set used_at = $2 where id = $1", [rows[0].invitation_id, now]);
      await insertIdentity(db, rows[0].user_id, identity, now);
      return rows[0].user_id;
    }
  }
  throw new AuthFailure("ukjent", "unknown_identity", "unknown identity without invitation");
}

// A new session in the user's default call centre. Only the hash of the token is stored.
export async function insertSession(
  db: pg.PoolClient,
  sessionToken: string,
  userId: string,
  method: LoginMethod,
  acr: string | null,
  now: Date,
  meta: RequestMeta,
) {
  await db.query(
    `insert into sessions (id_hash, user_id, provider, acr, active_organization_id, created_at, last_seen_at, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, app.default_organization_for($2), $5, $5, $6, $7, $8)`,
    [
      sha256(sessionToken),
      userId,
      method,
      acr,
      now,
      new Date(now.getTime() + SESSION_MAX_HOURS * 3_600_000),
      meta.ip ?? null,
      meta.userAgent?.slice(0, 500) ?? null,
    ],
  );
}

async function insertIdentity(db: pg.PoolClient, userId: string, identity: Identity, now: Date) {
  try {
    await db.query(
      "insert into identities (user_id, provider, subject, created_at) values ($1, $2, $3, $4)",
      [userId, identity.provider, identity.subject, now],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AuthFailure("allerede_koblet", "invalid", "user already has this login method");
    }
    throw error;
  }
}

// Step 2: the provider sends the browser back here.
export async function handleCallback(
  deps: AuthDeps,
  provider: Provider,
  query: Record<string, string | undefined>,
  meta: RequestMeta,
): Promise<LoginRedirect> {
  const settings = deps.config.providers[provider];
  if (!settings) return { location: loginPage(deps, "ikke_satt_opp") };

  if (query.error) {
    // Cancelled while accepting a sale: back to the customer's page, not the login page.
    if (query.state) {
      const pending = await deps.authDb.query<{ confirmation_id: string | null }>(
        "update auth_states set used_at = $2 where state_hash = $1 and used_at is null returning confirmation_id",
        [sha256(query.state), deps.now()],
      );
      if (pending.rows[0]?.confirmation_id) return { location: resultPage(deps, "avbrutt") };
    }
    await logEvent(deps, provider, "cancelled", meta, undefined, query.error);
    return { location: loginPage(deps, "avbrutt") };
  }
  if (!query.state || !query.code) {
    await logEvent(deps, provider, "invalid", meta, undefined, "missing state or code");
    return { location: loginPage(deps, "utlopt") };
  }

  // Marked as used before the code is exchanged, so a state works only once.
  const now = deps.now();
  const { rows } = await deps.authDb.query<StoredState>(
    `update auth_states set used_at = $3
     where state_hash = $1 and provider = $2 and used_at is null
       and created_at > $3::timestamptz - make_interval(mins => $4)
     returning nonce, code_verifier, return_to, invitation_id, link_user_id, confirmation_id, browser_hash`,
    [sha256(query.state), provider, now, STATE_LIFETIME_MINUTES],
  );
  const state = rows[0];
  if (!state) {
    await logEvent(deps, provider, "invalid", meta, undefined, "unknown, used or expired state");
    return { location: loginPage(deps, "utlopt") };
  }

  if (state.confirmation_id) {
    // A customer accepting a sale: identify, record the acceptance, no session. Only in the
    // browser that opened the offer and started the identification.
    if (!state.browser_hash || !meta.confirmBinding || !timingSafeEqual(sha256(meta.confirmBinding), state.browser_hash)) {
      return { location: resultPage(deps, "annen_nettleser") };
    }
    try {
      const identity = await completeLogin(deps.fetch, provider, settings, {
        code: query.code,
        redirectUri: callbackUri(deps, provider),
        codeVerifier: state.code_verifier,
        nonce: state.nonce,
      });
      return { location: resultPage(deps, await acceptConfirmation(deps, state.confirmation_id, identity, meta)) };
    } catch (error) {
      console.error(`[${provider}] confirmation failed`, error instanceof AuthFailure ? error.message : error);
      return { location: resultPage(deps, "feil") };
    }
  }

  let userId: string | undefined;
  try {
    const identity = await completeLogin(deps.fetch, provider, settings, {
      code: query.code,
      redirectUri: callbackUri(deps, provider),
      codeVerifier: state.code_verifier,
      nonce: state.nonce,
    });

    const sessionToken = randomToken();
    userId = await withTransaction(deps.authDb, async (db) => {
      const id = await linkUser(db, deps, identity, state);
      const user = await db.query<{ status: string }>("select status from users where id = $1", [id]);
      if (user.rows[0]?.status === "disabled") {
        throw new AuthFailure("deaktivert", "invalid", "user is disabled");
      }
      await db.query("update users set status = 'active', last_login_at = $2 where id = $1", [id, now]);
      await db.query("update identities set last_used_at = $3 where provider = $1 and subject = $2", [
        provider,
        identity.subject,
        now,
      ]);
      await insertSession(db, sessionToken, id, provider, identity.acr ?? null, now, meta);
      return id;
    });
    await logEvent(deps, provider, "success", meta, userId);
    return {
      location: new URL(state.return_to ?? "/", deps.config.appOrigin).toString(),
      sessionToken,
    };
  } catch (error) {
    if (error instanceof AuthFailure) {
      console.warn(`[${provider}] login failed: ${error.message}`);
      await logEvent(deps, provider, error.result, meta, userId, error.message);
      return { location: loginPage(deps, error.code) };
    }
    console.error(`[${provider}] login error`, error);
    await logEvent(deps, provider, "error", meta, userId, (error as Error).message);
    return { location: loginPage(deps, "feil") };
  }
}

