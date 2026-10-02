import { describe, expect, it } from "vitest";
import { addMember, api, as, count, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

describe("call centre isolation", () => {
  it("shows a member only their own call centre", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const sellerA = await member(orgA, "seller");
    const userB = await member(orgB, "seller");
    await owner.query("insert into teams (organization_id, name) values ($1, 'A'), ($2, 'B')", [orgA, orgB]);

    await as(api, { userId: sellerA, orgId: orgA }, async (db) => {
      const teams = await db.query("select organization_id from teams");
      expect(teams.rows.map((r) => r.organization_id)).toEqual([orgA]);
      const roles = await db.query("select distinct organization_id from roles");
      expect(roles.rows.map((r) => r.organization_id)).toEqual([orgA]);
      const orgs = await db.query("select id from organizations");
      expect(orgs.rows.map((r) => r.id)).toEqual([orgA]);
      const users = await db.query("select id from users where id = $1", [userB]);
      expect(users.rowCount).toBe(0);
    });
  });

  it("shows nothing when the request points at a call centre the user is not in", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const sellerA = await member(orgA, "seller");
    await owner.query("insert into teams (organization_id, name) values ($1, 'B')", [orgB]);

    await as(api, { userId: sellerA, orgId: orgB }, async (db) => {
      const { rows } = await db.query("select app.current_org_id() as org");
      expect(rows[0].org).toBeNull();
      expect(await count(db, "teams")).toBe(0);
      expect(await count(db, "roles")).toBe(0);
    });
  });

  it("shows nothing without a user and call centre", async () => {
    const orgA = await createOrg();
    await member(orgA, "admin");
    await as(api, {}, async (db) => {
      for (const table of ["organizations", "users", "teams", "roles", "role_permissions", "memberships"]) {
        expect(await count(db, table), table).toBe(0);
      }
    });
  });

  it("locks out disabled members, disabled users and suspended call centres", async () => {
    const org = await createOrg();
    const disabledMember = await createUser();
    await addMember(org, disabledMember, "admin", "disabled");
    const disabledUser = await createUser("Avsluttet Bruker", "disabled");
    await addMember(org, disabledUser, "admin");
    for (const userId of [disabledMember, disabledUser]) {
      await as(api, { userId, orgId: org }, async (db) => {
        expect(await count(db, "roles")).toBe(0);
      });
    }

    const suspended = await createOrg();
    const admin = await member(suspended, "admin");
    await owner.query("update organizations set status = 'suspended' where id = $1", [suspended]);
    await as(api, { userId: admin, orgId: suspended }, async (db) => {
      expect(await count(db, "roles")).toBe(0);
    });
  });

  it("refuses writes into another call centre", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const adminA = await member(orgA, "admin");
    await as(api, { userId: adminA, orgId: orgA }, async (db) => {
      await expect(
        db.query("insert into teams (organization_id, name) values ($1, 'Inntrenger')", [orgB]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("lets a superadmin see every call centre and act in one they are not a member of", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const superadmin = await createUser("Superadmin");
    await makePlatformAdmin(superadmin);

    await as(api, { userId: superadmin, orgId: orgB }, async (db) => {
      const { rows } = await db.query("select id from organizations where id in ($1, $2)", [orgA, orgB]);
      expect(rows).toHaveLength(2);
      await db.query("insert into teams (organization_id, name) values ($1, 'Fra superadmin')", [orgB]);
      const audit = await db.query(
        "select as_platform_admin, actor_user_id from audit_log where table_name = 'teams' and organization_id = $1",
        [orgB],
      );
      expect(audit.rows).toEqual([{ as_platform_admin: true, actor_user_id: superadmin }]);
    });
  });

  it("only lets superadmins create call centres", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await expect(db.query("insert into organizations (name) values ('Ny')")).rejects.toThrow(
        /row-level security/,
      );
    });

    const superadmin = await createUser("Superadmin");
    await makePlatformAdmin(superadmin);
    await as(api, { userId: superadmin }, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into organizations (name) values ('Nytt callsenter') returning id",
      );
      const roles = await db.query(
        "select count(*)::int as n from roles where organization_id = $1",
        [rows[0]!.id],
      );
      // Default roles are seeded, but the superadmin sees them only once acting in that call centre.
      expect(roles.rows[0].n).toBe(0);
      await db.query("select set_config('app.current_org_id', $1, true)", [rows[0]!.id]);
      const seeded = await db.query(
        "select count(*)::int as n from roles where organization_id = $1",
        [rows[0]!.id],
      );
      expect(seeded.rows[0].n).toBe(4);
    });
  });
});
