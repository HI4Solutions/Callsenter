// /org/*: the call centre's own admin portal (docs/plan.md, section 11), for the call centre the
// session is in. Everything runs as app_user under RLS with the session's user and call centre,
// so the database decides what is visible and refuses grants of permissions the caller lacks.
// The checks here only give clearer answers.
import { type ModuleKey, MODULES, type Permission, STRONG_AUTH_PERMISSIONS } from "@veriqall/shared";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type pg from "pg";
import { invoiceDetail, invoicePdfFor } from "../admin/billing.ts";
import { inviteMember, NotFound, revokeInvitation } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, parseBody, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import type { AuthDeps } from "../auth/types.ts";
import { binary, json, type Result } from "../http.ts";
import { withSession } from "../me.ts";
import {
  audioUrl,
  callStatus,
  chunkUrl,
  completeCall,
  createCall,
  createReportTemplate,
  editNote,
  getStudio,
  listPieces,
  pieceUploaded,
  pieceUrl,
  noteHistory,
  requestNote,
  setStudio,
  getCall,
  listCalls,
  listReportTemplates,
  renewRealtimeKey,
  retryCall,
  reviewAnalysis,
  Unavailable,
  updateCall,
  updateReportTemplate,
} from "./calls.ts";
import { addComplaintNote, createComplaint, getComplaint, listComplaints, updateComplaint } from "./complaints.ts";
import { createConfirmation, revokeConfirmation } from "./confirmations.ts";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.ts";
import { createCoaching, getDashboard, listCoaching, readCoaching } from "./dashboard.ts";
import { getSaleDocumentation } from "./documentation.ts";
import { listOrgInvoices } from "./invoices.ts";
import {
  createDraft,
  createProduct,
  deleteDraft,
  getProduct,
  listProducts,
  publishDraft,
  updateDraft,
  updateProduct,
} from "./products.ts";
import { createRole, listRoles, updateRole } from "./roles.ts";
import { createSale, getSale, listSales, updateSale } from "./sales.ts";
import { getThread, listThreads, reply as replyThread, setThreadStatus, startThread } from "./threads.ts";

class Forbidden extends Error {
  // Only administrative permissions need BankID or a passkey; for the rest, signing in
  // differently would not help.
  needsStrongSession: boolean;
  constructor(permission: Permission, session: Session) {
    super(permission);
    this.needsStrongSession = !session.strong && STRONG_AUTH_PERMISSIONS.includes(permission);
  }
}

const MEMBER = /^\/org\/members\/([^/]+)$/;
const INVITATION = /^\/org\/invitations\/([^/]+)$/;
const TEAM = /^\/org\/teams\/([^/]+)$/;
const ROLE = /^\/org\/roles\/([^/]+)$/;
const THREAD = /^\/org\/threads\/([^/]+)$/;
const THREAD_MESSAGES = /^\/org\/threads\/([^/]+)\/messages$/;
const CUSTOMER = /^\/org\/customers\/([^/]+)$/;
const SALE = /^\/org\/sales\/([^/]+)$/;
const SALE_CONFIRMATIONS = /^\/org\/sales\/([^/]+)\/confirmations$/;
const SALE_DOCUMENTATION = /^\/org\/sales\/([^/]+)\/documentation$/;
const INVOICE = /^\/org\/invoices\/([^/]+)$/;
const INVOICE_PDF = /^\/org\/invoices\/([^/]+)\/pdf$/;
const COACHING_READ = /^\/org\/coaching\/([^/]+)\/read$/;
const COMPLAINT = /^\/org\/complaints\/([^/]+)$/;
const COMPLAINT_NOTES = /^\/org\/complaints\/([^/]+)\/notes$/;
const SALE_CONFIRMATION_REVOKE = /^\/org\/sales\/([^/]+)\/confirmations\/([^/]+)\/revoke$/;
const CALL = /^\/org\/calls\/([^/]+)$/;
const CALL_ACTION = /^\/org\/calls\/([^/]+)\/(chunks|complete|retry|realtime-key|audio)$/;
const CALL_ANALYSIS = /^\/org\/calls\/([^/]+)\/analyses\/([^/]+)$/;
const CALL_PIECES = /^\/org\/calls\/([^/]+)\/pieces$/;
const CALL_PIECE_DONE = /^\/org\/calls\/([^/]+)\/pieces\/(\d+)\/uploaded$/;
const CALL_NOTES = /^\/org\/calls\/([^/]+)\/notes$/;
const CALL_NOTE = /^\/org\/calls\/([^/]+)\/notes\/([^/]+)(\/history)?$/;
const REPORT_TEMPLATE = /^\/org\/report-templates\/([^/]+)$/;
const PRODUCT = /^\/org\/products\/([^/]+)$/;
const PRODUCT_DRAFT = /^\/org\/products\/([^/]+)\/draft$/;
const VERSION = /^\/org\/products\/([^/]+)\/versions\/([^/]+)$/;
const VERSION_PUBLISH = /^\/org\/products\/([^/]+)\/versions\/([^/]+)\/publish$/;

async function requirePermission(db: pg.Pool, session: Session, permission: Permission) {
  const ok = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>("select app.has_permission($1) as ok", [permission]);
    return rows[0]?.ok === true;
  });
  if (!ok) throw new Forbidden(permission, session);
}

class ModuleDisabled extends Error {}

// A module the superadmin has switched off for the call centre is closed in the API too.
async function requireModule(db: pg.Pool, session: Session, module: ModuleKey) {
  const on = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ enabled: boolean }>(
      "select enabled from organization_modules where organization_id = app.current_org_id() and module = $1",
      [module],
    );
    return rows[0]?.enabled === true;
  });
  if (!on) throw new ModuleDisabled(module);
}

export async function overview(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const members = await c.query(
      `select u.id as "userId", u.full_name as name, u.phone, u.email, u.status as "userStatus",
              u.last_login_at as "lastLoginAt", m.status, m.created_at as "createdAt",
              r.id as "roleId", r.name as "roleName", t.id as "teamId", t.name as "teamName"
       from memberships m
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id
       left join teams t on t.id = m.team_id
       where m.organization_id = app.current_org_id()
       order by lower(u.full_name)`,
    );
    const roles = await c.query(
      `select r.id, r.key, r.name,
              array(select permission from role_permissions rp where rp.role_id = r.id order by 1) as permissions,
              not exists (select 1 from role_permissions rp where rp.role_id = r.id
                          and not app.has_permission(rp.permission)) as assignable
       from roles r where r.organization_id = app.current_org_id() and r.archived_at is null
       order by r.name`,
    );
    const teams = await c.query(
      `select t.id, t.name, t.archived_at as "archivedAt",
              (select count(*) from memberships m where m.team_id = t.id and m.status = 'active')::int as members
       from teams t where t.organization_id = app.current_org_id()
       order by t.archived_at nulls first, lower(t.name)`,
    );
    const invitations = await c.query(
      `select i.id, u.full_name as name, i.created_at as "createdAt", i.expires_at as "expiresAt",
              i.used_at as "usedAt", i.revoked_at as "revokedAt"
       from invitations i join users u on u.id = i.user_id
       where i.organization_id = app.current_org_id()
       order by i.created_at desc limit 50`,
    );
    return { members: members.rows, roles: roles.rows, teams: teams.rows, invitations: invitations.rows };
  });
}

// Change a member's role, team or status in this call centre, or (while they are still invited)
// their name and contact details. Never your own membership: no locking yourself out.
export async function updateMember(db: pg.Pool, session: Session, userId: string, body: Body) {
  if (userId === session.userId) throw new BadRequest("Du kan ikke endre ditt eget medlemskap.");
  const roleId = optionalText(body, "roleId", "Rolle", 64);
  const teamId = body.teamId === null ? null : optionalText(body, "teamId", "Team", 64);
  const status = body.status;
  if (roleId !== undefined && (!roleId || !isUuid(roleId))) throw new BadRequest("Ukjent rolle.");
  if (teamId && !isUuid(teamId)) throw new BadRequest("Ukjent team.");
  if (status !== undefined && status !== "active" && status !== "disabled") throw new BadRequest("Ugyldig status.");
  const fullName = optionalText(body, "fullName", "Navn", 200);
  if (fullName === null) throw new BadRequest("Navn må fylles ut.");

  return withSession(db, session, async (c) => {
    const current = await c.query<{ user_status: string }>(
      `select u.status as user_status from memberships m join users u on u.id = m.user_id
       where m.organization_id = app.current_org_id() and m.user_id = $1`,
      [userId],
    );
    if (!current.rows[0]) throw new NotFound();
    const sets: string[] = [];
    const values: unknown[] = [userId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (roleId !== undefined) add("role_id", roleId);
    if (teamId !== undefined) add("team_id", teamId);
    if (status !== undefined) add("status", status);
    if (sets.length) {
      await c.query(
        `update memberships set ${sets.join(", ")} where organization_id = app.current_org_id() and user_id = $1`,
        values,
      );
    }
    if (fullName !== undefined) {
      // After the first login the name comes from BankID or Vipps.
      if (current.rows[0].user_status !== "invited") throw new BadRequest("Navnet kan bare endres før første innlogging.");
      await c.query("update users set full_name = $2 where id = $1", [userId, fullName]);
    }
    return { userId };
  });
}

export async function createTeam(db: pg.Pool, session: Session, body: Body) {
  const name = requiredText(body, "name", "Navn", 100);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "insert into teams (organization_id, name) values (app.current_org_id(), $1) returning id",
      [name],
    );
    return { id: rows[0]!.id };
  });
}

export async function updateTeam(db: pg.Pool, session: Session, teamId: string, body: Body) {
  const name = optionalText(body, "name", "Navn", 100);
  if (name === null) throw new BadRequest("Navn må fylles ut.");
  const archived = body.archived;
  if (archived !== undefined && typeof archived !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  return withSession(db, session, async (c) => {
    const exists = await c.query("select 1 from teams where id = $1 and organization_id = app.current_org_id()", [teamId]);
    if (!exists.rowCount) throw new NotFound();
    if (name) await c.query("update teams set name = $2 where id = $1", [teamId, name]);
    if (archived === true) {
      // Members keep working; they just no longer belong to a team.
      await c.query("update memberships set team_id = null where team_id = $1", [teamId]);
      await c.query("update teams set archived_at = now() where id = $1 and archived_at is null", [teamId]);
    }
    if (archived === false) await c.query("update teams set archived_at = null where id = $1", [teamId]);
    return { id: teamId };
  });
}

export async function handleOrg(
  deps: AuthDeps,
  event: APIGatewayProxyEventV2,
  session: Session,
  cors: Record<string, string>,
): Promise<Result> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const reply = (status: number, body: unknown) => json(status, body, cors);
  if (method !== "GET" && event.headers?.origin !== deps.config.appOrigin) return reply(403, { error: "Ikke tillatt." });
  const orgId = session.activeOrganizationId;
  if (!orgId) return reply(400, { error: "Velg et callsenter først." });

  try {
    const body = () => parseBody(event.body, event.isBase64Encoded);
    if (path === "/org/roles" || ROLE.test(path)) {
      await requirePermission(deps.appDb, session, "roles.manage");
      if (method === "GET" && path === "/org/roles") return reply(200, await listRoles(deps.appDb, session));
      if (method === "POST" && path === "/org/roles") return reply(201, await createRole(deps.appDb, session, body()));
      const role = ROLE.exec(path);
      if (role && isUuid(role[1]) && method === "PATCH") return reply(200, await updateRole(deps.appDb, session, role[1], body()));
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/customers" || CUSTOMER.test(path)) {
      // Changing customers means seeing them too: customers.manage is used together with customers.read.
      await requirePermission(deps.appDb, session, "customers.read");
      if (method !== "GET") await requirePermission(deps.appDb, session, "customers.manage");
      if (method === "GET" && path === "/org/customers") {
        return reply(200, await listCustomers(deps.appDb, session, event.queryStringParameters ?? {}));
      }
      if (method === "POST" && path === "/org/customers") return reply(201, await createCustomer(deps.appDb, session, body()));
      const customer = CUSTOMER.exec(path);
      if (customer && isUuid(customer[1])) {
        if (method === "GET") return reply(200, await getCustomer(deps.appDb, session, customer[1]));
        if (method === "PATCH") return reply(200, await updateCustomer(deps.appDb, session, customer[1], body()));
      }
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/studio") {
      if (method === "GET") return reply(200, await getStudio(deps.appDb, session));
      if (method === "PUT") return reply(200, await setStudio(deps.appDb, session, body()));
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/calls" || path.startsWith("/org/calls/")) {
      const services = deps.calls;
      if (!services) return reply(503, { error: "Opptak er ikke satt opp ennå." });
      const meta = { ip: event.requestContext.http.sourceIp, userAgent: event.requestContext.http.userAgent };
      if (method === "GET" && path === "/org/calls") {
        return reply(200, await listCalls(deps.appDb, session, event.queryStringParameters ?? {}, meta));
      }
      if (method === "POST" && path === "/org/calls") {
        await requirePermission(deps.appDb, session, "calls.upload");
        return reply(201, await createCall(deps.appDb, session, services, body()));
      }
      const action = CALL_ACTION.exec(path);
      if (action && isUuid(action[1])) {
        const [, id, name] = action;
        if (method === "GET" && name === "audio") {
          await requirePermission(deps.appDb, session, "calls.audio.play");
          return reply(200, await audioUrl(deps.appDb, session, services, id, meta));
        }
        if (method === "POST") {
          await requirePermission(deps.appDb, session, "calls.upload");
          if (name === "chunks") return reply(200, await chunkUrl(deps.appDb, session, services, id, body()));
          if (name === "complete") return reply(200, await completeCall(deps.appDb, session, services, id, body()));
          if (name === "retry") return reply(200, await retryCall(deps.appDb, session, services, id));
          if (name === "realtime-key") return reply(200, await renewRealtimeKey(deps.appDb, session, services, id));
        }
      }
      const pieces = CALL_PIECES.exec(path);
      if (pieces && isUuid(pieces[1])) {
        if (method === "GET") return reply(200, await listPieces(deps.appDb, session, pieces[1], event.queryStringParameters ?? {}, meta));
        if (method === "POST") {
          await requirePermission(deps.appDb, session, "calls.upload");
          return reply(200, await pieceUrl(deps.appDb, session, services, pieces[1], body()));
        }
      }
      const pieceDone = CALL_PIECE_DONE.exec(path);
      if (pieceDone && isUuid(pieceDone[1]) && method === "POST") {
        await requirePermission(deps.appDb, session, "calls.upload");
        return reply(200, await pieceUploaded(deps.appDb, session, services, pieceDone[1], Number(pieceDone[2])));
      }
      const notes = CALL_NOTES.exec(path);
      if (notes && isUuid(notes[1]) && method === "POST") {
        await requireModule(deps.appDb, session, "reports");
        return reply(201, await requestNote(deps.appDb, session, services, notes[1], body()));
      }
      const note = CALL_NOTE.exec(path);
      if (note && isUuid(note[1]) && isUuid(note[2])) {
        if (method === "GET" && note[3]) return reply(200, await noteHistory(deps.appDb, session, note[1], note[2], meta));
        if (method === "PATCH" && !note[3]) return reply(200, await editNote(deps.appDb, session, note[1], note[2], body()));
      }
      const review = CALL_ANALYSIS.exec(path);
      if (review && isUuid(review[1]) && isUuid(review[2]) && method === "PATCH") {
        await requirePermission(deps.appDb, session, "flags.review");
        return reply(200, await reviewAnalysis(deps.appDb, session, review[1], review[2], body()));
      }
      const one = CALL.exec(path);
      if (one && isUuid(one[1])) {
        if (method === "GET" && event.queryStringParameters?.status === "1") return reply(200, await callStatus(deps.appDb, session, one[1]));
        if (method === "GET") return reply(200, await getCall(deps.appDb, session, one[1], meta));
        if (method === "PATCH") {
          await requirePermission(deps.appDb, session, "calls.upload");
          return reply(200, await updateCall(deps.appDb, session, services, one[1], body()));
        }
      }
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/report-templates" || REPORT_TEMPLATE.test(path)) {
      if (method === "GET" && path === "/org/report-templates") return reply(200, await listReportTemplates(deps.appDb, session));
      await requirePermission(deps.appDb, session, "report_templates.manage");
      if (method === "POST" && path === "/org/report-templates") return reply(201, await createReportTemplate(deps.appDb, session, body()));
      const template = REPORT_TEMPLATE.exec(path);
      if (template && isUuid(template[1]) && method === "PATCH") {
        return reply(200, await updateReportTemplate(deps.appDb, session, template[1], body()));
      }
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/complaints" || path.startsWith("/org/complaints/")) {
      await requireModule(deps.appDb, session, "complaints");
      await requirePermission(deps.appDb, session, "complaints.manage");
      const meta = { ip: event.requestContext.http.sourceIp, userAgent: event.requestContext.http.userAgent };
      if (method === "GET" && path === "/org/complaints") {
        return reply(200, await listComplaints(deps.appDb, session, event.queryStringParameters ?? {}));
      }
      if (method === "POST" && path === "/org/complaints") return reply(201, await createComplaint(deps.appDb, session, body()));
      const one = COMPLAINT.exec(path);
      if (one && isUuid(one[1])) {
        if (method === "GET") return reply(200, await getComplaint(deps.appDb, session, one[1], meta));
        if (method === "PATCH") return reply(200, await updateComplaint(deps.appDb, session, one[1], body()));
      }
      const notes = COMPLAINT_NOTES.exec(path);
      if (notes && isUuid(notes[1]) && method === "POST") return reply(201, await addComplaintNote(deps.appDb, session, notes[1], body()));
      return reply(404, { error: "Fant ikke ressursen." });
    }
    // The call centre's own invoices from VeriQall (billing.read, which needs BankID or a passkey).
    if (method === "GET" && (path === "/org/invoices" || INVOICE.test(path) || INVOICE_PDF.test(path))) {
      await requirePermission(deps.appDb, session, "billing.read");
      const pdf = INVOICE_PDF.exec(path);
      if (pdf) {
        if (!isUuid(pdf[1])) return reply(404, { error: "Fant ikke ressursen." });
        const file = await withSession(deps.appDb, session, (c) => invoicePdfFor(c, pdf[1]!));
        return binary(file.pdf, "application/pdf", cors, file.filename);
      }
      const one = INVOICE.exec(path);
      if (one) {
        if (!isUuid(one[1])) return reply(404, { error: "Fant ikke ressursen." });
        return reply(200, await withSession(deps.appDb, session, (c) => invoiceDetail(c, one[1]!)));
      }
      return reply(200, await listOrgInvoices(deps.appDb, session));
    }
    // Everyone sees their own numbers and feedback; the database checks the rest.
    if (path === "/org/dashboard" || path === "/org/coaching" || COACHING_READ.test(path)) {
      await requireModule(deps.appDb, session, "dashboard");
    }
    if (method === "GET" && path === "/org/dashboard") {
      return reply(200, await getDashboard(deps.appDb, session, event.queryStringParameters ?? {}));
    }
    if (path === "/org/coaching") {
      if (method === "GET") return reply(200, await listCoaching(deps.appDb, session, event.queryStringParameters ?? {}));
      if (method === "POST") {
        await requirePermission(deps.appDb, session, "coaching.give");
        return reply(201, await createCoaching(deps.appDb, session, body()));
      }
    }
    const coachingRead = COACHING_READ.exec(path);
    if (coachingRead && isUuid(coachingRead[1]) && method === "POST") {
      return reply(200, await readCoaching(deps.appDb, session, coachingRead[1]));
    }
    const documentation = SALE_DOCUMENTATION.exec(path);
    if (documentation && isUuid(documentation[1]) && method === "GET") {
      await requireModule(deps.appDb, session, "documentation");
      const meta = { ip: event.requestContext.http.sourceIp, userAgent: event.requestContext.http.userAgent };
      return reply(200, await getSaleDocumentation(deps.appDb, session, documentation[1], meta));
    }
    const confirmations = SALE_CONFIRMATIONS.exec(path);
    if (confirmations && isUuid(confirmations[1]) && method === "POST") {
      await requireModule(deps.appDb, session, "sale_verification");
      await requirePermission(deps.appDb, session, "sales.manage");
      return reply(201, await createConfirmation(deps.appDb, session, deps.config.appOrigin, confirmations[1]));
    }
    const revoke = SALE_CONFIRMATION_REVOKE.exec(path);
    if (revoke && isUuid(revoke[1]) && isUuid(revoke[2]) && method === "POST") {
      await requirePermission(deps.appDb, session, "sales.manage");
      return reply(200, await revokeConfirmation(deps.appDb, session, revoke[1], revoke[2]));
    }
    if (path === "/org/sales" || SALE.test(path)) {
      // Who sees which sales is decided by RLS (own, team or all); sales.manage changes them.
      if (method !== "GET") await requirePermission(deps.appDb, session, "sales.manage");
      if (method === "GET" && path === "/org/sales") {
        return reply(200, await listSales(deps.appDb, session, event.queryStringParameters ?? {}));
      }
      if (method === "POST" && path === "/org/sales") return reply(201, await createSale(deps.appDb, session, body()));
      const sale = SALE.exec(path);
      if (sale && isUuid(sale[1])) {
        if (method === "GET") return reply(200, await getSale(deps.appDb, session, sale[1]));
        if (method === "PATCH") return reply(200, await updateSale(deps.appDb, session, sale[1], body()));
      }
      return reply(404, { error: "Fant ikke ressursen." });
    }
    if (path === "/org/products" || path.startsWith("/org/products/")) {
      // Every member reads products (sellers pick them for sales); products.manage changes them.
      if (method !== "GET") await requirePermission(deps.appDb, session, "products.manage");
      if (method === "GET" && path === "/org/products") {
        return reply(200, await listProducts(deps.appDb, session, event.queryStringParameters?.archived === "1"));
      }
      if (method === "POST" && path === "/org/products") return reply(201, await createProduct(deps.appDb, session, body()));
      const product = PRODUCT.exec(path);
      if (product && isUuid(product[1])) {
        if (method === "GET") return reply(200, await getProduct(deps.appDb, session, product[1]));
        if (method === "PATCH") return reply(200, await updateProduct(deps.appDb, session, product[1], body()));
      }
      const draft = PRODUCT_DRAFT.exec(path);
      if (draft && isUuid(draft[1]) && method === "POST") return reply(201, await createDraft(deps.appDb, session, draft[1]));
      const version = VERSION.exec(path);
      if (version && isUuid(version[1]) && isUuid(version[2])) {
        if (method === "PATCH") return reply(200, await updateDraft(deps.appDb, session, version[1], version[2], body()));
        if (method === "DELETE") return reply(200, await deleteDraft(deps.appDb, session, version[1], version[2]));
      }
      const publish = VERSION_PUBLISH.exec(path);
      if (publish && isUuid(publish[1]) && isUuid(publish[2]) && method === "POST") {
        return reply(200, await publishDraft(deps.appDb, session, publish[1], publish[2]));
      }
      return reply(404, { error: "Fant ikke ressursen." });
    }
    await requirePermission(deps.appDb, session, "users.manage");
    if (path === "/org/threads") {
      if (method === "GET") return reply(200, await listThreads(deps.appDb, session, "org"));
      if (method === "POST") return reply(201, await startThread(deps.appDb, session, "org", body()));
    }
    const thread = THREAD.exec(path);
    if (thread && isUuid(thread[1])) {
      if (method === "GET") return reply(200, await getThread(deps.appDb, session, "org", thread[1]));
      if (method === "PATCH") return reply(200, await setThreadStatus(deps.appDb, session, "org", thread[1], body()));
    }
    const messages = THREAD_MESSAGES.exec(path);
    if (messages && isUuid(messages[1]) && method === "POST") {
      return reply(201, await replyThread(deps.appDb, session, "org", messages[1], body()));
    }
    if (method === "GET" && path === "/org/overview") return reply(200, await overview(deps.appDb, session));
    let match = MEMBER.exec(path);
    if (match && isUuid(match[1]) && method === "PATCH") return reply(200, await updateMember(deps.appDb, session, match[1], body()));
    if (method === "POST" && path === "/org/invitations") {
      const input = body();
      // Role by id in this portal; inviteMember takes the role key.
      const roleId = optionalText(input, "roleId", "Rolle", 64);
      if (!roleId || !isUuid(roleId)) throw new BadRequest("Velg en rolle.");
      const roleKey = await withSession(deps.appDb, session, async (c) => {
        const { rows } = await c.query<{ key: string }>(
          "select key from roles where id = $1 and organization_id = app.current_org_id() and archived_at is null",
          [roleId],
        );
        return rows[0]?.key;
      });
      if (!roleKey) throw new BadRequest("Ukjent rolle.");
      return reply(201, await inviteMember(deps.appDb, session, orgId, deps.config.appOrigin, { ...input, roleKey }));
    }
    match = INVITATION.exec(path);
    if (match && isUuid(match[1]) && method === "DELETE") return reply(200, await revokeInvitation(deps.appDb, session, orgId, match[1]));
    if (method === "POST" && path === "/org/teams") return reply(201, await createTeam(deps.appDb, session, body()));
    match = TEAM.exec(path);
    if (match && isUuid(match[1]) && method === "PATCH") return reply(200, await updateTeam(deps.appDb, session, match[1], body()));
    return reply(404, { error: "Fant ikke ressursen." });
  } catch (error) {
    if (error instanceof Forbidden) {
      return reply(403, {
        error: error.needsStrongSession ? "Dette krever innlogging med BankID eller passkey." : "Du har ikke tilgang til dette.",
        code: error.needsStrongSession ? "krever_bankid" : "ingen_tilgang",
      });
    }
    if (error instanceof BadRequest) return reply(400, { error: error.message });
    if (error instanceof Unavailable) return reply(503, { error: "Sanntidstekst er ikke tilgjengelig nå. Opptaket fortsetter." });
    if (error instanceof NotFound) return reply(404, { error: "Fant ikke ressursen." });
    if (error instanceof ModuleDisabled) {
      const name = MODULES[error.message as ModuleKey]?.name ?? error.message;
      return reply(403, { error: `${name} er ikke slått på for callsenteret.`, code: "modul_av" });
    }
    const code = (error as { code?: string }).code;
    const constraint = (error as { constraint?: string }).constraint ?? "";
    if (code === "42501" && path.startsWith("/org/roles")) {
      return reply(403, { error: "Du kan ikke gi en rolle rettigheter du ikke har selv." });
    }
    if (code === "42501" && /^\/org\/(customers|products|sales|calls|report-templates|complaints|dashboard|coaching)(\/|$)/.test(path)) {
      return reply(403, { error: "Du har ikke tilgang til dette.", code: "ingen_tilgang" });
    }
    if (code === "42501") return reply(403, { error: "Du kan ikke gi en rolle med rettigheter du ikke har selv." });
    if (code === "23505" && constraint === "customers_org_number_key") {
      return reply(409, { error: "Det finnes allerede en kunde med dette organisasjonsnummeret." });
    }
    if (code === "23505" && constraint === "products_org_name_key") {
      return reply(409, { error: "Det finnes allerede et produkt med dette navnet." });
    }
    if (code === "23505" && constraint === "report_templates_default") {
      return reply(409, { error: "Noen andre endret standardmalen samtidig. Last siden på nytt." });
    }
    if (code === "23505" && constraint.startsWith("product_template_versions")) {
      return reply(409, { error: "Noen andre endret produktet samtidig. Last siden på nytt." });
    }
    if (code === "23514" && path.startsWith("/org/products/")) {
      return reply(409, { error: "Versjonen er publisert og kan ikke endres." });
    }
    if (code === "22007" || code === "22008") return reply(400, { error: "Ugyldig dato." });
    if (code === "23505" && constraint.includes("phone")) return reply(409, { error: "Mobilnummeret er allerede i bruk." });
    if (code === "23505" && constraint.includes("email")) return reply(409, { error: "E-postadressen er allerede i bruk." });
    if (code === "23505" && constraint === "sale_confirmations_pending") {
      return reply(409, { error: "Noen andre sendte en ny lenke samtidig. Last siden på nytt." });
    }
    if (code === "23503") return reply(400, { error: "Ukjent rolle eller team." });
    throw error;
  }
}

// For POST /me/organization: may this session work in the given call centre? Active members of
// an open call centre may, and superadmins may enter any call centre.
export async function canEnterOrganization(db: pg.Pool, session: Session, orgId: string): Promise<boolean> {
  return withSession(db, { ...session, activeOrganizationId: orgId }, async (c) => {
    const { rows } = await c.query<{ id: string | null }>("select app.current_org_id() as id");
    return rows[0]?.id === orgId;
  });
}
