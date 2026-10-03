// Superadmin: call centres (docs/plan.md, section 10, "Callsentre"). Everything runs as
// app_user under RLS. Work inside one call centre sets it as the current call centre, so the
// same policies, guards and audit triggers apply as for the call centre's own admin.
import { isLocale, isModuleKey, MODULE_KEYS } from "@veriqall/shared";
import type pg from "pg";
import { randomToken, sha256 } from "../auth/crypto.ts";
import type { Session } from "../auth/session.ts";
import { sendInvitation } from "../email.ts";
import { localeOr, spokenLanguages } from "../i18n/worker.ts";
import { withSession } from "../me.ts";
import {
  BadRequest,
  type Body,
  isUuid,
  optionalDate,
  optionalEmail,
  optionalOrgNumber,
  optionalPhone,
  optionalText,
  requiredText,
} from "./validate.ts";

export class NotFound extends Error {}

const STATUSES = ["active", "suspended"] as const;

function inOrganization<T>(db: pg.Pool, session: Session, orgId: string | null, fn: (c: pg.PoolClient) => Promise<T>) {
  return withSession(db, { ...session, activeOrganizationId: orgId }, fn);
}

export async function listOrganizations(db: pg.Pool, session: Session) {
  return inOrganization(db, session, null, async (c) => {
    const { rows } = await c.query(
      `select o.id, o.name, o.org_number as "orgNumber", o.status, o.trial_ends_at as "trialEndsAt", o.access_until as "accessUntil",
              o.created_at as "createdAt",
              coalesce(v.active_members, 0) as "activeMembers",
              coalesce(v.invited_members, 0) as "invitedMembers",
              v.last_login_at as "lastLoginAt"
       from organizations o
       left join app.organization_overview() v on v.organization_id = o.id
       order by lower(o.name)`,
    );
    return rows;
  });
}

// Fields shared by create and update. Undefined means "not sent".
function organizationFields(body: Body) {
  const status = body.status;
  if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new BadRequest("Ugyldig status.");
  }
  return {
    name: optionalText(body, "name", "Navn", 200),
    org_number: optionalOrgNumber(body, "orgNumber"),
    contact_name: optionalText(body, "contactName", "Kontaktperson", 200),
    contact_email: optionalEmail(body, "contactEmail", "E-post til kontaktperson"),
    contact_phone: optionalPhone(body, "contactPhone", "Telefon til kontaktperson"),
    invoice_email: optionalEmail(body, "invoiceEmail", "Faktura-e-post"),
    invoice_address: optionalText(body, "invoiceAddress", "Fakturaadresse", 500),
    note: optionalText(body, "note", "Notat", 2000),
    trial_ends_at: optionalDate(body, "trialEndsAt", "Slutt på prøveperiode"),
    status: status as (typeof STATUSES)[number] | undefined,
    recording_retention_months: retentionMonths(body),
    default_locale: organizationLocale(body, "defaultLocale"),
    content_locale: organizationLocale(body, "contentLocale"),
    transcription_languages: spokenLanguages(body, "transcriptionLanguages") ?? undefined,
  };
}

// The call centre's language for the pages and for notes (docs/plan.md, section 19).
function organizationLocale(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!isLocale(value)) throw new BadRequest("Ukjent språk.");
  return value;
}

// How long recordings and transcripts are kept (decided 2 October 2026: 3, 6, 9 or 12 months).
function retentionMonths(body: Body): number | undefined {
  const value = body.recordingRetentionMonths;
  if (value === undefined) return undefined;
  if (value !== 3 && value !== 6 && value !== 9 && value !== 12) throw new BadRequest("Lagringstiden må være 3, 6, 9 eller 12 måneder.");
  return value;
}

function moduleChanges(body: Body): [string, boolean][] {
  const modules = body.modules;
  if (modules === undefined) return [];
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) throw new BadRequest("Ugyldige moduler.");
  return Object.entries(modules).map(([key, enabled]) => {
    if (!isModuleKey(key) || typeof enabled !== "boolean") throw new BadRequest("Ugyldige moduler.");
    return [key, enabled];
  });
}

async function setModules(c: pg.PoolClient, orgId: string, changes: [string, boolean][]) {
  for (const [module, enabled] of changes) {
    await c.query(
      `insert into organization_modules (organization_id, module, enabled) values ($1, $2, $3)
       on conflict (organization_id, module) do update set enabled = excluded.enabled
       where organization_modules.enabled is distinct from excluded.enabled`,
      [orgId, module, enabled],
    );
  }
}

export async function createOrganization(db: pg.Pool, session: Session, body: Body) {
  requiredText(body, "name", "Navn");
  const fields = Object.entries(organizationFields(body)).filter(([, value]) => value !== undefined);
  const changes = moduleChanges(body);
  return inOrganization(db, session, null, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into organizations (${fields.map(([key]) => key).join(", ")})
       values (${fields.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      fields.map(([, value]) => value),
    );
    const id = rows[0]!.id;
    // Modules are written inside the new call centre (organization_modules policy).
    await c.query("select set_config('app.current_org_id', $1, true)", [id]);
    await setModules(c, id, changes);
    return { id };
  });
}

export async function updateOrganization(db: pg.Pool, session: Session, orgId: string, body: Body) {
  const fields = Object.entries(organizationFields(body)).filter(([, value]) => value !== undefined);
  if (fields.some(([key, value]) => key === "name" && !value)) throw new BadRequest("Navn må fylles ut.");
  const changes = moduleChanges(body);
  return inOrganization(db, session, orgId, async (c) => {
    const exists = await c.query("select 1 from organizations where id = $1", [orgId]);
    if (!exists.rowCount) throw new NotFound();
    if (fields.length) {
      await c.query(
        `update organizations set ${fields.map(([key], i) => `${key} = $${i + 2}`).join(", ")} where id = $1`,
        [orgId, ...fields.map(([, value]) => value)],
      );
    }
    await setModules(c, orgId, changes);
    return { id: orgId };
  });
}

export async function getOrganization(db: pg.Pool, session: Session, orgId: string) {
  return inOrganization(db, session, orgId, async (c) => {
    const org = await c.query(
      `select id, name, org_number as "orgNumber", status, trial_ends_at as "trialEndsAt", access_until as "accessUntil",
              contact_name as "contactName", contact_email as "contactEmail", contact_phone as "contactPhone",
              invoice_email as "invoiceEmail", invoice_address as "invoiceAddress", note,
              recording_retention_months as "recordingRetentionMonths",
              default_locale as "defaultLocale", content_locale as "contentLocale",
              transcription_languages as "transcriptionLanguages",
              created_at as "createdAt", updated_at as "updatedAt"
       from organizations where id = $1`,
      [orgId],
    );
    if (!org.rows[0]) throw new NotFound();
    const modules = await c.query<{ module: string; enabled: boolean }>(
      "select module, enabled from organization_modules where organization_id = $1",
      [orgId],
    );
    const enabled = new Map(modules.rows.map((r) => [r.module, r.enabled]));
    const members = await c.query(
      `select u.id as "userId", u.full_name as name, u.phone, u.email, u.status as "userStatus",
              u.last_login_at as "lastLoginAt", m.status, r.key as "roleKey", r.name as "roleName",
              m.created_at as "createdAt"
       from memberships m
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id
       where m.organization_id = $1
       order by lower(u.full_name)`,
      [orgId],
    );
    const roles = await c.query(
      `select key, name from roles where organization_id = $1 and archived_at is null order by name`,
      [orgId],
    );
    const invitations = await c.query(
      `select i.id, u.full_name as name, i.created_at as "createdAt", i.expires_at as "expiresAt",
              i.used_at as "usedAt", i.revoked_at as "revokedAt"
       from invitations i join users u on u.id = i.user_id
       where i.organization_id = $1
       order by i.created_at desc
       limit 50`,
      [orgId],
    );
    return {
      ...org.rows[0],
      modules: MODULE_KEYS.map((key) => ({ key, enabled: enabled.get(key) ?? false })),
      members: members.rows,
      roles: roles.rows,
      invitations: invitations.rows,
    };
  });
}

// Invites a person to a call centre with a role (the call centre's admin by default). Reuses a
// user with the same mobile number or e-mail address. Returns the link once; only its hash is
// stored.
// True when the member holds a permission in this call centre that the current user lacks.
// Nobody changes, disables or re-invites someone with more rights than they have themselves.
export async function holdsMoreThanMe(c: pg.PoolClient, userId: string): Promise<boolean> {
  const { rows } = await c.query<{ more: boolean }>(
    `select exists (
       select 1 from memberships m join role_permissions rp on rp.role_id = m.role_id
       where m.organization_id = app.current_org_id() and m.user_id = $1 and not app.has_permission(rp.permission)
     ) as more`,
    [userId],
  );
  return rows[0]!.more;
}

export async function inviteMember(db: pg.Pool, session: Session, orgId: string, appOrigin: string, body: Body) {
  const fullName = requiredText(body, "fullName", "Navn");
  const phone = optionalPhone(body, "phone", "Mobilnummer") ?? null;
  const email = optionalEmail(body, "email", "E-post") ?? null;
  if (!phone && !email) throw new BadRequest("Fyll ut mobilnummer eller e-post.");
  const roleKey = optionalText(body, "roleKey", "Rolle", 64) ?? "admin";
  const teamId = optionalText(body, "teamId", "Team", 64) ?? null;
  if (teamId && !isUuid(teamId)) throw new BadRequest("Ukjent team.");

  const invited = await inOrganization(db, session, orgId, async (c) => {
    const exists = await c.query<{ name: string; locale: string }>("select name, default_locale as locale from organizations where id = $1", [orgId]);
    if (!exists.rowCount) throw new NotFound();
    const role = await c.query<{ id: string }>(
      "select id from roles where organization_id = $1 and key = $2 and archived_at is null",
      [orgId, roleKey],
    );
    if (!role.rows[0]) throw new BadRequest("Ukjent rolle.");

    // The person may already be a user elsewhere; the lookup works across call centres.
    const existing = await c.query<{ id: string | null }>("select app.user_id_for_invitation($1, $2) as id", [phone, email]);
    let userId = existing.rows[0]?.id ?? undefined;
    if (userId === session.userId) throw new BadRequest("Du kan ikke invitere deg selv.");
    if (userId) {
      const status = await c.query<{ status: string }>("select status from users where id = $1", [userId]);
      if (status.rows[0]?.status === "disabled") throw new BadRequest("Brukeren er deaktivert.");
      // Inviting again changes the role of an existing member.
      if (await holdsMoreThanMe(c, userId)) throw new BadRequest("Brukeren har rettigheter du ikke har selv.");
    }
    if (!userId) {
      // The new user is not visible until the membership exists, so the id is made here.
      const created = await c.query<{ id: string }>("select gen_random_uuid() as id");
      userId = created.rows[0]!.id;
      await c.query("insert into users (id, full_name, phone, email, status) values ($1, $2, $3, $4, 'invited')", [
        userId,
        fullName,
        phone,
        email,
      ]);
    }
    if (teamId) {
      const team = await c.query("select 1 from teams where id = $1 and organization_id = $2 and archived_at is null", [
        teamId,
        orgId,
      ]);
      if (!team.rowCount) throw new BadRequest("Ukjent team.");
    }
    await c.query(
      `insert into memberships (organization_id, user_id, role_id, team_id) values ($1, $2, $3, $4)
       on conflict (organization_id, user_id) do update
         set role_id = excluded.role_id, team_id = excluded.team_id, status = 'active'`,
      [orgId, userId, role.rows[0].id, teamId],
    );
    // A link may only go to someone who has never logged in and belongs to no other call
    // centre (migration 0025). Anyone else is added without a link, and sees the call centre
    // the next time they log in with their own BankID, Vipps or passkey.
    const claimable = await c.query<{ ok: boolean }>("select app.invitation_claimable($1) as ok", [userId]);
    if (!claimable.rows[0]?.ok) {
      return { id: null, userId, link: null, expiresAt: null, organizationName: exists.rows[0]!.name, locale: exists.rows[0]!.locale };
    }
    const token = randomToken();
    const invitation = await c.query<{ id: string; expires_at: Date }>(
      `insert into invitations (organization_id, user_id, token_hash, created_by)
       values ($1, $2, $3, $4) returning id, expires_at`,
      [orgId, userId, sha256(token), session.userId],
    );
    const link = new URL("/logg-inn", appOrigin);
    link.searchParams.set("invitasjon", token);
    return {
      id: invitation.rows[0]!.id,
      userId,
      link: link.toString(),
      expiresAt: invitation.rows[0]!.expires_at,
      organizationName: exists.rows[0]!.name,
      locale: exists.rows[0]!.locale,
    };
  });
  // Sent after the invitation is committed; the link is shown either way.
  // In the call centre's language, as the invited person will see it first.
  const { organizationName, locale, ...result } = invited;
  const emailed = email && result.link ? await sendInvitation(email, fullName, organizationName, result.link, localeOr(locale)) : false;
  return { ...result, emailed };
}

export async function revokeInvitation(db: pg.Pool, session: Session, orgId: string, invitationId: string) {
  return inOrganization(db, session, orgId, async (c) => {
    const { rowCount } = await c.query(
      "update invitations set revoked_at = now() where id = $1 and organization_id = $2 and used_at is null and revoked_at is null",
      [invitationId, orgId],
    );
    if (!rowCount) throw new NotFound();
    return { id: invitationId };
  });
}

