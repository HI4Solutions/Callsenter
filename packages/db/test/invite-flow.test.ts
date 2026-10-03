import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, api, as, createOrg, createUser, hash32, member, roleId } from "./helpers.ts";

describe("admin invites a new user", () => {
  it("works under RLS when the API generates the user id itself", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const sellerRole = await roleId(org, "seller");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      // A new user is not yet visible to the admin (no membership), so the API sets the id
      // instead of reading it back with RETURNING.
      const newUser = randomUUID();
      await db.query("insert into users (id, full_name, phone, status) values ($1, 'Ny Selger', '+4791234567', 'invited')", [
        newUser,
      ]);
      await db.query("insert into memberships (organization_id, user_id, role_id) values ($1, $2, $3)", [
        org,
        newUser,
        sellerRole,
      ]);
      await db.query("insert into invitations (organization_id, user_id, token_hash, created_by) values ($1, $2, $3, $4)", [
        org,
        newUser,
        hash32(),
        admin,
      ]);
      const { rows } = await db.query("select full_name, status from users where id = $1", [newUser]);
      expect(rows).toEqual([{ full_name: "Ny Selger", status: "invited" }]);
    });
  });
});

describe("people in more than one call centre", () => {
  it("are changed only by their own call centre's admin when they belong to no other", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const admin = await member(org, "admin");
    const own = await member(org, "seller");
    const shared = await member(org, "seller");
    await addMember(other, shared, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      const changed = await db.query("update users set full_name = 'Nytt navn' where id = $1", [own]);
      expect(changed.rowCount).toBe(1);
      // The user row is global: another call centre's admin is not changed from here.
      const blocked = await db.query("update users set phone = '+4790000000' where id = $1", [shared]);
      expect(blocked.rowCount).toBe(0);
    });
  });

  it("can only be claimed by an invitation link before they have logged in anywhere else", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const admin = await member(org, "admin");
    const fresh = await createUser("Ny", "invited");
    await addMember(org, fresh, "seller");
    const elsewhere = await createUser("Annen", "invited");
    await addMember(org, elsewhere, "seller");
    await addMember(other, elsewhere, "seller");
    const active = await member(org, "seller");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      const check = async (id: string) => (await db.query("select app.invitation_claimable($1) as ok", [id])).rows[0].ok;
      expect(await check(fresh)).toBe(true);
      expect(await check(elsewhere)).toBe(false);
      expect(await check(active)).toBe(false);
    });
    const seller = await member(org, "seller");
    await as(api, { userId: seller, orgId: org }, async (db) => {
      // Without users.manage the answer is always no.
      expect((await db.query("select app.invitation_claimable($1) as ok", [fresh])).rows[0].ok).toBe(false);
    });
  });
});
