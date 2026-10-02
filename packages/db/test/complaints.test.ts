import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

async function setup() {
  const org = await createOrg();
  const customer = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Kari') returning id", [org])).rows[0].id;
  const other = (await owner.query("insert into customers (organization_id, kind, name) values ($1, 'person', 'Ola') returning id", [org])).rows[0].id;
  const product = (await owner.query("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [org])).rows[0].id;
  await owner.query(
    `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly)
     values ($1, $2, 1, 'published', now(), 399)`,
    [org, product],
  );
  const seller = await member(org, "seller");
  const sale = (
    await owner.query("insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id", [
      org,
      customer,
      product,
      seller,
    ])
  ).rows[0].id;
  return { org, customer, other, sale, seller };
}

const INSERT = "insert into complaints (organization_id, customer_id, sale_id, summary) values ($1, $2, $3, 'Fikk ikke angrerett') returning id";

describe("complaints", () => {
  it("are handled with complaints.manage, with a history of every status change", async () => {
    const s = await setup();
    const compliance = await member(s.org, "compliance");
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      const id = (await db.query(INSERT, [s.org, s.customer, s.sale])).rows[0].id;
      await db.query("update complaints set status = 'investigating', status_note = 'Hører på opptaket' where id = $1", [id]);
      await db.query("insert into complaint_events (organization_id, complaint_id, kind, note, actor_user_id) values ($1, $2, 'note', 'Ringte kunden', $3)", [
        s.org,
        id,
        compliance,
      ]);
      await db.query("update complaints set status = 'resolved', outcome = 'Avtalen hevet' where id = $1", [id]);
      const events = await db.query("select kind, from_status, to_status, note from complaint_events where complaint_id = $1 order by id", [id]);
      expect(events.rows).toEqual([
        { kind: "created", from_status: null, to_status: "open", note: null },
        { kind: "status", from_status: "open", to_status: "investigating", note: "Hører på opptaket" },
        { kind: "note", from_status: null, to_status: null, note: "Ringte kunden" },
        { kind: "status", from_status: "investigating", to_status: "resolved", note: null },
      ]);
      expect((await db.query("select closed_at is not null as closed from complaints where id = $1", [id])).rows[0].closed).toBe(true);
      await rejects(db, "delete from complaint_events where complaint_id = $1", [id], /permission denied/);
      await rejects(
        db,
        "insert into complaint_events (organization_id, complaint_id, kind, to_status, actor_user_id) values ($1, $2, 'status', 'open', $3)",
        [s.org, id, compliance],
        /row-level security/,
      );
    });
  });

  it("refuse sales of another customer, and stay hidden from sellers and other call centres", async () => {
    const s = await setup();
    const compliance = await member(s.org, "compliance");
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, s.other, s.sale], /another customer/);
    });
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await rejects(db, INSERT, [s.org, s.customer, s.sale], /row-level security/);
    });
    await owner.query("insert into complaints (organization_id, customer_id, summary) values ($1, $2, 'Feil pris')", [s.org, s.customer]);
    const stranger = await member(await createOrg(), "admin");
    await as(api, { userId: stranger, orgId: s.org }, async (db) => {
      expect((await db.query("select 1 from complaints")).rowCount).toBe(0);
    });
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select 1 from complaints")).rowCount).toBe(0);
    });
  });
});
