import { describe, expect, it } from "vitest";
import { api, as, createOrg, hash32, member, owner, rejects } from "./helpers.ts";

// A call centre with the dashboard, complaints and customer acceptance on, one product, and
// sellers whose calls were checked by AI.
async function setup() {
  const org = await createOrg();
  for (const m of ["dashboard", "complaints", "sale_verification"]) {
    await owner.query("insert into organization_modules (organization_id, module) values ($1, $2)", [org, m]);
  }
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
  const anna = await member(org, "seller");
  const bo = await member(org, "seller");
  const cato = await member(org, "seller");
  const compliance = await member(org, "compliance");
  const leader = await member(org, "leader");
  // checkedHoursAgo: when the AI control was made; reviewedNow: a leader reviewed it just now.
  const call = async (user: string, flag: string, checkedHoursAgo = 0, reviewedNow = false) => {
    const id = (
      await owner.query(
        "insert into calls (organization_id, user_id, source, transcription_mode, product_id) values ($1, $2, 'microphone', 'chunked', $3) returning id",
        [org, user, product],
      )
    ).rows[0].id;
    await owner.query(
      `insert into call_analyses (organization_id, call_id, template_version_id, model, flag, findings, created_at, reviewed_at)
       values ($1, $2, $3, 'm', $4, '[]', now() - make_interval(hours => $5), case when $6 then now() end)`,
      [org, id, version, flag, checkedHoursAgo, reviewedNow],
    );
    return id;
  };
  const sale = async (seller: string) =>
    (
      await owner.query("insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id", [
        org,
        customer,
        product,
        seller,
      ])
    ).rows[0].id as string;
  return { org, version, customer, anna, bo, cato, compliance, leader, call, sale };
}

const PERIOD = "now() - interval '6 days', now() + interval '1 minute'";

const quality = (userId: string, orgId: string) =>
  as(api, { userId, orgId }, async (db) => (await db.query(`select app.dashboard_quality(${PERIOD}) as q`)).rows[0].q);

describe("quality dashboard", () => {
  it("shows the queue of flags, deviations per product and seller, complaints, acceptance and access", async () => {
    const s = await setup();
    await s.call(s.anna, "red", 30);
    await s.call(s.anna, "red", 5, true);
    await s.call(s.anna, "green");
    await s.call(s.bo, "yellow", 100);
    await s.call(s.bo, "green");
    await s.call(s.bo, "green");
    await s.call(s.cato, "red", 2);

    const sale = await s.sale(s.anna);
    const complaint = (
      await owner.query("insert into complaints (organization_id, customer_id, sale_id, summary, channel) values ($1, $2, $3, 'Klage', 'email') returning id", [
        s.org,
        s.customer,
        sale,
      ])
    ).rows[0].id;
    await owner.query("insert into complaints (organization_id, customer_id, summary) values ($1, $2, 'Klage 2')", [s.org, s.customer]);
    await owner.query("update complaints set status = 'resolved' where id = $1", [complaint]);

    const confirmation = (status: string, method: string | null, match: string | null) =>
      owner.query(
        `insert into sale_confirmations (organization_id, sale_id, token_hash, status, document, document_hash, template_version_id, expires_at, decided_at, method, identity_match)
         values ($1, $2, $3, $4, '{}', repeat('a', 64), $5, now() + interval '1 day', case when $4 <> 'pending' then now() end, $6, $7)`,
        [s.org, sale, hash32(), status, s.version, method, match],
      );
    await confirmation("accepted", "bankid", "name");
    await confirmation("accepted", "vipps", "none");
    await confirmation("rejected", "none", null);

    await owner.query(
      "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'x', 'play'), ($1, $2, 'call', 'x', 'view'), ($1, $3, 'call_search', 'q', 'view')",
      [s.org, s.leader, s.compliance],
    );

    const q = await quality(s.compliance, s.org);
    // Open: Anna's unreviewed red (30 h), Bo's yellow (100 h) and Cato's red (2 h).
    expect(q.flags).toMatchObject({
      open: 3,
      openByAge: { day: 1, days3: 1, week: 1, older: 0 },
      reviewed: 1,
      medianHoursToReview: 5,
      checked: 7,
      yellow: 1,
      red: 3,
    });
    expect(q.products).toEqual([{ name: "Strøm", checked: 7, yellow: 1, red: 3 }]);
    // Cato had only one call checked: too few for the list.
    expect(q.sellers.map((x: { userId: string }) => x.userId)).toEqual([s.anna]);
    expect(q.sellers[0]).toMatchObject({ checked: 3, red: 2, yellow: 0 });
    expect(q.complaints).toMatchObject({
      received: 2,
      byStatus: { open: 1, investigating: 0, resolved: 1, rejected: 0 },
      openNow: 1,
      byChannel: { email: 1, phone: 1 },
    });
    expect(q.complaints.weekly.reduce((n: number, w: { received: number }) => n + w.received, 0)).toBe(2);
    expect(q.confirmations).toMatchObject({ sent: 3, accepted: 2, rejected: 1, bankid: 1, vipps: 1, identityMismatch: 1 });
    expect(q.access).toMatchObject({ views: 1, plays: 1, downloads: 0, searches: 1 });
    expect(q.access.users).toHaveLength(2);
  });

  it("is for those who see the whole call centre and review flags or complaints, and access needs audit.read", async () => {
    const s = await setup();
    for (const user of [s.leader, s.anna]) {
      await as(api, { userId: user, orgId: s.org }, async (db) => {
        await rejects(db, `select app.dashboard_quality(${PERIOD})`, [], /no access to the quality dashboard/);
      });
    }
    // Without audit.read, the part about who opened recordings is left out.
    const role = (await owner.query("select role_id from memberships where organization_id = $1 and user_id = $2", [s.org, s.compliance])).rows[0]
      .role_id;
    await owner.query("delete from role_permissions where role_id = $1 and permission = 'audit.read'", [role]);
    expect((await quality(s.compliance, s.org)).access).toBeNull();
    // With the complaints module off, so is that part.
    await owner.query("update organization_modules set enabled = false where organization_id = $1 and module = 'complaints'", [s.org]);
    expect((await quality(s.compliance, s.org)).complaints).toBeNull();
  });
});
