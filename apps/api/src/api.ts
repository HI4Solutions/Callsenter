// API Lambda behind API Gateway (HTTP API).
//   GET  /health                      database reachable as veriqall_api, under RLS
//   GET  /auth/{vipps|bankid}/start   start a login (?invite=, ?next=, ?link=1)
//   GET  /auth/{vipps|bankid}/callback
//   POST /auth/logout
//   GET  /me                          the signed-in user, call centres and permissions
//   GET  /announcements               live announcements for the signed-in user
//   /admin/*                          superadmin portal (src/admin)
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type pg from "pg";
import { handleAdmin } from "./admin/index.ts";
import { myAnnouncements } from "./admin/messages.ts";
import { handleCallback, startLogin } from "./auth/flow.ts";
import { resolveSession, revokeSession } from "./auth/session.ts";
import { isProvider, SESSION_COOKIE, type AuthDeps } from "./auth/types.ts";
import { loadAuthConfig } from "./config.ts";
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

    if (path.startsWith("/admin/")) {
      const session = await resolveSession(auth, readCookie(event, SESSION_COOKIE));
      if (!session) return json(401, { error: "Ikke innlogget" }, cors);
      return handleAdmin(auth, event, session, cors);
    }

    return json(404, { error: "Fant ikke ressursen" }, cors);
  };
}

let apiPool: pg.Pool | undefined;
let authDeps: Promise<AuthDeps> | undefined;

export const handler = createHandler({
  checkDatabase: poolCheck(() => (apiPool ??= iamPool("veriqall_api"))),
  auth: () => {
    authDeps ??= loadAuthConfig().then((config) => ({
      config,
      authDb: iamPool("veriqall_auth"),
      appDb: (apiPool ??= iamPool("veriqall_api")),
      fetch,
      now: () => new Date(),
    }));
    // Try again on the next request if loading the secret failed.
    authDeps.catch(() => (authDeps = undefined));
    return authDeps;
  },
});
