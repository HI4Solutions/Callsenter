import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

// A call centre with the dashboard on, a product, two teams: Nord with three sellers and a
// leader, Sør with one seller. An admin sees everything.
async function setup() {
  const org = await createOrg();
  await owner.query("insert into organization_modules (organization_id, module) values ($1, 'dashboard')", [org]);
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
  const nord = (await owner.query("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0].id;
  const sor = (await owner.query("insert into teams (organization_id, name) values ($1, 'Sør') returning id", [org])).rows[0].id;
  const join = (user: string, team: string) =>
    owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = $2", [org, user, team]);
  const anna = await member(org, "seller");
  const bo = await member(org, "seller");
  const cato = await member(org, "seller");
  const dina = await member(org, "seller");
  const leader = await member(org, "leader");
  const admin = await member(org, "admin");
  for (const user of [anna, bo, cato, leader]) await join(user, nord);
  await join(dina, sor);
  const sale = async (seller: string, status?: string) => {
    const id = (
      await owner.query("insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id", [
        org,
        customer,
        product,
        seller,
      ])
    ).rows[0].id;
    if (status) await owner.query("update sales set status = $2 where id = $1", [id, status]);
    return id;
  };
  const call = async (user: string, flag?: string) => {
    const id = (
      await owner.query(
        "insert into calls (organization_id, user_id, source, transcription_mode, product_id) values ($1, $2, 'microphone', 'chunked', $3) returning id",
        [org, user, product],
      )
    ).rows[0].id;
    if (flag) {
      await owner.query(
        "insert into call_analyses (organization_id, call_id, template_version_id, model, flag, findings) values ($1, $2, $3, 'm', $4, '[]')",
        [org, id, version, flag],
      );
    }
    return id;
  };
  return { org, nord, sor, anna, bo, cato, dina, leader, admin, sale, call };
}

const PERIOD = "now() - interval '6 days', now() + interval '1 minute'";

const benchmark = (userId: string, orgId: string) =>
  as(api, { userId, orgId }, async (db) => (await db.query(`select app.dashboard_benchmark(${PERIOD}) as b`)).rows[0].b);

interface SellerRow {
  userId: string;
  calls: number[];
  sales: number[];
  red: number[];
  unreviewed: number;
  feedback: number;
  lastFeedbackAt: string | null;
}

const team = (userId: string, orgId: string, teamId: string | null) =>
  as(api, { userId, orgId }, async (db) => (await db.query(`select app.dashboard_team($1, ${PERIOD}) as t`, [teamId])).rows[0].t) as Promise<{
    days: string[];
    sellers: SellerRow[];
  }>;

describe("dashboard per level", () => {
  it("shows a seller the team's average without names, only when at least three were active", async () => {
    const s = await setup();
    await s.call(s.anna, "green");
    await s.call(s.anna, "red");
    await s.sale(s.anna, "confirmed");
    await s.call(s.bo, "green");
    // Two active in Nord: an average would show what the colleague did.
    expect(await benchmark(s.anna, s.org)).toMatchObject({ teamName: "Nord", sellers: 2, tooFew: true, perSeller: null, shares: null });

    await s.call(s.cato, "green");
    await s.sale(s.cato);
    const b = await benchmark(s.anna, s.org);
    expect(b).toMatchObject({ sellers: 3, tooFew: false, perSeller: { calls: 1.3, sales: 0.7, confirmed: 0.3 }, shares: { confirmed: 50, green: 75, red: 25 } });
    expect(JSON.stringify(b)).not.toContain(s.bo);

    // Not in a team: nothing to compare with. Sør's one seller is not counted in Nord.
    expect(await benchmark(s.admin, s.org)).toBeNull();
    expect((await benchmark(s.dina, s.org)).sellers).toBe(0);
  });

  it("shows a leader each seller in the team day by day, open flags and feedback", async () => {
    const s = await setup();
    await s.call(s.anna, "red");
    await s.call(s.anna, "yellow");
    await s.call(s.bo, "green");
    await s.sale(s.bo, "confirmed");
    await s.call(s.dina, "red");
    await owner.query("insert into coaching_notes (organization_id, seller_id, author_id, kind, body) values ($1, $2, $3, 'improve', 'Husk angrefristen')", [
      s.org,
      s.anna,
      s.leader,
    ]);

    const t = await team(s.leader, s.org, s.nord);
    expect(t.days).toHaveLength(7);
    const byName: Record<string, SellerRow> = Object.fromEntries(t.sellers.map((p) => [p.userId, p]));
    // The leader is also a member of the team, and Cato did nothing this week: both are shown.
    expect(Object.keys(byName).sort()).toEqual([s.anna, s.bo, s.cato, s.leader].sort());
    expect(byName[s.anna]).toMatchObject({ unreviewed: 2, feedback: 1 });
    expect(byName[s.anna]!.calls.at(-1)).toBe(2);
    expect(byName[s.anna]!.red.at(-1)).toBe(1);
    expect(byName[s.bo]).toMatchObject({ unreviewed: 0, feedback: 0, lastFeedbackAt: null });
    expect(byName[s.bo]!.sales.at(-1)).toBe(1);
    expect(byName[s.cato]!.calls.reduce((a, b) => a + b, 0)).toBe(0);

    // Another team, or the whole call centre, needs dashboard.all.
    await as(api, { userId: s.leader, orgId: s.org }, async (db) => {
      await rejects(db, `select app.dashboard_team($1, ${PERIOD})`, [s.sor], /no access to this team/);
      await rejects(db, `select app.dashboard_team(null, ${PERIOD})`, [], /no access to the whole call centre/);
    });
    await as(api, { userId: s.anna, orgId: s.org }, async (db) => {
      await rejects(db, `select app.dashboard_team($1, ${PERIOD})`, [s.nord], /no access to this team/);
    });
    const all = await team(s.admin, s.org, null);
    expect(all.sellers.map((p) => p.userId).sort()).toEqual([s.anna, s.bo, s.dina].sort());
  });
});
