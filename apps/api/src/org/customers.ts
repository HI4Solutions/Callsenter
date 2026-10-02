// Customers in the session's call centre (docs/plan.md, section 12). Read with customers.read,
// written with customers.manage; RLS enforces both.
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import {
  BadRequest,
  type Body,
  optionalEmail,
  optionalOrgNumber,
  optionalPhone,
  optionalText,
  requiredText,
} from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

const COLUMNS = `c.id, c.kind, c.name, c.birth_date::text as "birthDate", c.org_number as "orgNumber",
  c.contact_name as "contactName", c.phone, c.email, c.address_line as "addressLine",
  c.postal_code as "postalCode", c.city, c.note, c.created_at as "createdAt", c.updated_at as "updatedAt",
  c.archived_at as "archivedAt"`;

function birthDate(body: Body): string | null | undefined {
  const value = body.birthDate;
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  // The round trip catches dates like 2001-02-30, which Date would roll over.
  const valid =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid || value < "1900-01-01" || new Date(value) > new Date()) throw new BadRequest("Ugyldig fødselsdato.");
  return value;
}

function fields(body: Body, kind: "person" | "business" | undefined) {
  const postalCode = optionalText(body, "postalCode", "Postnummer", 10);
  if (postalCode && !/^[0-9]{4}$/.test(postalCode)) throw new BadRequest("Postnummeret må ha fire siffer.");
  const values = {
    name: optionalText(body, "name", kind === "business" ? "Firmanavn" : "Navn", 200),
    birth_date: birthDate(body),
    org_number: optionalOrgNumber(body, "orgNumber"),
    contact_name: optionalText(body, "contactName", "Kontaktperson", 200),
    phone: optionalPhone(body, "phone", "Mobilnummer"),
    email: optionalEmail(body, "email", "E-post"),
    address_line: optionalText(body, "addressLine", "Adresse", 200),
    postal_code: postalCode,
    city: optionalText(body, "city", "Poststed", 100),
    note: optionalText(body, "note", "Notat", 2000),
  };
  if (kind === "person" && values.org_number) throw new BadRequest("En privatperson har ikke organisasjonsnummer.");
  if (kind === "business" && values.birth_date) throw new BadRequest("En bedrift har ikke fødselsdato.");
  return values;
}

export async function listCustomers(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const q = (query.q ?? "").trim().slice(0, 100);
  const archived = query.archived === "1";
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${COLUMNS} from customers c
       where c.organization_id = app.current_org_id()
         and (c.archived_at is not null) = $2
         and ($1 = '' or c.name ilike '%' || $1 || '%' or c.email ilike '%' || $1 || '%'
              or c.org_number = regexp_replace($1, '\\s', '', 'g')
              or c.phone like '%' || regexp_replace($1, '[\\s-]', '', 'g') || '%')
       order by lower(c.name)
       limit 200`,
      [q, archived],
    );
    return rows;
  });
}

export async function createCustomer(db: pg.Pool, session: Session, body: Body) {
  const kind = body.kind;
  if (kind !== "person" && kind !== "business") throw new BadRequest("Velg privatperson eller bedrift.");
  requiredText(body, "name", kind === "business" ? "Firmanavn" : "Navn", 200);
  const values = Object.entries(fields(body, kind)).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    const columns = ["organization_id", "kind", "created_by", ...values.map(([k]) => k)];
    const params = [kind, session.userId, ...values.map(([, v]) => v)];
    const { rows } = await c.query<{ id: string }>(
      `insert into customers (${columns.join(", ")})
       values (app.current_org_id(), ${params.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      params,
    );
    return { id: rows[0]!.id };
  });
}

export async function getCustomer(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(`select ${COLUMNS} from customers c where c.id = $1`, [id]);
    if (!rows[0]) throw new NotFound();
    return rows[0];
  });
}

export async function updateCustomer(db: pg.Pool, session: Session, id: string, body: Body) {
  const archived = body.archived;
  if (archived !== undefined && typeof archived !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  return withSession(db, session, async (c) => {
    const current = await c.query<{ kind: "person" | "business" }>("select kind from customers where id = $1", [id]);
    if (!current.rows[0]) throw new NotFound();
    const values = fields(body, current.rows[0].kind);
    if (values.name === null) throw new BadRequest("Navn må fylles ut.");
    const sets = Object.entries(values).filter(([, v]) => v !== undefined);
    const params: unknown[] = [id, ...sets.map(([, v]) => v)];
    const assignments = sets.map(([k], i) => `${k} = $${i + 2}`);
    if (archived !== undefined) assignments.push(archived ? "archived_at = coalesce(archived_at, now())" : "archived_at = null");
    if (assignments.length) await c.query(`update customers set ${assignments.join(", ")} where id = $1`, params);
    return { id };
  });
}
