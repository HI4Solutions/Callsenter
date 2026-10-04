import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

async function recording() {
  const org = await createOrg();
  const seller = await member(org, "seller");
  const call = (
    await owner.query(
      `insert into calls (organization_id, user_id, source, transcription_mode) values ($1, $2, 'microphone', 'chunked') returning id`,
      [org, seller],
    )
  ).rows[0].id as string;
  return { org, seller, call };
}

describe("discarding a call", () => {
  it("lets the recorder discard a call being recorded, which hides it at once and is audited", async () => {
    const s = await recording();
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      // Not with a plain update: the row would leave the seller's view in the same statement.
      await rejects(db, "update calls set status = 'discarded' where id = $1", [s.call], /row-level security/);
    });
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select app.discard_call($1) as ok", [s.call])).rows[0].ok).toBe(true);
      expect((await db.query("select id from calls where id = $1", [s.call])).rows).toEqual([]);
    });
  });

  it("refuses anyone but the recorder, and a call that is already finished", async () => {
    const s = await recording();
    const manager = await member(s.org, "admin");
    await as(api, { userId: manager, orgId: s.org }, async (db) => {
      expect((await db.query("select app.discard_call($1) as ok", [s.call])).rows[0].ok).toBe(false);
    });
    const other = await createOrg();
    const stranger = await member(other, "seller");
    await as(api, { userId: stranger, orgId: other }, async (db) => {
      expect((await db.query("select app.discard_call($1) as ok", [s.call])).rows[0].ok).toBe(false);
    });
    await owner.query("update calls set status = 'processing', chunk_count = 1 where id = $1", [s.call]);
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select app.discard_call($1) as ok", [s.call])).rows[0].ok).toBe(false);
    });
  });

  it("sets the call to expire now, so housekeeping deletes it, and logs the change", async () => {
    const s = await recording();
    const c = await owner.connect();
    try {
      await c.query("select set_config('app.current_user_id', $1, false)", [s.seller]);
      const { rows } = await c.query(
        "update calls set status = 'discarded' where id = $1 returning expires_at <= now() as expired, ended_at is not null as ended",
        [s.call],
      );
      expect(rows[0]).toEqual({ expired: true, ended: true });
    } finally {
      await c.query("select set_config('app.current_user_id', '', false)");
      c.release();
    }
    const audit = await owner.query(
      "select new_data ->> 'status' as status from audit_log where table_name = 'calls' and record_id = $1 and action = 'update'",
      [s.call],
    );
    expect(audit.rows.map((r) => r.status)).toContain("discarded");
  });
});
