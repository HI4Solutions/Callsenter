import { STRONG_AUTH_PERMISSIONS } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { api, as, auth, count, createOrg, createUser, hash32, makePlatformAdmin, member, owner, rejects } from "./helpers.ts";

describe("BankID requirement", () => {
  it("lists the same permissions as packages/shared", async () => {
    const { rows } = await owner.query<{ permission: string }>(
      "select permission from strong_auth_permissions order by permission",
    );
    expect(rows.map((r) => r.permission)).toEqual([...STRONG_AUTH_PERMISSIONS].sort());
  });

  it("gives an admin in a Vipps session everything except the administrative permissions", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const held = (strong: boolean) =>
      as(api, { userId: admin, orgId: org, strong }, async (db) => {
        const { rows } = await db.query<{ p: string }>("select app.current_permissions() as p order by 1");
        return rows.map((r) => r.p);
      });
    const vipps = await held(false);
    const bankid = await held(true);
    expect(bankid).toEqual(expect.arrayContaining([...STRONG_AUTH_PERMISSIONS]));
    for (const permission of STRONG_AUTH_PERMISSIONS) expect(vipps).not.toContain(permission);
    expect(vipps).toContain("sales.manage");
    expect(bankid.length - vipps.length).toBe(STRONG_AUTH_PERMISSIONS.length);
  });

  it("enforces it in RLS: no audit log and no user administration from a Vipps session", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org, strong: false }, async (db) => {
      expect(await count(db, "audit_log")).toBe(0);
      await rejects(db, "insert into teams (organization_id, name) values ($1, 'Team')", [org], /row-level security/);
    });
    await as(api, { userId: admin, orgId: org, strong: true }, async (db) => {
      expect(await count(db, "audit_log")).toBeGreaterThan(0);
      await db.query("insert into teams (organization_id, name) values ($1, 'Team')", [org]);
    });
  });

  it("takes superadmin powers away from a Vipps session", async () => {
    const org = await createOrg();
    const superadmin = await createUser("Superadmin");
    await makePlatformAdmin(superadmin);
    await as(api, { userId: superadmin, orgId: org, strong: false }, async (db) => {
      const { rows } = await db.query("select app.is_platform_admin() as admin, app.current_org_id() as org");
      expect(rows[0]).toEqual({ admin: false, org: null });
      expect(await count(db, "organizations")).toBe(0);
    });
  });

  it("lets nobody grant administrative permissions from a Vipps session", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org, strong: false }, async (db) => {
      // roles.manage itself is administrative, so a Vipps session cannot even create roles.
      await rejects(db, "insert into roles (organization_id, key, name) values ($1, 'x', 'X')", [org], /row-level security/);
    });
  });
});

describe("login helpers", () => {
  it("picks the oldest active membership as the session's call centre", async () => {
    const first = await createOrg();
    const second = await createOrg();
    const user = await member(first, "seller");
    await owner.query(
      "insert into memberships (organization_id, user_id, role_id) select $1, $2, id from roles where organization_id = $1 and key = 'seller'",
      [second, user],
    );
    await as(auth, {}, async (db) => {
      const { rows } = await db.query("select app.default_organization_for($1) as org", [user]);
      expect(rows[0].org).toBe(first);
    });
  });

  it("accepts superadmin invitations without a call centre, invisible to call centres", async () => {
    const invited = await createUser("Ny Superadmin", "invited");
    await owner.query("insert into invitations (user_id, token_hash) values ($1, $2)", [invited, hash32()]);
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      const { rows } = await db.query("select count(*)::int as n from invitations where user_id = $1", [invited]);
      expect(rows[0].n).toBe(0);
    });
  });
});
