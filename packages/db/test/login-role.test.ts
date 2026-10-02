import { describe, expect, it } from "vitest";
import { api, as, auth, createOrg, createUser, hash32, member, rejects } from "./helpers.ts";

describe("login role (app_auth)", () => {
  it("can run a login: state, identity, session and login event", async () => {
    const user = await createUser("Vipps Bruker");
    await as(auth, {}, async (db) => {
      await db.query(
        "insert into auth_states (state_hash, provider, nonce, code_verifier, return_to) values ($1, 'vipps', 'n', 'v', '/samtaler')",
        [hash32()],
      );
      const found = await db.query("select id from users where id = $1", [user]);
      expect(found.rowCount).toBe(1);
      await db.query("insert into identities (user_id, provider, subject) values ($1, 'vipps', 'sub-123')", [user]);
      await db.query(
        "insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, 'vipps', now() + interval '12 hours')",
        [hash32(), user],
      );
      await db.query("insert into login_events (provider, result, user_id) values ('vipps', 'success', $1)", [user]);
      await db.query("update users set last_login_at = now(), status = 'active' where id = $1", [user]);
    });
  });

  it("cannot read or change call centre data", async () => {
    await as(auth, {}, async (db) => {
      for (const table of ["teams", "roles", "memberships", "organizations", "audit_log", "access_log", "login_events"]) {
        await rejects(db, `select * from ${table} limit 1`, [], /permission denied/);
      }
      await rejects(db, "update users set full_name = 'X'", [], /permission denied/);
    });
  });

  it("accepts only relative return paths", async () => {
    await as(auth, {}, async (db) => {
      const insert = (returnTo: string) =>
        db.query(
          "insert into auth_states (state_hash, provider, nonce, code_verifier, return_to) values ($1, 'bankid', 'n', 'v', $2)",
          [hash32(), returnTo],
        );
      await insert("/");
      await insert("/samtaler?side=2");
      for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "samtaler"]) {
        await rejects(
          db,
          "insert into auth_states (state_hash, provider, nonce, code_verifier, return_to) values ($1, 'bankid', 'n', 'v', $2)",
          [hash32(), bad],
          /check constraint/,
        );
      }
    });
  });
});

describe("API role (app_user) and login tables", () => {
  it("cannot touch login state, identities or sessions", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      for (const table of ["auth_states", "identities", "sessions"]) {
        await rejects(db, `select * from ${table} limit 1`, [], /permission denied/);
      }
    });
  });
});
