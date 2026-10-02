import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

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
