import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

// A call centre with the dashboard on, a published product, a customer, two teams, two sellers
// in team Nord and one in team Sør, and a leader in Nord.
async function setup() {
  const org = await createOrg();
  await owner.query("insert into organization_modules (organization_id, module) values ($1, 'dashboard')", [org]);
  const product = (await owner.query("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [org])).rows[0].id;
  const version = (
    await owner.query(
      `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly, required_points)
       values ($1, $2, 1, 'published', now(), 399, '[{"id": "p1", "text": "Angrefrist nevnt"}]') returning id`,
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
  const leader = await member(org, "leader");
  await join(anna, nord);
  await join(bo, nord);
  await join(cato, sor);
  await join(leader, nord);
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
  const call = async (user: string, flag?: string, findings: unknown[] = []) => {
    const id = (
      await owner.query(
        "insert into calls (organization_id, user_id, source, transcription_mode, product_id) values ($1, $2, 'microphone', 'chunked', $3) returning id",
        [org, user, product],
      )
    ).rows[0].id;
    if (flag) {
      await owner.query(
        "insert into call_analyses (organization_id, call_id, template_version_id, model, flag, findings) values ($1, $2, $3, 'm', $4, $5)",
        [org, id, version, flag, JSON.stringify(findings)],
      );
    }
    return id;
  };
  return { org, customer, nord, sor, anna, bo, cato, leader, sale, call };
}

const PERIOD = "now() - interval '7 days', now() + interval '1 minute'";

async function dashboard(context: { userId: string; orgId: string }, scope: string, target: string | null) {
  return as(api, context, async (db) => (await db.query(`select app.dashboard($1, $2, ${PERIOD}) as d`, [scope, target])).rows[0].d);
}

describe("dashboard", () => {
  it("counts sales, flags and complaints for the scope", async () => {
    const s = await setup();
    await s.sale(s.anna, "confirmed");
    await s.sale(s.anna);
    const rejected = await s.sale(s.bo, "awaiting_confirmation");
    await owner.query("update sales set status = 'rejected' where id = $1", [rejected]);
    await s.sale(s.cato, "confirmed");
    const missed = { kind: "required_point", pointId: "p1", label: "Selgeren sa ikke noe om angrefristen til Kari", level: "red" };
    await s.call(s.anna, "red", [missed]);
    await s.call(s.bo, "yellow", [{ ...missed, level: "yellow" }]);
    await s.call(s.cato, "green");
    await owner.query("insert into complaints (organization_id, customer_id, sale_id, summary) values ($1, $2, $3, 'Klage')", [
      s.org,
      s.customer,
      rejected,
    ]);

    const team = await dashboard({ userId: s.leader, orgId: s.org }, "team", s.nord);
    expect(team.sales).toMatchObject({ total: 3, confirmed: 1, pending: 1, rejected: 1, revenueMonthly: 399 });
    expect(team.calls).toMatchObject({ total: 2, analyzed: 2, red: 1, yellow: 1, green: 0, unreviewed: 2 });
    expect(team.complaints).toEqual({ received: 1, open: 1 });
    // The template's point, not the AI's description of the call.
    expect(team.findings).toEqual([{ label: "Angrefrist nevnt", red: 1, yellow: 1 }]);
    // Everyone in the team is listed, also the leader without activity; Cato (Sør) is not.
    expect(team.sellers.map((p: { userId: string }) => p.userId).sort()).toEqual([s.anna, s.bo, s.leader].sort());
    expect(team.sellers.find((p: { userId: string }) => p.userId === s.anna)).toMatchObject({ sales: 2, confirmed: 1, calls: 1, red: 1 });
    expect(team.daily.at(-1)).toMatchObject({ sales: 3, confirmed: 1, calls: 2 });

    const mine = await dashboard({ userId: s.anna, orgId: s.org }, "me", null);
    expect(mine.sales.total).toBe(2);
    expect(mine.sellers).toEqual([]);
  });

  it("shows a team leader only what a seller did in the leader's team", async () => {
    const s = await setup();
    await s.sale(s.cato, "confirmed");
    await s.call(s.cato, "red");
    // Cato moves from Sør to Nord: the Sør work stays Sør's.
    await owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = $2", [s.org, s.cato, s.nord]);
    await s.sale(s.cato);
    const cato = await dashboard({ userId: s.leader, orgId: s.org }, "seller", s.cato);
    expect(cato.sales.total).toBe(1);
    expect(cato.calls.total).toBe(0);
    const compliance = await member(s.org, "compliance");
    expect((await dashboard({ userId: compliance, orgId: s.org }, "seller", s.cato)).sales.total).toBe(2);
  });

  it("gives each user only what their permissions cover", async () => {
    const s = await setup();
    const compliance = await member(s.org, "compliance");
    const forbidden = /no access|not a member/;
    await as(api, { userId: s.anna, orgId: s.org }, async (db) => {
      await rejects(db, `select app.dashboard('team', $1, ${PERIOD})`, [s.nord], forbidden);
      await rejects(db, `select app.dashboard('seller', $1, ${PERIOD})`, [s.bo], forbidden);
      await rejects(db, `select app.dashboard('all', null, ${PERIOD})`, [], forbidden);
    });
    await as(api, { userId: s.leader, orgId: s.org }, async (db) => {
      await db.query(`select app.dashboard('seller', $1, ${PERIOD})`, [s.bo]);
      await rejects(db, `select app.dashboard('team', $1, ${PERIOD})`, [s.sor], forbidden);
      await rejects(db, `select app.dashboard('all', null, ${PERIOD})`, [], forbidden);
    });
    expect((await dashboard({ userId: compliance, orgId: s.org }, "all", null)).sales.total).toBe(0);
    expect(await dashboard({ userId: compliance, orgId: s.org }, "team", s.sor)).toBeTruthy();

    // Another call centre's admin sees nothing of this one.
    const other = await createOrg();
    await owner.query("insert into organization_modules (organization_id, module) values ($1, 'dashboard')", [other]);
    await s.sale(s.anna);
    const admin = await member(other, "admin");
    expect((await dashboard({ userId: admin, orgId: other }, "all", null)).sales.total).toBe(0);
    await as(api, { userId: admin, orgId: other }, async (db) => {
      await rejects(db, `select app.dashboard('seller', $1, ${PERIOD})`, [s.anna], forbidden);
    });

    // Off when the module is off, and the period is limited to a year.
    await owner.query("update organization_modules set enabled = false where organization_id = $1", [s.org]);
    await as(api, { userId: s.anna, orgId: s.org }, async (db) => {
      await rejects(db, `select app.dashboard('me', null, ${PERIOD})`, [], /module is off/);
    });
    await owner.query("update organization_modules set enabled = true where organization_id = $1", [s.org]);
    await as(api, { userId: s.anna, orgId: s.org }, async (db) => {
      await rejects(db, "select app.dashboard('me', null, now() - interval '2 years', now())", [], /invalid period/);
    });
  });
});

describe("coaching notes", () => {
  it("are given by a leader to sellers in the team, and only marked as read by the seller", async () => {
    const s = await setup();
    const call = await s.call(s.anna);
    const id = await as(api, { userId: s.leader, orgId: s.org }, async (db) => {
      const row = (
        await db.query(
          "insert into coaching_notes (organization_id, seller_id, author_id, call_id, kind, body) values ($1, $2, $3, $4, 'improve', 'Husk angrefristen') returning id",
          [s.org, s.anna, s.leader, call],
        )
      ).rows[0];
      // Not to a seller in another team, not about someone else's call, not to oneself.
      await rejects(
        db,
        "insert into coaching_notes (organization_id, seller_id, author_id, kind, body) values ($1, $2, $3, 'praise', 'Bra')",
        [s.org, s.cato, s.leader],
        /row-level security/,
      );
      await rejects(
        db,
        "insert into coaching_notes (organization_id, seller_id, author_id, call_id, kind, body) values ($1, $2, $3, $4, 'praise', 'Bra')",
        [s.org, s.bo, s.leader, call],
        /row-level security/,
      );
      await rejects(
        db,
        "insert into coaching_notes (organization_id, seller_id, author_id, kind, body) values ($1, $2, $2, 'praise', 'Bra')",
        [s.org, s.leader],
        /row-level security|check constraint/,
      );
      return row.id;
    });
    // The transaction above was rolled back; write it for real so the seller can see it.
    await owner.query(
      "insert into coaching_notes (id, organization_id, seller_id, author_id, call_id, kind, body) values ($1, $2, $3, $4, $5, 'improve', 'Husk angrefristen')",
      [id, s.org, s.anna, s.leader, call],
    );

    await as(api, { userId: s.anna, orgId: s.org }, async (db) => {
      expect((await db.query("select body from coaching_notes")).rows).toEqual([{ body: "Husk angrefristen" }]);
      await rejects(db, "update coaching_notes set body = 'Endret' where id = $1", [id], /permission denied/);
      await db.query("update coaching_notes set read_at = now() where id = $1", [id]);
      await rejects(db, "update coaching_notes set read_at = now() where id = $1", [id], /already read/);
      await rejects(db, "delete from coaching_notes where id = $1", [id], /permission denied/);
    });
    for (const userId of [s.bo, s.cato]) {
      await as(api, { userId, orgId: s.org }, async (db) => {
        expect((await db.query("select 1 from coaching_notes")).rowCount).toBe(0);
        // Others cannot mark it read either.
        expect((await db.query("update coaching_notes set read_at = now() where id = $1", [id])).rowCount).toBe(0);
      });
    }
    // The note stays when the call is deleted.
    await owner.query("delete from calls where id = $1", [call]);
    expect((await owner.query("select call_id from coaching_notes where id = $1", [id])).rows[0].call_id).toBeNull();
  });
});
