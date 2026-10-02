import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, owner, rejects, worker } from "./helpers.ts";

async function setup() {
  const admin = await createUser("Super Admin");
  await makePlatformAdmin(admin);
  const org = await createOrg();
  await owner.query("update organizations set invoice_email = 'faktura@example.test', trial_ends_at = now() + interval '3 days' where id = $1", [org]);
  await owner.query("update billing_settings set company_name = 'Leverandør AS', org_number = '999999999', account_number = '12345678903'");
  const pkg = (
    await owner.query(
      "insert into billing_packages (name, unit_price, modules) values ('VeriQall Pro', 2990, '{transcription,ai_control}') returning id",
    )
  ).rows[0].id;
  return { admin, org, pkg };
}

// Moves an invoice's due date without the rules (as if time had passed).
async function backdate(id: string, dueDaysAgo: number) {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("alter table invoices disable trigger invoices_guard");
    await c.query("update invoices set due_date = app.oslo_today() - $2::int where id = $1", [id, dueDaysAgo]);
    await c.query("alter table invoices enable trigger invoices_guard");
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}

async function packageInvoice(db: import("pg").PoolClient, org: string, pkg: string, grantAccess = true) {
  const id = (await db.query("insert into invoices (organization_id, grant_access) values ($1, $2) returning id", [org, grantAccess])).rows[0].id;
  await db.query(
    `insert into invoice_lines (invoice_id, organization_id, kind, package_id, description, quantity, unit_price)
     values ($1, $2, 'package', $3, 'VeriQall Pro', 1, 2990)`,
    [id, org, pkg],
  );
  return id as string;
}

describe("invoicing v2", () => {
  it("gives every call centre a fixed customer number from 10001", async () => {
    const org = await createOrg();
    const n = (await owner.query("select customer_number from organizations where id = $1", [org])).rows[0].customer_number;
    expect(n).toBeGreaterThanOrEqual(10001);
    await expect(owner.query("update organizations set customer_number = customer_number + 1 where id = $1", [org])).rejects.toThrow(/fixed/);
  });

  it("opens the call centre through the period and switches on the package's modules when sent", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      const id = await packageInvoice(db, s.org, s.pkg);
      await db.query("update invoices set status = 'sent' where id = $1", [id]);
      const inv = (
        await db.query(
          "select period_start = app.oslo_today() as starts, period_end - period_start + 1 = app.days_in_month(app.oslo_today()) as month, recipient->>'customerNumber' as customer from invoices where id = $1",
          [id],
        )
      ).rows[0];
      expect(inv.starts && inv.month).toBe(true);
      expect(Number(inv.customer)).toBeGreaterThanOrEqual(10001);
      const org = (
        await db.query(
          `select trial_ends_at is null as trial_ended,
                  access_until = ((select period_end from invoices where id = $2) + 1)::timestamp at time zone 'Europe/Oslo' as until
           from organizations where id = $1`,
          [s.org, id],
        )
      ).rows[0];
      expect(org).toEqual({ trial_ended: true, until: true });
      // Seen inside the call centre (the superadmin opens it).
      await db.query("select set_config('app.current_org_id', $1, true)", [s.org]);
      const modules = await db.query("select module from organization_modules where organization_id = $1 and enabled order by 1", [s.org]);
      expect(modules.rows.map((m) => m.module)).toEqual(["ai_control", "transcription"]);
    });
  });

  it("schedules an invoice for a later date and sends it that morning", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      const id = await packageInvoice(db, s.org, s.pkg, false);
      await rejects(db, "update invoices set status = 'scheduled', issue_date = app.oslo_today() where id = $1", [id], /future invoice date/);
      await db.query("update invoices set status = 'scheduled', issue_date = app.oslo_today() + 3 where id = $1", [id]);
      // Still editable while scheduled, and not sent before its date.
      await db.query("update invoice_lines set quantity = 2 where invoice_id = $1", [id]);
      expect((await db.query("select app.billing_daily() as id")).rows.map((r) => r.id)).not.toContain(id);
      expect((await db.query("select status, number from invoices where id = $1", [id])).rows[0]).toEqual({ status: "scheduled", number: null });
    });
  });

  it("closes the call centre 5 days after a missed payment, and opens it again when paid", async () => {
    const s = await setup();
    // Committed: the daily run and the payment come in separate transactions.
    const id: string = (await owner.query("insert into invoices (organization_id, grant_access) values ($1, true) returning id", [s.org])).rows[0].id;
    await owner.query(
      "insert into invoice_lines (invoice_id, organization_id, kind, package_id, description, quantity, unit_price) values ($1, $2, 'package', $3, 'Pro', 1, 100)",
      [id, s.org, s.pkg],
    );
    await owner.query("update invoices set status = 'sent' where id = $1", [id]);
    const agreement = (
      await owner.query(
        `insert into recurring_invoices (organization_id, name, lines, interval_months, start_date, next_date)
         values ($1, 'Abonnement', '[{"description": "Pro", "quantity": 1, "unitPrice": 100}]', 1, app.oslo_today() + 40, app.oslo_today() + 40) returning id`,
        [s.org],
      )
    ).rows[0].id;
    const open = async () => (await owner.query("select app.organization_open(o) as open from organizations o where id = $1", [s.org])).rows[0].open;
    expect(await open()).toBe(true);

    // 4 days late: still open. 6 days late: payment missed, closed, agreement paused.
    await backdate(id, 4);
    await worker.query("select app.billing_daily()");
    expect((await owner.query("select status from invoices where id = $1", [id])).rows[0].status).toBe("sent");
    await backdate(id, 6);
    await worker.query("select app.billing_daily()");
    expect((await owner.query("select status, missed_at is not null as missed from invoices where id = $1", [id])).rows[0]).toEqual({
      status: "payment_missed",
      missed: true,
    });
    expect(await open()).toBe(false);
    expect((await owner.query("select paused from recurring_invoices where id = $1", [agreement])).rows[0].paused).toBe(true);

    await as(api, { userId: s.admin }, async (db) => {
      await db.query("insert into invoice_payments (invoice_id, organization_id, amount, paid_on) values ($1, $2, 125, app.oslo_today())", [id, s.org]);
      expect((await db.query("select status from invoices where id = $1", [id])).rows[0].status).toBe("paid");
      expect((await db.query("select paused from recurring_invoices where id = $1", [agreement])).rows[0].paused).toBe(false);
      expect((await db.query("select app.organization_open(o) as open from organizations o where id = $1", [s.org])).rows[0].open).toBe(true);
    });
  });

  it("gives a fixed agreement's invoice the agreement's whole period", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      await db.query(
        `insert into recurring_invoices (organization_id, name, lines, interval_months, start_date, next_date)
         values ($1, 'Kvartal', '[{"description": "Pro", "quantity": 1, "unitPrice": 100}]', 3, app.oslo_today() + 10, app.oslo_today() + 10)`,
        [s.org],
      );
      const [id] = (await db.query("select app.billing_daily() as id")).rows.map((r) => r.id);
      const inv = (
        await db.query(
          `select period_start = app.oslo_today() + 10 as starts,
                  period_end = ((app.oslo_today() + 10) + interval '3 months')::date - 1 as ends
           from invoices where id = $1`,
          [id],
        )
      ).rows[0];
      expect(inv).toEqual({ starts: true, ends: true });
      const open = await db.query(
        "select access_until = (((app.oslo_today() + 10) + interval '3 months')::date)::timestamp at time zone 'Europe/Oslo' as ok from organizations where id = $1",
        [s.org],
      );
      expect(open.rows[0].ok).toBe(true);
    });
  });

  it("keeps scheduled invoices from the call centre, and one bad invoice from stopping the run", async () => {
    const s = await setup();
    // Committed, so the worker's run sees them.
    const bad: string = (await owner.query("insert into invoices (organization_id) values ($1) returning id", [s.org])).rows[0].id;
    await owner.query("insert into invoice_lines (invoice_id, organization_id, description, quantity, unit_price) values ($1, $2, 'X', 1, 1)", [bad, s.org]);
    await owner.query("update invoices set status = 'scheduled', issue_date = app.oslo_today() + 1 where id = $1", [bad]);
    await owner.query("delete from invoice_lines where invoice_id = $1", [bad]);
    const good: string = (await owner.query("insert into invoices (organization_id) values ($1) returning id", [s.org])).rows[0].id;
    await owner.query("insert into invoice_lines (invoice_id, organization_id, description, quantity, unit_price) values ($1, $2, 'Y', 1, 1)", [good, s.org]);
    await owner.query("update invoices set status = 'scheduled', issue_date = app.oslo_today() + 1 where id = $1", [good]);

    const orgAdmin = await member(s.org, "admin");
    await as(api, { userId: orgAdmin, orgId: s.org }, async (db) => {
      expect((await db.query("select 1 from invoices where id = any($1)", [[bad, good]])).rowCount).toBe(0);
    });

    // Both are due today: the bad one is skipped, the good one is sent.
    const c = await owner.connect();
    try {
      await c.query("begin");
      await c.query("alter table invoices disable trigger invoices_guard");
      await c.query("update invoices set issue_date = app.oslo_today() where id = any($1)", [[bad, good]]);
      await c.query("alter table invoices enable trigger invoices_guard");
      await c.query("commit");
    } finally {
      c.release();
    }
    const sent = (await worker.query("select app.billing_daily() as id")).rows.map((r) => r.id);
    expect(sent).toContain(good);
    expect(sent).not.toContain(bad);
    expect((await owner.query("select status from invoices where id = $1", [bad])).rows[0].status).toBe("scheduled");
  });

  it("credits an invoice whose payment was missed, and does not let a period in the past close the call centre", async () => {
    const s = await setup();
    await as(api, { userId: s.admin }, async (db) => {
      const old = await packageInvoice(db, s.org, s.pkg);
      await db.query("update invoices set period_start = '2025-09-01', period_end = '2025-09-30' where id = $1", [old]);
      await db.query("update invoices set status = 'sent' where id = $1", [old]);
      expect((await db.query("select access_until from organizations where id = $1", [s.org])).rows[0].access_until).toBeNull();

      await db.query("update invoices set status = 'payment_missed' where id = $1", [old]);
      const credit = (await db.query("select app.credit_invoice($1, 'Bestridt') as id", [old])).rows[0].id;
      expect((await db.query("select status from invoices where id = $1", [old])).rows[0].status).toBe("credited");
      expect((await db.query("select kind, status from invoices where id = $1", [credit])).rows[0]).toEqual({ kind: "credit", status: "sent" });
    });
  });

  it("lets only superadmins and the worker run invoicing, and keeps packages to superadmins", async () => {
    const s = await setup();
    const orgAdmin = await member(s.org, "admin");
    await as(api, { userId: orgAdmin, orgId: s.org }, async (db) => {
      await rejects(db, "select app.billing_daily()", [], /only superadmins/);
      expect((await db.query("select 1 from billing_packages")).rowCount).toBe(0);
    });
    await as(api, { userId: s.admin, strong: false }, async (db) => {
      await rejects(db, "select app.billing_daily()", [], /only superadmins/);
    });
    await expect(worker.query("select app.billing_daily()")).resolves.toBeTruthy();
  });
});
