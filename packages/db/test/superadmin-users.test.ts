import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, api, as, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

async function superadmin() {
  const id = await createUser("Super");
  await makePlatformAdmin(id);
  return id;
}

async function session(userId: string, provider = "bankid") {
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
    [randomBytes(32), userId, provider],
  );
}

describe("granting superadmin from the portal", () => {
  it("lets a superadmin grant and revoke others, but not themself", async () => {
    const me = await superadmin();
    const other = await createUser("Ny Super");
    await as(api, { userId: me }, async (db) => {
      await db.query("insert into platform_admins (user_id) values ($1)", [other]);
      await db.query("update platform_admins set revoked_at = now() where user_id = $1", [other]);
      await expect(db.query("update platform_admins set revoked_at = now() where user_id = $1", [me])).rejects.toThrow(
        /your own/,
      );
    });
  });

  it("is refused without BankID and for call centre admins", async () => {
    const me = await superadmin();
    const other = await createUser();
    await as(api, { userId: me, strong: false }, async (db) => {
      await expect(db.query("insert into platform_admins (user_id) values ($1)", [other])).rejects.toThrow(/row-level security/);
    });
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await expect(db.query("insert into platform_admins (user_id) values ($1)", [other])).rejects.toThrow(/row-level security/);
    });
  });
});

describe("superadmin read-outs", () => {
  it("shows memberships, login methods and sessions only to superadmins", async () => {
    const me = await superadmin();
    const org = await createOrg("Synlig AS");
    const user = await member(org, "seller");
    await owner.query("insert into identities (user_id, provider, subject) values ($1, 'vipps', $2)", [
      user,
      randomBytes(8).toString("hex"),
    ]);
    await session(user, "vipps");

    await as(api, { userId: me }, async (db) => {
      const m = await db.query("select organization_name, role_name from app.admin_memberships($1)", [user]);
      expect(m.rows).toEqual([{ organization_name: "Synlig AS", role_name: "Selger" }]);
      const i = await db.query("select provider from app.admin_identities($1)", [user]);
      expect(i.rows).toEqual([{ provider: "vipps" }]);
      const s = await db.query("select provider from app.admin_sessions($1)", [user]);
      expect(s.rows).toEqual([{ provider: "vipps" }]);
    });

    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      expect((await db.query("select * from app.admin_memberships($1)", [user])).rows).toEqual([]);
      expect((await db.query("select * from app.admin_sessions($1)", [user])).rows).toEqual([]);
      await expect(db.query("select app.admin_revoke_sessions($1)", [user])).rejects.toThrow(/superadmin required/);
    });
  });

  it("signs a user out everywhere and removes a login method, with an audit trail", async () => {
    const me = await superadmin();
    const user = await createUser();
    await addMember(await createOrg(), user, "seller");
    await owner.query("insert into identities (user_id, provider, subject) values ($1, 'bankid', $2)", [
      user,
      randomBytes(8).toString("hex"),
    ]);
    await session(user);
    await session(user, "vipps");

    const client = await api.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_user_id', $1, true), set_config('app.session_strong', 'on', true)", [me]);
      expect((await client.query("select app.admin_remove_identity($1, 'bankid') as ok", [user])).rows[0].ok).toBe(true);
      expect((await client.query("select app.admin_revoke_sessions($1) as n", [user])).rows[0].n).toBe(1);
      await client.query("commit");
    } finally {
      client.release();
    }
    const left = await owner.query("select count(*)::int as n from sessions where user_id = $1 and revoked_at is null", [user]);
    expect(left.rows[0].n).toBe(0);
    const audit = await owner.query(
      "select table_name, action from audit_log where record_id in ($1) or (table_name = 'identities' and old_data ->> 'user_id' = $1) order by id",
      [user],
    );
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { table_name: "identities", action: "delete" },
        { table_name: "sessions", action: "update" },
      ]),
    );
  });
});
