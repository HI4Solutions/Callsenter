// Products and their versioned templates (docs/plan.md, section 12). Every member reads them;
// products.manage changes them. A draft is edited freely; publishing freezes it (the database
// refuses later changes) and retires the previously published version.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, optionalText, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

const VERSION_COLUMNS = `v.id, v.version, v.status, v.currency, v.price_once::text as "priceOnce",
  v.price_monthly::text as "priceMonthly", v.binding_months as "bindingMonths", v.notice_months as "noticeMonths",
  v.withdrawal_days as "withdrawalDays", v.terms, v.required_points as "requiredPoints",
  v.approved_phrases as "approvedPhrases", v.forbidden_phrases as "forbiddenPhrases",
  v.created_at as "createdAt", v.updated_at as "updatedAt", v.published_at as "publishedAt",
  pu.full_name as "publishedByName"`;

export async function listProducts(db: pg.Pool, session: Session, includeArchived: boolean) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select p.id, p.name, p.description, p.archived_at as "archivedAt", p.created_at as "createdAt",
              pub.version as "publishedVersion", pub.id as "publishedVersionId",
              pub.price_once::text as "priceOnce", pub.price_monthly::text as "priceMonthly",
              pub.binding_months as "bindingMonths", pub.published_at as "publishedAt",
              d.version as "draftVersion"
       from products p
       left join product_template_versions pub on pub.product_id = p.id and pub.status = 'published'
       left join product_template_versions d on d.product_id = p.id and d.status = 'draft'
       where p.organization_id = app.current_org_id() and (p.archived_at is null or $1)
       order by p.archived_at nulls first, lower(p.name)`,
      [includeArchived],
    );
    return rows;
  });
}

export async function createProduct(db: pg.Pool, session: Session, body: Body) {
  const name = requiredText(body, "name", "Navn", 200);
  const description = optionalText(body, "description", "Beskrivelse", 2000) ?? null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "insert into products (organization_id, name, description, created_by) values (app.current_org_id(), $1, $2, $3) returning id",
      [name, description, session.userId],
    );
    const id = rows[0]!.id;
    await c.query(
      "insert into product_template_versions (organization_id, product_id, version, created_by) values (app.current_org_id(), $1, 1, $2)",
      [id, session.userId],
    );
    return { id };
  });
}

export async function getProduct(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const product = await c.query(
      `select id, name, description, archived_at as "archivedAt", created_at as "createdAt"
       from products where id = $1`,
      [id],
    );
    if (!product.rows[0]) throw new NotFound();
    const versions = await c.query(
      `select ${VERSION_COLUMNS} from product_template_versions v
       left join users pu on pu.id = v.published_by
       where v.product_id = $1 and (v.status <> 'draft' or app.has_permission('products.manage'))
       order by v.version desc`,
      [id],
    );
    return { ...product.rows[0], versions: versions.rows };
  });
}

export async function updateProduct(db: pg.Pool, session: Session, id: string, body: Body) {
  const name = optionalText(body, "name", "Navn", 200);
  if (name === null) throw new BadRequest("Navn må fylles ut.");
  const description = optionalText(body, "description", "Beskrivelse", 2000);
  const archived = body.archived;
  if (archived !== undefined && typeof archived !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  return withSession(db, session, async (c) => {
    const exists = await c.query("select 1 from products where id = $1", [id]);
    if (!exists.rowCount) throw new NotFound();
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (name !== undefined) sets.push(`name = $${params.push(name)}`);
    if (description !== undefined) sets.push(`description = $${params.push(description)}`);
    if (archived !== undefined) sets.push(archived ? "archived_at = coalesce(archived_at, now())" : "archived_at = null");
    if (sets.length) await c.query(`update products set ${sets.join(", ")} where id = $1`, params);
    return { id };
  });
}

// A new draft, copied from the newest version so the editor starts from what applies today.
export async function createDraft(db: pg.Pool, session: Session, productId: string) {
  return withSession(db, session, async (c) => {
    const exists = await c.query("select 1 from products where id = $1", [productId]);
    if (!exists.rowCount) throw new NotFound();
    const draft = await c.query("select 1 from product_template_versions where product_id = $1 and status = 'draft'", [productId]);
    if (draft.rowCount) throw new BadRequest("Produktet har allerede et utkast.");
    const { rows } = await c.query<{ id: string }>(
      `insert into product_template_versions (organization_id, product_id, version, price_once, price_monthly,
         binding_months, notice_months, withdrawal_days, terms, required_points, approved_phrases, forbidden_phrases, created_by)
       select app.current_org_id(), $1, n.next, l.price_once, l.price_monthly, coalesce(l.binding_months, 0),
         coalesce(l.notice_months, 0), coalesce(l.withdrawal_days, 14), coalesce(l.terms, ''),
         coalesce(l.required_points, '[]'), coalesce(l.approved_phrases, '{}'), coalesce(l.forbidden_phrases, '{}'), $2
       from (select coalesce(max(version), 0) + 1 as next from product_template_versions where product_id = $1) n
       left join lateral (
         select * from product_template_versions where product_id = $1 order by version desc limit 1
       ) l on true
       returning id`,
      [productId, session.userId],
    );
    return { id: rows[0]!.id };
  });
}

function price(body: Body, key: string, label: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = String(value).replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new BadRequest(`${label} må være et beløp i kroner, for eksempel 399 eller 399,50.`);
  return text;
}

function wholeNumber(body: Body, key: string, label: string, max: number): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new BadRequest(`${label} må være et helt tall mellom 0 og ${max}.`);
  return n;
}

function phrases(body: Body, key: string, label: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequest(`Ugyldige ${label}.`);
  const list = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  if (list.length > 100 || list.some((p) => p.length > 300)) throw new BadRequest(`For mange eller for lange ${label}.`);
  return [...new Set(list)];
}

// Required points keep their id across edits, so AI findings can point at them.
function points(body: Body): { id: string; text: string }[] | undefined {
  const value = body.requiredPoints;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequest("Ugyldige obligatoriske punkter.");
  const list = value
    .map((p) => {
      if (typeof p === "string") return { id: "", text: p.trim() };
      if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
        const id = (p as { id?: unknown }).id;
        return { id: typeof id === "string" && /^[a-z0-9]{6,32}$/.test(id) ? id : "", text: (p as { text: string }).text.trim() };
      }
      throw new BadRequest("Ugyldige obligatoriske punkter.");
    })
    .filter((p) => p.text);
  if (list.length > 50 || list.some((p) => p.text.length > 500)) throw new BadRequest("For mange eller for lange obligatoriske punkter.");
  return list.map((p) => ({ id: p.id || randomBytes(6).toString("hex"), text: p.text }));
}

export async function updateDraft(db: pg.Pool, session: Session, productId: string, versionId: string, body: Body) {
  const values: Record<string, unknown> = {
    price_once: price(body, "priceOnce", "Engangspris"),
    price_monthly: price(body, "priceMonthly", "Månedspris"),
    binding_months: wholeNumber(body, "bindingMonths", "Bindingstid", 120),
    notice_months: wholeNumber(body, "noticeMonths", "Oppsigelsestid", 24),
    withdrawal_days: wholeNumber(body, "withdrawalDays", "Angrefrist", 365),
    terms: body.terms === undefined ? undefined : (optionalText(body, "terms", "Vilkår", 50000) ?? ""),
    required_points: (() => {
      const p = points(body);
      return p === undefined ? undefined : JSON.stringify(p);
    })(),
    approved_phrases: phrases(body, "approvedPhrases", "godkjente formuleringer"),
    forbidden_phrases: phrases(body, "forbiddenPhrases", "forbudte formuleringer"),
  };
  const sets = Object.entries(values).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    const current = await c.query<{ status: string }>(
      "select status from product_template_versions where id = $1 and product_id = $2",
      [versionId, productId],
    );
    if (!current.rows[0]) throw new NotFound();
    if (current.rows[0].status !== "draft") throw new BadRequest("Bare utkast kan endres. Lag et nytt utkast for å endre malen.");
    if (sets.length) {
      await c.query(
        `update product_template_versions set ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
        [versionId, ...sets.map(([, v]) => v)],
      );
    }
    // The points with the ids given to new ones, so the editor keeps them on the next save.
    const saved = await c.query<{ requiredPoints: { id: string; text: string }[] }>(
      `select required_points as "requiredPoints" from product_template_versions where id = $1`,
      [versionId],
    );
    return { id: versionId, requiredPoints: saved.rows[0]!.requiredPoints };
  });
}

// What a version needs before sellers may use it.
export function publishProblems(v: {
  price_once: string | null;
  price_monthly: string | null;
  terms: string;
  required_points: unknown[];
}): string[] {
  const problems: string[] = [];
  if (v.price_once === null && v.price_monthly === null) problems.push("pris (engangs eller per måned)");
  if (!v.terms.trim()) problems.push("vilkår");
  if (v.required_points.length === 0) problems.push("minst ett obligatorisk punkt");
  return problems;
}

export async function publishDraft(db: pg.Pool, session: Session, productId: string, versionId: string) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{
      status: string;
      price_once: string | null;
      price_monthly: string | null;
      terms: string;
      required_points: unknown[];
    }>(
      `select status, price_once::text, price_monthly::text, terms, required_points
       from product_template_versions where id = $1 and product_id = $2 for update`,
      [versionId, productId],
    );
    const v = rows[0];
    if (!v) throw new NotFound();
    if (v.status !== "draft") throw new BadRequest("Bare utkast kan publiseres.");
    const problems = publishProblems(v);
    if (problems.length) throw new BadRequest(`Fyll ut før publisering: ${problems.join(", ")}.`);
    await c.query("update product_template_versions set status = 'retired' where product_id = $1 and status = 'published'", [
      productId,
    ]);
    await c.query(
      "update product_template_versions set status = 'published', published_at = now(), published_by = $2 where id = $1",
      [versionId, session.userId],
    );
    return { id: versionId };
  });
}

export async function deleteDraft(db: pg.Pool, session: Session, productId: string, versionId: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query(
      "delete from product_template_versions where id = $1 and product_id = $2 and status = 'draft'",
      [versionId, productId],
    );
    if (!rowCount) throw new NotFound();
    return { id: versionId };
  });
}
