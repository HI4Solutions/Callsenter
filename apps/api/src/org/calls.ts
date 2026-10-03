// Calls in the session's call centre (docs/plan.md, section 13). Recording happens in the
// browser: the API creates the call, hands out presigned URLs for the chunks and a temporary
// Soniox key for live text, and starts the worker when the recording is done. Visibility follows
// calls.read.own/team/all (RLS); calls.upload records; calls.audio.play plays; flags.review
// reviews yellow and red flags. Every view and playback is written to access_log.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import type { CallServices } from "../calls/services.ts";
import { SONIOX_REALTIME_MODEL, SONIOX_REALTIME_URL } from "../calls/soniox.ts";
import { DEFAULT_REPORT, extension } from "../calls/process.ts";
import { chunkKey, pieceKey } from "../calls/store.ts";
import { withSession } from "../me.ts";

export class Unavailable extends Error {}

const SOURCES = ["microphone", "tab", "upload"] as const;
const MAX_CHUNKS = 2000;
const MAX_REALTIME_KEYS = 5;

// Audio types the browser records or a user may upload.
function audioMime(value: unknown): string {
  if (typeof value !== "string" || !/^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,"-]*)?$/.test(value) || value.length > 100) {
    throw new BadRequest("Ukjent lydformat.");
  }
  return value;
}

async function moduleEnabled(c: pg.PoolClient, module: string): Promise<boolean> {
  const { rows } = await c.query<{ enabled: boolean }>(
    "select enabled from organization_modules where organization_id = app.current_org_id() and module = $1",
    [module],
  );
  return rows[0]?.enabled === true;
}

async function transcriptionMode(c: pg.PoolClient): Promise<{ mode: "realtime" | "chunked"; terms: string[] }> {
  const { rows } = await c.query<{ key: string; value: unknown }>("select key, value from platform_settings");
  const settings = new Map(rows.map((r) => [r.key, r.value]));
  const terms = settings.get("transcription_terms");
  return {
    mode: settings.get("transcription_mode") === "realtime" ? "realtime" : "chunked",
    terms: Array.isArray(terms) ? (terms as string[]) : [],
  };
}

function uuidOrNull(body: Body, key: string, label: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) throw new BadRequest(`Ukjent ${label}.`);
  return value;
}

// The database's refusals, in words for the user.
function translate(error: unknown): never {
  const message = (error as Error).message ?? "";
  if (message.includes("no published template version")) throw new BadRequest("Produktet har ingen publisert mal.");
  if (message.includes("sale not found")) throw new BadRequest("Fant ikke salget.");
  if (message.includes("recorder is not an active member")) throw new BadRequest("Du er ikke aktiv i callsenteret.");
  if (message.includes("keeps its links")) throw new BadRequest("En samtale som er sjekket av AI, kan ikke kobles om.");
  if (message.includes("call is being processed")) throw new BadRequest("Samtalen behandles nå. Prøv igjen om litt.");
  if (message.includes("cannot go from")) throw new BadRequest("Samtalen kan ikke endres nå. Last siden på nytt.");
  if ((error as { code?: string }).code === "23503") throw new BadRequest("Ukjent kunde, salg eller produkt.");
  throw error;
}

async function realtimeKey(services: CallServices, callId: string) {
  if (!services.soniox) return null;
  try {
    const key = await services.soniox.temporaryKey(callId);
    return { apiKey: key.api_key, expiresAt: key.expires_at, url: SONIOX_REALTIME_URL, model: SONIOX_REALTIME_MODEL };
  } catch (error) {
    // The browser falls back to chunked mode; the recording itself is not affected.
    console.error("calls: temporary Soniox key failed", error);
    return null;
  }
}

export async function createCall(db: pg.Pool, session: Session, services: CallServices, body: Body) {
  const source = body.source;
  if (!SOURCES.includes(source as (typeof SOURCES)[number])) throw new BadRequest("Velg mikrofon, fanelyd eller fil.");
  const mime = audioMime(body.mime);
  const title = optionalText(body, "title", "Tittel", 200) ?? null;
  const customerId = uuidOrNull(body, "customerId", "kunde") ?? null;
  const saleId = uuidOrNull(body, "saleId", "salg") ?? null;
  const productId = uuidOrNull(body, "productId", "produkt") ?? null;
  const notes = body.noteTemplateIds === undefined ? [] : noteTemplateIds(body.noteTemplateIds);

  const created = await withSession(db, session, async (c) => {
    if (!(await moduleEnabled(c, "transcription"))) throw new BadRequest("Transkribering er ikke slått på for callsenteret.");
    if (notes.length) await activeTemplates(c, notes);
    const settings = await transcriptionMode(c);
    // An uploaded file has no live text.
    const mode = source === "upload" ? "chunked" : settings.mode;
    try {
      const { rows } = await c.query<{ id: string; expires_at: Date }>(
        `insert into calls (organization_id, user_id, source, transcription_mode, audio_mime, title, customer_id, sale_id, product_id, note_templates)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, expires_at`,
        [session.userId, source, mode, mime, title, customerId, saleId, productId, notes],
      );
      return { id: rows[0]!.id, expiresAt: rows[0]!.expires_at, mode, terms: settings.terms };
    } catch (error) {
      translate(error);
    }
  });
  const realtime = created.mode === "realtime" ? await realtimeKey(services, created.id) : null;
  if (created.mode === "realtime") {
    // Usage is billed by what was used: no key means no live text.
    await withSession(db, session, (c) =>
      c.query(
        realtime
          ? "update calls set realtime_keys = realtime_keys + 1 where id = $1"
          : "update calls set transcription_mode = 'chunked' where id = $1",
        [created.id],
      ),
    );
  }
  return {
    id: created.id,
    mode: realtime ? "realtime" : "chunked",
    expiresAt: created.expiresAt,
    realtime: realtime && { ...realtime, languageHints: ["no"], terms: created.terms.slice(0, 200) },
  };
}

// A new key for the same call, when the realtime connection must be reopened.
// Only for the caller's own realtime recording, while realtime is still on, and a few times per
// call: each key opens a Soniox session paid by the platform.
export async function renewRealtimeKey(db: pg.Pool, session: Session, services: CallServices, callId: string) {
  await recordingCall(db, session, callId);
  const allowed = await withSession(db, session, async (c) => {
    if (!(await moduleEnabled(c, "transcription")) || (await transcriptionMode(c)).mode !== "realtime") return false;
    const { rowCount } = await c.query(
      `update calls set realtime_keys = realtime_keys + 1
       where id = $1 and transcription_mode = 'realtime' and realtime_keys < $2`,
      [callId, MAX_REALTIME_KEYS],
    );
    return rowCount === 1;
  });
  if (!allowed) throw new Unavailable();
  const realtime = await realtimeKey(services, callId);
  if (!realtime) throw new Unavailable();
  return realtime;
}

// The caller's own call that is still recording.
async function recordingCall(db: pg.Pool, session: Session, callId: string) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ organization_id: string; status: string; user_id: string }>(
      "select organization_id, status, user_id from calls where id = $1",
      [callId],
    );
    const call = rows[0];
    if (!call || call.user_id !== session.userId) throw new NotFound();
    if (call.status !== "recording") throw new BadRequest("Opptaket er allerede avsluttet.");
    return call;
  });
}

// A presigned URL for one chunk. Chunks are numbered from 0 and joined in order by the worker.
export async function chunkUrl(db: pg.Pool, session: Session, services: CallServices, callId: string, body: Body) {
  const seq = body.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) throw new BadRequest("Ugyldig del.");
  const call = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ organization_id: string; status: string; user_id: string; audio_mime: string }>(
      "select organization_id, status, user_id, audio_mime from calls where id = $1 for update",
      [callId],
    );
    const found = rows[0];
    if (!found || found.user_id !== session.userId) throw new NotFound();
    if (found.status !== "recording") throw new BadRequest("Opptaket er allerede avsluttet.");
    await c.query("update calls set chunk_count = greatest(chunk_count, $2), last_chunk_at = now() where id = $1", [callId, seq + 1]);
    return found;
  });
  return {
    url: await services.store.presignPut(chunkKey(call.organization_id, callId, seq), call.audio_mime),
    contentType: call.audio_mime,
  };
}

// --- Transcription in pieces ---------------------------------------------------------------------
// While recording, the browser makes a complete audio file every 15 seconds. Each is uploaded here
// and transcribed by the worker, so the text shows as the call goes on (docs/plan.md, section 13).

export async function pieceUrl(db: pg.Pool, session: Session, services: CallServices, callId: string, body: Body) {
  const seq = body.seq;
  const startMs = body.startMs;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) throw new BadRequest("Ugyldig del.");
  if (typeof startMs !== "number" || !Number.isInteger(startMs) || startMs < 0 || startMs > 24 * 3600_000) {
    throw new BadRequest("Ugyldig tidspunkt.");
  }
  const call = await recordingCall(db, session, callId);
  const mime = await withSession(db, session, async (c) => {
    if (!(await moduleEnabled(c, "transcription"))) throw new BadRequest("Transkribering er ikke slått på for callsenteret.");
    await c.query(
      `insert into call_pieces (call_id, organization_id, seq, start_ms) values ($1, app.current_org_id(), $2, $3)
       on conflict (call_id, seq) do nothing`,
      [callId, seq, startMs],
    );
    return (await c.query<{ audio_mime: string }>("select audio_mime from calls where id = $1", [callId])).rows[0]!.audio_mime;
  });
  return { url: await services.store.presignPut(pieceKey(call.organization_id, callId, seq), mime), contentType: mime };
}

// The piece is uploaded: the worker transcribes it.
export async function pieceUploaded(db: pg.Pool, session: Session, services: CallServices, callId: string, seq: number) {
  const changed = await withSession(db, session, async (c) => {
    const { rowCount } = await c.query("update call_pieces set status = 'pending' where call_id = $1 and seq = $2 and status = 'uploading'", [
      callId,
      seq,
    ]);
    return rowCount === 1;
  });
  if (changed) await services.startPiece(callId, seq);
  return { seq, status: "pending" };
}

// The text so far, piece by piece. The first look at a call's live text is logged as a view of it.
export async function listPieces(
  db: pg.Pool,
  session: Session,
  callId: string,
  query: Record<string, string | undefined>,
  meta: { ip?: string; userAgent?: string },
) {
  const after = Number(query.after ?? -1);
  return withSession(db, session, async (c) => {
    const call = await c.query("select 1 from calls where id = $1", [callId]);
    if (!call.rowCount) throw new NotFound();
    const { rows } = await c.query(
      `select seq, start_ms as "startMs", status, segments from call_pieces
       where call_id = $1 and seq > $2 order by seq`,
      [callId, Number.isInteger(after) ? after : -1],
    );
    if (!Number.isInteger(after) || after < 0) await logAccess(c, callId, "view", meta);
    return rows;
  });
}

export async function completeCall(db: pg.Pool, session: Session, services: CallServices, callId: string, body: Body) {
  const durationMs = body.durationMs;
  if (durationMs !== undefined && (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0)) {
    throw new BadRequest("Ugyldig varighet.");
  }
  // How many pieces the browser made for transcription while recording (none for a file).
  const pieces = body.pieces;
  if (pieces !== undefined && (typeof pieces !== "number" || !Number.isInteger(pieces) || pieces < 0 || pieces > MAX_CHUNKS)) {
    throw new BadRequest("Ugyldig antall deler.");
  }
  await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ status: string; chunk_count: number }>("select status, chunk_count from calls where id = $1", [
      callId,
    ]);
    const call = rows[0];
    if (!call) throw new NotFound();
    if (call.status !== "recording") throw new BadRequest("Opptaket er allerede avsluttet.");
    if (call.chunk_count === 0) throw new BadRequest("Ingen lyd er lastet opp.");
    await c.query("update calls set status = 'processing', duration_ms = coalesce($2, duration_ms), piece_count = $3 where id = $1", [
      callId,
      durationMs ?? null,
      pieces ?? null,
    ]);
  });
  await services.startWorker(callId);
  return { id: callId, status: "processing" };
}

export async function retryCall(db: pg.Pool, session: Session, services: CallServices, callId: string) {
  await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ status: string; transcribed: boolean }>(
      "select status, exists (select 1 from transcripts t where t.call_id = calls.id) as transcribed from calls where id = $1",
      [callId],
    );
    if (!rows[0]) throw new NotFound();
    if (rows[0].status !== "failed") throw new BadRequest("Bare samtaler som feilet, kan kjøres på nytt.");
    // A call that failed in the AI step keeps its transcript and is not transcribed (or paid for) again.
    await c.query("update calls set status = $2 where id = $1", [callId, rows[0].transcribed ? "transcribed" : "processing"]);
  });
  await services.startWorker(callId);
  return { id: callId, status: "processing" };
}

const SUMMARY = `c.id, c.status, c.source, c.title, c.started_at as "startedAt", c.duration_ms as "durationMs",
  c.expires_at as "expiresAt", c.error, c.user_id as "userId", u.full_name as "userName", t.name as "teamName",
  c.customer_id as "customerId", cu.name as "customerName", c.sale_id as "saleId", c.product_id as "productId",
  p.name as "productName", tv.version as "templateVersion",
  a.flag, a.reviewed_at as "reviewedAt"`;

const FROM = `from calls c
  left join users u on u.id = c.user_id
  left join teams t on t.id = c.team_id
  left join customers cu on cu.id = c.customer_id
  left join products p on p.id = c.product_id
  left join product_template_versions tv on tv.id = c.template_version_id
  left join lateral (
    select flag, reviewed_at from call_analyses where call_id = c.id order by created_at desc limit 1
  ) a on true`;

function dayParam(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

export async function listCalls(
  db: pg.Pool,
  session: Session,
  query: Record<string, string | undefined>,
  meta: { ip?: string; userAgent?: string } = {},
) {
  const q = (query.q ?? "").trim().slice(0, 200);
  const flag = ["green", "yellow", "red"].includes(query.flag ?? "") ? query.flag! : null;
  const status = ["recording", "processing", "transcribed", "analyzed", "failed"].includes(query.status ?? "") ? query.status! : null;
  const customerId = query.customerId && isUuid(query.customerId) ? query.customerId : null;
  const saleId = query.saleId && isUuid(query.saleId) ? query.saleId : null;
  const mine = query.mine === "1";
  // Yellow and red flags nobody has reviewed yet.
  const review = query.review === "1";
  // From the dashboard: a period of whole days in Norwegian time, a seller or a team, and calls
  // flagged yellow or red, or not checked by AI.
  const from = dayParam(query.from);
  const to = dayParam(query.to);
  const userId = query.userId && isUuid(query.userId) ? query.userId : null;
  const teamId = query.teamId && isUuid(query.teamId) ? query.teamId : null;
  const flagged = query.flagged === "1";
  const unchecked = query.unchecked === "1";
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${SUMMARY},
              case when $1 = '' then null else ts_headline('norwegian', tr.text, websearch_to_tsquery('norwegian', $1),
                'MaxWords=18, MinWords=8, MaxFragments=1, StartSel=«, StopSel=»') end as "match"
       ${FROM}
       left join transcripts tr on tr.call_id = c.id
       where c.organization_id = app.current_org_id()
         and ($1 = '' or tr.search @@ websearch_to_tsquery('norwegian', $1) or c.title ilike '%' || $1 || '%' or cu.name ilike '%' || $1 || '%')
         and ($2::text is null or a.flag = $2)
         and ($3::text is null or c.status = $3)
         and ($4::uuid is null or c.customer_id = $4)
         and ($5::uuid is null or c.sale_id = $5)
         and (not $6 or c.user_id = app.current_user_id())
         and (not $7 or (a.flag in ('yellow', 'red') and a.reviewed_at is null))
         and ($8::date is null or c.started_at >= $8::date::timestamp at time zone 'Europe/Oslo')
         and ($9::date is null or c.started_at < ($9::date + 1)::timestamp at time zone 'Europe/Oslo')
         and ($10::uuid is null or c.user_id = $10)
         and ($11::uuid is null or c.team_id = $11)
         and (not $12 or a.flag in ('yellow', 'red'))
         and (not $13 or a.flag is null)
       order by c.started_at desc
       limit 200`,
      [q, flag, status, customerId, saleId, mine, review, from, to, userId, teamId, flagged, unchecked],
    );
    // Search results show excerpts of the transcripts: each is a view of that transcript.
    const shown = rows.filter((r) => r.match).map((r) => r.id as string);
    if (shown.length) {
      await c.query(
        `insert into access_log (organization_id, user_id, resource_type, resource_id, action, ip, user_agent)
         select app.current_org_id(), app.current_user_id(), 'call_search', id::text, 'view', $2, $3 from unnest($1::uuid[]) id`,
        [shown, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
      );
    }
    return rows;
  });
}

async function logAccess(c: pg.PoolClient, callId: string, action: "view" | "play", meta: { ip?: string; userAgent?: string }) {
  await c.query(
    `insert into access_log (organization_id, user_id, resource_type, resource_id, action, ip, user_agent)
     values (app.current_org_id(), app.current_user_id(), 'call', $1, $2, $3, $4)`,
    [callId, action, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
  );
}

// The call's log for leaders (audit.read): who viewed, played and searched it, and what was done
// with it (recorded, linked, AI control reviewed, notes asked for and adjusted). Never the text.
export async function callLog(db: pg.Pool, session: Session, callId: string) {
  return withSession(db, session, async (c) => {
    const call = await c.query("select 1 from calls where id = $1", [callId]);
    if (!call.rowCount) throw new NotFound();
    const access = await c.query(
      `select l.occurred_at as "at", l.action, l.resource_type as "resource", u.full_name as "userName"
       from access_log l left join users u on u.id = l.user_id
       where l.resource_type in ('call', 'call_search') and l.resource_id = $1 and l.organization_id = app.current_org_id()
       order by l.occurred_at desc limit 200`,
      [callId],
    );
    const changes = await c.query(
      `select l.occurred_at as "at", l.action, l.table_name as "table", u.full_name as "userName",
              l.old_data ->> 'status' as "fromStatus", l.new_data ->> 'status' as "toStatus",
              l.new_data ->> 'flag' as flag, l.new_data ->> 'reviewed_at' as "reviewedAt", l.new_data ->> 'template_name' as "templateName"
       from audit_log l left join users u on u.id = l.actor_user_id
       where l.organization_id = app.current_org_id()
         and ((l.table_name = 'calls' and l.record_id = $1) or (l.new_data ? 'call_id' and l.new_data ->> 'call_id' = $1))
       order by l.occurred_at desc limit 200`,
      [callId],
    );
    return { access: access.rows, changes: changes.rows };
  });
}

// Status only, for polling while the worker runs: no transcript, so no access_log entry.
export async function callStatus(db: pg.Pool, session: Session, callId: string) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select c.id, c.status, c.error, coalesce(c.lease_until > now(), false) as working,
              (select count(*) from call_analyses a where a.call_id = c.id)::int as analyses,
              (select count(*) from reports r where r.call_id = c.id and r.status = 'done')::int as reports,
              (select count(*) from reports r where r.call_id = c.id and r.status = 'pending')::int as "pendingReports"
       from calls c where c.id = $1`,
      [callId],
    );
    if (!rows[0]) throw new NotFound();
    return rows[0];
  });
}

export async function getCall(db: pg.Pool, session: Session, callId: string, meta: { ip?: string; userAgent?: string }) {
  return withSession(db, session, async (c) => {
    const call = await c.query(
      `select ${SUMMARY}, c.note, c.transcription_mode as "transcriptionMode", c.audio_key is not null as "hasAudio",
              coalesce(c.lease_until > now(), false) as working,
              c.template_version_id as "templateVersionId", coalesce(tv.required_points, '[]') as "requiredPoints",
              c.user_id = app.current_user_id() as "isOwn", c.note_templates as "noteTemplateIds"
       ${FROM} where c.id = $1`,
      [callId],
    );
    if (!call.rows[0]) throw new NotFound();
    const segments = await c.query(
      `select seq, speaker, start_ms as "startMs", end_ms as "endMs", text from transcript_segments
       where call_id = $1 order by seq`,
      [callId],
    );
    const analyses = await c.query(
      `select a.id, a.flag, a.summary, a.findings, a.model, a.created_at as "createdAt", a.reviewed_at as "reviewedAt",
              ru.full_name as "reviewedByName", a.review_note as "reviewNote"
       from call_analyses a left join users ru on ru.id = a.reviewed_by
       where a.call_id = $1 order by a.created_at desc`,
      [callId],
    );
    // The latest adjustment by the seller is the note; the AI text is kept beside it.
    const reports = await c.query(
      `select r.id, r.template_name as "templateName", r.status, r.error, r.model, r.created_at as "createdAt",
              coalesce(e.content, r.content) as content, r.content as "aiContent",
              e.created_at as "editedAt", eu.full_name as "editedByName",
              (select count(*) from report_edits x where x.report_id = r.id)::int as edits,
              ru.full_name as "requestedByName"
       from reports r
       left join lateral (
         select content, created_at, edited_by from report_edits where report_id = r.id order by created_at desc limit 1
       ) e on true
       left join users eu on eu.id = e.edited_by
       left join users ru on ru.id = r.requested_by
       where r.call_id = $1 order by r.created_at desc`,
      [callId],
    );
    await logAccess(c, callId, "view", meta);
    return { ...call.rows[0], segments: segments.rows, analyses: analyses.rows, reports: reports.rows };
  });
}

export async function audioUrl(
  db: pg.Pool,
  session: Session,
  services: CallServices,
  callId: string,
  meta: { ip?: string; userAgent?: string },
) {
  const call = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ audio_key: string | null; audio_mime: string | null }>(
      "select audio_key, audio_mime from calls where id = $1",
      [callId],
    );
    if (!rows[0]) throw new NotFound();
    if (!rows[0].audio_key) throw new BadRequest("Lyden er ikke klar ennå.");
    await logAccess(c, callId, "play", meta);
    return rows[0];
  });
  return {
    url: await services.store.presignGet(call.audio_key!, `samtale-${callId}.${extension(call.audio_mime)}`, call.audio_mime ?? "audio/webm"),
    expiresInSeconds: 600,
  };
}

// Title, note and links. Linking a product or sale to a transcribed call starts the AI control.
export async function updateCall(db: pg.Pool, session: Session, services: CallServices, callId: string, body: Body) {
  const values: Record<string, unknown> = {
    title: optionalText(body, "title", "Tittel", 200),
    note: optionalText(body, "note", "Notat", 2000),
    customer_id: uuidOrNull(body, "customerId", "kunde"),
    sale_id: uuidOrNull(body, "saleId", "salg"),
    product_id: uuidOrNull(body, "productId", "produkt"),
    note_templates: body.noteTemplateIds === undefined ? undefined : noteTemplateIds(body.noteTemplateIds),
  };
  const sets = Object.entries(values).filter(([, v]) => v !== undefined);
  const analyse = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ status: string; template_version_id: string | null }>(
      `select status, template_version_id from calls where id = $1`,
      [callId],
    );
    if (!rows[0]) throw new NotFound();
    if (!sets.length) return false;
    if (values.note_templates) await activeTemplates(c, values.note_templates as string[]);
    try {
      const updated = await c.query<{ template_version_id: string | null }>(
        `update calls set ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1 returning template_version_id`,
        [callId, ...sets.map(([, v]) => v)],
      );
      if (!updated.rowCount) throw new NotFound();
      // The database refuses new links once an AI control exists, so a new template here means
      // the call has none yet.
      return (
        (rows[0].status === "transcribed" || rows[0].status === "analyzed") &&
        updated.rows[0]!.template_version_id !== null &&
        updated.rows[0]!.template_version_id !== rows[0].template_version_id
      );
    } catch (error) {
      if (error instanceof NotFound) throw error;
      translate(error);
    }
  });
  if (analyse) await services.startWorker(callId);
  return { id: callId };
}

export async function reviewAnalysis(db: pg.Pool, session: Session, callId: string, analysisId: string, body: Body) {
  const note = optionalText(body, "reviewNote", "Kommentar", 2000) ?? null;
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query(
      `update call_analyses set reviewed_at = now(), reviewed_by = app.current_user_id(), review_note = $3
       where id = $1 and call_id = $2`,
      [analysisId, callId, note],
    );
    if (!rowCount) throw new NotFound();
    return { id: analysisId };
  });
}

// --- Notes (Samtalestudio, docs/plan.md, section 18) -------------------------------------------

function translateNote(error: unknown): never {
  const message = (error as Error).message ?? "";
  if (message.includes("already being written")) throw new BadRequest("Det lages allerede notater for denne samtalen. Vent til de er ferdige.");
  if (message.includes("too many notes")) throw new BadRequest("Samtalen kan ha høyst 10 notater.");
  throw error;
}

// Another note from the same transcript, with the chosen note template (or the call centre's
// default). The worker writes it; the studio checks the status until it is done.
export async function requestNote(db: pg.Pool, session: Session, services: CallServices, callId: string, body: Body) {
  // Several note templates (the studio's chosen ones), one, or none for the default.
  const ids = body.templateIds !== undefined ? noteTemplateIds(body.templateIds) : [uuidOrNull(body, "templateId", "notatmal") ?? null].filter((v) => v !== null);
  const created = await withSession(db, session, async (c) => {
    const call = await c.query<{ status: string }>("select status from calls where id = $1", [callId]);
    if (!call.rows[0]) throw new NotFound();
    if (!["transcribed", "analyzed"].includes(call.rows[0].status)) throw new BadRequest("Samtalen er ikke ferdig transkribert ennå.");
    const chosen = ids.length ? await activeTemplates(c, ids) : [await defaultTemplate(c)];
    const made: string[] = [];
    try {
      for (const template of chosen) {
        const { rows } = await c.query<{ id: string }>(
          `insert into reports (organization_id, call_id, template_id, template_name, requested_by, status)
           values (app.current_org_id(), $1, $2, $3, app.current_user_id(), 'pending') returning id`,
          [callId, template.id, template.name],
        );
        made.push(rows[0]!.id);
      }
    } catch (error) {
      translateNote(error);
    }
    return made;
  });
  for (const id of created) await services.startWorker(undefined, id);
  return { ids: created, status: "pending" };
}

// The call centre's default note template, or VeriQall's built-in one.
async function defaultTemplate(c: pg.PoolClient): Promise<{ id: string | null; name: string }> {
  const { rows } = await c.query<{ id: string; name: string }>(
    "select id, name from report_templates where organization_id = app.current_org_id() and is_default and archived_at is null",
  );
  return rows[0] ?? { id: null, name: DEFAULT_REPORT.name };
}

// Note templates in use, in the order chosen; an unknown or archived one is refused.
async function activeTemplates(c: pg.PoolClient, ids: string[]): Promise<{ id: string; name: string }[]> {
  const { rows } = await c.query<{ id: string; name: string }>(
    "select id, name from report_templates where id = any($1::uuid[]) and archived_at is null",
    [ids],
  );
  if (rows.length !== ids.length) throw new BadRequest("Ukjent notatmal.");
  return ids.map((id) => rows.find((r) => r.id === id)!);
}

function noteTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5 || !value.every((v) => typeof v === "string" && isUuid(v))) {
    throw new BadRequest("Velg høyst fem notatmaler.");
  }
  return [...new Set(value as string[])];
}

// The seller adjusts the note. The AI text stays as it was; each adjustment is kept.
export async function editNote(db: pg.Pool, session: Session, callId: string, reportId: string, body: Body) {
  const content = requiredText(body, "content", "Notatet", 20000);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ own: boolean; status: string; content: string | null }>(
      `select c.user_id = app.current_user_id() as own, r.status,
              coalesce((select content from report_edits where report_id = r.id order by created_at desc limit 1), r.content) as content
       from reports r join calls c on c.id = r.call_id where r.id = $1 and r.call_id = $2`,
      [reportId, callId],
    );
    const found = rows[0];
    if (!found) throw new NotFound();
    if (!found.own) throw new BadRequest("Bare selgeren som hadde samtalen, kan endre notatet.");
    if (found.status !== "done") throw new BadRequest("Notatet er ikke ferdig ennå.");
    if (found.content === content) return { id: reportId, changed: false };
    await c.query(
      `insert into report_edits (organization_id, report_id, call_id, content, edited_by)
       values (app.current_org_id(), $1, $2, $3, app.current_user_id())`,
      [reportId, callId, content],
    );
    return { id: reportId, changed: true };
  });
}

// The seller's earlier versions of a note, newest first, with the AI text last.
export async function noteHistory(
  db: pg.Pool,
  session: Session,
  callId: string,
  reportId: string,
  meta: { ip?: string; userAgent?: string },
) {
  return withSession(db, session, async (c) => {
    const report = await c.query<{ content: string | null; created_at: Date; model: string | null }>(
      "select content, created_at, model from reports where id = $1 and call_id = $2",
      [reportId, callId],
    );
    if (!report.rows[0]) throw new NotFound();
    const edits = await c.query(
      `select e.content, e.created_at as "createdAt", u.full_name as "byName"
       from report_edits e left join users u on u.id = e.edited_by
       where e.report_id = $1 order by e.created_at desc`,
      [reportId],
    );
    await logAccess(c, callId, "view", meta);
    return [
      ...edits.rows.map((e) => ({ ...e, ai: false })),
      { content: report.rows[0].content, createdAt: report.rows[0].created_at, byName: null, ai: true },
    ];
  });
}

// The member's default product (the template) in the studio.
export async function getStudio(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ product_id: string | null }>(
      `select s.product_id from studio_preferences s join products p on p.id = s.product_id and p.archived_at is null`,
    );
    return { productId: rows[0]?.product_id ?? null };
  });
}

export async function setStudio(db: pg.Pool, session: Session, body: Body) {
  const productId = uuidOrNull(body, "productId", "produkt") ?? null;
  return withSession(db, session, async (c) => {
    if (productId) {
      const { rowCount } = await c.query("select 1 from products where id = $1 and archived_at is null", [productId]);
      if (!rowCount) throw new BadRequest("Ukjent produkt.");
    }
    await c.query(
      `insert into studio_preferences (organization_id, user_id, product_id) values (app.current_org_id(), app.current_user_id(), $1)
       on conflict (organization_id, user_id) do update set product_id = excluded.product_id, updated_at = now()`,
      [productId],
    );
    return { productId };
  });
}

// --- Report templates --------------------------------------------------------------------------

export async function listReportTemplates(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select id, name, instructions, is_default as "isDefault", archived_at as "archivedAt", updated_at as "updatedAt"
       from report_templates where organization_id = app.current_org_id()
       order by archived_at nulls first, is_default desc, lower(name)`,
    );
    return rows;
  });
}

export async function createReportTemplate(db: pg.Pool, session: Session, body: Body) {
  const name = requiredText(body, "name", "Navn", 200);
  const instructions = requiredText(body, "instructions", "Instruksjoner", 10000);
  const isDefault = body.isDefault === true;
  return withSession(db, session, async (c) => {
    if (isDefault) await c.query("update report_templates set is_default = false where organization_id = app.current_org_id() and is_default");
    const { rows } = await c.query<{ id: string }>(
      `insert into report_templates (id, organization_id, name, instructions, is_default, created_by)
       values ($1, app.current_org_id(), $2, $3, $4, app.current_user_id()) returning id`,
      [randomUUID(), name, instructions, isDefault],
    );
    return { id: rows[0]!.id };
  });
}

export async function updateReportTemplate(db: pg.Pool, session: Session, id: string, body: Body) {
  const name = optionalText(body, "name", "Navn", 200);
  const instructions = optionalText(body, "instructions", "Instruksjoner", 10000);
  if (name === null) throw new BadRequest("Navn må fylles ut.");
  if (instructions === null) throw new BadRequest("Instruksjoner må fylles ut.");
  const isDefault = body.isDefault;
  const archived = body.archived;
  if (isDefault !== undefined && typeof isDefault !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  if (archived !== undefined && typeof archived !== "boolean") throw new BadRequest("Ugyldig forespørsel.");
  if (isDefault === true && archived === true) throw new BadRequest("En arkivert mal kan ikke være standardmal.");
  return withSession(db, session, async (c) => {
    const exists = await c.query<{ archived: boolean }>("select archived_at is not null as archived from report_templates where id = $1", [id]);
    if (!exists.rows[0]) throw new NotFound();
    if (isDefault === true && exists.rows[0].archived && archived !== false) throw new BadRequest("En arkivert mal kan ikke være standardmal.");
    if (isDefault === true) {
      await c.query("update report_templates set is_default = false where organization_id = app.current_org_id() and is_default and id <> $1", [
        id,
      ]);
    }
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (name !== undefined) sets.push(`name = $${params.push(name)}`);
    if (instructions !== undefined) sets.push(`instructions = $${params.push(instructions)}`);
    if (archived === true) sets.push("archived_at = coalesce(archived_at, now())", "is_default = false");
    else if (isDefault !== undefined) sets.push(`is_default = $${params.push(isDefault)}`);
    if (archived === false) sets.push("archived_at = null");
    if (sets.length) await c.query(`update report_templates set ${sets.join(", ")} where id = $1`, params);
    return { id };
  });
}
