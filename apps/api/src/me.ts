// GET /me: who is signed in, which call centres they belong to, and what they may do in the
// active one. Runs as app_user under RLS, with the session's user, call centre and strength.
import type pg from "pg";
import type { Session } from "./auth/session.ts";

export interface Me {
  user: { id: string; name: string };
  provider: string;
  strongAuthentication: boolean;
  platformAdmin: boolean;
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  // Modules switched on for the active call centre.
  modules: string[];
}

export async function withSession<T>(appDb: pg.Pool, session: Session, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appDb.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true),
              set_config('app.session_strong', $3, true)`,
      [session.userId, session.activeOrganizationId ?? "", session.strong ? "on" : ""],
    );
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

export function loadMe(appDb: pg.Pool, session: Session): Promise<Me> {
  return withSession(appDb, session, async (db) => {
    const user = await db.query<{ id: string; full_name: string }>("select id, full_name from users where id = $1", [
      session.userId,
    ]);
    // The user's call centres, plus the current one when a superadmin has stepped into it.
    const orgs = await db.query<{ id: string; name: string }>(
      `select id, name from organizations
       where id in (select app.my_organization_ids()) or id = app.current_org_id() order by name`,
    );
    const flags = await db.query<{ platform_admin: boolean; org: string | null }>(
      "select app.is_platform_admin() as platform_admin, app.current_org_id() as org",
    );
    const permissions = await db.query<{ p: string }>("select app.current_permissions() as p order by 1");
    const modules = await db.query<{ module: string }>(
      "select module from organization_modules where organization_id = app.current_org_id() and enabled order by 1",
    );
    return {
      user: { id: session.userId, name: user.rows[0]?.full_name ?? "" },
      provider: session.provider,
      strongAuthentication: session.strong,
      platformAdmin: flags.rows[0]?.platform_admin ?? false,
      organizations: orgs.rows,
      activeOrganizationId: flags.rows[0]?.org ?? null,
      permissions: permissions.rows.map((r) => r.p),
      modules: modules.rows.map((r) => r.module),
    };
  });
}
