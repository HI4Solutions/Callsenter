import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects, worker } from "./helpers.ts";

// A call centre with a published product, a customer and a team.
async function setup() {
  const org = await createOrg();
  const product = (await owner.query("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [org])).rows[0].id;
  const version = (
    await owner.query(
      `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly)
       values ($1, $2, 1, 'published', now(), 399) returning id`,
      [org, product],
    )
  ).rows[0].id;
  const customer = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Kari') returning id", [org]))
    .rows[0].id;
  const team = (await owner.query("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0].id;
  return { org, product, version, customer, team };
}

async function call(org: string, userId: string, extra: Record<string, string> = {}) {
  const columns = ["organization_id", "user_id", "source", "transcription_mode", ...Object.keys(extra)];
  const values = [org, userId, "microphone", "realtime", ...Object.values(extra)];
  const { rows } = await owner.query<{ id: string }>(
    `insert into calls (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values,
  );
  return rows[0]!.id;
}

const INSERT = `insert into calls (organization_id, user_id, source, transcription_mode, product_id)
  values ($1, $2, 'tab', 'realtime', $3) returning id, status, template_version_id, team_id, expires_at`;

describe("calls: recording", () => {
  it("sets the template version, team and expiry from the call centre's retention", async () => {
    const s = await setup();
    await owner.query("update organizations set recording_retention_months = 3 where id = $1", [s.org]);
    const seller = await member(s.org, "seller");
    await owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = $2", [s.org, seller, s.team]);
    await as(api, { userId: seller, orgId: s.org, strong: false }, async (db) => {
      const { rows } = await db.query(INSERT, [s.org, seller, s.product]);
      expect(rows[0]).toMatchObject({ status: "recording", template_version_id: s.version, team_id: s.team });
      const months = (new Date(rows[0].expires_at).getTime() - Date.now()) / (30.4 * 24 * 3600 * 1000);
      expect(Math.round(months)).toBe(3);
    });
  });

  it("only lets members with calls.upload record, and only as themselves", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const colleague = await member(s.org, "seller");
    const compliance = await member(s.org, "compliance");
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, colleague, s.product], /row-level security/);
    });
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, compliance, s.product], /row-level security/);
    });
  });

  it("takes customer, product and version from a linked sale", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const sale = (
      await owner.query(
        "insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id",
        [s.org, s.customer, s.product, seller],
      )
    ).rows[0].id;
    const id = await call(s.org, seller);
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await db.query("update calls set sale_id = $2 where id = $1", [id, sale]);
      const { rows } = await db.query("select customer_id, product_id, template_version_id from calls where id = $1", [id]);
      expect(rows[0]).toEqual({ customer_id: s.customer, product_id: s.product, template_version_id: s.version });
    });
  });
});

describe("calls: status and visibility", () => {
  it("lets the API only finish a recording or retry a failed call; the worker does the rest", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const id = await call(s.org, seller);
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(db, "update calls set status = 'analyzed' where id = $1", [id], /cannot go from recording to analyzed/);
      await db.query("update calls set status = 'processing' where id = $1", [id]);
      const { rows } = await db.query("select processing_started_at, ended_at from calls where id = $1", [id]);
      expect(rows[0].processing_started_at).not.toBeNull();
      expect(rows[0].ended_at).not.toBeNull();
      // Columns the API has no grant for.
      await rejects(db, "update calls set audio_key = 'x' where id = $1", [id], /permission denied/);
      await rejects(db, "update calls set expires_at = now() + interval '10 years' where id = $1", [id], /permission denied/);
    });
    await owner.query("update calls set status = 'processing' where id = $1", [id]);
    const w = await worker.connect();
    try {
      await w.query("update calls set status = 'transcribed', audio_key = 'k' where id = $1", [id]);
      await w.query(
        "insert into transcripts (call_id, organization_id, text) values ($1, $2, 'Hei, jeg ringer fra Strøm AS om fastpris')",
        [id, s.org],
      );
      await w.query("delete from transcripts where call_id = $1", [id]);
    } finally {
      w.release();
    }
  });

  it("shows calls like sales, hides them after they expire, and keeps call centres apart", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const other = await member(s.org, "seller");
    const compliance = await member(s.org, "compliance");
    const mine = await call(s.org, seller);
    const theirs = await call(s.org, other);
    const expired = await call(s.org, seller);
    await owner.query("update calls set expires_at = now() - interval '1 minute' where id = $1", [expired]);
    for (const id of [mine, theirs]) {
      await owner.query("insert into transcripts (call_id, organization_id, text) values ($1, $2, 'angrerett i fjorten dager')", [id, s.org]);
    }

    const visible = (userId: string, orgId = s.org) =>
      as(api, { userId, orgId }, async (db) => ({
        calls: (await db.query("select id from calls order by id")).rows.map((r) => r.id),
        transcripts: (await db.query("select call_id from transcripts order by call_id")).rows.map((r) => r.call_id),
        // Norwegian full-text search finds the inflected form.
        found: (await db.query("select call_id from transcripts where search @@ websearch_to_tsquery('norwegian', 'angreretten')")).rowCount,
      }));
    expect(await visible(seller)).toEqual({ calls: [mine], transcripts: [mine], found: 1 });
    expect((await visible(compliance)).calls.sort()).toEqual([mine, theirs].sort());

    const otherOrg = await setup();
    const stranger = await member(otherOrg.org, "admin");
    expect(await visible(stranger, otherOrg.org)).toEqual({ calls: [], transcripts: [], found: 0 });
  });

  it("lets flags.review mark an analysis as reviewed, and nothing else", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const leader = await member(s.org, "leader");
    await owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = any($2)", [s.org, [seller, leader], s.team]);
    const id = await call(s.org, seller);
    const analysis = (
      await owner.query(
        "insert into call_analyses (organization_id, call_id, template_version_id, model, flag) values ($1, $2, $3, 'm', 'red') returning id",
        [s.org, id, s.version],
      )
    ).rows[0].id;
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      const { rowCount } = await db.query("update call_analyses set reviewed_at = now() where id = $1", [analysis]);
      expect(rowCount).toBe(0);
    });
    await as(api, { userId: leader, orgId: s.org }, async (db) => {
      await db.query("update call_analyses set reviewed_at = now(), reviewed_by = $2, review_note = 'Snakket med selger' where id = $1", [
        analysis,
        leader,
      ]);
      await rejects(db, "update call_analyses set flag = 'green' where id = $1", [analysis], /permission denied/);
      const audit = await owner.query("select new_data from audit_log where table_name = 'call_analyses' and record_id = $1 order by id", [analysis]);
      expect(audit.rows.at(-1)?.new_data).toMatchObject({ flag: "red" });
    });
  });
});

describe("settings, report templates and usage", () => {
  it("lets only superadmins change platform settings and retention", async () => {
    const s = await setup();
    const admin = await member(s.org, "admin");
    await as(api, { userId: admin, orgId: s.org }, async (db) => {
      expect((await db.query("select value from platform_settings where key = 'transcription_mode'")).rows[0].value).toBe("chunked");
      expect((await db.query("update platform_settings set value = '\"realtime\"' where key = 'transcription_mode'")).rowCount).toBe(0);
      expect((await db.query("update organizations set recording_retention_months = 6 where id = $1", [s.org])).rowCount).toBe(0);
    });
    await expect(owner.query("update organizations set recording_retention_months = 24 where id = $1", [s.org])).rejects.toThrow(/check/);
  });

  it("keeps report templates per call centre with one default, written with report_templates.manage", async () => {
    const s = await setup();
    const admin = await member(s.org, "admin");
    const seller = await member(s.org, "seller");
    const insert = "insert into report_templates (organization_id, name, instructions, is_default) values ($1, $2, 'Oppsummer samtalen', true)";
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(db, insert, [s.org, "Kort"], /row-level security/);
    });
    await as(api, { userId: admin, orgId: s.org }, async (db) => {
      await db.query(insert, [s.org, "Kort"]);
      await rejects(db, insert, [s.org, "Lang"], /report_templates_default/);
    });
  });

  it("is written by the worker and read only by superadmins", async () => {
    const s = await setup();
    const admin = await member(s.org, "admin");
    const w = await worker.connect();
    try {
      await w.query("insert into usage_events (organization_id, kind, audio_seconds) values ($1, 'transcription_async', 60)", [s.org]);
      await expect(w.query("select * from users")).rejects.toThrow(/permission denied/);
      await expect(w.query("select * from sessions")).rejects.toThrow(/permission denied/);
    } finally {
      w.release();
    }
    await as(api, { userId: admin, orgId: s.org }, async (db) => {
      expect((await db.query("select * from usage_events")).rowCount).toBe(0);
    });
  });
});
