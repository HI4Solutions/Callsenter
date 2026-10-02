import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner } from "./helpers.ts";

describe("finding a user to invite", () => {
  it("finds a user from another call centre, but only for someone with users.manage", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const elsewhere = await member(orgA, "seller");
    const phone = `+479${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    await owner.query("update users set phone = $2 where id = $1", [elsewhere, phone]);

    const adminB = await member(orgB, "admin");
    await as(api, { userId: adminB, orgId: orgB }, async (db) => {
      const { rows } = await db.query("select app.user_id_for_invitation($1, null) as id", [phone]);
      expect(rows[0].id).toBe(elsewhere);
    });
    const sellerB = await member(orgB, "seller");
    await as(api, { userId: sellerB, orgId: orgB }, async (db) => {
      const { rows } = await db.query("select app.user_id_for_invitation($1, null) as id", [phone]);
      expect(rows[0].id).toBeNull();
    });
    // users.manage needs a strong session.
    await as(api, { userId: adminB, orgId: orgB, strong: false }, async (db) => {
      const { rows } = await db.query("select app.user_id_for_invitation($1, null) as id", [phone]);
      expect(rows[0].id).toBeNull();
    });
  });
});
