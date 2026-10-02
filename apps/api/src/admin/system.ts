// Superadmin System (docs/plan.md, section 10): how calls are transcribed, the word list sent to
// Soniox, and usage per call centre (audio minutes and AI tokens) for Økonomi.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { BadRequest, type Body } from "./validate.ts";

export async function getSystem(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ key: string; value: unknown; updated_at: Date }>(
      "select key, value, updated_at from platform_settings",
    );
    const settings = new Map(rows.map((r) => [r.key, r]));
    return {
      transcriptionMode: settings.get("transcription_mode")?.value === "chunked" ? "chunked" : "realtime",
      transcriptionTerms: (settings.get("transcription_terms")?.value as string[] | undefined) ?? [],
      updatedAt: rows.reduce<Date | null>((latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest), null),
    };
  });
}

export async function updateSystem(db: pg.Pool, session: Session, body: Body) {
  const mode = body.transcriptionMode;
  if (mode !== undefined && mode !== "realtime" && mode !== "chunked") throw new BadRequest("Ugyldig transkripsjonsmodus.");
  const termsInput = body.transcriptionTerms;
  let terms: string[] | undefined;
  if (termsInput !== undefined) {
    if (!Array.isArray(termsInput)) throw new BadRequest("Ugyldig ordliste.");
    terms = [...new Set(termsInput.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean))];
    if (terms.length > 500 || terms.some((t) => t.length > 100)) throw new BadRequest("Ordlisten kan ha opptil 500 ord på opptil 100 tegn.");
  }
  return withSession(db, session, async (c) => {
    const set = async (key: string, value: unknown) => {
      const { rowCount } = await c.query("update platform_settings set value = $2, updated_by = app.current_user_id() where key = $1", [
        key,
        JSON.stringify(value),
      ]);
      if (!rowCount) throw new BadRequest("Bare superadmin kan endre dette.");
    };
    if (mode !== undefined) await set("transcription_mode", mode);
    if (terms !== undefined) await set("transcription_terms", terms);
    return { ok: true };
  });
}

// Usage per call centre and month, newest first.
export async function usage(db: pg.Pool, session: Session, monthsParam: string | undefined) {
  const months = Math.min(Math.max(Number(monthsParam) || 3, 1), 24);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select o.id as "organizationId", o.name as "organizationName",
              to_char(date_trunc('month', u.created_at), 'YYYY-MM') as month,
              count(distinct u.call_id) filter (where u.kind = 'transcription_async')::int as calls,
              coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription_async'), 0)::int as "audioSeconds",
              coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription_realtime'), 0)::int as "realtimeSeconds",
              coalesce(sum(u.input_tokens), 0)::bigint::text as "inputTokens",
              coalesce(sum(u.output_tokens), 0)::bigint::text as "outputTokens"
       from usage_events u join organizations o on o.id = u.organization_id
       where u.created_at >= date_trunc('month', now()) - make_interval(months => $1 - 1)
       group by 1, 2, 3
       order by month desc, "organizationName"`,
      [months],
    );
    return rows;
  });
}
