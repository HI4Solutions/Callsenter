// Superadmin: users across call centres (docs/plan.md, section 10, "Brukere"), and the
// catalogs shown under "Roller og moduler". Runs as app_user under RLS, outside any call
// centre; cross-call-centre read-outs go through the app.admin_* functions (migration 0004).
import { MODULE_KEYS, MODULES, STRONG_AUTH_PERMISSIONS } from "@veriqall/shared";
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, optionalEmail, optionalPhone, optionalText } from "./validate.ts";

function platform<T>(db: pg.Pool, session: Session, fn: (c: pg.PoolClient) => Promise<T>) {
  return withSession(db, { ...session, activeOrganizationId: null }, fn);
}

export async function listUsers(db: pg.Pool, session: Session, query: string) {
  const q = query.trim().slice(0, 100);
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `with m as (select * from app.admin_memberships())
       select u.id, u.full_name as name, u.phone, u.email, u.status,
              u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
              exists (select 1 from platform_admins p where p.user_id = u.id and p.revoked_at is null) as "platformAdmin",
              coalesce((select json_agg(json_build_object('id', m.organization_id, 'name', m.organization_name,
                                                          'role', m.role_name, 'status', m.status)
                                        order by m.organization_name)
                        from m where m.user_id = u.id), '[]') as organizations
       from users u
       where $1 = '' or u.full_name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%'
          or u.phone like '%' || regexp_replace($1, '\\s', '', 'g') || '%'
       order by lower(u.full_name)
       limit 500`,
      [q],
    );
    return rows;
  });
}

export async function getUser(db: pg.Pool, session: Session, userId: string) {
  return platform(db, session, async (c) => {
    const user = await c.query(
      `select u.id, u.full_name as name, u.phone, u.email, u.status, u.last_login_at as "lastLoginAt",
              u.created_at as "createdAt",
              exists (select 1 from platform_admins p where p.user_id = u.id and p.revoked_at is null) as "platformAdmin"
       from users u where u.id = $1`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFound();
    const memberships = await c.query(
      `select organization_id as id, organization_name as name, role_name as role, status
       from app.admin_memberships($1)`,
      [userId],
    );
    const identities = await c.query(
      `select provider, created_at as "createdAt", last_used_at as "lastUsedAt" from app.admin_identities($1)`,
      [userId],
    );
    const passkeys = await c.query(
      `select id, name, created_at as "createdAt", last_used_at as "lastUsedAt"
       from passkeys where user_id = $1 order by created_at`,
      [userId],
    );
    const sessions = await c.query(
      `select provider, created_at as "createdAt", last_seen_at as "lastSeenAt", expires_at as "expiresAt",
              host(ip) as ip, user_agent as "userAgent"
       from app.admin_sessions($1)`,
      [userId],
    );
    const logins = await c.query(
      `select occurred_at as "occurredAt", provider, result, host(ip) as ip
       from login_events where user_id = $1 order by occurred_at desc limit 20`,
      [userId],
    );
    return {
      ...user.rows[0],
      self: userId === session.userId,
      organizations: memberships.rows,
      identities: identities.rows,
      passkeys: passkeys.rows,
      sessions: sessions.rows,
      logins: logins.rows,
    };
  });
}

export async function updateUser(db: pg.Pool, session: Session, userId: string, body: Body) {
  const fullName = optionalText(body, "fullName", "Navn", 200);
  if (fullName === null) throw new BadRequest("Navn må fylles ut.");
  const phone = optionalPhone(body, "phone", "Mobilnummer");
  const email = optionalEmail(body, "email", "E-post");
  const access = body.access;
  if (access !== undefined && access !== "enabled" && access !== "disabled") throw new BadRequest("Ugyldig status.");
  if (access === "disabled" && userId === session.userId) throw new BadRequest("Du kan ikke deaktivere deg selv.");

  return platform(db, session, async (c) => {
    const current = await c.query<{ status: string; last_login_at: Date | null }>(
      "select status, last_login_at from users where id = $1",
      [userId],
    );
    if (!current.rows[0]) throw new NotFound();
    const sets: string[] = [];
    const values: unknown[] = [userId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (fullName !== undefined) add("full_name", fullName);
    if (phone !== undefined) add("phone", phone);
    if (email !== undefined) add("email", email);
    if (access === "disabled") add("status", "disabled");
    // Enabling again: back to invited if the user never signed in.
    if (access === "enabled" && current.rows[0].status === "disabled") {
      add("status", current.rows[0].last_login_at ? "active" : "invited");
    }
    if (sets.length) await c.query(`update users set ${sets.join(", ")} where id = $1`, values);
    if (access === "disabled") await c.query("select app.admin_revoke_sessions($1)", [userId]);
    return { id: userId };
  });
}

export async function signOutEverywhere(db: pg.Pool, session: Session, userId: string) {
  return platform(db, session, async (c) => {
    const { rows } = await c.query<{ n: number }>("select app.admin_revoke_sessions($1) as n", [userId]);
    return { revoked: rows[0]?.n ?? 0 };
  });
}

export async function removeIdentity(db: pg.Pool, session: Session, userId: string, provider: string) {
  if (provider !== "bankid" && provider !== "vipps") throw new NotFound();
  // Removing your own BankID would lock you out of superadmin.
  if (userId === session.userId) throw new BadRequest("Du kan ikke fjerne dine egne innloggingsmetoder.");
  return platform(db, session, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>("select app.admin_remove_identity($1, $2) as ok", [userId, provider]);
    if (!rows[0]?.ok) throw new NotFound();
    return { removed: provider };
  });
}

// Removes a passkey (for example a lost device) and signs the user out everywhere.
export async function removePasskey(db: pg.Pool, session: Session, userId: string, passkeyId: string) {
  return platform(db, session, async (c) => {
    const { rowCount } = await c.query("delete from passkeys where id = $1 and user_id = $2", [passkeyId, userId]);
    if (!rowCount) throw new NotFound();
    await c.query("select app.admin_revoke_sessions($1)", [userId]);
    return { removed: passkeyId };
  });
}

export async function setPlatformAdmin(db: pg.Pool, session: Session, userId: string, body: Body) {
  if (typeof body.enabled !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  const enabled = body.enabled;
  return platform(db, session, async (c) => {
    const user = await c.query<{ status: string }>("select status from users where id = $1", [userId]);
    if (!user.rows[0]) throw new NotFound();
    if (enabled) {
      if (user.rows[0].status === "disabled") throw new BadRequest("Brukeren er deaktivert.");
      await c.query(
        `insert into platform_admins (user_id) values ($1)
         on conflict (user_id) do update set revoked_at = null, granted_at = now()
         where platform_admins.revoked_at is not null`,
        [userId],
      );
    } else {
      await c.query("update platform_admins set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    }
    return { id: userId, platformAdmin: enabled };
  });
}

// "Roller og moduler": the permission catalog, the roles new call centres get, and modules.
export async function catalog(db: pg.Pool, session: Session) {
  return platform(db, session, async (c) => {
    const permissions = await c.query<{ key: string; description: string }>(
      "select key, description from permissions order by key",
    );
    const defaults = await c.query<{ role_key: string; role_name: string; permissions: string[] }>(
      `select role_key, role_name, array_agg(permission order by permission) as permissions
       from default_role_permissions group by role_key, role_name order by role_name`,
    );
    const usage = await c.query<{ module: string; enabled_count: number }>("select * from app.admin_module_usage()");
    const used = new Map(usage.rows.map((r) => [r.module, r.enabled_count]));
    return {
      permissions: permissions.rows.map((p) => ({
        ...p,
        requiresBankId: (STRONG_AUTH_PERMISSIONS as readonly string[]).includes(p.key),
      })),
      defaultRoles: defaults.rows.map((r) => ({ key: r.role_key, name: r.role_name, permissions: r.permissions })),
      modules: MODULE_KEYS.map((key) => ({ key, ...MODULES[key], enabledIn: used.get(key) ?? 0 })),
    };
  });
}
