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
import {
  addGrowthEvent,
  createAnnouncement,
  deleteAnnouncement,
  deleteGrowthEvent,
  growth,
  listAnnouncements,
  updateAnnouncement,
} from "./messages.ts";
import { getThread, listThreads, reply as replyThread, setThreadStatus, startThread } from "../org/threads.ts";
import { accessLog, auditLog, blockIp, listBlockedIps, securityOverview, unblockIp } from "./security.ts";
import {
  catalog,
  getUser,
  listUsers,
  removeIdentity,
  removePasskey,
  setPlatformAdmin,
  signOutEverywhere,
  updateUser,
} from "./users.ts";
import {
  addPayment,
  addUsageLines,
  billingOverview,
  createInvoice,
  createRecurring,
  creditInvoice,
  deleteInvoice,
  deleteRecurring,
  generateRecurring,
  getBillingSettings,
  getInvoice,
  listInvoices,
  listRecurring,
  sendInvoice,
  updateBillingSettings,
  updateInvoice,
  updateRecurring,
} from "./billing.ts";
import { getSystem, updateSystem, usage } from "./system.ts";
import { BadRequest, isUuid, parseBody } from "./validate.ts";

const ORGANIZATION = /^\/admin\/organizations\/([^/]+)$/;
const INVITATIONS = /^\/admin\/organizations\/([^/]+)\/invitations$/;
const INVITATION = /^\/admin\/organizations\/([^/]+)\/invitations\/([^/]+)$/;
const USER = /^\/admin\/users\/([^/]+)$/;
const USER_ACTION = /^\/admin\/users\/([^/]+)\/(logout|superadmin)$/;
const BLOCKED_IP = /^\/admin\/security\/blocked-ips\/([^/]+)$/;
const THREAD = /^\/admin\/threads\/([^/]+)$/;
const THREAD_MESSAGES = /^\/admin\/threads\/([^/]+)\/messages$/;
const ANNOUNCEMENT = /^\/admin\/announcements\/([^/]+)$/;
const GROWTH_EVENT = /^\/admin\/growth\/events\/([^/]+)$/;
const USER_PASSKEY = /^\/admin\/users\/([^/]+)\/passkeys\/([^/]+)$/;
const INVOICE = /^\/admin\/invoices\/([^/]+)$/;
const INVOICE_ACTION = /^\/admin\/invoices\/([^/]+)\/(send|payments|credit|usage)$/;
const RECURRING = /^\/admin\/recurring-invoices\/([^/]+)$/;
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
    match = USER_PASSKEY.exec(path);
    if (match && isUuid(match[1]) && isUuid(match[2]) && method === "DELETE") {
      return reply(200, await removePasskey(deps.appDb, session, match[1], match[2]));
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
    if (path === "/admin/threads") {
      if (method === "GET") return reply(200, await listThreads(deps.appDb, session, "platform"));
      if (method === "POST") return reply(201, await startThread(deps.appDb, session, "platform", body()));
    }
    match = THREAD.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "GET") return reply(200, await getThread(deps.appDb, session, "platform", match[1]));
      if (method === "PATCH") return reply(200, await setThreadStatus(deps.appDb, session, "platform", match[1], body()));
    }
    match = THREAD_MESSAGES.exec(path);
    if (match && isUuid(match[1]) && method === "POST") {
      return reply(201, await replyThread(deps.appDb, session, "platform", match[1], body()));
    }
    if (path === "/admin/announcements") {
      if (method === "GET") return reply(200, await listAnnouncements(deps.appDb, session));
      if (method === "POST") return reply(201, await createAnnouncement(deps.appDb, session, body()));
    }
    match = ANNOUNCEMENT.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "PATCH") return reply(200, await updateAnnouncement(deps.appDb, session, match[1], body()));
      if (method === "DELETE") return reply(200, await deleteAnnouncement(deps.appDb, session, match[1]));
    }
    if (path === "/admin/system") {
      if (method === "GET") return reply(200, await getSystem(deps.appDb, session));
      if (method === "PATCH") return reply(200, await updateSystem(deps.appDb, session, body()));
    }
    if (method === "GET" && path === "/admin/usage") return reply(200, await usage(deps.appDb, session, query.months));
    if (method === "GET" && path === "/admin/billing/overview") return reply(200, await billingOverview(deps.appDb, session));
    if (path === "/admin/billing/settings") {
      if (method === "GET") return reply(200, await getBillingSettings(deps.appDb, session));
      if (method === "PATCH") return reply(200, await updateBillingSettings(deps.appDb, session, body()));
    }
    if (path === "/admin/invoices") {
      if (method === "GET") return reply(200, await listInvoices(deps.appDb, session, query));
      if (method === "POST") return reply(201, await createInvoice(deps.appDb, session, body()));
    }
    match = INVOICE.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "GET") return reply(200, await getInvoice(deps.appDb, session, match[1]));
      if (method === "PATCH") return reply(200, await updateInvoice(deps.appDb, session, match[1], body()));
      if (method === "DELETE") return reply(200, await deleteInvoice(deps.appDb, session, match[1]));
    }
    match = INVOICE_ACTION.exec(path);
    if (match && isUuid(match[1]) && method === "POST") {
      if (match[2] === "send") return reply(200, await sendInvoice(deps.appDb, session, match[1]));
      if (match[2] === "payments") return reply(201, await addPayment(deps.appDb, session, match[1], body()));
      if (match[2] === "credit") return reply(201, await creditInvoice(deps.appDb, session, match[1], body()));
      if (match[2] === "usage") return reply(200, await addUsageLines(deps.appDb, session, match[1], body()));
    }
    if (path === "/admin/recurring-invoices") {
      if (method === "GET") return reply(200, await listRecurring(deps.appDb, session));
      if (method === "POST") return reply(201, await createRecurring(deps.appDb, session, body()));
    }
    if (method === "POST" && path === "/admin/recurring-invoices/generate") return reply(200, await generateRecurring(deps.appDb, session));
    match = RECURRING.exec(path);
    if (match && isUuid(match[1])) {
      if (method === "PATCH") return reply(200, await updateRecurring(deps.appDb, session, match[1], body()));
      if (method === "DELETE") return reply(200, await deleteRecurring(deps.appDb, session, match[1]));
    }
    if (method === "GET" && path === "/admin/growth") return reply(200, await growth(deps.appDb, session, query.months));
    if (method === "POST" && path === "/admin/growth/events") return reply(201, await addGrowthEvent(deps.appDb, session, body()));
    match = GROWTH_EVENT.exec(path);
    if (match && isUuid(match[1]) && method === "DELETE") return reply(200, await deleteGrowthEvent(deps.appDb, session, match[1]));
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
