// Sending a sale to the customer for written acceptance (docs/plan.md, section 14, module 8).
// The call centre gets a secret link to send (SMS comes when a provider is chosen); the customer
// accepts with BankID or Vipps on the public page (src/confirm).
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest } from "../admin/validate.ts";
import { randomToken, sha256 } from "../auth/crypto.ts";
import type { Session } from "../auth/session.ts";
import { documentHash } from "../confirm/document.ts";
import { withSession } from "../me.ts";

// How long the customer has to decide.
export const CONFIRMATION_DAYS = 7;

interface SaleForDocument {
  status: string;
  sold_at: Date;
  price_once: string | null;
  price_monthly: string | null;
  binding_months: number;
  withdrawal_days: number;
  notice_months: number;
  terms: string;
  version: number;
  template_version_id: string;
  product: string;
  kind: string;
  customer: string;
  org_number: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  company: string;
  company_org_number: string | null;
  seller: string | null;
}

export async function createConfirmation(db: pg.Pool, session: Session, appOrigin: string, saleId: string) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<SaleForDocument>(
      `select s.status, s.sold_at, s.price_once::text, s.price_monthly::text, s.binding_months, s.withdrawal_days,
              tv.notice_months, tv.terms, tv.version, s.template_version_id, p.name as product,
              cu.kind, cu.name as customer, cu.org_number, cu.birth_date::text, cu.phone, cu.email,
              cu.address_line, cu.postal_code, cu.city,
              o.name as company, o.org_number as company_org_number, u.full_name as seller
       from sales s
       join product_template_versions tv on tv.id = s.template_version_id
       join products p on p.id = s.product_id
       join customers cu on cu.id = s.customer_id
       join organizations o on o.id = s.organization_id
       left join users u on u.id = s.seller_id
       where s.id = $1`,
      [saleId],
    );
    const s = rows[0];
    if (!s) throw new NotFound();
    if (s.status !== "registered" && s.status !== "awaiting_confirmation") {
      throw new BadRequest("Salget kan ikke sendes til bekreftelse nå.");
    }
    const issuedAt = new Date();
    const document = {
      type: "Salgsbekreftelse",
      formatVersion: 1,
      issuedAt: issuedAt.toISOString(),
      seller: { company: s.company, orgNumber: s.company_org_number, salesperson: s.seller },
      customer: {
        kind: s.kind,
        name: s.customer,
        orgNumber: s.org_number,
        birthDate: s.birth_date,
        phone: s.phone,
        email: s.email,
        address: [s.address_line, [s.postal_code, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
      },
      product: { name: s.product, templateVersion: s.version },
      price: { currency: "NOK", once: s.price_once, monthly: s.price_monthly },
      bindingMonths: s.binding_months,
      noticeMonths: s.notice_months,
      withdrawalDays: s.withdrawal_days,
      terms: s.terms,
      soldAt: s.sold_at.toISOString(),
    };
    const token = randomToken();
    // Only one open link per sale: a new one replaces the old.
    await c.query("update sale_confirmations set status = 'revoked' where sale_id = $1 and status = 'pending'", [saleId]);
    const created = await c.query<{ id: string; expires_at: Date }>(
      `insert into sale_confirmations (organization_id, sale_id, token_hash, document, document_hash, template_version_id,
         created_by, expires_at)
       values (app.current_org_id(), $1, $2, $3, $4, $5, app.current_user_id(), now() + make_interval(days => $6))
       returning id, expires_at`,
      [saleId, sha256(token), JSON.stringify(document), documentHash(document), s.template_version_id, CONFIRMATION_DAYS],
    );
    if (s.status === "registered") {
      await c.query("update sales set status = 'awaiting_confirmation', status_note = 'Sendt til kunden for bekreftelse' where id = $1", [
        saleId,
      ]);
    }
    return {
      id: created.rows[0]!.id,
      // Shown once; only the hash is stored.
      url: new URL(`/bekreft/${token}`, appOrigin).toString(),
      expiresAt: created.rows[0]!.expires_at,
    };
  });
}

export async function revokeConfirmation(db: pg.Pool, session: Session, saleId: string, confirmationId: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query(
      "update sale_confirmations set status = 'revoked' where id = $1 and sale_id = $2 and status = 'pending'",
      [confirmationId, saleId],
    );
    if (!rowCount) throw new NotFound();
    return { id: confirmationId };
  });
}

export async function listConfirmations(c: pg.PoolClient, saleId: string) {
  const { rows } = await c.query(
    `select sc.id, sc.status, sc.created_at as "createdAt", sc.expires_at as "expiresAt", sc.viewed_at as "viewedAt",
            sc.decided_at as "decidedAt", sc.method, sc.identity_name as "identityName", sc.identity_phone as "identityPhone",
            sc.identity_match as "identityMatch", host(sc.ip) as ip, sc.document_hash as "documentHash",
            u.full_name as "createdByName"
     from sale_confirmations sc left join users u on u.id = sc.created_by
     where sc.sale_id = $1 order by sc.created_at desc`,
    [saleId],
  );
  return rows;
}
