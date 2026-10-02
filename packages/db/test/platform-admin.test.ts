import { createHash, randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invitePlatformAdmin } from "../src/admin.ts";
import { as, api, owner } from "./helpers.ts";

const phone = () => `+479${randomInt(1_000_000, 9_999_999)}`;

describe("invitePlatformAdmin", () => {
  it("creates an invited superadmin with an invitation outside every call centre", async () => {
    const client = await owner.connect();
    try {
      const number = phone();
      const invitation = await invitePlatformAdmin(client, { fullName: "Super Admin", phone: number });
      expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);

      const user = await client.query("select full_name, phone, status from users where id = $1", [invitation.userId]);
      expect(user.rows).toEqual([{ full_name: "Super Admin", phone: number, status: "invited" }]);
      const admin = await client.query("select revoked_at from platform_admins where user_id = $1", [invitation.userId]);
      expect(admin.rows).toEqual([{ revoked_at: null }]);
      // Only the hash is stored.
      const stored = await client.query("select organization_id, token_hash from invitations where user_id = $1", [
        invitation.userId,
      ]);
      expect(stored.rows).toEqual([
        { organization_id: null, token_hash: createHash("sha256").update(invitation.token).digest() },
      ]);

      // Running it again reuses the user and issues a fresh invitation.
      const again = await invitePlatformAdmin(client, { fullName: "Super Admin", phone: number });
      expect(again.userId).toBe(invitation.userId);
      expect(again.token).not.toBe(invitation.token);
    } finally {
      client.release();
    }
  });

  it("superadmin invitations are invisible to call centre users", async () => {
    const client = await owner.connect();
    let userId: string;
    try {
      ({ userId } = await invitePlatformAdmin(client, { fullName: "Skjult Admin", phone: phone() }));
    } finally {
      client.release();
    }
    await as(api, { userId }, async (db) => {
      const { rows } = await db.query("select 1 from invitations where user_id = $1", [userId]);
      expect(rows).toEqual([]);
    });
  });

  it("requires a name", async () => {
    const client = await owner.connect();
    try {
      await expect(invitePlatformAdmin(client, { fullName: " " })).rejects.toThrow(/fullName/);
    } finally {
      client.release();
    }
  });
});
