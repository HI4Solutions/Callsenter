import { describe, expect, it } from "vitest";
import { api, as, auth, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

describe("organization overview", () => {
  it("counts members for superadmins only, and only in BankID sessions", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const superadmin = await createUser("Super");
    await makePlatformAdmin(superadmin);
    const overview = (ctx: { userId: string; orgId?: string; strong?: boolean }) =>
      as(api, ctx, async (db) => {
        const { rows } = await db.query("select active_members from app.organization_overview() where organization_id = $1", [org]);
        return rows;
      });

    expect(await overview({ userId: superadmin })).toEqual([{ active_members: 1 }]);
    expect(await overview({ userId: superadmin, strong: false })).toEqual([]);
    expect(await overview({ userId: admin, orgId: org })).toEqual([]);
  });
});

describe("trial periods", () => {
  it("closes a call centre for members after the trial, and opens it again when extended", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    const current = () =>
      as(api, { userId: seller, orgId: org }, async (db) => (await db.query("select app.current_org_id() as id")).rows[0].id);
    const defaultOrg = async () =>
      (await owner.query("select app.default_organization_for($1) as id", [seller])).rows[0].id;

    expect(await current()).toBe(org);
    await owner.query("update organizations set trial_ends_at = now() - interval '1 day' where id = $1", [org]);
    expect(await current()).toBeNull();
    expect(await defaultOrg()).toBeNull();
    await owner.query("update organizations set trial_ends_at = now() + interval '30 days' where id = $1", [org]);
    expect(await current()).toBe(org);
    expect(await defaultOrg()).toBe(org);
  });

  it("validates contact details", async () => {
    const org = await createOrg();
    await expect(owner.query("update organizations set contact_email = 'nope' where id = $1", [org])).rejects.toThrow();
    await expect(owner.query("update organizations set contact_phone = '12345' where id = $1", [org])).rejects.toThrow();
  });
});

describe("blocked IP addresses", () => {
  it("are managed by superadmins, readable by the login role, and audited", async () => {
    const superadmin = await createUser("Blokk");
    await makePlatformAdmin(superadmin);
    const network = `203.0.113.${Math.floor(Math.random() * 250)}/32`;
    await as(api, { userId: superadmin }, async (db) => {
      await db.query("insert into blocked_ips (network, reason, created_by) values ($1, 'test', $2)", [network, superadmin]);
      await expect(db.query("insert into blocked_ips (network) values ($1)", [network])).rejects.toThrow(/duplicate/);
    });
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      expect((await db.query("select * from blocked_ips")).rows).toEqual([]);
      await expect(db.query("insert into blocked_ips (network) values ('198.51.100.0/24')")).rejects.toThrow(/row-level security/);
    });
    // Committed by a superadmin, then visible to the login role and in the audit log.
    const client = await api.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_user_id', $1, true), set_config('app.session_strong', 'on', true)", [
        superadmin,
      ]);
      await client.query("insert into blocked_ips (network, created_by) values ($1, $2)", [network, superadmin]);
      await client.query("commit");
    } finally {
      client.release();
    }
    const seen = await auth.query("select count(*)::int as n from blocked_ips where network = $1", [network]);
    expect(seen.rows[0].n).toBe(1);
    const audit = await owner.query(
      "select action from audit_log where table_name = 'blocked_ips' and new_data ->> 'network' = $1",
      [network],
    );
    expect(audit.rows).toEqual([{ action: "insert" }]);
    await owner.query("delete from blocked_ips where network = $1", [network]);
  });

  it("let superadmins read the access log of every call centre", async () => {
    const org = await createOrg();
    const reader = await member(org, "compliance");
    await owner.query(
      "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'x', 'view')",
      [org, reader],
    );
    const superadmin = await createUser("Leser");
    await makePlatformAdmin(superadmin);
    const rows = await as(api, { userId: superadmin }, async (db) =>
      (await db.query("select resource_id from access_log where organization_id = $1", [org])).rows,
    );
    expect(rows).toEqual([{ resource_id: "x" }]);
  });
});
