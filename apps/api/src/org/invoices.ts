// The call centre's own invoices from VeriQall (docs/plan.md, section 16). RLS shows only sent
// invoices of the session's call centre, and only with billing.read.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

export async function listOrgInvoices(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select i.id, i.kind, i.status, i.number, i.issue_date::text as "issueDate", i.due_date::text as "dueDate",
              i.total::text as total,
              (select coalesce(sum(p.amount), 0) from invoice_payments p where p.invoice_id = i.id)::text as paid,
              (i.status = 'sent' and i.kind = 'invoice' and i.due_date < app.oslo_today()) as overdue
       from invoices i
       where i.organization_id = app.current_org_id()
       order by i.number desc`,
    );
    return rows;
  });
}
