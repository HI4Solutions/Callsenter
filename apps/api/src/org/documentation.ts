// Sale documentation (docs/plan.md, section 14, module 9): everything about one sale in one
// place, for follow-up and complaints. What was offered (the template version, or the document the
// customer accepted), what was said (the calls, with transcript, AI control and report), how it was
// accepted (the confirmation evidence) and what happened since (the status history). Read under
// RLS, so a viewer only sees calls they may see. Contains transcripts, so every read is logged.
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { listConfirmations } from "./confirmations.ts";

export async function saleDocumentation(
  c: pg.PoolClient,
  saleId: string,
  meta: { ip?: string; userAgent?: string },
  resourceType = "sale_documentation",
) {
  const sale = await c.query(
    `select s.id, s.status, s.sold_at as "soldAt", s.price_once::text as "priceOnce", s.price_monthly::text as "priceMonthly",
            s.binding_months as "bindingMonths", s.withdrawal_days as "withdrawalDays", s.note,
            s.customer_id as "customerId", cu.name as "customerName", cu.kind as "customerKind", cu.org_number as "customerOrgNumber",
            cu.phone as "customerPhone", cu.email as "customerEmail",
            s.product_id as "productId", p.name as "productName", tv.version as "templateVersion",
            tv.notice_months as "noticeMonths", tv.terms, tv.required_points as "requiredPoints",
            u.full_name as "sellerName", t.name as "teamName", o.name as "organizationName"
     from sales s
     join products p on p.id = s.product_id
     join product_template_versions tv on tv.id = s.template_version_id
     left join customers cu on cu.id = s.customer_id
     left join users u on u.id = s.seller_id
     left join teams t on t.id = s.team_id
     join organizations o on o.id = s.organization_id
     where s.id = $1`,
    [saleId],
  );
  if (!sale.rows[0]) throw new NotFound();
  const events = await c.query(
    `select e.from_status as "fromStatus", e.to_status as "toStatus", e.note, u.full_name as "actorName", e.created_at as "createdAt"
     from sale_events e left join users u on u.id = e.actor_user_id where e.sale_id = $1 order by e.id`,
    [saleId],
  );
  const accepted = await c.query(
    `select document from sale_confirmations where sale_id = $1 and status = 'accepted' order by decided_at desc limit 1`,
    [saleId],
  );
  const calls = await c.query<{ id: string }>(
    `select c.id, c.title, c.started_at as "startedAt", c.duration_ms as "durationMs", c.status, u.full_name as "userName",
            c.transcription_mode as "transcriptionMode"
     from calls c left join users u on u.id = c.user_id
     where c.sale_id = $1 order by c.started_at`,
    [saleId],
  );
  const callDetails = [];
  for (const call of calls.rows) {
    const segments = await c.query(
      `select speaker, start_ms as "startMs", text from transcript_segments where call_id = $1 order by seq`,
      [call.id],
    );
    const analysis = await c.query(
      `select a.flag, a.summary, a.findings, a.created_at as "createdAt", a.reviewed_at as "reviewedAt",
              ru.full_name as "reviewedByName", a.review_note as "reviewNote"
       from call_analyses a left join users ru on ru.id = a.reviewed_by
       where a.call_id = $1 order by a.created_at desc limit 1`,
      [call.id],
    );
    // The latest finished note; when the seller adjusted it, the AI text is shown beside it.
    const report = await c.query(
      `select r.template_name as "templateName", coalesce(e.content, r.content) as content,
              case when e.content is not null then r.content end as "aiContent",
              e.created_at as "editedAt", u.full_name as "editedByName"
       from reports r
       left join lateral (select content, created_at, edited_by from report_edits where report_id = r.id order by created_at desc limit 1) e on true
       left join users u on u.id = e.edited_by
       where r.call_id = $1 and r.status = 'done' order by r.created_at desc limit 1`,
      [call.id],
    );
    callDetails.push({ ...call, segments: segments.rows, analysis: analysis.rows[0] ?? null, report: report.rows[0] ?? null });
  }
  await c.query(
    `insert into access_log (organization_id, user_id, resource_type, resource_id, action, ip, user_agent)
     values (app.current_org_id(), app.current_user_id(), $1, $2, 'view', $3, $4)`,
    [resourceType, saleId, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
  );
  // Each call shown (transcript, AI control and report) is also a view of that call, so the
  // call's own access log shows it.
  if (calls.rows.length) {
    await c.query(
      `insert into access_log (organization_id, user_id, resource_type, resource_id, action, ip, user_agent)
       select app.current_org_id(), app.current_user_id(), 'call', id::text, 'view', $2, $3 from unnest($1::uuid[]) id`,
      [calls.rows.map((r) => r.id), meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
    );
  }
  return {
    sale: sale.rows[0],
    acceptedDocument: accepted.rows[0]?.document ?? null,
    confirmations: await listConfirmations(c, saleId),
    calls: callDetails,
    events: events.rows,
    generatedAt: new Date().toISOString(),
  };
}

export function getSaleDocumentation(db: pg.Pool, session: Session, saleId: string, meta: { ip?: string; userAgent?: string }) {
  return withSession(db, session, (c) => saleDocumentation(c, saleId, meta));
}
