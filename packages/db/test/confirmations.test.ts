import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { api, as, auth, createOrg, member, owner, rejects } from "./helpers.ts";

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
  const customer = (
    await owner.query("insert into customers (organization_id, kind, name, phone) values ($1, 'person', 'Kari Kunde', '+4791234567') returning id", [org])
  ).rows[0].id;
  const seller = await member(org, "seller");
  const sale = (
    await owner.query("insert into sales (organization_id, customer_id, product_id, seller_id) values ($1, $2, $3, $4) returning id", [
      org,
      customer,
      product,
      seller,
    ])
  ).rows[0].id;
  await owner.query("update sales set status = 'awaiting_confirmation' where id = $1", [sale]);
  return { org, product, version, customer, seller, sale };
}

async function confirmation(s: Awaited<ReturnType<typeof setup>>, expires = "7 days") {
  const token = randomBytes(32);
  const hash = createHash("sha256").update(token).digest();
  const { rows } = await owner.query(
    `insert into sale_confirmations (organization_id, sale_id, token_hash, document, document_hash, template_version_id, expires_at)
     values ($1, $2, $3, '{"product": "Strøm"}', $4, $5, now() + $6::interval) returning id`,
    [s.org, s.sale, hash, "a".repeat(64), s.version, expires],
  );
  return { id: rows[0].id as string, hash };
}

const decide = (id: string, decision: string, how = "vipps", name: string | null = "Kari Kunde", phone: string | null = "+4791234567") =>
  auth.query("select app.confirmation_decide($1, $2, $3, $4, $5, $6, $7, $8, $9) as r", [
    id,
    decision,
    how,
    name,
    phone,
    decision === "accepted" ? "b".repeat(64) : null,
    null,
    "203.0.113.5",
    "vitest",
  ]);

describe("sale confirmations", () => {
  it("shows the offer through the token, accepts with a verified identity and confirms the sale", async () => {
    const s = await setup();
    const c = await confirmation(s);
    const view = (await auth.query("select app.confirmation_view($1) as v", [c.hash])).rows[0].v;
    expect(view).toMatchObject({ id: c.id, status: "pending", document: { product: "Strøm" } });
    expect((await decide(c.id, "accepted")).rows[0].r).toBe("accepted");
    const row = (await owner.query("select status, method, identity_match, ip::text from sale_confirmations where id = $1", [c.id])).rows[0];
    expect(row).toEqual({ status: "accepted", method: "vipps", identity_match: "phone", ip: "203.0.113.5/32" });
    const sale = (await owner.query("select status from sales where id = $1", [s.sale])).rows[0];
    expect(sale.status).toBe("confirmed");
    const event = (await owner.query("select note from sale_events where sale_id = $1 order by id desc limit 1", [s.sale])).rows[0];
    expect(event.note).toBe("Godtatt skriftlig av kunden med Vipps");
    // Decided once, and frozen.
    expect((await decide(c.id, "rejected")).rows[0].r).toBe("not_pending");
    await expect(owner.query("update sale_confirmations set document = '{}' where id = $1", [c.id])).rejects.toThrow(/cannot be changed/);
  });

  it("lets the customer decline without identifying, and refuses expired links", async () => {
    const s = await setup();
    const c = await confirmation(s);
    expect((await decide(c.id, "rejected", "none", null, null)).rows[0].r).toBe("rejected");
    expect((await owner.query("select status from sales where id = $1", [s.sale])).rows[0].status).toBe("rejected");

    const s2 = await setup();
    const old = await confirmation(s2, "-1 minute");
    expect((await auth.query("select app.confirmation_view($1) as v", [old.hash])).rows[0].v.status).toBe("expired");
    expect((await decide(old.id, "accepted")).rows[0].r).toBe("expired");
    await expect(decide((await confirmation(await setup())).id, "accepted", "none")).rejects.toThrow(/verified identity/);
  });

  it("is accepted only by the buyer: someone else leaves the link open and the sale waiting", async () => {
    const s = await setup();
    const c = await confirmation(s);
    // Another person's BankID: neither the name nor a phone number matches.
    expect((await decide(c.id, "accepted", "bankid", "Per Annen", null)).rows[0].r).toBe("wrong_person");
    expect((await owner.query("select status, decided_at from sale_confirmations where id = $1", [c.id])).rows[0]).toEqual({
      status: "pending",
      decided_at: null,
    });
    expect((await owner.query("select status from sales where id = $1", [s.sale])).rows[0].status).toBe("awaiting_confirmation");
    const attempt = (await owner.query("select from_status, to_status, note from sale_events where sale_id = $1 order by id desc limit 1", [s.sale]))
      .rows[0];
    expect(attempt).toMatchObject({ from_status: "awaiting_confirmation", to_status: "awaiting_confirmation" });
    expect(attempt.note).toMatch(/^Forsøk på å godta med BankID av en annen enn kjøperen/);
    expect(attempt.note).not.toContain("Per Annen");
    // Vipps with another number and another name is refused too.
    expect((await decide(c.id, "accepted", "vipps", "Per Annen", "+4799999999")).rows[0].r).toBe("wrong_person");
    // The buyer's BankID, with a middle name and without the accent she was registered with.
    await owner.query("update customers set name = 'Kåri Kunde' where id = $1", [s.customer]);
    expect((await decide(c.id, "accepted", "bankid", "KARI MARIE KUNDE", null)).rows[0].r).toBe("accepted");
    expect((await owner.query("select identity_match from sale_confirmations where id = $1", [c.id])).rows[0].identity_match).toBe("name");
    expect((await owner.query("select status from sales where id = $1", [s.sale])).rows[0].status).toBe("confirmed");
  });

  it("is accepted for a business by its contact person", async () => {
    const s = await setup();
    await owner.query("update customers set kind = 'business', name = 'Kunde AS', contact_name = 'Kari Kunde', phone = null where id = $1", [
      s.customer,
    ]);
    const c = await confirmation(s);
    // The company's name is not a person.
    expect((await decide(c.id, "accepted", "bankid", "Kunde AS", null)).rows[0].r).toBe("wrong_person");
    expect((await decide(c.id, "accepted", "bankid", "Kari Kunde", null)).rows[0].r).toBe("accepted");
  });

  it("compares names by first and last name, without case or accents", async () => {
    const same = async (a: string | null, b: string) => (await owner.query("select app.same_person_name($1, $2) as r", [a, b])).rows[0].r;
    expect(await same("Øyvind Ærlig", "øyvind ærlig")).toBe(true);
    expect(await same("Ola Nordmann", "Ola Johan Nordmann")).toBe(true);
    expect(await same("Ola Johan Nordmann", "Ola Nordmann")).toBe(true);
    expect(await same("Nordmann Ola", "Ola Nordmann")).toBe(true);
    expect(await same("Ola", "Ola Nordmann")).toBe(false);
    expect(await same("Kari Nordmann", "Ola Nordmann")).toBe(false);
    expect(await same("", "Ola Nordmann")).toBe(false);
    expect(await same(null, "Ola Nordmann")).toBe(false);
  });

  it("cannot be answered when the sale no longer waits for it", async () => {
    const s = await setup();
    const c = await confirmation(s);
    await owner.query("update sales set status = 'cancelled' where id = $1", [s.sale]);
    // Revoked by the trigger when the sale was cancelled.
    expect((await owner.query("select status from sale_confirmations where id = $1", [c.id])).rows[0].status).toBe("revoked");
    expect((await decide(c.id, "accepted")).rows[0].r).toBe("not_pending");
    expect((await auth.query("select app.confirmation_view($1) as v", [c.hash])).rows[0].v).toMatchObject({ status: "revoked", document: null });
    expect((await owner.query("select status from sales where id = $1", [s.sale])).rows[0].status).toBe("cancelled");
  });

  it("is visible with the sale, written with sales.manage, and closed to other call centres", async () => {
    const s = await setup();
    const c = await confirmation(s);
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      expect((await db.query("select id from sale_confirmations")).rows.map((r) => r.id)).toEqual([c.id]);
      await db.query("update sale_confirmations set status = 'revoked' where id = $1", [c.id]);
      await rejects(db, "update sale_confirmations set status = 'accepted' where id = $1", [c.id], /row-level security|cannot be changed/);
    });
    const compliance = await member(s.org, "compliance");
    await as(api, { userId: compliance, orgId: s.org }, async (db) => {
      expect((await db.query("update sale_confirmations set status = 'revoked' where id = $1", [c.id])).rowCount).toBe(0);
    });
    const stranger = await member(await createOrg(), "admin");
    await as(api, { userId: stranger, orgId: s.org }, async (db) => {
      expect((await db.query("select id from sale_confirmations")).rowCount).toBe(0);
    });
    // Evidence cannot be written by the call centre: a new confirmation is pending and empty.
    await as(api, { userId: s.seller, orgId: s.org }, async (db) => {
      await rejects(
        db,
        `insert into sale_confirmations (organization_id, sale_id, token_hash, document, document_hash, template_version_id, expires_at, status, decided_at, method, identity_ref)
         values ($1, $2, $3, '{}', $4, $5, now() + interval '1 day', 'accepted', now(), 'bankid', $6)`,
        [s.org, s.sale, randomBytes(32), "a".repeat(64), s.version, "c".repeat(64)],
        /row-level security/,
      );
    });
    // The login role reaches confirmations only through the functions.
    await expect(auth.query("select * from sale_confirmations")).rejects.toThrow(/permission denied/);
  });
});
