// Complaints (docs/plan.md, section 14, module 10), handled with complaints.manage. A complaint
// carries its history (status changes and notes, append-only) and, when it is about a sale, the
// sale's full documentation: offer, acceptance, calls with transcript and AI control.
//
// A complaint can also be about a call, fetched with the reference the seller pasted into the
// call centre's own system. The case handler then sees the call (transcript, notes, recording,
// through the calls API, which logs it), and asks the AI for an assessment of the complaint
// against the call and for a draft reply to the customer (calls/complaints.ts, in the worker).
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import type { CallServices } from "../calls/services.ts";
import { withSession } from "../me.ts";
import { assertLanguageOpen, callReference, localeParam } from "./calls.ts";
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
  if (message.includes("keeps its customer")) throw new BadRequest("Klagen har allerede en kunde.");
  if ((error as { code?: string }).code === "23503") throw new BadRequest("Ukjent kunde, salg, samtale eller saksbehandler.");
  throw error;
}

// A call the case handler may see (calls follow their own visibility rules).
async function assertCallVisible(c: pg.PoolClient, callId: string) {
  if (!(await c.query("select 1 from calls where id = $1", [callId])).rowCount) throw new BadRequest("Ukjent samtale.");
}

// The call a complaint is about, found by the reference the seller pasted into the call centre's
// own system (VQ-XXXX-XXXX, written any way). Only calls the case handler may see are found, and
// the lookup is logged like a search. Null when there is none.
export async function findCall(db: pg.Pool, session: Session, value: string | undefined, meta: { ip?: string; userAgent?: string }) {
  const reference = callReference(value ?? "");
  if (!reference) throw new BadRequest("Skriv referansen slik den står i salgssystemet, for eksempel VQ-7K3M-Q9TX.");
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select c.id, c.reference, c.status, c.started_at as "startedAt", c.duration_ms as "durationMs", u.full_name as "userName",
              p.name as "productName", c.customer_id as "customerId", cu.name as "customerName"
       from calls c
       left join users u on u.id = c.user_id
       left join products p on p.id = c.product_id
       left join customers cu on cu.id = c.customer_id
       where c.reference = $1`,
      [reference],
    );
    const call = rows[0];
    if (!call) return null;
    const complaints = await c.query(
      `select id, summary, status, received_on::text as "receivedOn" from complaints where call_id = $1 order by created_at desc`,
      [call.id],
    );
    await c.query(
      `insert into access_log (organization_id, user_id, resource_type, resource_id, action, ip, user_agent)
       values (app.current_org_id(), app.current_user_id(), 'call_search', $1, 'view', $2, $3)`,
      [call.id, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
    );
    return { call, complaints: complaints.rows };
  });
}

export async function listComplaints(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const status = STATUSES.includes(query.status as (typeof STATUSES)[number]) ? query.status! : null;
  const open = query.open === "1";
  const customerId = query.customerId && isUuid(query.customerId) ? query.customerId : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select k.id, k.status, k.channel, k.received_on::text as "receivedOn", k.summary, k.closed_at as "closedAt",
              k.customer_id as "customerId", cu.name as "customerName", k.sale_id as "saleId", p.name as "productName",
              k.call_reference as "callReference", a.full_name as "assignedName", k.updated_at as "updatedAt"
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
  const customerId = uuidOrNull(body, "customerId", "kunde") ?? null;
  const callId = uuidOrNull(body, "callId", "samtale") ?? null;
  if (!customerId && !callId) throw new BadRequest("Velg kunden eller samtalen klagen gjelder.");
  const saleId = uuidOrNull(body, "saleId", "salg") ?? null;
  const summary = requiredText(body, "summary", "Kort beskrivelse", 200);
  const description = optionalText(body, "description", "Beskrivelse", 10000) ?? "";
  const channel = body.channel ?? "phone";
  if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) throw new BadRequest("Ukjent kanal.");
  const received = receivedOn(body) ?? null;
  return withSession(db, session, async (c) => {
    if (callId) await assertCallVisible(c, callId);
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into complaints (organization_id, customer_id, sale_id, call_id, summary, description, channel, received_on, assigned_to)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), app.current_user_id()) returning id`,
        [customerId, saleId, callId, summary, description, channel, received],
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
              k.assigned_to as "assignedTo", a.full_name as "assignedName", cr.full_name as "createdByName",
              k.call_id as "callId", k.call_reference as "callReference",
              exists (select 1 from calls c where c.id = k.call_id) as "callVisible"
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
    // The AI's assessments and draft replies, newest first (hidden with the call: they quote it).
    const ai = await c.query(
      `select a.id, a.kind, a.status, a.error, a.locale, a.result, coalesce(a.content, a.ai_content) as content,
              a.ai_content as "aiContent", a.instructions, a.complaint_text as "complaintText", a.created_at as "createdAt",
              a.edited_at as "editedAt", ru.full_name as "requestedByName", eu.full_name as "editedByName"
       from complaint_ai a
       left join users ru on ru.id = a.requested_by
       left join users eu on eu.id = a.edited_by
       where a.complaint_id = $1
       order by a.created_at desc`,
      [id],
    );
    return { ...rows[0], events: events.rows, documentation, documentationHidden, ai: ai.rows };
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
    call_id: uuidOrNull(body, "callId", "samtale"),
    customer_id: uuidOrNull(body, "customerId", "kunde"),
    assigned_to: uuidOrNull(body, "assignedTo", "saksbehandler"),
  };
  if (values.summary === null) throw new BadRequest("Kort beskrivelse må fylles ut.");
  // A complaint can be moved to another call, or given a customer, but not left without them.
  if (values.call_id === null || values.customer_id === null) throw new BadRequest("En klage kan ikke kobles fra kunden eller samtalen.");
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
    if (typeof values.call_id === "string") await assertCallVisible(c, values.call_id);
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

const AI_KINDS = ["assessment", "reply"] as const;

// Asks the AI for an assessment of the complaint against its call, or for a draft reply to the
// customer (with the case handler's instructions). The worker writes it; the case page polls.
export async function requestComplaintAi(db: pg.Pool, session: Session, services: CallServices, id: string, body: Body) {
  const kind = body.kind;
  if (!AI_KINDS.includes(kind as (typeof AI_KINDS)[number])) throw new BadRequest("Velg vurdering eller utkast til tilsvar.");
  const instructions = kind === "reply" ? (optionalText(body, "instructions", "Instrukser", 2000) ?? null) : null;
  const asked = localeParam(body, "locale") ?? null;
  const aiId = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ call_id: string | null; description: string; locale: string }>(
      `select k.call_id, k.description, o.content_locale as locale
       from complaints k join organizations o on o.id = k.organization_id where k.id = $1`,
      [id],
    );
    const k = rows[0];
    if (!k) throw new NotFound();
    if (!k.call_id) throw new BadRequest("Koble klagen til samtalen den gjelder først.");
    if (!k.description.trim()) throw new BadRequest("Skriv inn klagen først.");
    await assertLanguageOpen(c, asked);
    try {
      const inserted = await c.query<{ id: string }>(
        `insert into complaint_ai (organization_id, complaint_id, call_id, kind, complaint_text, instructions, locale, requested_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, app.current_user_id()) returning id`,
        [id, k.call_id, kind, k.description.trim(), instructions, asked ?? k.locale],
      );
      return inserted.rows[0]!.id;
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (message.includes("already being done")) throw new BadRequest("AI-en jobber allerede med denne klagen. Vent til den er ferdig.");
      if (message.includes("too much complaint work")) throw new BadRequest("Denne klagen har nådd grensen for vurderinger og utkast.");
      if ((error as { code?: string }).code === "42501") {
        throw new BadRequest("Samtalen har ingen transkripsjon ennå, eller du har ikke tilgang til den.");
      }
      throw error;
    }
  });
  await services.startComplaintAi(aiId);
  return { id: aiId };
}

// The case handler's adjustment of a finished draft reply; the AI's text is kept beside it.
export async function editComplaintReply(db: pg.Pool, session: Session, complaintId: string, aiId: string, body: Body) {
  const content = requiredText(body, "content", "Utkast", 20000);
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query(
      `update complaint_ai set content = $3, edited_by = app.current_user_id(), edited_at = now()
       where id = $2 and complaint_id = $1 and kind = 'reply' and status = 'done'`,
      [complaintId, aiId, content],
    );
    if (!rowCount) throw new NotFound();
    return { id: aiId };
  });
}
