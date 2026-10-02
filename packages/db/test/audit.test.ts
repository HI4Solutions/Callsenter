import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, hash32, member, owner } from "./helpers.ts";

describe("audit log", () => {
  it("records who changed what, in which call centre", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await db.query("insert into teams (organization_id, name) values ($1, 'Kveldsskift')", [org]);
      const { rows } = await db.query(
        "select actor_user_id, organization_id, action, new_data ->> 'name' as name, as_platform_admin from audit_log where table_name = 'teams'",
      );
      expect(rows).toEqual([
        { actor_user_id: admin, organization_id: org, action: "insert", name: "Kveldsskift", as_platform_admin: false },
      ]);
    });
  });

  it("is append-only, even for the owner", async () => {
    await createOrg();
    await expect(owner.query("update audit_log set action = 'delete'")).rejects.toThrow(/append-only/);
    await expect(owner.query("delete from audit_log")).rejects.toThrow(/append-only/);
    await expect(owner.query("truncate audit_log")).rejects.toThrow(/append-only/);
  });

  it("cannot be written or changed by the API directly", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await expect(
        db.query("insert into audit_log (action, table_name) values ('insert', 'fake')"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("is readable only with audit.read, and only for the current call centre", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const compliance = await member(orgA, "compliance");
    const seller = await member(orgA, "seller");
    await as(api, { userId: compliance, orgId: orgA }, async (db) => {
      const { rows } = await db.query("select distinct organization_id from audit_log");
      expect(rows.map((r) => r.organization_id)).toEqual([orgA]);
    });
    await as(api, { userId: seller, orgId: orgA }, async (db) => {
      const { rows } = await db.query("select count(*)::int as n from audit_log");
      expect(rows[0].n).toBe(0);
    });
    void orgB;
  });

  it("never stores invitation tokens", async () => {
    const org = await createOrg();
    const user = await createUser("Invitert", "invited");
    await owner.query("insert into invitations (organization_id, user_id, token_hash) values ($1, $2, $3)", [
      org,
      user,
      hash32(),
    ]);
    const { rows } = await owner.query(
      "select new_data from audit_log where table_name = 'invitations' and organization_id = $1",
      [org],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_data).not.toHaveProperty("token_hash");
  });
});

describe("access log", () => {
  it("accepts only rows for the current user and call centre", async () => {
    const org = await createOrg();
    const leader = await member(org, "leader");
    const other = await member(org, "seller");
    await as(api, { userId: leader, orgId: org }, async (db) => {
      await db.query(
        "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'c1', 'play')",
        [org, leader],
      );
      await expect(
        db.query(
          "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'c1', 'play')",
          [org, other],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("is append-only", async () => {
    const org = await createOrg();
    const user = await member(org, "seller");
    await owner.query(
      "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'c1', 'view')",
      [org, user],
    );
    await expect(owner.query("update access_log set action = 'play'")).rejects.toThrow(/append-only/);
    await expect(owner.query("delete from access_log")).rejects.toThrow(/append-only/);
    await expect(owner.query("truncate access_log")).rejects.toThrow(/append-only/);
  });
});
