// Complaints (docs/plan.md, section 14, module 10), handled with complaints.manage. A complaint
// carries its history (status changes and notes, append-only) and, when it is about a sale, the
// sale's full documentation: offer, acceptance, calls with transcript and AI control.
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { saleDocumentation } from "./documentation.ts";

const STATUSES = ["open", "investigating", "resolved", "rejected"] as const;
const CHANNELS = ["phone", "email", "letter", "web", "other"] as const;

function uuidOrNull(body: Body, key: string, label: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) throw new BadRequest(`Ukjent ${label}.`);
  return value;
}

function receivedOn(body: Body): string | undefined {
  const value = body.receivedOn;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequest("Ugyldig dato.");
  }
  if (new Date(value) > new Date()) throw new BadRequest("Datoen kan ikke være fram i tid.");
  return value;
}

function translate(error: unknown): never {
  const message = (error as Error).message ?? "";
  if (message.includes("another customer")) throw new BadRequest("Salget tilhører en annen kunde.");
  if ((error as { code?: string }).code === "23503") throw new BadRequest("Ukjent kunde, salg eller saksbehandler.");
  throw error;
}

export async function listComplaints(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const status = STATUSES.includes(query.status as (typeof STATUSES)[number]) ? query.status! : null;
  const open = query.open === "1";
  const customerId = query.customerId && isUuid(query.customerId) ? query.customerId : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select k.id, k.status, k.channel, k.received_on::text as "receivedOn", k.summary, k.closed_at as "closedAt",
              k.customer_id as "customerId", cu.name as "customerName", k.sale_id as "saleId", p.name as "productName",
              a.full_name as "assignedName", k.updated_at as "updatedAt"
       from complaints k
       left join customers cu on cu.id = k.customer_id
       left join sales s on s.id = k.sale_id
       left join products p on p.id = s.product_id
       left join users a on a.id = k.assigned_to
       where k.organization_id = app.current_org_id()
         and ($1::text is null or k.status = $1)
         and (not $2 or k.status in ('open', 'investigating'))
         and ($3::uuid is null or k.customer_id = $3)
       order by k.closed_at nulls first, k.received_on desc, k.created_at desc
       limit 200`,
      [status, open, customerId],
    );
    return rows;
  });
}

export async function createComplaint(db: pg.Pool, session: Session, body: Body) {
  const customerId = uuidOrNull(body, "customerId", "kunde");
  if (!customerId) throw new BadRequest("Velg kunden klagen gjelder.");
  const saleId = uuidOrNull(body, "saleId", "salg") ?? null;
  const summary = requiredText(body, "summary", "Kort beskrivelse", 200);
  const description = optionalText(body, "description", "Beskrivelse", 10000) ?? "";
  const channel = body.channel ?? "phone";
  if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) throw new BadRequest("Ukjent kanal.");
  const received = receivedOn(body) ?? null;
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into complaints (organization_id, customer_id, sale_id, summary, description, channel, received_on, assigned_to)
         values (app.current_org_id(), $1, $2, $3, $4, $5, coalesce($6::date, current_date), app.current_user_id()) returning id`,
        [customerId, saleId, summary, description, channel, received],
      );
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

export async function getComplaint(db: pg.Pool, session: Session, id: string, meta: { ip?: string; userAgent?: string }) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select k.id, k.status, k.channel, k.received_on::text as "receivedOn", k.summary, k.description, k.outcome,
              k.closed_at as "closedAt", k.created_at as "createdAt", k.customer_id as "customerId", cu.name as "customerName",
              cu.phone as "customerPhone", cu.email as "customerEmail", k.sale_id as "saleId",
              k.assigned_to as "assignedTo", a.full_name as "assignedName", cr.full_name as "createdByName"
       from complaints k
       left join customers cu on cu.id = k.customer_id
       left join users a on a.id = k.assigned_to
       left join users cr on cr.id = k.created_by
       where k.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFound();
    const events = await c.query(
      `select e.id::text, e.kind, e.from_status as "fromStatus", e.to_status as "toStatus", e.note,
              u.full_name as "actorName", e.created_at as "createdAt"
       from complaint_events e left join users u on u.id = e.actor_user_id
       where e.complaint_id = $1 order by e.id`,
      [id],
    );
    // The sale's documentation, logged as part of this complaint. Hidden when the case handler
    // may not see the sale (all sales need calls.read.all, which needs BankID or a passkey).
    let documentation = null;
    let documentationHidden = false;
    if (rows[0].saleId) {
      try {
        documentation = await saleDocumentation(c, rows[0].saleId, meta, "complaint_documentation");
      } catch (error) {
        if (!(error instanceof NotFound)) throw error;
        documentationHidden = true;
      }
    }
    return { ...rows[0], events: events.rows, documentation, documentationHidden };
  });
}

export async function updateComplaint(db: pg.Pool, session: Session, id: string, body: Body) {
  const status = body.status;
  if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) throw new BadRequest("Ukjent status.");
  const channel = body.channel;
  if (channel !== undefined && !CHANNELS.includes(channel as (typeof CHANNELS)[number])) throw new BadRequest("Ukjent kanal.");
  const values: Record<string, unknown> = {
    status,
    status_note: status !== undefined ? (optionalText(body, "statusNote", "Begrunnelse", 1000) ?? null) : undefined,
    channel,
    received_on: receivedOn(body),
    summary: optionalText(body, "summary", "Kort beskrivelse", 200),
    description: body.description === undefined ? undefined : (optionalText(body, "description", "Beskrivelse", 10000) ?? ""),
    outcome: optionalText(body, "outcome", "Utfall", 10000),
    sale_id: uuidOrNull(body, "saleId", "salg"),
    assigned_to: uuidOrNull(body, "assignedTo", "saksbehandler"),
  };
  if (values.summary === null) throw new BadRequest("Kort beskrivelse må fylles ut.");
  if ((status === "resolved" || status === "rejected") && !optionalText(body, "outcome", "Utfall", 10000)) {
    // Closing needs an outcome: either now or already on the case (checked below).
    values.__needsOutcome = true;
  }
  const needsOutcome = values.__needsOutcome === true;
  delete values.__needsOutcome;
  const sets = Object.entries(values).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    const current = await c.query<{ outcome: string | null }>("select outcome from complaints where id = $1", [id]);
    if (!current.rows[0]) throw new NotFound();
    if (needsOutcome && !current.rows[0].outcome?.trim()) throw new BadRequest("Skriv utfallet før saken lukkes.");
    if (!sets.length) return { id };
    try {
      await c.query(`update complaints set ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [
        id,
        ...sets.map(([, v]) => v),
      ]);
    } catch (error) {
      translate(error);
    }
    return { id };
  });
}

export async function addComplaintNote(db: pg.Pool, session: Session, id: string, body: Body) {
  const note = requiredText(body, "note", "Notat", 5000);
  return withSession(db, session, async (c) => {
    const exists = await c.query("select 1 from complaints where id = $1", [id]);
    if (!exists.rowCount) throw new NotFound();
    await c.query(
      `insert into complaint_events (organization_id, complaint_id, kind, note, actor_user_id)
       values (app.current_org_id(), $1, 'note', $2, app.current_user_id())`,
      [id, note],
    );
    return { id };
  });
}
