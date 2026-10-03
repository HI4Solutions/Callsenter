import { describe, expect, it } from "vitest";
import { addMember, api, as, createOrg, createUser, owner } from "./helpers.ts";

// Row-level security on calls asks for the user's permissions and team once per query, not per
// row (migration 0027). With the per-row version, counting these calls took tens of seconds.
describe("visibility of calls at volume", () => {
  it("counts thousands of calls quickly for sellers, leaders and admins, with the same rules", async () => {
    const org = await createOrg();
    const team = (await owner.query("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0].id;
    const seller = await createUser();
    const colleague = await createUser();
    const leader = await createUser();
    const admin = await createUser();
    await addMember(org, seller, "seller");
    await addMember(org, colleague, "seller");
    await addMember(org, leader, "leader");
    await addMember(org, admin, "admin");
    await owner.query("update memberships set team_id = $2 where organization_id = $1 and user_id in ($3, $4)", [org, team, seller, leader]);
    const client = await owner.connect();
    try {
      await client.query("begin");
      // Bulk data straight in, without the trigger that sets the start time of a new recording.
      await client.query("alter table calls disable trigger calls_guard");
      await client.query(
        `insert into calls (organization_id, user_id, team_id, source, transcription_mode, status, started_at, expires_at)
         select $1, case when i % 2 = 0 then $2::uuid else $3::uuid end, case when i % 2 = 0 then $4::uuid end,
                'microphone', 'chunked', 'analyzed', now() - make_interval(mins => i), now() + interval '90 days'
         from generate_series(1, 3000) i`,
        [org, seller, colleague, team],
      );
      await client.query("alter table calls enable trigger calls_guard");
      await client.query("commit");
    } finally {
      client.release();
    }
    await owner.query("analyze calls");

    const visible = async (userId: string) =>
      as(api, { userId, orgId: org }, async (db) => {
        const started = performance.now();
        const n = (await db.query("select count(*)::int as n from calls")).rows[0].n as number;
        await db.query("select id from calls order by started_at desc limit 200");
        return { n, ms: performance.now() - started };
      });
    const results = { seller: await visible(seller), leader: await visible(leader), admin: await visible(admin) };
    expect(results.seller.n).toBe(1500);
    expect(results.leader.n).toBe(1500);
    expect(results.admin.n).toBe(3000);
    for (const r of Object.values(results)) expect(r.ms).toBeLessThan(3000);
  });
});
