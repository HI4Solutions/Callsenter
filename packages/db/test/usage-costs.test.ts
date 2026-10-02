import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, rejects } from "./helpers.ts";

describe("usage costs", () => {
  it("keeps prices, rates and eID counts to superadmins", async () => {
    const org = await createOrg();
    const orgAdmin = await member(org, "admin");
    await as(api, { userId: orgAdmin, orgId: org }, async (db) => {
      await rejects(db, "select * from app.eid_usage(now() - interval '1 day', now())", [], /only superadmins/);
      expect((await db.query("select 1 from model_prices")).rowCount).toBe(0);
      expect((await db.query("select 1 from service_prices")).rowCount).toBe(0);
      expect((await db.query("update service_prices set amount = 1")).rowCount).toBe(0);
      expect((await db.query("select 1 from accounting_entries")).rowCount).toBe(0);
      expect((await db.query("select 1 from fixed_costs")).rowCount).toBe(0);
      await rejects(
        db,
        "insert into accounting_entries (kind, description, amount, occurred_on) values ('cost', 'x', 1, current_date)",
        [],
        /row-level security/,
      );
    });
    const admin = await createUser();
    await makePlatformAdmin(admin);
    await as(api, { userId: admin }, async (db) => {
      expect((await db.query("select count(*)::int as n from model_prices")).rows[0].n).toBeGreaterThanOrEqual(4);
      await db.query("insert into exchange_rates (day, usd_nok) values ('2000-01-03', 9.5) on conflict do nothing");
      expect(Number((await db.query("select app.usd_nok('2000-01-05') as r")).rows[0].r)).toBe(9.5);
    });
  });
});
