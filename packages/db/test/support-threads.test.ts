import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

async function thread(orgId: string, createdBy: string) {
  const { rows } = await owner.query<{ id: string }>(
    "insert into support_threads (organization_id, subject, created_by) values ($1, 'Hjelp', $2) returning id",
    [orgId, createdBy],
  );
  return rows[0]!.id;
}

describe("support threads", () => {
  it("are visible to the call centre's admins and to superadmins, not to sellers or other call centres", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const admin = await member(org, "admin");
    const seller = await member(org, "seller");
    const otherAdmin = await member(other, "admin");
    const id = await thread(org, admin);
    const superadmin = await createUser();
    await makePlatformAdmin(superadmin);

    const count = (ctx: { userId: string; orgId?: string }) =>
      as(api, ctx, async (db) => (await db.query("select id from support_threads where id = $1", [id])).rowCount);
    expect(await count({ userId: admin, orgId: org })).toBe(1);
    expect(await count({ userId: superadmin })).toBe(1);
    expect(await count({ userId: seller, orgId: org })).toBe(0);
    expect(await count({ userId: otherAdmin, orgId: other })).toBe(0);
  });

  it("marks messages from superadmins as from VeriQall, and only then", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const id = await thread(org, admin);
    const insert = "insert into support_messages (thread_id, organization_id, author_user_id, from_platform, body) values ($1, $2, $3, $4, 'Hei')";
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await db.query(insert, [id, org, admin, false]);
      await expect(db.query(insert, [id, org, admin, true])).rejects.toThrow(/row-level security/);
    });
    const superadmin = await createUser();
    await makePlatformAdmin(superadmin);
    await as(api, { userId: superadmin }, async (db) => {
      await db.query(insert, [id, org, superadmin, true]);
      await expect(db.query(insert, [id, org, admin, true])).rejects.toThrow(/row-level security/);
    });
  });
});
