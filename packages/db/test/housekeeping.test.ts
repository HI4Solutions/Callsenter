import { describe, expect, it } from "vitest";
import { hash32, owner, worker } from "./helpers.ts";

describe("housekeeping of login data", () => {
  it("lets the worker remove login states and passkey challenges older than an hour", async () => {
    const insertState = (age: string) =>
      owner.query(
        `insert into auth_states (state_hash, provider, nonce, code_verifier, created_at)
         values ($1, 'vipps', 'n', 'v', now() - $2::interval) returning id`,
        [hash32(), age],
      );
    const insertChallenge = (age: string) =>
      owner.query(
        "insert into webauthn_challenges (challenge, purpose, created_at) values ('c', 'login', now() - $1::interval) returning id",
        [age],
      );
    const oldState = (await insertState("2 hours")).rows[0].id;
    const newState = (await insertState("5 minutes")).rows[0].id;
    const oldChallenge = (await insertChallenge("2 hours")).rows[0].id;
    const newChallenge = (await insertChallenge("1 minute")).rows[0].id;

    const w = await worker.connect();
    try {
      await w.query("select app.purge_login_states()");
    } finally {
      w.release();
    }
    const states = await owner.query("select id from auth_states where id = any($1)", [[oldState, newState]]);
    expect(states.rows.map((r) => r.id)).toEqual([newState]);
    const challenges = await owner.query("select id from webauthn_challenges where id = any($1)", [[oldChallenge, newChallenge]]);
    expect(challenges.rows.map((r) => r.id)).toEqual([newChallenge]);
  });
});
