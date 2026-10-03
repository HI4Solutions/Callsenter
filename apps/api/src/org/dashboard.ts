// Dashboard and coaching (docs/plan.md, section 15, module 11). The numbers come from
// app.dashboard, which checks the dashboard permissions itself; coaching notes are under RLS.
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

const SCOPES = ["me", "seller", "team", "all"] as const;

function day(value: string | undefined, fallback: string): string {
  if (value === undefined || value === "") return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequest("Ugyldig dato.");
  return value;
}

function isoDay(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(date);
}

// A period of whole days in Norwegian time, from and to inclusive (default the last 30 days).
function period(query: Record<string, string | undefined>) {
  const today = isoDay(new Date());
  const to = day(query.to, today);
  const from = day(query.from, isoDay(new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000)));
  if (from > to) throw new BadRequest("Fra-datoen må være før til-datoen.");
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new BadRequest("Perioden kan være høyst ett år.");
  return { from, to };
}

// The period's bounds as timestamps for the database functions ($1 and $2 are the days).
const BOUNDS = "$1::date::timestamp at time zone 'Europe/Oslo', ($2::date + 1)::timestamp at time zone 'Europe/Oslo'";

// Numbers for a period. Also returns what the user may choose between: teams and the whole
// call centre.
export async function getDashboard(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const scope = SCOPES.includes(query.scope as (typeof SCOPES)[number]) ? query.scope! : "me";
  const target = scope === "seller" || scope === "team" ? query.target : undefined;
  if ((scope === "seller" || scope === "team") && (!target || !isUuid(target))) throw new BadRequest("Velg en selger eller et team.");
  const { from, to } = period(query);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ d: Record<string, unknown> }>(
      `select app.dashboard($1, $2, $3::date::timestamp at time zone 'Europe/Oslo',
                            ($4::date + 1)::timestamp at time zone 'Europe/Oslo') as d`,
      [scope, target ?? null, from, to],
    );
    const all = (await c.query<{ ok: boolean }>("select app.has_permission('dashboard.all') as ok")).rows[0]!.ok;
    const teamOnly = !all && (await c.query<{ ok: boolean }>("select app.has_permission('dashboard.team') as ok")).rows[0]!.ok;
    const teams = all
      ? await c.query("select id, name from teams where organization_id = app.current_org_id() and archived_at is null order by name")
      : teamOnly
        ? await c.query(
            `select t.id, t.name from teams t join memberships m on m.team_id = t.id
             where m.organization_id = app.current_org_id() and m.user_id = app.current_user_id() and m.status = 'active'`,
          )
        : { rows: [] };
    let target_name: string | null = null;
    if (scope === "seller") {
      target_name = (await c.query<{ name: string }>("select full_name as name from users where id = $1", [target])).rows[0]?.name ?? null;
    } else if (scope === "team") {
      target_name = (await c.query<{ name: string }>("select name from teams where id = $1", [target])).rows[0]?.name ?? null;
    }
    return { scope, target: target ?? null, targetName: target_name, from, to, canSeeAll: all, teams: teams.rows, ...rows[0]!.d };
  });
}

// The average per seller in one's own team, without names (null outside a team, and only
// figures when at least three were active).
export async function getBenchmark(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const { from, to } = period(query);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ b: Record<string, unknown> | null }>(`select app.dashboard_benchmark(${BOUNDS}) as b`, [from, to]);
    return { from, to, benchmark: rows[0]!.b };
  });
}

// Each seller in a team (or the whole call centre without team) day by day, with open flags
// and feedback given. The database checks dashboard.team and dashboard.all.
export async function getTeamDashboard(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const team = query.team || null;
  if (team !== null && !isUuid(team)) throw new BadRequest("Ukjent team.");
  const { from, to } = period(query);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ t: Record<string, unknown> }>(`select app.dashboard_team($3, ${BOUNDS}) as t`, [from, to, team]);
    return { from, to, team, ...rows[0]!.t };
  });
}

// The quality dashboard for compliance: dashboard.all with flags.review or complaints.manage
// (checked by the database); who opened recordings only with audit.read.
export async function getQualityDashboard(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const { from, to } = period(query);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ q: Record<string, unknown> }>(`select app.dashboard_quality(${BOUNDS}) as q`, [from, to]);
    return { from, to, ...rows[0]!.q };
  });
}

const NOTE_COLUMNS = `n.id, n.seller_id as "sellerId", s.full_name as "sellerName", n.author_id as "authorId", a.full_name as "authorName",
  n.call_id as "callId", c.title as "callTitle", c.started_at as "callStartedAt", n.kind, n.body, n.created_at as "createdAt", n.read_at as "readAt"`;

// Feedback to a seller (default: to oneself), newest first, and whether the user may give more.
export async function listCoaching(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const seller = query.sellerId && isUuid(query.sellerId) ? query.sellerId : session.userId;
  const callId = query.callId && isUuid(query.callId) ? query.callId : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${NOTE_COLUMNS}
       from coaching_notes n
       join users s on s.id = n.seller_id
       join users a on a.id = n.author_id
       left join calls c on c.id = n.call_id
       where n.organization_id = app.current_org_id() and n.seller_id = $1 and ($2::uuid is null or n.call_id = $2)
       order by n.created_at desc
       limit 200`,
      [seller, callId],
    );
    const canCoach = (await c.query<{ ok: boolean }>("select app.can_coach($1) as ok", [seller])).rows[0]!.ok;
    return { notes: rows, canCoach };
  });
}

export async function createCoaching(db: pg.Pool, session: Session, body: Body) {
  const seller = body.sellerId;
  if (typeof seller !== "string" || !isUuid(seller)) throw new BadRequest("Velg selgeren.");
  if (seller === session.userId) throw new BadRequest("Du kan ikke gi tilbakemelding til deg selv.");
  const call = body.callId ?? null;
  if (call !== null && (typeof call !== "string" || !isUuid(call))) throw new BadRequest("Ukjent samtale.");
  const kind = body.kind;
  if (kind !== "praise" && kind !== "improve") throw new BadRequest("Velg type tilbakemelding.");
  const text = requiredText(body, "body", "Tilbakemelding", 4000);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into coaching_notes (organization_id, seller_id, author_id, call_id, kind, body)
       values (app.current_org_id(), $1, app.current_user_id(), $2, $3, $4) returning id`,
      [seller, call, kind, text],
    );
    return { id: rows[0]!.id };
  });
}

// The seller marks feedback as read.
export async function readCoaching(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query("update coaching_notes set read_at = now() where id = $1 and read_at is null", [id]);
    if (!rowCount) {
      const exists = await c.query("select 1 from coaching_notes where id = $1 and seller_id = app.current_user_id()", [id]);
      if (!exists.rowCount) throw new NotFound();
    }
    return { id };
  });
}
