// The worker's job for one call (docs/plan.md, section 13): join the uploaded chunks into one
// recording, transcribe it with Soniox (and delete it there at once), check it against the
// product template with Claude, and write the report. Runs as app_worker, outside any session.
import { AI_MODELS, DEFAULT_AI_MODEL, isAiModelKey } from "@veriqall/shared";
import type pg from "pg";
import type { Ai } from "./ai.ts";
import { type Segment, type Soniox, toSegments } from "./soniox.ts";
import { audioKey, callPrefix, type AudioStore } from "./store.ts";

export interface WorkerDeps {
  db: pg.Pool;
  store: AudioStore;
  soniox: Soniox | null;
  ai: Ai | null;
  // Waits between status checks at Soniox (shortened in tests).
  sleep: (ms: number) => Promise<void>;
  // How long to wait for Soniox before giving up (the Lambda has 15 minutes).
  sonioxTimeoutMs: number;
}

interface CallRow {
  id: string;
  organization_id: string;
  status: string;
  transcription_mode: string;
  audio_key: string | null;
  audio_mime: string | null;
  duration_ms: number | null;
  template_version_id: string | null;
  product_id: string | null;
  customer_id: string | null;
  title: string | null;
  attempts: number;
  soniox_file_id: string | null;
  soniox_transcription_id: string | null;
}

// Shown to users; the details go to the log.
const FAILED = {
  noAudio: "Ingen lyd ble lastet opp.",
  transcription: "Transkriberingen feilet. Prøv igjen.",
  notEnabled: "Transkribering er ikke slått på for callsenteret.",
  notConfigured: "Transkribering er ikke satt opp ennå.",
  ai: "AI-kontrollen feilet. Prøv igjen.",
  tooMany: "Behandlingen feilet flere ganger. Prøv igjen senere.",
} as const;

class CallFailure extends Error {}

// A file name extension for the audio type, so Soniox and players recognise the format.
export function extension(mime: string | null): string {
  const type = (mime ?? "").split(";")[0] ?? "";
  const known: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/aac": "aac",
  };
  return known[type] ?? "webm";
}

async function modules(db: pg.Pool, orgId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ module: string }>(
    "select module from organization_modules where organization_id = $1 and enabled",
    [orgId],
  );
  return new Set(rows.map((r) => r.module));
}

async function cleanupSoniox(deps: WorkerDeps, call: CallRow) {
  if (!deps.soniox || (!call.soniox_file_id && !call.soniox_transcription_id)) return;
  if (call.soniox_transcription_id) await deps.soniox.deleteTranscription(call.soniox_transcription_id).catch((e) => console.error("soniox cleanup", e));
  if (call.soniox_file_id) await deps.soniox.deleteFile(call.soniox_file_id).catch((e) => console.error("soniox cleanup", e));
  await deps.db.query("update calls set soniox_file_id = null, soniox_transcription_id = null where id = $1", [call.id]);
}

async function fail(db: pg.Pool, callId: string, message: string) {
  await db.query("update calls set status = 'failed', error = $2, lease_until = null where id = $1", [callId, message]);
}

// Processes one call if it is waiting (processing) or transcribed but not yet analysed. Safe to
// call twice: the lease keeps a second run away.
export async function processCall(deps: WorkerDeps, callId: string): Promise<void> {
  // Waiting calls, and analysed calls that got a template linked after their report.
  const claimed = await deps.db.query<CallRow>(
    `update calls c set lease_until = now() + interval '15 minutes', attempts = attempts + 1
     where c.id = $1 and (c.lease_until is null or c.lease_until < now())
       and (c.status in ('processing', 'transcribed')
            or (c.status = 'analyzed' and c.template_version_id is not null
                and not exists (select 1 from call_analyses a where a.call_id = c.id)))
     returning id, organization_id, status, transcription_mode, audio_key, audio_mime, duration_ms,
               template_version_id, product_id, customer_id, title, attempts, soniox_file_id, soniox_transcription_id`,
    [callId],
  );
  const call = claimed.rows[0];
  if (!call) return;
  // A run that was cut off may have left the recording at Soniox.
  await cleanupSoniox(deps, call);
  if (call.attempts > 3) {
    await fail(deps.db, call.id, FAILED.tooMany);
    return;
  }
  try {
    const enabled = await modules(deps.db, call.organization_id);
    if (call.status === "processing") await transcribe(deps, call, enabled);
    await analyse(deps, call, enabled);
    await deps.db.query("update calls set lease_until = null where id = $1", [call.id]);
  } catch (error) {
    console.error("worker: call failed", call.id, error);
    const message =
      error instanceof CallFailure ? error.message : call.status === "processing" ? FAILED.transcription : FAILED.ai;
    await fail(deps.db, call.id, message);
  }
}

// --- Transcription ---------------------------------------------------------------------------

async function joinChunks(deps: WorkerDeps, call: CallRow): Promise<{ key: string; bytes: Uint8Array }> {
  const key = audioKey(call.organization_id, call.id);
  if (call.audio_key) return { key, bytes: await deps.store.get(call.audio_key) };
  const chunks = (await deps.store.list(`${callPrefix(call.organization_id, call.id)}chunks/`)).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  if (!chunks.length) throw new CallFailure(FAILED.noAudio);
  // Chunks from one MediaRecorder are pieces of one file: joined in order they play as one.
  const parts = await Promise.all(chunks.map((c) => deps.store.get(c.key)));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  await deps.store.put(key, bytes, call.audio_mime ?? "audio/webm");
  await deps.db.query("update calls set audio_key = $2, audio_bytes = $3 where id = $1", [call.id, key, bytes.length]);
  await deps.store.delete(chunks.map((c) => c.key));
  return { key, bytes };
}

async function context(db: pg.Pool, call: CallRow) {
  const terms = (await db.query<{ value: string[] }>("select value from platform_settings where key = 'transcription_terms'")).rows[0]
    ?.value;
  const names = await db.query<{ org: string; product: string | null }>(
    `select o.name as org, p.name as product from organizations o
     left join products p on p.id = $2 where o.id = $1`,
    [call.organization_id, call.product_id],
  );
  const extra = [names.rows[0]?.org, names.rows[0]?.product].filter((v): v is string => Boolean(v));
  return {
    general: [{ key: "domain", value: "Telefonsalg" }],
    terms: [...new Set([...(Array.isArray(terms) ? terms : []), ...extra])].slice(0, 500),
  };
}

async function transcribe(deps: WorkerDeps, call: CallRow, enabled: Set<string>) {
  if (!enabled.has("transcription")) throw new CallFailure(FAILED.notEnabled);
  if (!deps.soniox) throw new CallFailure(FAILED.notConfigured);
  const audio = await joinChunks(deps, call);

  const soniox = deps.soniox;
  let fileId: string | undefined;
  let transcriptionId: string | undefined;
  let tokens;
  let audioMs: number | undefined;
  try {
    // The ids are kept on the call until deleted, so a run that is cut off can be cleaned up.
    fileId = await soniox.uploadFile(audio.bytes, `${call.id}.${extension(call.audio_mime)}`, call.audio_mime ?? "audio/webm");
    await deps.db.query("update calls set soniox_file_id = $2 where id = $1", [call.id, fileId]);
    transcriptionId = await soniox.createTranscription(fileId, await context(deps.db, call), call.id);
    await deps.db.query("update calls set soniox_transcription_id = $2 where id = $1", [call.id, transcriptionId]);
    const deadline = Date.now() + deps.sonioxTimeoutMs;
    for (;;) {
      const status = await soniox.status(transcriptionId);
      if (status.status === "completed") {
        audioMs = status.audio_duration_ms;
        break;
      }
      if (status.status === "error") throw new Error(`soniox: ${status.error_message ?? "error"}`);
      if (Date.now() > deadline) throw new Error("soniox: timed out");
      await deps.sleep(3000);
    }
    tokens = (await soniox.transcript(transcriptionId)).tokens;
  } finally {
    // Nothing is left at Soniox: the file and the transcription go as soon as we have the text.
    if (transcriptionId) await soniox.deleteTranscription(transcriptionId).catch((e) => console.error("soniox cleanup", e));
    if (fileId) await soniox.deleteFile(fileId).catch((e) => console.error("soniox cleanup", e));
    await deps.db.query("update calls set soniox_file_id = null, soniox_transcription_id = null where id = $1", [call.id]);
  }

  const segments = toSegments(tokens);
  const text = segments.map((s) => s.text).join("\n");
  const durationMs = audioMs ?? segments.at(-1)?.endMs ?? call.duration_ms ?? 0;
  const client = await deps.db.connect();
  try {
    await client.query("begin");
    await client.query("delete from transcripts where call_id = $1", [call.id]);
    await client.query("delete from transcript_segments where call_id = $1", [call.id]);
    await client.query("insert into transcripts (call_id, organization_id, text, model, audio_ms) values ($1, $2, $3, $4, $5)", [
      call.id,
      call.organization_id,
      text,
      "soniox",
      durationMs,
    ]);
    await insertSegments(client, call, segments);
    await client.query("update calls set status = 'transcribed', duration_ms = $2, error = null where id = $1", [call.id, durationMs]);
    const seconds = Math.round(durationMs / 1000);
    await client.query(
      "insert into usage_events (organization_id, call_id, kind, audio_seconds) values ($1, $2, 'transcription_async', $3)",
      [call.organization_id, call.id, seconds],
    );
    // Live text was streamed once, however many times the recording is transcribed.
    if (call.transcription_mode === "realtime") {
      await client.query(
        `insert into usage_events (organization_id, call_id, kind, audio_seconds)
         select $1, $2, 'transcription_realtime', $3
         where not exists (select 1 from usage_events where call_id = $2 and kind = 'transcription_realtime')`,
        [call.organization_id, call.id, seconds],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  call.status = "transcribed";
}

async function insertSegments(client: pg.PoolClient, call: CallRow, segments: Segment[]) {
  for (let i = 0; i < segments.length; i += 500) {
    const batch = segments.slice(i, i + 500);
    const values: unknown[] = [];
    const rows = batch.map((s, j) => {
      values.push(call.id, call.organization_id, i + j, s.speaker, s.startMs, s.endMs, s.text);
      const b = j * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await client.query(
      `insert into transcript_segments (call_id, organization_id, seq, speaker, start_ms, end_ms, text) values ${rows.join(", ")}`,
      values,
    );
  }
}

// --- AI control and report -------------------------------------------------------------------

export function timestamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function transcriptForAi(db: pg.Pool, callId: string): Promise<string> {
  const { rows } = await db.query<{ speaker: string | null; start_ms: number; text: string }>(
    "select speaker, start_ms, text from transcript_segments where call_id = $1 order by seq",
    [callId],
  );
  return rows.map((r) => `[${timestamp(r.start_ms)}]${r.speaker ? ` Taler ${r.speaker}:` : ""} ${r.text}`).join("\n");
}

interface Template {
  version: number;
  product: string;
  price_once: string | null;
  price_monthly: string | null;
  binding_months: number;
  notice_months: number;
  withdrawal_days: number;
  terms: string;
  required_points: { id: string; text: string }[];
  approved_phrases: string[];
  forbidden_phrases: string[];
}

export interface Finding {
  kind: "required_point" | "forbidden_phrase" | "price_terms" | "other";
  pointId: string;
  label: string;
  level: "green" | "yellow" | "red";
  quote: string;
  startMs: number;
  comment: string;
}

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string", description: "Kort oppsummering på norsk bokmål av hvordan samtalen holdt seg til malen." },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "pointId", "label", "level", "quote", "startMs", "comment"],
        properties: {
          kind: { type: "string", enum: ["required_point", "forbidden_phrase", "price_terms", "other"] },
          pointId: { type: "string", description: "Id-en til det obligatoriske punktet, ellers tom streng." },
          label: { type: "string" },
          level: { type: "string", enum: ["green", "yellow", "red"] },
          quote: { type: "string", description: "Ordrett sitat fra transkripsjonen, eller tom streng." },
          startMs: { type: "integer", description: "Tidspunktet for sitatet i millisekunder, eller -1." },
          comment: { type: "string" },
        },
      },
    },
  },
} as const;

const CONTROL_SYSTEM = `You check recorded telephone sales calls for a Norwegian call centre against the product template the seller must follow. Work only from the transcript; it may contain transcription errors, so judge meaning, not exact wording. Speaker labels come from automatic diarization and may be wrong.

Produce one finding per mandatory point (kind "required_point", pointId = the point's id):
- green: clearly said;
- yellow: said partly, unclearly or in a misleading way;
- red: not said.
Produce a finding (kind "forbidden_phrase") for every forbidden phrase that was used, or an equivalent statement with the same meaning: red.
Produce a finding (kind "price_terms") if the price, binding period, notice period or withdrawal right stated in the call contradicts the template: red if it is wrong, yellow if unclear. Add "other" findings only for serious problems such as pressure selling or the customer clearly not consenting (yellow or red).
For each finding quote the relevant words verbatim from the transcript (empty string if nothing was said) with the timestamp in milliseconds (the [mm:ss] marker before the line; -1 if none). Write label, comment and summary in Norwegian bokmål, short and factual.`;

function describeTemplate(t: Template): string {
  const price = [t.price_monthly && `${t.price_monthly} kr per måned`, t.price_once && `${t.price_once} kr engangs`].filter(Boolean).join(" + ");
  return [
    `Produkt: ${t.product} (malversjon ${t.version})`,
    `Pris: ${price || "ikke oppgitt"}`,
    `Bindingstid: ${t.binding_months} måneder. Oppsigelsestid: ${t.notice_months} måneder. Angrefrist: ${t.withdrawal_days} dager.`,
    `Obligatoriske punkter:\n${t.required_points.map((p) => `- [${p.id}] ${p.text}`).join("\n") || "- ingen"}`,
    `Godkjente formuleringer:\n${t.approved_phrases.map((p) => `- ${p}`).join("\n") || "- ingen"}`,
    `Forbudte formuleringer:\n${t.forbidden_phrases.map((p) => `- ${p}`).join("\n") || "- ingen"}`,
    `Vilkår:\n${t.terms.slice(0, 20000) || "ingen"}`,
  ].join("\n\n");
}

export function worstLevel(findings: Pick<Finding, "level">[]): "green" | "yellow" | "red" {
  if (findings.some((f) => f.level === "red")) return "red";
  if (findings.some((f) => f.level === "yellow")) return "yellow";
  return "green";
}

// The built-in report when the call centre has not made its own default template.
export const DEFAULT_REPORT = {
  name: "Standardrapport",
  instructions: `Skriv en kort rapport om samtalen for callsenterets ledere og compliance:
1. Sammendrag (2–4 setninger): hvem ringte, hva ble tilbudt, og hva endte samtalen med.
2. Tilbud og vilkår: pris, bindingstid og angrerett slik selgeren la dem fram.
3. Kundens svar: aksepterte kunden, og hvordan.
4. Oppfølging: konkrete ting som må følges opp.`,
};

const REPORT_SYSTEM = `You write reports about recorded telephone sales calls for a Norwegian call centre. Follow the call centre's report instructions. Base everything on the transcript only and say so when something is unclear; never invent facts. Write in Norwegian bokmål, as plain text with short headings, without Markdown tables.`;

async function analyse(deps: WorkerDeps, call: CallRow, enabled: Set<string>) {
  const ai = deps.ai;
  const control = Boolean(ai && enabled.has("ai_control") && call.template_version_id);
  // One report per call: a template linked later adds the AI control, not a second report.
  const hasReport = (await deps.db.query("select 1 from reports where call_id = $1", [call.id])).rowCount! > 0;
  const report = Boolean(ai && enabled.has("reports") && !hasReport);
  if (!control && !report) return;
  const transcript = await transcriptForAi(deps.db, call.id);
  if (!transcript.trim()) return;
  // The model chosen by superadmins under System.
  const chosen = (await deps.db.query<{ value: unknown }>("select value from platform_settings where key = 'ai_model'")).rows[0]?.value;
  const model = AI_MODELS[isAiModelKey(chosen) ? chosen : DEFAULT_AI_MODEL].bedrockId;

  let templateText = "";
  if (call.template_version_id) {
    const { rows } = await deps.db.query<Template>(
      `select tv.version, p.name as product, tv.price_once::text, tv.price_monthly::text, tv.binding_months, tv.notice_months,
              tv.withdrawal_days, tv.terms, tv.required_points, tv.approved_phrases, tv.forbidden_phrases
       from product_template_versions tv join products p on p.id = tv.product_id where tv.id = $1`,
      [call.template_version_id],
    );
    if (rows[0]) templateText = describeTemplate(rows[0]);
  }

  if (control && ai && templateText) {
    const result = await ai.structured<{ summary: string; findings: Finding[] }>(
      model,
      CONTROL_SYSTEM,
      `<template>\n${templateText}\n</template>\n\n<transcript>\n${transcript}\n</transcript>`,
      FINDINGS_SCHEMA,
    );
    const findings = result.data.findings.map((f) => ({ ...f, startMs: f.startMs >= 0 ? f.startMs : null, quote: f.quote || null }));
    await deps.db.query(
      `insert into call_analyses (organization_id, call_id, template_version_id, model, flag, summary, findings, input_tokens, output_tokens)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        call.organization_id,
        call.id,
        call.template_version_id,
        result.model,
        worstLevel(result.data.findings),
        result.data.summary,
        JSON.stringify(findings),
        result.inputTokens,
        result.outputTokens,
      ],
    );
    await usage(deps.db, call, "ai_control", result);
  }

  if (report && ai) {
    const template = (
      await deps.db.query<{ id: string; name: string; instructions: string }>(
        `select id, name, instructions from report_templates
         where organization_id = $1 and is_default and archived_at is null`,
        [call.organization_id],
      )
    ).rows[0];
    const chosen = template ?? { id: null, ...DEFAULT_REPORT };
    const result = await ai.text(
      model,
      REPORT_SYSTEM,
      `<report_instructions>\n${chosen.instructions}\n</report_instructions>\n\n${
        templateText ? `<template>\n${templateText}\n</template>\n\n` : ""
      }<transcript>\n${transcript}\n</transcript>`,
    );
    await deps.db.query(
      `insert into reports (organization_id, call_id, template_id, template_name, content, model, input_tokens, output_tokens)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [call.organization_id, call.id, chosen.id, chosen.name, result.data.trim(), result.model, result.inputTokens, result.outputTokens],
    );
    await usage(deps.db, call, "report", result);
  }
  await deps.db.query("update calls set status = 'analyzed', error = null where id = $1", [call.id]);
}

async function usage(db: pg.Pool, call: CallRow, kind: string, r: { model: string; inputTokens: number; outputTokens: number }) {
  await db.query(
    "insert into usage_events (organization_id, call_id, kind, input_tokens, output_tokens, model) values ($1, $2, $3, $4, $5, $6)",
    [call.organization_id, call.id, kind, r.inputTokens, r.outputTokens, r.model],
  );
}

// --- Housekeeping ----------------------------------------------------------------------------

// Deletes calls past their retention (audio and all rows), finishes recordings whose browser
// went away, and frees calls a crashed run left behind. Returns the calls to process.
export async function housekeeping(deps: WorkerDeps, hasTime: () => boolean = () => true): Promise<string[]> {
  // All expired calls, in batches, while there is time.
  for (;;) {
    const expired = await deps.db.query<{ id: string; organization_id: string }>(
      "select id, organization_id from calls where expires_at <= now() order by expires_at limit 200",
    );
    for (const c of expired.rows) {
      const objects = await deps.store.list(callPrefix(c.organization_id, c.id));
      await deps.store.delete(objects.map((o) => o.key));
      await deps.db.query("delete from calls where id = $1", [c.id]);
    }
    if (expired.rows.length < 200 || !hasTime()) break;
  }
  // A recording nobody finished: process what was uploaded, or drop it if nothing was.
  await deps.db.query(
    "delete from calls where status = 'recording' and chunk_count = 0 and started_at < now() - interval '1 day'",
  );
  const stale = await deps.db.query<{ id: string }>(
    `update calls set status = 'processing'
     where status = 'recording' and chunk_count > 0 and coalesce(last_chunk_at, started_at) < now() - interval '3 hours'
     returning id`,
  );
  // A run that died mid-way left its lease, or the worker was never started: pick it up again.
  const stuck = await deps.db.query<{ id: string }>(
    `select id from calls
     where (status in ('processing', 'transcribed') and lease_until < now())
        or (status = 'processing' and lease_until is null and processing_started_at < now() - interval '10 minutes')
     order by updated_at limit 50`,
  );
  return [...stale.rows, ...stuck.rows].map((r) => r.id);
}
