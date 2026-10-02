import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { api, as, createOrg, hash32, member, roleId } from "./helpers.ts";

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
