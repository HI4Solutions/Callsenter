import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects, worker } from "./helpers.ts";

// A call centre with a seller's call (with a transcript) and a case handler.
async function setup() {
  const org = await createOrg();
  const seller = await member(org, "seller");
  const compliance = await member(org, "compliance");
  const customer = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Kari') returning id", [org]))
    .rows[0].id;
  const call = await newCall(org, seller);
  await owner.query("insert into transcripts (call_id, organization_id, text) values ($1, $2, 'Det er helt gratis.')", [call.id, org]);
  return { org, seller, compliance, customer, call };
}

async function newCall(org: string, userId: string, customerId: string | null = null) {
  const { rows } = await owner.query<{ id: string; reference: string }>(
    `insert into calls (organization_id, user_id, source, transcription_mode, customer_id)
     values ($1, $2, 'tab', 'realtime', $3) returning id, reference`,
    [org, userId, customerId],
  );
  return rows[0]!;
}

const COMPLAINT = "insert into complaints (organization_id, call_id, summary, description) values ($1, $2, 'Lovet gratis', 'Selgeren sa det var gratis.') returning id";
const ASK = `insert into complaint_ai (organization_id, complaint_id, call_id, kind, complaint_text, locale, requested_by)
  values ($1, $2, $3, $4, 'Selgeren sa det var gratis.', 'nb', $5) returning id`;

describe("complaints about a call", () => {
  it("need no customer, can be given one later but never another, and keep the call's reference", async () => {
    const s = await setup();
    const complaint = await as(api, { userId: s.compliance, orgId: s.org }, async (db) => {
      const id = (await db.query(COMPLAINT, [s.org, s.call.id])).rows[0].id;
      expect((await db.query("select customer_id, call_reference from complaints where id = $1", [id])).rows[0]).toEqual({
        customer_id: null,
        call_reference: s.call.reference,
      });
      await db.query("update complaints set customer_id = $2 where id = $1", [id, s.customer]);
      const other = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Ola') returning id", [s.org]))
        .rows[0].id;
      await rejects(db, "update complaints set customer_id = $2 where id = $1", [id, other], /keeps its customer/);
      return id;
    });
    // as() rolls back; the same complaint, kept, for the deletion below.
    expect(complaint).toBeTruthy();
    const kept = (await owner.query("insert into complaints (organization_id, call_id, summary) values ($1, $2, 'Lovet gratis') returning id", [s.org, s.call.id]))
      .rows[0].id;
    await owner.query("delete from calls where id = $1", [s.call.id]);
    expect((await owner.query("select call_id, call_reference from complaints where id = $1", [kept])).rows[0]).toEqual({
      call_id: null,
      call_reference: s.call.reference,
    });
  });

  it("take the customer of the call they are about", async () => {
    const s = await setup();
    const call = await newCall(s.org, s.seller, s.customer);
    await as(api, { userId: s.compliance, orgId: s.org }, async (db) => {
      const id = (await db.query(COMPLAINT, [s.org, call.id])).rows[0].id;
      expect((await db.query("select customer_id from complaints where id = $1", [id])).rows[0].customer_id).toBe(s.customer);
    });
  });
});

describe("AI work on complaints", () => {
  it("is asked for by case handlers on the complaint's call, written by the worker and adjusted by the handler", async () => {
    const s = await setup();
    const complaint = (await owner.query("insert into complaints (organization_id, call_id, summary) values ($1, $2, 'Lovet gratis') returning id", [s.org, s.call.id]))
      .rows[0].id;
    const other = await newCall(s.org, s.seller);
    const [assessment, reply] = await as(api, { userId: s.compliance, orgId: s.org }, async (db) => {
      // Only on the call the complaint is about, and only when it has a transcript.
      await rejects(db, ASK, [s.org, complaint, other.id, "assessment", s.compliance], /row-level security/);
      const ids = [
        (await db.query(ASK, [s.org, complaint, s.call.id, "assessment", s.compliance])).rows[0].id,
        (await db.query(ASK, [s.org, complaint, s.call.id, "reply", s.compliance])).rows[0].id,
      ];
      await db.query("commit");
      return ids;
    });

    // The worker writes them; the case handler cannot.
    await as(api, { userId: s.compliance, orgId: s.org }, async (db) => {
      await rejects(db, "update complaint_ai set status = 'done' where id = $1", [assessment], /permission denied/);
    });
    await worker.query(
      "update complaint_ai set status = 'done', model = 'm', result = '{\"verdict\": \"justified\"}' where id = $1",
      [assessment],
    );
    await worker.query("update complaint_ai set status = 'done', model = 'm', ai_content = 'Hei [Navn],' where id = $1", [reply]);

    // A finished reply can be adjusted; an assessment cannot.
    await as(api, { userId: s.compliance, orgId: s.org }, async (db) => {
      const edit = "update complaint_ai set content = 'Hei Kari,', edited_by = $2, edited_at = now() where id = $1";
      expect((await db.query(edit, [reply, s.compliance])).rowCount).toBe(1);
      expect((await db.query(edit, [assessment, s.compliance])).rowCount).toBe(0);
    });

    // The audit log records who asked for what, never the text.
    const logged = await owner.query("select new_data from audit_log where table_name = 'complaint_ai' and record_id = $1", [reply]);
    expect(logged.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged.rows)).not.toContain("gratis");
    expect(JSON.stringify(logged.rows)).not.toContain("Hei");
  });

  it("is seen only by case handlers who see the call, and is deleted with the call", async () => {
    const s = await setup();
    const complaint = (await owner.query("insert into complaints (organization_id, call_id, summary) values ($1, $2, 'Lovet gratis') returning id", [s.org, s.call.id]))
      .rows[0].id;
    const id = (await owner.query(ASK, [s.org, complaint, s.call.id, "assessment", s.compliance])).rows[0].id;
    const seen = (ctx: { userId: string; orgId: string; strong?: boolean }) =>
      as(api, ctx, async (db) => (await db.query("select id from complaint_ai")).rows.map((r) => r.id));
    expect(await seen({ userId: s.compliance, orgId: s.org })).toEqual([id]);
    // Another seller's call needs calls.read.all, which needs BankID or a passkey.
    expect(await seen({ userId: s.compliance, orgId: s.org, strong: false })).toEqual([]);
    expect(await seen({ userId: s.seller, orgId: s.org })).toEqual([]);
    const stranger = await member(await createOrg(), "admin");
    expect(await seen({ userId: stranger, orgId: s.org })).toEqual([]);

    await owner.query("delete from calls where id = $1", [s.call.id]);
    expect((await owner.query("select 1 from complaint_ai where id = $1", [id])).rowCount).toBe(0);
  });

  it("is limited to three at a time per complaint", async () => {
    const s = await setup();
    const complaint = (await owner.query("insert into complaints (organization_id, call_id, summary) values ($1, $2, 'Lovet gratis') returning id", [s.org, s.call.id]))
      .rows[0].id;
    for (let i = 0; i < 3; i++) await owner.query(ASK, [s.org, complaint, s.call.id, "assessment", s.compliance]);
    await expect(owner.query(ASK, [s.org, complaint, s.call.id, "assessment", s.compliance])).rejects.toThrow(/already being done/);
  });

  it("is counted as usage", async () => {
    const s = await setup();
    await worker.query(
      "insert into usage_events (organization_id, call_id, kind, input_tokens, output_tokens, model) values ($1, $2, 'complaint', 10, 5, 'm')",
      [s.org, s.call.id],
    );
    expect((await owner.query("select kind from usage_events where call_id = $1", [s.call.id])).rows).toEqual([{ kind: "complaint" }]);
  });
});
