// /admin/*: the superadmin portal's API. Only superadmins in a BankID session get in
// (app.is_platform_admin() requires both). State-changing calls must come from the app itself.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Session } from "../auth/session.ts";
import type { AuthDeps } from "../auth/types.ts";
import { json, type Result } from "../http.ts";
import { withSession } from "../me.ts";
import {
  createOrganization,
  getOrganization,
  inviteMember,
  listOrganizations,
  NotFound,
  revokeInvitation,
  updateOrganization,
} from "./organizations.ts";
import { accessLog, auditLog, blockIp, listBlockedIps, securityOverview, unblockIp } from "./security.ts";
import { catalog, getUser, listUsers, removeIdentity, setPlatformAdmin, signOutEverywhere, updateUser } from "./users.ts";
import { BadRequest, isUuid, parseBody } from "./validate.ts";

const ORGANIZATION = /^\/admin\/organizations\/([^/]+)$/;
const INVITATIONS = /^\/admin\/organizations\/([^/]+)\/invitations$/;
const INVITATION = /^\/admin\/organizations\/([^/]+)\/invitations\/([^/]+)$/;
const USER = /^\/admin\/users\/([^/]+)$/;
const USER_ACTION = /^\/admin\/users\/([^/]+)\/(logout|superadmin)$/;
const BLOCKED_IP = /^\/admin\/security\/blocked-ips\/([^/]+)$/;
const USER_IDENTITY = /^\/admin\/users\/([^/]+)\/identities\/([a-z]+)$/;

export async function handleAdmin(
  deps: AuthDeps,
  event: APIGatewayProxyEventV2,
  session: Session,
  cors: Record<string, string>,
): Promise<Result> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const reply = (status: number, body: unknown) => json(status, body, cors);

  if (method !== "GET" && event.headers?.origin !== deps.config.appOrigin) return reply(403, { error: "Ikke tillatt." });

  const isAdmin = await withSession(deps.appDb, session, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>("select app.is_platform_admin() as ok");
    return rows[0]?.ok === true;
  });
  if (!isAdmin) {
    return reply(403, {
      error: session.strong ? "Du er ikke superadmin." : "Superadmin krever innlogging med BankID.",
      code: session.strong ? "ikke_superadmin" : "krever_bankid",
    });
  }

  try {
    const body = () => parseBody(event.body, event.isBase64Encoded);
    if (path === "/admin/organizations") {
      if (method === "GET") return reply(200, await listOrganizations(deps.appDb, session));
      if (method === "POST") return reply(201, await createOrganization(deps.appDb, session, body()));
    }
    let match = ORGANIZATION.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "GET") return reply(200, await getOrganization(deps.appDb, session, match[1]));
      if (method === "PATCH") return reply(200, await updateOrganization(deps.appDb, session, match[1], body()));
    }
    match = INVITATIONS.exec(path);
    if (match && isUuid(match[1]) && method === "POST") {
      return reply(201, await inviteMember(deps.appDb, session, match[1], deps.config.appOrigin, body()));
    }
    match = INVITATION.exec(path);
    if (match && isUuid(match[1]) && isUuid(match[2]) && method === "DELETE") {
      return reply(200, await revokeInvitation(deps.appDb, session, match[1], match[2]));
    }
    if (path === "/admin/users" && method === "GET") {
      return reply(200, await listUsers(deps.appDb, session, event.queryStringParameters?.q ?? ""));
    }
    match = USER.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "GET") return reply(200, await getUser(deps.appDb, session, match[1]));
      if (method === "PATCH") return reply(200, await updateUser(deps.appDb, session, match[1], body()));
    }
    match = USER_ACTION.exec(path);
    if (match && isUuid(match[1])) {
      if (match[2] === "logout" && method === "POST") return reply(200, await signOutEverywhere(deps.appDb, session, match[1]));
      if (match[2] === "superadmin" && method === "PUT") {
        return reply(200, await setPlatformAdmin(deps.appDb, session, match[1], body()));
      }
    }
    match = USER_IDENTITY.exec(path);
    if (match && isUuid(match[1]) && method === "DELETE") {
      return reply(200, await removeIdentity(deps.appDb, session, match[1], match[2]!));
    }
    if (path === "/admin/catalog" && method === "GET") return reply(200, await catalog(deps.appDb, session));
    const query = event.queryStringParameters ?? {};
    if (method === "GET" && path === "/admin/security/overview") return reply(200, await securityOverview(deps.appDb, session, query));
    if (method === "GET" && path === "/admin/security/audit") return reply(200, await auditLog(deps.appDb, session, query));
    if (method === "GET" && path === "/admin/security/access") return reply(200, await accessLog(deps.appDb, session, query));
    if (path === "/admin/security/blocked-ips") {
      if (method === "GET") return reply(200, await listBlockedIps(deps.appDb, session));
      if (method === "POST") {
        return reply(201, await blockIp(deps.appDb, session, event.requestContext.http.sourceIp, body()));
      }
    }
    match = BLOCKED_IP.exec(path);
    if (match && isUuid(match[1]) && method === "DELETE") return reply(200, await unblockIp(deps.appDb, session, match[1]));
    return reply(404, { error: "Fant ikke ressursen." });
  } catch (error) {
    if (error instanceof BadRequest) return reply(400, { error: error.message });
    if (error instanceof NotFound) return reply(404, { error: "Fant ikke ressursen." });
    const code = (error as { code?: string }).code;
    const constraint = (error as { constraint?: string }).constraint;
    if (code === "23505" && constraint?.includes("org_number")) {
      return reply(409, { error: "Organisasjonsnummeret er allerede registrert." });
    }
    if (code === "23505" && constraint?.includes("phone")) {
      return reply(409, { error: "Mobilnummeret er allerede i bruk av en annen bruker." });
    }
    if (code === "23505" && constraint?.includes("blocked_ips")) {
      return reply(409, { error: "Denne adressen er allerede sperret." });
    }
    if (code === "23505" && constraint?.includes("email")) {
      return reply(409, { error: "E-postadressen er allerede i bruk av en annen bruker." });
    }
    if (code === "23505") return reply(409, { error: "Finnes allerede." });
    const message = (error as { message?: string }).message ?? "";
    if (message.includes("your own superadmin")) return reply(400, { error: "Du kan ikke fjerne din egen superadmin-tilgang." });
    if (message.includes("at least one superadmin")) return reply(400, { error: "Det må finnes minst én superadmin." });
    if (code === "23514") return reply(400, { error: "Ugyldig verdi." });
    throw error;
  }
}
