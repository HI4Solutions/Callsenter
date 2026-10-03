import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects, worker } from "./helpers.ts";

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

const PIECE = "insert into call_pieces (call_id, organization_id, seq, start_ms) values ($1, $2, $3, $4)";

describe("call pieces", () => {
  it("lets the recorder add and finish pieces while recording, and the worker transcribe them", async () => {
    const s = await recording();
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await db.query(PIECE, [s.call, s.org, 0, 0]);
      await db.query("update call_pieces set status = 'pending' where call_id = $1 and seq = 0", [s.call]);
      // Not the text: only the worker writes it.
      await rejects(db, "update call_pieces set segments = '[]' where call_id = $1", [s.call], /permission denied/);
      await rejects(
        db,
        "insert into call_pieces (call_id, organization_id, seq, start_ms, status) values ($1, $2, 1, 15000, 'done')",
        [s.call, s.org],
        /row-level security/,
      );
    });
    await owner.query(PIECE, [s.call, s.org, 0, 0]);
    await owner.query("update call_pieces set status = 'pending' where call_id = $1", [s.call]);
    const w = await worker.connect();
    try {
      await w.query(
        `update call_pieces set status = 'done', segments = '[{"speaker":"1","startMs":0,"endMs":900,"text":"Hei"}]' where call_id = $1`,
        [s.call],
      );
    } finally {
      w.release();
    }
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select status from call_pieces where call_id = $1", [s.call])).rows).toEqual([{ status: "done" }]);
    });
  });

  it("keeps colleagues out, and stops new pieces once the recording is finished", async () => {
    const s = await recording();
    const colleague = await member(s.org, "seller");
    await as(api, { userId: colleague, orgId: s.org }, async (db) => {
      await rejects(db, PIECE, [s.call, s.org, 0, 0], /row-level security/);
    });
    await owner.query("update calls set status = 'processing' where id = $1", [s.call]);
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await rejects(db, PIECE, [s.call, s.org, 1, 15000], /row-level security/);
    });
  });

  it("makes transcription in pieces the default", async () => {
    const { rows } = await owner.query("select value from platform_settings where key = 'transcription_mode'");
    expect(rows[0].value).toBe("chunked");
  });
});
