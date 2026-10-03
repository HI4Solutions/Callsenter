import { describe, expect, it } from "vitest";
import { addMember, api, as, createOrg, createUser, makePlatformAdmin, member, owner, rejects } from "./helpers.ts";

// The overview counts the whole platform, and the test database is shared by every test file,
// so the test compares the counts before and after its own fixtures.

const overview = (userId: string, setup?: string) =>
  as(api, { userId }, async (db) => {
    if (setup) await db.query(setup, [userId]);
    return (await db.query("select app.platform_overview() as o")).rows[0].o;
  });

// Calls straight into a state, past the guard that only lets the worker move them.
async function setCalls(sql: string, params: unknown[]) {
  const client = await owner.connect();
  try {
    await client.query("begin");
    await client.query("alter table calls disable trigger calls_guard");
    await client.query(sql, params);
    await client.query("alter table calls enable trigger calls_guard");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const newCall = async (org: string, user: string) =>
  (
    await owner.query("insert into calls (organization_id, user_id, source, transcription_mode) values ($1, $2, 'microphone', 'chunked') returning id", [
      org,
      user,
    ])
  ).rows[0].id as string;

describe("the superadmin's overview", () => {
  it("counts call centres, users, logins, calls, the worker's queue, usage and messages", async () => {
    const me = await createUser("Superadmin");
    await makePlatformAdmin(me);
    const before = await overview(me);

    // On trial for five more days, records calls, but has not done so since it started.
    const quiet = await createOrg("Stille AS");
    await owner.query("update organizations set created_at = now() - interval '45 days', trial_ends_at = now() + interval '5 days' where id = $1", [
      quiet,
    ]);
    await owner.query("insert into organization_modules (organization_id, module) values ($1, 'transcription')", [quiet]);
    // Access from an invoice that ends in three days.
    const paid = await createOrg("Betaler AS");
    await owner.query("update organizations set access_until = now() + interval '3 days' where id = $1", [paid]);
    const closed = await createOrg("Stengt AS");
    await owner.query("update organizations set status = 'suspended' where id = $1", [closed]);

    // A busy call centre: 200 calls checked today, one failed, one being recorded, one stuck in
    // processing, and one three days ago.
    const busy = await createOrg("Travel AS");
    const seller = await member(busy, "seller");
    await owner.query("update users set last_login_at = now() where id = $1", [seller]);
    const invited = await createUser("Ny Selger", "invited");
    await addMember(busy, invited, "seller");
    await owner.query(
      "insert into calls (organization_id, user_id, source, transcription_mode) select $1, $2, 'microphone', 'chunked' from generate_series(1, 200)",
      [busy, seller],
    );
    await setCalls("update calls set status = 'analyzed' where organization_id = $1", [busy]);
    const failed = await newCall(busy, seller);
    const recording = await newCall(busy, seller);
    const stuck = await newCall(busy, seller);
    const earlier = await newCall(busy, seller);
    await setCalls("update calls set status = 'failed' where id = $1", [failed]);
    await setCalls("update calls set status = 'processing', processing_started_at = now() - interval '45 minutes' where id = $1", [stuck]);
    await setCalls("update calls set status = 'analyzed', started_at = now() - interval '3 days' where id = $1", [earlier]);
    await owner.query("insert into call_pieces (call_id, organization_id, seq, start_ms, status) values ($1, $2, 0, 0, 'pending')", [recording, busy]);

    // One hour transcribed in four pieces, its AI control and a note.
    for (const piece of [0, 1, 2, 3]) {
      await owner.query("insert into usage_events (organization_id, call_id, kind, audio_seconds, piece) values ($1, $2, 'transcription_async', 900, $3)", [
        busy,
        earlier,
        piece,
      ]);
    }
    await owner.query("insert into usage_events (organization_id, call_id, kind, input_tokens, output_tokens) values ($1, $2, 'ai_control', 1000, 100)", [
      busy,
      earlier,
    ]);
    await owner.query("insert into usage_events (organization_id, call_id, kind, input_tokens, output_tokens) values ($1, $2, 'report', 1000, 100)", [
      busy,
      earlier,
    ]);

    // Logins: three methods over ten days, five failures from one address and six from an
    // address that gets blocked, and one cancelled.
    await owner.query(
      `insert into login_events (occurred_at, provider, result, user_id, ip) values
         (now(), 'bankid', 'success', $1, '192.0.2.1'),
         (now() - interval '2 days', 'vipps', 'success', $1, '192.0.2.1'),
         (now() - interval '10 days', 'passkey', 'success', $1, '192.0.2.1'),
         (now(), 'vipps', 'cancelled', null, '192.0.2.2')`,
      [seller],
    );
    for (let i = 0; i < 5; i++) await owner.query("insert into login_events (provider, result, ip) values ('bankid', 'unknown_identity', '203.0.113.7')");
    for (let i = 0; i < 6; i++) await owner.query("insert into login_events (provider, result, ip) values ('vipps', 'invalid', '198.51.100.9')");

    // A conversation with a message from the call centre that nobody at VeriQall has read.
    const thread = (await owner.query("insert into support_threads (organization_id, subject, created_by) values ($1, 'Hjelp', $2) returning id", [busy, seller]))
      .rows[0].id;
    await owner.query("insert into support_messages (thread_id, organization_id, author_user_id, from_platform, body) values ($1, $2, $3, false, 'Hei')", [
      thread,
      busy,
      seller,
    ]);

    const after = await overview(me, "insert into blocked_ips (network, created_by) values ('198.51.100.0/24', $1)");
    const delta = (part: string, key: string) => Number(after[part][key]) - Number(before[part][key]);
    const dayOfMonth = Number(String(after.today).slice(8, 10));

    expect(delta("organizations", "total")).toBe(4);
    expect(delta("organizations", "open")).toBe(3);
    expect(delta("organizations", "trial")).toBe(1);
    expect(delta("organizations", "paying")).toBe(1);
    expect(delta("organizations", "closed")).toBe(1);
    expect(delta("organizations", "newThisMonth")).toBe(3);
    expect(after.organizations.ending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: quiet, kind: "trial" }),
        expect.objectContaining({ id: paid, kind: "access" }),
      ]),
    );
    expect(after.organizations.quiet).toEqual(expect.arrayContaining([{ id: quiet, name: "Stille AS", lastCallAt: null, lastLoginAt: null }]));
    expect(after.organizations.quiet.map((o: { id: string }) => o.id)).not.toContain(busy);
    expect(after.organizations.mostActive).toEqual(
      expect.arrayContaining([{ id: busy, name: "Travel AS", calls: 203 + (dayOfMonth > 3 ? 1 : 0), users30: 1 }]),
    );

    expect(delta("users", "active")).toBe(1);
    expect(delta("users", "invited")).toBe(1);
    expect(delta("users", "new30")).toBe(2);
    expect(delta("users", "loggedInToday")).toBe(1);

    expect(delta("logins", "today")).toBe(1);
    expect(delta("logins", "week")).toBe(2);
    expect(delta("logins", "failed24h")).toBe(12);
    expect(delta("logins", "suspiciousIps")).toBe(1);
    expect(delta("logins", "blockedIps")).toBe(1);
    for (const method of ["bankid", "vipps", "passkey"]) {
      expect(after.logins.byMethod[method] - before.logins.byMethod[method]).toBe(1);
    }

    expect(delta("calls", "today")).toBe(203);
    expect(delta("calls", "week")).toBe(204);
    expect(delta("calls", "month")).toBe(203 + (dayOfMonth > 3 ? 1 : 0));
    expect(delta("calls", "failed7")).toBe(1);
    expect(delta("calls", "recording")).toBe(1);
    expect(delta("calls", "processing")).toBe(1);
    expect(delta("calls", "stuck")).toBe(1);
    expect(delta("calls", "piecesWaiting")).toBe(1);

    expect(delta("usage", "hours")).toBeCloseTo(1, 5);
    expect(delta("usage", "controls")).toBe(1);
    expect(delta("usage", "notes")).toBe(1);

    expect(delta("support", "open")).toBe(1);
    expect(delta("support", "unread")).toBe(1);

    // Thirty days, oldest first, today last.
    expect(after.days).toHaveLength(30);
    expect(after.days[29].day).toBe(after.today);
    const day = (i: number, key: string) => after.days[i][key] - before.days[i][key];
    expect(day(29, "calls")).toBe(203);
    expect(day(26, "calls")).toBe(1);
    expect(day(29, "logins")).toBe(1);
    expect(day(27, "logins")).toBe(1);
    expect(day(19, "logins")).toBe(1);
  });

  it("is only for superadmins in a BankID session", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await rejects(db, "select app.platform_overview()", [], /not a superadmin/);
    });
    const me = await createUser("Superadmin");
    await makePlatformAdmin(me);
    await as(api, { userId: me, strong: false }, async (db) => {
      await rejects(db, "select app.platform_overview()", [], /not a superadmin/);
    });
  });
});
