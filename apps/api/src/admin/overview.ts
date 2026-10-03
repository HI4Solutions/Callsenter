// Superadmin → Oversikt (docs/plan.md, section 10): the platform at a glance. The counts come
// from app.platform_overview() (never content), the money from Økonomi: MRR and unpaid
// invoices as under Faktura, and this month's revenue, costs and result as under Regnskap.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { figures } from "./accounting.ts";
import { billingTotals } from "./billing.ts";

export async function platformOverview(db: pg.Pool, session: Session) {
  return withSession(db, { ...session, activeOrganizationId: null }, async (c) => {
    const { rows } = await c.query<{ o: { today: string } & Record<string, unknown> }>("select app.platform_overview() as o");
    const overview = rows[0]!.o;
    const month = await figures(c, `${overview.today.slice(0, 7)}-01`, overview.today);
    const billing = await billingTotals(c);
    const mrr = Number(billing.mrr);
    return {
      ...overview,
      money: {
        mrr,
        arr: Math.round(mrr * 12 * 100) / 100,
        revenue: month.revenue.net,
        costs: month.costs.total,
        result: month.result,
        outstanding: Number(billing.outstanding),
        overdue: Number(billing.overdue),
        missed: billing.missed,
        drafts: billing.drafts,
        scheduled: billing.scheduled,
      },
    };
  });
}
