// Sales in the session's call centre (docs/plan.md, section 12). Visibility follows calls (own,
// team or all; RLS decides), sales.manage registers and moves them. The database picks the
// product's published template version and records every status change in sale_events.
import { isSaleStatus } from "@veriqall/shared";
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, optionalText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

const SUMMARY = `s.id, s.status, s.sold_at as "soldAt", s.status_changed_at as "statusChangedAt",
  s.price_once::text as "priceOnce", s.price_monthly::text as "priceMonthly", s.binding_months as "bindingMonths",
  s.customer_id as "customerId", c.name as "customerName", s.product_id as "productId", p.name as "productName",
  tv.version as "templateVersion", s.seller_id as "sellerId", u.full_name as "sellerName", t.name as "teamName"`;

const FROM = `from sales s
  left join customers c on c.id = s.customer_id
  join products p on p.id = s.product_id
  join product_template_versions tv on tv.id = s.template_version_id
  left join users u on u.id = s.seller_id
  left join teams t on t.id = s.team_id`;

// The database's refusals, in words for the user.
function translate(error: unknown): never {
  const message = (error as Error).message ?? "";
  const code = (error as { code?: string }).code;
  if (message.includes("no published template version")) throw new BadRequest("Produktet har ingen publisert mal og kan ikke selges.");
  if (message.includes("not the published one")) throw new BadRequest("Produktmalen er endret. Last siden på nytt og prøv igjen.");
  if (message.includes("customer not found or archived")) throw new BadRequest("Fant ikke kunden, eller kunden er arkivert.");
  if (message.includes("seller is not an active member")) throw new BadRequest("Selgeren er ikke aktiv i callsenteret.");
  if (message.includes("cannot go from")) throw new BadRequest("Salget kan ikke få denne statusen nå. Last siden på nytt.");
  if (message.includes("only the status and the note")) throw new BadRequest("Bare status og notat kan endres på et salg.");
  if (code === "42501") throw new BadRequest("Du kan bare registrere dine egne salg.");
  if (code === "23503") throw new BadRequest("Ukjent kunde, produkt eller selger.");
  throw error;
}

export async function listSales(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const status = query.status && isSaleStatus(query.status) ? query.status : null;
  const customerId = query.customerId && isUuid(query.customerId) ? query.customerId : null;
  const mine = query.mine === "1";
  const q = (query.q ?? "").trim().slice(0, 100);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${SUMMARY} ${FROM}
       where s.organization_id = app.current_org_id()
         and ($1::text is null or s.status = $1)
         and ($2::uuid is null or s.customer_id = $2)
         and (not $3 or s.seller_id = app.current_user_id())
         and ($4 = '' or c.name ilike '%' || $4 || '%' or p.name ilike '%' || $4 || '%')
       order by s.sold_at desc
       limit 200`,
      [status, customerId, mine, q],
    );
    return rows;
  });
}

export async function createSale(db: pg.Pool, session: Session, body: Body) {
  const customerId = optionalText(body, "customerId", "Kunde", 64);
  const productId = optionalText(body, "productId", "Produkt", 64);
  if (!customerId || !isUuid(customerId)) throw new BadRequest("Velg en kunde.");
  if (!productId || !isUuid(productId)) throw new BadRequest("Velg et produkt.");
  const sellerId = optionalText(body, "sellerId", "Selger", 64) ?? session.userId;
  if (!isUuid(sellerId)) throw new BadRequest("Ukjent selger.");
  const note = optionalText(body, "note", "Notat", 2000) ?? null;
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into sales (organization_id, customer_id, product_id, seller_id, note)
         values (app.current_org_id(), $1, $2, $3, $4) returning id`,
        [customerId, productId, sellerId, note],
      );
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

export async function getSale(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const sale = await c.query(
      `select ${SUMMARY}, s.note, s.withdrawal_days as "withdrawalDays", s.template_version_id as "templateVersionId",
              c.kind as "customerKind", c.phone as "customerPhone", c.email as "customerEmail"
       ${FROM} where s.id = $1`,
      [id],
    );
    if (!sale.rows[0]) throw new NotFound();
    const events = await c.query(
      `select e.id::text, e.from_status as "fromStatus", e.to_status as "toStatus", e.note,
              u.full_name as "actorName", e.created_at as "createdAt"
       from sale_events e left join users u on u.id = e.actor_user_id
       where e.sale_id = $1 order by e.id`,
      [id],
    );
    return { ...sale.rows[0], events: events.rows };
  });
}

export async function updateSale(db: pg.Pool, session: Session, id: string, body: Body) {
  const status = body.status;
  if (status !== undefined && !isSaleStatus(status)) throw new BadRequest("Ukjent status.");
  const statusNote = optionalText(body, "statusNote", "Begrunnelse", 1000);
  const note = optionalText(body, "note", "Notat", 2000);
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (status !== undefined) {
    sets.push(`status = $${params.push(status)}`, `status_note = $${params.push(statusNote ?? null)}`);
  }
  if (note !== undefined) sets.push(`note = $${params.push(note)}`);
  return withSession(db, session, async (c) => {
    const current = await c.query<{ status: string }>("select status from sales where id = $1", [id]);
    if (!current.rows[0]) throw new NotFound();
    if (status !== undefined && status === current.rows[0].status) throw new BadRequest("Salget har allerede denne statusen.");
    if (sets.length) {
      try {
        await c.query(`update sales set ${sets.join(", ")} where id = $1`, params);
      } catch (error) {
        translate(error);
      }
    }
    return { id };
  });
}
