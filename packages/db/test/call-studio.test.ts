import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects, worker } from "./helpers.ts";

// A transcribed call by a seller, with one finished AI note.
async function setup() {
  const org = await createOrg();
  const product = (await owner.query("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [org])).rows[0].id;
  const seller = await member(org, "seller");
  const call = (
    await owner.query(
      `insert into calls (organization_id, user_id, source, transcription_mode)
       values ($1, $2, 'microphone', 'realtime') returning id`,
      [org, seller],
    )
  ).rows[0].id;
  // Recorded, then transcribed and checked by the worker.
  await owner.query("update calls set status = 'processing' where id = $1", [call]);
  const w = await worker.connect();
  try {
    await w.query("update calls set status = 'analyzed' where id = $1", [call]);
  } finally {
    w.release();
  }
  await owner.query("insert into transcripts (call_id, organization_id, text) values ($1, $2, 'Hei, jeg ringer om strøm')", [call, org]);
  const report = (
    await owner.query(
      `insert into reports (organization_id, call_id, template_name, content, model)
       values ($1, $2, 'Standardrapport', 'Kunden takket ja.', 'm') returning id`,
      [org, call],
    )
  ).rows[0].id;
  return { org, product, seller, call, report };
}

const REQUEST = `insert into reports (organization_id, call_id, template_name, requested_by, status)
  values ($1, $2, 'Kort notat', $3, 'pending') returning id`;

describe("call studio: notes", () => {
  it("lets the seller ask for more notes, five at a time, and the worker write them", async () => {
    const s = await setup();
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      for (let i = 0; i < 5; i++) await db.query(REQUEST, [s.org, s.call, s.seller]);
      await rejects(db, REQUEST, [s.org, s.call, s.seller], /already being written/);
      // The note templates chosen in the studio are kept on the call.
      await db.query("update calls set note_templates = array[gen_random_uuid()] where id = $1", [s.call]);
      // Not a finished note made up by the API.
      await rejects(
        db,
        `insert into reports (organization_id, call_id, template_name, requested_by, status) values ($1, $2, 'x', $3, 'done')`,
        [s.org, s.call, s.seller],
        /row-level security|violates check/,
      );
    });
    const id = (await owner.query(REQUEST, [s.org, s.call, s.seller])).rows[0].id as string;
    const w = await worker.connect();
    try {
      await w.query("update reports set content = 'Kort.', model = 'm', status = 'done' where id = $1", [id]);
    } finally {
      w.release();
    }
    const audit = await owner.query("select new_data from audit_log where table_name = 'reports' and record_id = $1", [id]);
    expect(audit.rows[0].new_data).toMatchObject({ call_id: s.call, template_name: "Kort notat", status: "pending" });
  });

  it("stops at ten notes per call", async () => {
    const s = await setup();
    for (let i = 0; i < 9; i++) {
      await owner.query("insert into reports (organization_id, call_id, template_name, content, model) values ($1, $2, 'x', 'y', 'm')", [
        s.org,
        s.call,
      ]);
    }
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await rejects(db, REQUEST, [s.org, s.call, s.seller], /too many notes/);
    });
  });

  it("keeps other sellers and calls without a transcript out", async () => {
    const s = await setup();
    const colleague = await member(s.org, "seller");
    await as(api, { userId: colleague, orgId: s.org }, async (db) => {
      await rejects(db, REQUEST, [s.org, s.call, colleague], /row-level security/);
    });
    await owner.query("delete from transcripts where call_id = $1", [s.call]);
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await rejects(db, REQUEST, [s.org, s.call, s.seller], /row-level security/);
    });
  });

  it("lets only the call's seller adjust a note, keeps the AI text, and audits without the text", async () => {
    const s = await setup();
    const leader = await member(s.org, "admin");
    const EDIT = `insert into report_edits (organization_id, report_id, call_id, content, edited_by) values ($1, $2, $3, $4, $5)`;
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await db.query(EDIT, [s.org, s.report, s.call, "Kunden takket ja til fastpris.", s.seller]);
      // The AI text and the transcript stay as they were.
      await rejects(db, "update reports set content = 'x' where id = $1", [s.report], /permission denied/);
      await rejects(db, "update transcripts set text = 'x' where call_id = $1", [s.call], /permission denied/);
      await rejects(db, "update report_edits set content = 'x' where report_id = $1", [s.report], /permission denied/);
      await rejects(db, "delete from report_edits where report_id = $1", [s.report], /permission denied/);
    });
    await owner.query(EDIT, [s.org, s.report, s.call, "Kunden takket ja til fastpris.", s.seller]);
    await as(api, { userId: leader, orgId: s.org }, async (db) => {
      await rejects(db, EDIT, [s.org, s.report, s.call, "Endret av leder", leader], /row-level security/);
      const { rows } = await db.query("select content from report_edits where report_id = $1", [s.report]);
      expect(rows).toEqual([{ content: "Kunden takket ja til fastpris." }]);
    });
    const audit = await owner.query("select new_data from audit_log where table_name = 'report_edits' and organization_id = $1", [s.org]);
    expect(audit.rows[0].new_data).toMatchObject({ call_id: s.call, report_id: s.report });
    expect(JSON.stringify(audit.rows[0].new_data)).not.toContain("fastpris");
    // Deleted with the call when it expires.
    await owner.query("delete from calls where id = $1", [s.call]);
    expect((await owner.query("select 1 from report_edits where call_id = $1", [s.call])).rowCount).toBe(0);
  });
});

describe("call studio: default product", () => {
  it("is each member's own", async () => {
    const s = await setup();
    const colleague = await member(s.org, "seller");
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await db.query(
        `insert into studio_preferences (organization_id, user_id, product_id) values ($1, $2, $3)
         on conflict (organization_id, user_id) do update set product_id = excluded.product_id`,
        [s.org, s.seller, s.product],
      );
      await rejects(
        db,
        "insert into studio_preferences (organization_id, user_id, product_id) values ($1, $2, $3)",
        [s.org, colleague, s.product],
        /row-level security/,
      );
    });
    await owner.query("insert into studio_preferences (organization_id, user_id, product_id) values ($1, $2, $3)", [s.org, s.seller, s.product]);
    await as(api, { userId: colleague, orgId: s.org }, async (db) => {
      expect((await db.query("select * from studio_preferences")).rowCount).toBe(0);
    });
    // Another call centre's product cannot be chosen.
    const other = await createOrg();
    const foreign = (await owner.query("insert into products (organization_id, name) values ($1, 'Annet') returning id", [other])).rows[0].id;
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select product_id from studio_preferences")).rows).toEqual([{ product_id: s.product }]);
      await rejects(db, "update studio_preferences set product_id = $1", [foreign], /foreign key/);
    });
  });
});
