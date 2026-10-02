// API Lambda behind API Gateway (HTTP API).
//   GET  /health                      database reachable as veriqall_api, under RLS
//   GET  /auth/{vipps|bankid}/start   start a login (?invite=, ?next=, ?link=1)
//   GET  /auth/{vipps|bankid}/callback
//   POST /auth/logout
//   POST /auth/passkey/login/options|verify      passkey login (WebAuthn)
//   POST /auth/passkey/register/options|verify   add a passkey (BankID session)
//   GET  /me                          the signed-in user, call centres and permissions
//   GET  /me/passkeys, DELETE /me/passkeys/{id}
//   POST /me/organization             switch the session's call centre
//   /org/*                            the call centre's admin portal (src/org)
//   GET  /announcements               live announcements for the signed-in user
//   /admin/*                          superadmin portal (src/admin)
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type pg from "pg";
import { handleAdmin } from "./admin/index.ts";
import { canEnterOrganization, handleOrg } from "./org/index.ts";
import { BadRequest, isUuid, parseBody } from "./admin/validate.ts";
import { myAnnouncements } from "./admin/messages.ts";
import { sha256 } from "./auth/crypto.ts";
import { handleCallback, startLogin } from "./auth/flow.ts";
import {
  authenticationOptions,
  deleteMyPasskey,
  listMyPasskeys,
  loginWithPasskey,
  PasskeyError,
  registerPasskey,
  registrationOptions,
} from "./auth/passkey.ts";
import { resolveSession, revokeSession } from "./auth/session.ts";
import { isProvider, SESSION_COOKIE, type AuthDeps } from "./auth/types.ts";
import { loadAuthConfig } from "./config.ts";
import { loadCallServices } from "./calls/runtime.ts";
import { rejectConfirmation, resultPage, startConfirmation, TOKEN, viewConfirmation } from "./confirm/index.ts";
import { isBlocked } from "./blocklist.ts";
import { iamPool } from "./db.ts";
import { clearCookie, corsHeaders, json, readCookie, redirect, requestMeta, sessionCookie, type Result } from "./http.ts";
import { loadMe } from "./me.ts";
import { SESSION_MAX_HOURS } from "@veriqall/shared";

// True when the database answers as a member of app_user (the role under RLS).
export type DatabaseCheck = () => Promise<boolean>;

export function poolCheck(pool: () => pg.Pool): DatabaseCheck {
  return async () => {
    const { rows } = await pool().query<{ ok: boolean }>(
      "select pg_has_role(current_user, 'app_user', 'member') as ok",
    );
    return rows[0]?.ok === true;
  };
}

export interface HandlerDeps {
  checkDatabase: DatabaseCheck;
  // Created on first use: configuration, secrets and the two database pools.
  auth?: () => Promise<AuthDeps>;
}

const AUTH_ROUTE = /^\/auth\/([a-z]+)\/(start|callback)$/;
const CONFIRM_ROUTE = /^\/confirm\/([^/]+)(?:\/(reject|bankid\/start|vipps\/start))?$/;

// Deleting expired calls and finishing abandoned recordings needs a regular run of the worker.
// Without a scheduler in the stack, the API starts one at most every 15 minutes per container,
// whenever someone uses the app.
const HOUSEKEEPING_MS = 15 * 60_000;
let lastHousekeeping = 0;
function tidyUp(auth: AuthDeps) {
  const now = Date.now();
  if (!auth.calls || now - lastHousekeeping < HOUSEKEEPING_MS) return;
  lastHousekeeping = now;
  auth.calls.startWorker().catch((error) => console.error("housekeeping: could not start the worker", error));
}

async function health(check: DatabaseCheck): Promise<Result> {
  try {
    if (await check()) return json(200, { status: "ok" });
    console.error("health: database login is not a member of app_user");
  } catch (error) {
    // Details go to the log only, never to the caller.
    console.error("health: database check failed", error);
  }
  return json(503, { status: "unavailable" });
}

export function createHandler(deps: HandlerDeps) {
  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === "GET" && path === "/health") return health(deps.checkDatabase);
    if (!deps.auth) return json(404, { error: "Fant ikke ressursen" });

    const auth = await deps.auth();
    tidyUp(auth);
    const cors = corsHeaders(event, auth.config.appOrigin);
    if (method === "OPTIONS") return { statusCode: 204, headers: cors };
    if (await isBlocked(auth.authDb, event.requestContext.http.sourceIp)) {
      return json(403, { error: "Tilgangen er sperret." }, cors);
    }

    const route = AUTH_ROUTE.exec(path);
    if (method === "GET" && route && isProvider(route[1]!)) {
      const provider = route[1];
      const query = event.queryStringParameters ?? {};
      if (route[2] === "start") {
        let linkUserId: string | undefined;
        if (query.link === "1") {
          const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
          if (!session) return redirect(new URL("/logg-inn?feil=utlopt", auth.config.appOrigin).toString());
          linkUserId = session.userId;
        }
        return redirect(await startLogin(auth, provider, { invite: query.invite, next: query.next, linkUserId }));
      }
      const result = await handleCallback(auth, provider, query, requestMeta(event));
      const cookies = result.sessionToken
        ? [sessionCookie(SESSION_COOKIE, result.sessionToken, SESSION_MAX_HOURS * 3600)]
        : [];
      return redirect(result.location, cookies);
    }

    // The customer's confirmation page (no session): view, decline, or accept with BankID/Vipps.
    const confirm = CONFIRM_ROUTE.exec(path);
    if (confirm && TOKEN.test(confirm[1]!)) {
      const token = confirm[1]!;
      const action = confirm[2];
      if (method === "GET" && !action) {
        const view = await viewConfirmation(auth.authDb, token);
        return view ? json(200, view, cors) : json(404, { error: "Lenken er ugyldig." }, cors);
      }
      if (method === "POST" && action === "reject") {
        if (event.headers?.origin !== auth.config.appOrigin) return json(403, { error: "Ikke tillatt." }, cors);
        return json(200, { result: await rejectConfirmation(auth.authDb, token, requestMeta(event)) }, cors);
      }
      if (method === "GET" && (action === "bankid/start" || action === "vipps/start")) {
        try {
          return redirect(await startConfirmation(auth, token, action === "bankid/start" ? "bankid" : "vipps"));
        } catch (error) {
          console.error("confirmation start failed", error);
          return redirect(resultPage(auth, "feil"));
        }
      }
      return json(404, { error: "Fant ikke ressursen" }, cors);
    }

    if (path.startsWith("/auth/passkey/") || path.startsWith("/me/passkeys")) {
      return passkeyRoutes(auth, event, cors);
    }

    if (method === "POST" && path === "/auth/logout") {
      // A state-changing call: only from the app itself (SameSite=Lax does not cover everything).
      if (event.headers?.origin !== auth.config.appOrigin) return json(403, { error: "Ikke tillatt" });
      await revokeSession(auth, readCookie(event, SESSION_COOKIE));
      return { statusCode: 204, headers: cors, cookies: [clearCookie(SESSION_COOKIE)] };
    }

    if (method === "GET" && path === "/me") {
      const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
      if (!session) return json(401, { error: "Ikke innlogget" }, cors);
      return json(200, await loadMe(auth.appDb, session), cors);
    }

    if (method === "GET" && path === "/announcements") {
      const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
      if (!session) return json(401, { error: "Ikke innlogget" }, cors);
      return json(200, await myAnnouncements(auth.appDb, session), cors);
    }

    if (method === "POST" && path === "/me/organization") {
      const token = readCookie(event, SESSION_COOKIE);
      const session = await resolveSession(auth, token);
      if (!session || !token) return json(401, { error: "Ikke innlogget" }, cors);
      if (event.headers?.origin !== auth.config.appOrigin) return json(403, { error: "Ikke tillatt." }, cors);
      let orgId: unknown;
      try {
        orgId = parseBody(event.body, event.isBase64Encoded).organizationId;
      } catch {
        return json(400, { error: "Ugyldig forespørsel." }, cors);
      }
      if (typeof orgId !== "string" || !isUuid(orgId)) return json(400, { error: "Ukjent callsenter." }, cors);
      if (!(await canEnterOrganization(auth.appDb, session, orgId))) {
        return json(403, { error: "Du har ikke tilgang til dette callsenteret." }, cors);
      }
      await auth.authDb.query("update sessions set active_organization_id = $2 where id_hash = $1", [sha256(token), orgId]);
      return json(200, { activeOrganizationId: orgId }, cors);
    }

    if (path.startsWith("/org/")) {
      const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
      if (!session) return json(401, { error: "Ikke innlogget" }, cors);
      return handleOrg(auth, event, session, cors);
    }

    if (path.startsWith("/admin/")) {
      const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
      if (!session) return json(401, { error: "Ikke innlogget" }, cors);
      return handleAdmin(auth, event, session, cors);
    }

    return json(404, { error: "Fant ikke ressursen" }, cors);
  };
}

const PASSKEY_ID = /^\/me\/passkeys\/([^/]+)$/;

async function passkeyRoutes(auth: AuthDeps, event: APIGatewayProxyEventV2, cors: Record<string, string>): Promise<Result> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method !== "GET" && event.headers?.origin !== auth.config.appOrigin) return json(403, { error: "Ikke tillatt." }, cors);
  try {
    const body = () => parseBody(event.body, event.isBase64Encoded);
    if (method === "POST" && path === "/auth/passkey/login/options") return json(200, await authenticationOptions(auth), cors);
    if (method === "POST" && path === "/auth/passkey/login/verify") {
      const result = await loginWithPasskey(auth, body(), requestMeta(event));
      return {
        ...json(200, { location: result.location }, cors),
        cookies: [sessionCookie(SESSION_COOKIE, result.sessionToken, SESSION_MAX_HOURS * 3600)],
      };
    }
    const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
    if (!session) return json(401, { error: "Ikke innlogget." }, cors);
    if (method === "POST" && path === "/auth/passkey/register/options") return json(200, await registrationOptions(auth, session), cors);
    if (method === "POST" && path === "/auth/passkey/register/verify") return json(201, await registerPasskey(auth, session, body()), cors);
    if (method === "GET" && path === "/me/passkeys") return json(200, await listMyPasskeys(auth, session), cors);
    const match = PASSKEY_ID.exec(path);
    if (method === "DELETE" && match && isUuid(match[1])) return json(200, await deleteMyPasskey(auth, session, match[1]), cors);
    return json(404, { error: "Fant ikke ressursen" }, cors);
  } catch (error) {
    if (error instanceof PasskeyError) return json(error.status, { error: error.message }, cors);
    if (error instanceof BadRequest) return json(400, { error: error.message }, cors);
    throw error;
  }
}

let apiPool: pg.Pool | undefined;
let authDeps: Promise<AuthDeps> | undefined;

export const handler = createHandler({
  checkDatabase: poolCheck(() => (apiPool ??= iamPool("veriqall_api"))),
  auth: () => {
    authDeps ??= Promise.all([loadAuthConfig(), loadCallServices()]).then(([config, calls]) => ({
      config,
      authDb: iamPool("veriqall_auth"),
      appDb: (apiPool ??= iamPool("veriqall_api")),
      fetch,
      now: () => new Date(),
      calls,
    }));
    // Try again on the next request if loading the secret failed.
    authDeps.catch(() => (authDeps = undefined));
    return authDeps;
  },
});
