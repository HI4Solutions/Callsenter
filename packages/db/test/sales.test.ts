import { SALE_TRANSITIONS } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

// A call centre with a product (published version 1 at 399/month), a customer and a team.
async function setup() {
  const org = await createOrg();
  const product = (
    await owner.query<{ id: string }>("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [org])
  ).rows[0]!.id;
  const version = (
    await owner.query<{ id: string }>(
      `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly, binding_months)
       values ($1, $2, 1, 'published', now(), 399, 12) returning id`,
      [org, product],
    )
  ).rows[0]!.id;
  const customer = (
    await owner.query<{ id: string }>("insert into customers (organization_id, kind, name) values ($1, 'person', 'Kari Kunde') returning id", [
      org,
    ])
  ).rows[0]!.id;
  const team = (await owner.query<{ id: string }>("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0]!
    .id;
  return { org, product, version, customer, team };
}

async function joinTeam(org: string, userId: string, team: string | null) {
  await owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = $2", [org, userId, team]);
}

// A committed sale, registered the way the API does it (the trigger fills in the rest).
async function sale(org: string, customer: string, product: string, seller: string) {
  const { rows } = await owner.query<{ id: string }>(
    "insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id",
    [org, customer, product, seller],
  );
  return rows[0]!.id;
}

const INSERT = `insert into sales (organization_id, customer_id, product_id, seller_id)
  values ($1, $2, $3, $4) returning id, template_version_id, price_monthly::text, binding_months, team_id, status, created_by`;

describe("sales: registering", () => {
  it("mirrors the status transitions from the code", async () => {
    const { rows } = await owner.query<{ from_status: string; to_status: string }>("select * from sale_status_transitions");
    const db = rows.map((r) => `${r.from_status}>${r.to_status}`).sort();
    const code = Object.entries(SALE_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
      .sort();
    expect(db).toEqual(code);
  });

  it("takes the published version, its prices and the seller's team, and records the event", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    await joinTeam(s.org, seller, s.team);
    await as(api, { userId: seller, orgId: s.org, strong: false }, async (db) => {
      const { rows } = await db.query(INSERT, [s.org, s.customer, s.product, seller]);
      expect(rows[0]).toMatchObject({
        template_version_id: s.version,
        price_monthly: "399.00",
        binding_months: 12,
        team_id: s.team,
        status: "registered",
        created_by: seller,
      });
      const events = await db.query("select from_status, to_status, actor_user_id from sale_events where sale_id = $1", [rows[0].id]);
      expect(events.rows).toEqual([{ from_status: null, to_status: "registered", actor_user_id: seller }]);
    });
  });

  it("refuses another version, products without a published version, and archived products or customers", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    await owner.query(
      "insert into product_template_versions (organization_id, product_id, version) values ($1, $2, 2)",
      [s.org, s.product],
    );
    const draft = (await owner.query("select id from product_template_versions where product_id = $1 and version = 2", [s.product])).rows[0].id;
    const bare = (await owner.query("insert into products (organization_id, name) values ($1, 'Uten mal') returning id", [s.org])).rows[0].id;
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(
        db,
        "insert into sales (organization_id, customer_id, product_id, seller_id, template_version_id) values ($1, $2, $3, $4, $5)",
        [s.org, s.customer, s.product, seller, draft],
        /not the published one/,
      );
      await rejects(db, INSERT, [s.org, s.customer, bare, seller], /no published template version/);
      await db.query("savepoint a");
      await owner.query("update customers set archived_at = now() where id = $1", [s.customer]);
      await rejects(db, INSERT, [s.org, s.customer, s.product, seller], /customer not found or archived/);
      await owner.query("update customers set archived_at = null where id = $1", [s.customer]);
      await owner.query("update products set archived_at = now() where id = $1", [s.product]);
      await rejects(db, INSERT, [s.org, s.customer, s.product, seller], /no published template version/);
      await owner.query("update products set archived_at = null where id = $1", [s.product]);
    });
  });

  it("lets sellers register only their own sales, and keeps call centres apart", async () => {
    const s = await setup();
    const other = await setup();
    const seller = await member(s.org, "seller");
    const colleague = await member(s.org, "seller");
    const admin = await member(s.org, "admin");
    const compliance = await member(s.org, "compliance");
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, s.customer, s.product, colleague], /row-level security/);
      // Another call centre's product or customer is not found.
      await rejects(db, INSERT, [s.org, s.customer, other.product, seller], /no published template version/);
      await rejects(db, INSERT, [s.org, other.customer, s.product, seller], /customer not found/);
      await rejects(db, INSERT, [other.org, other.customer, other.product, seller], /customer not found|row-level security|no published/);
    });
    await as(api, { userId: admin, orgId: s.org }, async (db) => {
      expect((await db.query(INSERT, [s.org, s.customer, s.product, colleague])).rows[0].status).toBe("registered");
    });
    // Compliance reads all sales but cannot register any.
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, s.customer, s.product, compliance], /row-level security/);
    });
  });
});

describe("sales: visibility", () => {
  it("shows own sales, the team's sales by the team they were made in, or all", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const teammate = await member(s.org, "seller");
    const outsider = await member(s.org, "seller");
    const leader = await member(s.org, "leader");
    const compliance = await member(s.org, "compliance");
    for (const u of [seller, teammate, leader]) await joinTeam(s.org, u, s.team);
    const own = await sale(s.org, s.customer, s.product, seller);
    const mate = await sale(s.org, s.customer, s.product, teammate);
    const away = await sale(s.org, s.customer, s.product, outsider);
    // Moving the teammate later does not move the sale they made in the team.
    await joinTeam(s.org, teammate, null);

    const visible = (userId: string, strong = true) =>
      as(api, { userId, orgId: s.org, strong }, async (db) => {
        const ids = (await db.query<{ id: string }>("select id from sales")).rows.map((r) => r.id);
        const events = (await db.query<{ sale_id: string }>("select distinct sale_id from sale_events")).rows.map((r) => r.sale_id);
        expect(events.sort()).toEqual([...ids].sort());
        return ids.sort();
      });
    expect(await visible(seller)).toEqual([own]);
    expect(await visible(leader)).toEqual([own, mate].sort());
    expect(await visible(compliance)).toEqual([own, mate, away].sort());
    // calls.read.all needs a BankID or passkey session.
    expect(await visible(compliance, false)).toEqual([]);

    const otherOrg = await setup();
    const stranger = await member(otherOrg.org, "admin");
    expect(await visible(stranger)).toEqual([]);
  });
});

describe("sales: status", () => {
  it("moves along the allowed transitions and records each step with its note", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const id = await sale(s.org, s.customer, s.product, seller);
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      const move = (status: string, note: string | null = null) =>
        db.query("update sales set status = $2, status_note = $3 where id = $1", [id, status, note]);
      await rejects(db, "update sales set status = 'active' where id = $1", [id], /cannot go from registered to active/);
      await move("awaiting_confirmation", "Sendt på SMS");
      await move("confirmed");
      await rejects(db, "update sales set status = 'awaiting_confirmation' where id = $1", [id], /cannot go from confirmed/);
      await move("withdrawn", "Kunden angret");
      await rejects(db, "update sales set status = 'active' where id = $1", [id], /cannot go from withdrawn/);
      const { rows } = await db.query("select from_status, to_status, note from sale_events where sale_id = $1 order by id", [id]);
      expect(rows).toEqual([
        { from_status: null, to_status: "registered", note: null },
        { from_status: "registered", to_status: "awaiting_confirmation", note: "Sendt på SMS" },
        { from_status: "awaiting_confirmation", to_status: "confirmed", note: null },
        { from_status: "confirmed", to_status: "withdrawn", note: "Kunden angret" },
      ]);
    });
  });

  it("freezes everything but the status and the note", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const id = await sale(s.org, s.customer, s.product, seller);
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      const other = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Ola') returning id", [s.org]))
        .rows[0].id;
      for (const [column, value] of [
        ["price_monthly", 1],
        ["customer_id", other],
        ["sold_at", "2020-01-01"],
      ] as const) {
        await rejects(db, `update sales set ${column} = $2 where id = $1`, [id, value], /only the status and the note/);
      }
      await db.query("update sales set note = 'Ring etter kl. 16' where id = $1", [id]);
      // A status note without a status change is ignored, so the history stays truthful.
      await db.query("update sales set status_note = 'Lurt' where id = $1", [id]);
      const { rows } = await db.query("select note, status_note from sales where id = $1", [id]);
      expect(rows[0]).toEqual({ note: "Ring etter kl. 16", status_note: null });
      expect((await db.query("select count(*)::int as n from sale_events where sale_id = $1", [id])).rows[0].n).toBe(1);
    });
  });

  it("needs sales.manage, and the history cannot be written directly", async () => {
    const s = await setup();
    const seller = await member(s.org, "seller");
    const compliance = await member(s.org, "compliance");
    const id = await sale(s.org, s.customer, s.product, seller);
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      const { rowCount } = await db.query("update sales set status = 'cancelled' where id = $1", [id]);
      expect(rowCount).toBe(0);
    });
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      await rejects(
        db,
        "insert into sale_events (organization_id, sale_id, to_status) values ($1, $2, 'confirmed')",
        [s.org, id],
        /permission denied/,
      );
      await rejects(db, "delete from sale_events where sale_id = $1", [id], /permission denied/);
      await rejects(db, "delete from sales where id = $1", [id], /permission denied/);
    });
  });
});
