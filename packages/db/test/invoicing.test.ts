import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, owner, rejects } from "./helpers.ts";

async function setup() {
  const admin = await createUser("Super Admin");
  await makePlatformAdmin(admin);
  const org = await createOrg();
  await owner.query("update organizations set invoice_email = 'faktura@example.test', invoice_address = 'Gate 1, 0150 Oslo' where id = $1", [org]);
  await owner.query(
    `update billing_settings set company_name = 'Leverandør AS', org_number = '999999999', account_number = '12345678903',
       address = 'Vei 2, 0150 Oslo', due_days = 14`,
  );
  return { admin, org };
}

async function draft(db: import("pg").PoolClient, org: string, lines: [string, number, number][] = [["Lisens", 1, 1000]]) {
  const id = (await db.query("insert into invoices (organization_id) values ($1) returning id", [org])).rows[0].id as string;
  for (const [i, [description, quantity, price]] of lines.entries()) {
    await db.query("insert into invoice_lines (invoice_id, organization_id, position, description, quantity, unit_price) values ($1, $2, $3, $4, $5, $6)", [
      id,
      org,
      i,
      description,
      quantity,
      price,
    ]);
  }
  return id;
}

describe("invoicing", () => {
  it("numbers an invoice when it is sent, freezes it, and marks it paid when payments cover it", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      const next = (await db.query("select next_number from billing_settings")).rows[0].next_number;
      const id = await draft(db, s.org, [
        ["Lisens", 2, 1000],
        ["Opplæring", 1.5, 800],
      ]);
      await db.query("update invoices set status = 'sent' where id = $1", [id]);
      const inv = (await db.query("select number, subtotal::text, vat::text, total::text, recipient, seller, due_date - issue_date as days from invoices where id = $1", [id])).rows[0];
      expect(inv).toMatchObject({ number: next, subtotal: "3200.00", vat: "800.00", total: "4000.00", days: 14 });
      expect(inv.recipient).toMatchObject({ email: "faktura@example.test", address: "Gate 1, 0150 Oslo" });
      expect(inv.seller).toMatchObject({ name: "Leverandør AS", accountNumber: "12345678903" });

      // Frozen.
      await rejects(db, "update invoices set note = 'Endret' where id = $1", [id], /cannot be changed/);
      await rejects(db, "update invoice_lines set unit_price = 1 where invoice_id = $1", [id], /cannot be changed/);
      await rejects(db, "insert into invoice_lines (invoice_id, organization_id, description, quantity, unit_price) values ($1, $2, 'X', 1, 1)", [id, s.org], /cannot be changed/);
      await rejects(db, "delete from invoices where id = $1", [id], /only drafts/);

      await db.query("insert into invoice_payments (invoice_id, organization_id, amount, paid_on) values ($1, $2, 1000, current_date)", [id, s.org]);
      expect((await db.query("select status from invoices where id = $1", [id])).rows[0].status).toBe("sent");
      await db.query("insert into invoice_payments (invoice_id, organization_id, amount, paid_on) values ($1, $2, 3000, current_date)", [id, s.org]);
      expect((await db.query("select status, paid_at is not null as paid from invoices where id = $1", [id])).rows[0]).toEqual({ status: "paid", paid: true });
      await rejects(db, "delete from invoice_payments where invoice_id = $1", [id], /permission denied/);

      // Drafts cannot be sent without lines, and take no payments.
      const empty = (await db.query("insert into invoices (organization_id) values ($1) returning id", [s.org])).rows[0].id;
      await rejects(db, "update invoices set status = 'sent' where id = $1", [empty], /at least one line/);
      await rejects(db, "insert into invoice_payments (invoice_id, organization_id, amount, paid_on) values ($1, $2, 1, current_date)", [empty, s.org], /sent invoices/);
      await rejects(db, "insert into invoices (organization_id, status, number) values ($1, 'sent', 999999)", [s.org], /row-level security/);
      await db.query("delete from invoices where id = $1", [empty]);
    });
  });

  it("credits a sent invoice with a numbered credit note", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      const id = await draft(db, s.org);
      await db.query("update invoices set status = 'sent' where id = $1", [id]);
      const number = (await db.query("select number from invoices where id = $1", [id])).rows[0].number;
      const credit = (await db.query("select app.credit_invoice($1, 'Feil pris') as id", [id])).rows[0].id;
      const row = (await db.query("select kind, status, number, total::text, note from invoices where id = $1", [credit])).rows[0];
      expect(row).toEqual({ kind: "credit", status: "sent", number: number + 1, total: "-1250.00", note: "Feil pris" });
      expect((await db.query("select status from invoices where id = $1", [id])).rows[0].status).toBe("credited");
      await rejects(db, "select app.credit_invoice($1, 'Igjen')", [id], /only a sent invoice/);
    });
  });

  it("makes drafts from fixed agreements, one per period", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      await db.query(
        `insert into recurring_invoices (organization_id, name, lines, interval_months, next_date)
         values ($1, 'Abonnement', '[{"description": "VeriQall", "quantity": 1, "unitPrice": 2990}]', 1, current_date - 40)`,
        [s.org],
      );
      expect((await db.query("select app.generate_recurring_invoices(current_date) as n")).rows[0].n).toBe(2);
      expect((await db.query("select app.generate_recurring_invoices(current_date) as n")).rows[0].n).toBe(0);
      const drafts = await db.query(
        "select i.status, l.description, l.unit_price::text, l.vat_rate::text from invoices i join invoice_lines l on l.invoice_id = i.id where i.organization_id = $1",
        [s.org],
      );
      expect(drafts.rows).toEqual([
        { status: "draft", description: "VeriQall", unit_price: "2990.00", vat_rate: "0.250" },
        { status: "draft", description: "VeriQall", unit_price: "2990.00", vat_rate: "0.250" },
      ]);
    });
  });

  it("shows a call centre its own sent invoices with billing.read, and nothing else", async () => {
    const s = await setup();
    // Committed fixtures (as() rolls back): one sent invoice and one draft.
    const sent = (await owner.query("insert into invoices (organization_id) values ($1) returning id", [s.org])).rows[0].id;
    await owner.query("insert into invoice_lines (invoice_id, organization_id, description, quantity, unit_price) values ($1, $2, 'Lisens', 1, 1000)", [sent, s.org]);
    await owner.query("update invoices set status = 'sent' where id = $1", [sent]);
    const unsent = (await owner.query("insert into invoices (organization_id) values ($1) returning id", [s.org])).rows[0].id;
    const orgAdmin = await member(s.org, "admin");
    await as(api, { userId: orgAdmin, orgId: s.org }, async (db) => {
      expect((await db.query("select id from invoices")).rows.map((r) => r.id)).toEqual([sent]);
      expect((await db.query("select count(*)::int as n from invoice_lines")).rows[0].n).toBe(1);
      expect((await db.query("select 1 from billing_settings")).rowCount).toBe(0);
      expect((await db.query("update invoices set note = 'x' where id = $1", [unsent])).rowCount).toBe(0);
      await rejects(db, "insert into invoices (organization_id) values ($1)", [s.org], /row-level security/);
      await rejects(db, "select app.credit_invoice($1, 'x')", [sent], /only superadmins/);
    });
    // Not without a strong session, and not for sellers or other call centres.
    await as(api, { userId: orgAdmin, orgId: s.org, strong: false }, async (db) => {
      expect((await db.query("select 1 from invoices")).rowCount).toBe(0);
    });
    const seller = await member(s.org, "seller");
    await as(api, { userId: seller, orgId: s.org }, async (db) => {
      expect((await db.query("select 1 from invoices")).rowCount).toBe(0);
    });
    const other = await createOrg();
    const otherAdmin = await member(other, "admin");
    await as(api, { userId: otherAdmin, orgId: other }, async (db) => {
      expect((await db.query("select 1 from invoices")).rowCount).toBe(0);
    });
    // A superadmin without BankID is not a superadmin.
    await as(api, { userId: s.admin, strong: false }, async (db) => {
      expect((await db.query("select 1 from invoices where organization_id = $1", [s.org])).rowCount).toBe(0);
    });
  });
});
