import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, member, owner, rejects, roleId } from "./helpers.ts";

// A user whose role has exactly the given permissions.
async function memberWith(orgId: string, permissions: string[]) {
  const { rows } = await owner.query<{ id: string }>(
    "insert into roles (organization_id, key, name) values ($1, $2, 'Egendefinert') returning id",
    [orgId, `custom_${Math.random().toString(36).slice(2, 8)}`],
  );
  const role = rows[0]!.id;
  for (const permission of permissions) {
    await owner.query(
      "insert into role_permissions (role_id, organization_id, permission) values ($1, $2, $3)",
      [role, orgId, permission],
    );
  }
  const userId = await createUser();
  await owner.query(
    "insert into memberships (organization_id, user_id, role_id) values ($1, $2, $3)",
    [orgId, userId, role],
  );
  return { userId, role };
}

describe("permissions", () => {
  it("lets a seller do nothing that needs users.manage or roles.manage", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    await as(api, { userId: seller, orgId: org }, async (db) => {
      await rejects(db, "insert into teams (organization_id, name) values ($1, 'X')", [org], /row-level security/);
      await rejects(db, "insert into roles (organization_id, key, name) values ($1, 'x', 'X')", [org], /row-level security/);
    });
  });

  it("reports the current user's permissions", async () => {
    const org = await createOrg();
    const leader = await member(org, "leader");
    await as(api, { userId: leader, orgId: org }, async (db) => {
      const { rows } = await db.query(
        "select app.has_permission('flags.review') as review, app.has_permission('audit.read') as audit",
      );
      expect(rows[0]).toEqual({ review: true, audit: false });
    });
  });

  it("refuses to grant a permission the granter does not hold", async () => {
    const org = await createOrg();
    const { userId } = await memberWith(org, ["roles.manage", "users.manage", "calls.read.own"]);
    await as(api, { userId, orgId: org }, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into roles (organization_id, key, name) values ($1, 'teamlead', 'Teamleder') returning id",
        [org],
      );
      const role = rows[0]!.id;
      await db.query(
        "insert into role_permissions (role_id, organization_id, permission) values ($1, $2, 'calls.read.own')",
        [role, org],
      );
      await expect(
        db.query(
          "insert into role_permissions (role_id, organization_id, permission) values ($1, $2, 'audit.read')",
          [role, org],
        ),
      ).rejects.toThrow(/cannot grant permission audit.read/);
    });
  });

  it("refuses to assign a role with permissions the assigner does not hold", async () => {
    const org = await createOrg();
    const { userId } = await memberWith(org, ["users.manage", "calls.read.own", "calls.audio.play", "calls.upload",
      "customers.read", "customers.manage", "sales.manage"]);
    const newcomer = await createUser("Ny Selger");
    const other = await createUser("Ny Compliance");
    await as(api, { userId, orgId: org }, async (db) => {
      // Seller's permissions are a subset of the assigner's.
      await db.query("insert into memberships (organization_id, user_id, role_id) values ($1, $2, $3)", [
        org,
        newcomer,
        await roleId(org, "seller"),
      ]);
      // Compliance includes audit.read, which the assigner lacks.
      await expect(
        db.query("insert into memberships (organization_id, user_id, role_id) values ($1, $2, $3)", [
          org,
          other,
          await roleId(org, "compliance"),
        ]),
      ).rejects.toThrow(/cannot assign a role with permission/);
    });
  });

  it("refuses to promote someone, including oneself, beyond one's own permissions", async () => {
    const org = await createOrg();
    const { userId } = await memberWith(org, ["users.manage"]);
    await as(api, { userId, orgId: org }, async (db) => {
      await expect(
        db.query("update memberships set role_id = $1 where user_id = $2 and organization_id = $3", [
          await roleId(org, "admin"),
          userId,
          org,
        ]),
      ).rejects.toThrow(/cannot assign a role with permission/);
    });
  });

  it("never moves a membership to another user or call centre", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const seller = await member(org, "seller");
    const outsider = await createUser("Utenforstående");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await expect(
        db.query("update memberships set user_id = $1 where user_id = $2", [outsider, seller]),
      ).rejects.toThrow(/cannot move/);
    });
  });

  it("keeps role, team and membership in the same call centre", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const user = await createUser();
    await expect(
      owner.query("insert into memberships (organization_id, user_id, role_id) values ($1, $2, $3)", [
        orgA,
        user,
        await roleId(orgB, "seller"),
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});
