// Roles in the call centre's admin portal (needs roles.manage). Permissions are a fixed catalog
// in code; roles are rows per call centre. The database refuses to put a permission on a role
// that the caller does not hold (role_permissions_guard).
import { isPermission } from "@veriqall/shared";
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, optionalText, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

function permissionList(body: Body): string[] | undefined {
  const value = body.permissions;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isPermission)) throw new BadRequest("Ugyldige rettigheter.");
  return [...new Set(value)];
}

export async function listRoles(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const roles = await c.query(
      `select r.id, r.key, r.name, r.is_default as "isDefault", r.archived_at as "archivedAt",
              array(select permission from role_permissions rp where rp.role_id = r.id order by 1) as permissions,
              (select count(*) from memberships m where m.role_id = r.id and m.status = 'active')::int as members,
              exists (select 1 from memberships m where m.role_id = r.id and m.user_id = app.current_user_id()) as mine
       from roles r where r.organization_id = app.current_org_id()
       order by r.archived_at nulls first, r.is_default desc, r.name`,
    );
    const catalog = await c.query(
      `select p.key, p.description, app.has_permission(p.key) as held,
              p.key in (select permission from strong_auth_permissions) as "requiresBankId"
       from permissions p order by p.key`,
    );
    return { roles: roles.rows, permissions: catalog.rows };
  });
}

// A key for a new role from its name: lower case ASCII, unique within the call centre.
export function roleKeyFrom(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `rolle_${base}`.replace(/_+$/, "");
}

export async function createRole(db: pg.Pool, session: Session, body: Body) {
  const name = requiredText(body, "name", "Navn", 100);
  const permissions = permissionList(body) ?? [];
  return withSession(db, session, async (c) => {
    const base = roleKeyFrom(name);
    const taken = await c.query<{ key: string }>(
      "select key from roles where organization_id = app.current_org_id() and (key = $1 or key like $1 || '\\_%')",
      [base],
    );
    const keys = new Set(taken.rows.map((r) => r.key));
    let key = base;
    for (let i = 2; keys.has(key); i++) key = `${base}_${i}`;
    const { rows } = await c.query<{ id: string }>(
      "insert into roles (organization_id, key, name) values (app.current_org_id(), $1, $2) returning id",
      [key, name],
    );
    const id = rows[0]!.id;
    for (const permission of permissions) {
      await c.query(
        "insert into role_permissions (role_id, organization_id, permission) values ($1, app.current_org_id(), $2)",
        [id, permission],
      );
    }
    return { id, key };
  });
}

export async function updateRole(db: pg.Pool, session: Session, roleId: string, body: Body) {
  const name = optionalText(body, "name", "Navn", 100);
  if (name === null) throw new BadRequest("Navn må fylles ut.");
  const permissions = permissionList(body);
  const archived = body.archived;
  if (archived !== undefined && typeof archived !== "boolean") throw new BadRequest("Ugyldig forespørsel.");

  return withSession(db, session, async (c) => {
    const role = await c.query<{ mine: boolean; members: number }>(
      `select exists (select 1 from memberships m where m.role_id = r.id and m.user_id = app.current_user_id()) as mine,
              (select count(*) from memberships m where m.role_id = r.id and m.status = 'active')::int as members
       from roles r where r.id = $1 and r.organization_id = app.current_org_id()`,
      [roleId],
    );
    if (!role.rows[0]) throw new NotFound();
    // Changing the role you hold could take away your own access to this page.
    if (role.rows[0].mine && (permissions !== undefined || archived === true)) {
      throw new BadRequest("Du kan ikke endre rettighetene til rollen du har selv.");
    }
    // Only roles within your own rights: taking rights away from a stronger role (an admin's)
    // would be a way round the rule that nobody gives or takes what they don't have.
    if (permissions !== undefined || archived !== undefined) {
      const stronger = await c.query<{ more: boolean }>(
        "select exists (select 1 from role_permissions where role_id = $1 and not app.has_permission(permission)) as more",
        [roleId],
      );
      if (stronger.rows[0]!.more) throw new BadRequest("Rollen har rettigheter du ikke har selv, og kan ikke endres av deg.");
    }
    if (archived === true && role.rows[0].members > 0) {
      throw new BadRequest("Rollen har brukere. Gi dem en annen rolle før du arkiverer den.");
    }
    if (name) await c.query("update roles set name = $2 where id = $1", [roleId, name]);
    if (permissions !== undefined) {
      await c.query("delete from role_permissions where role_id = $1 and not (permission = any($2::text[]))", [
        roleId,
        permissions,
      ]);
      // Only the new ones: the grant guard checks every inserted permission, also ones the
      // role already had.
      const existing = await c.query<{ permission: string }>("select permission from role_permissions where role_id = $1", [
        roleId,
      ]);
      const has = new Set(existing.rows.map((r) => r.permission));
      for (const permission of permissions.filter((p) => !has.has(p))) {
        await c.query("insert into role_permissions (role_id, organization_id, permission) values ($1, app.current_org_id(), $2)", [
          roleId,
          permission,
        ]);
      }
    }
    if (archived === true) await c.query("update roles set archived_at = now() where id = $1 and archived_at is null", [roleId]);
    if (archived === false) await c.query("update roles set archived_at = null where id = $1", [roleId]);
    return { id: roleId };
  });
}

