import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { api, as, auth, createUser, makePlatformAdmin } from "./helpers.ts";

const insert = "insert into passkeys (user_id, credential_id, public_key, name) values ($1, $2, '\\x01', 'Test')";
const credential = () => randomBytes(24).toString("base64url");

describe("passkeys", () => {
  it("are added by the user themself, only in a strong (BankID) session", async () => {
    const user = await createUser();
    const other = await createUser();
    await as(api, { userId: user, strong: false }, async (db) => {
      await expect(db.query(insert, [user, credential()])).rejects.toThrow(/row-level security/);
    });
    await as(api, { userId: user }, async (db) => {
      await expect(db.query(insert, [other, credential()])).rejects.toThrow(/row-level security/);
    });
    await as(api, { userId: user }, async (db) => {
      await db.query(insert, [user, credential()]);
      expect((await db.query("select count(*)::int as n from passkeys where user_id = $1", [user])).rows[0].n).toBe(1);
    });
  });

  it("are visible to their owner and superadmins, and readable by the login role", async () => {
    const user = await createUser();
    const id = credential();
    const client = await api.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_user_id', $1, true), set_config('app.session_strong', 'on', true)", [user]);
      await client.query(insert, [user, id]);
      await client.query("commit");
    } finally {
      client.release();
    }
    const stranger = await createUser();
    await as(api, { userId: stranger }, async (db) => {
      expect((await db.query("select * from passkeys where credential_id = $1", [id])).rows).toEqual([]);
    });
    const superadmin = await createUser();
    await makePlatformAdmin(superadmin);
    await as(api, { userId: superadmin }, async (db) => {
      expect((await db.query("select user_id from passkeys where credential_id = $1", [id])).rows).toEqual([{ user_id: user }]);
    });
    expect((await auth.query("select user_id from passkeys where credential_id = $1", [id])).rows).toEqual([{ user_id: user }]);
    await expect(auth.query("update passkeys set user_id = $2 where credential_id = $1", [id, stranger])).rejects.toThrow(
      /permission denied/,
    );
  });
});
