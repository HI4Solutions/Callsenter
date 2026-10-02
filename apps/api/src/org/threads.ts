// Conversations between a call centre's admins and the superadmins (migration 0009). The same
// functions serve both sides: "org" runs in the session's call centre, "platform" as a
// superadmin across call centres.
import type pg from "pg";
import { NotFound } from "../admin/organizations.ts";
import { BadRequest, type Body, isUuid, requiredText } from "../admin/validate.ts";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";

export type Side = "org" | "platform";

function context(session: Session, side: Side): Session {
  return side === "platform" ? { ...session, activeOrganizationId: null } : session;
}

export async function listThreads(db: pg.Pool, session: Session, side: Side) {
  const readColumn = side === "org" ? "org_read_at" : "platform_read_at";
  return withSession(db, context(session, side), async (c) => {
    const { rows } = await c.query(
      `select t.id, t.subject, t.status, t.created_at as "createdAt", t.last_message_at as "lastMessageAt",
              t.organization_id as "organizationId", o.name as "organizationName",
              (select count(*) from support_messages m where m.thread_id = t.id)::int as messages,
              exists (select 1 from support_messages m
                      where m.thread_id = t.id and m.from_platform = $1
                        and m.created_at > coalesce(t.${readColumn}, '-infinity')) as unread
       from support_threads t join organizations o on o.id = t.organization_id
       ${side === "org" ? "where t.organization_id = app.current_org_id()" : ""}
       order by t.last_message_at desc
       limit 200`,
      [side === "org"],
    );
    return rows;
  });
}

export async function getThread(db: pg.Pool, session: Session, side: Side, threadId: string) {
  return withSession(db, context(session, side), async (c) => {
    const thread = await c.query(
      `select t.id, t.subject, t.status, t.created_at as "createdAt", t.organization_id as "organizationId",
              o.name as "organizationName"
       from support_threads t join organizations o on o.id = t.organization_id where t.id = $1`,
      [threadId],
    );
    if (!thread.rows[0]) throw new NotFound();
    const messages = await c.query(
      `select m.id, m.body, m.from_platform as "fromPlatform", m.created_at as "createdAt",
              m.author_user_id = app.current_user_id() as mine,
              case when m.from_platform then 'VeriQall' else u.full_name end as author
       from support_messages m left join users u on u.id = m.author_user_id
       where m.thread_id = $1 order by m.created_at`,
      [threadId],
    );
    await c.query(`update support_threads set ${side === "org" ? "org_read_at" : "platform_read_at"} = now() where id = $1`, [
      threadId,
    ]);
    return { ...thread.rows[0], messages: messages.rows };
  });
}

async function addMessage(c: pg.PoolClient, session: Session, side: Side, threadId: string, orgId: string, body: string) {
  await c.query(
    `insert into support_messages (thread_id, organization_id, author_user_id, from_platform, body)
     values ($1, $2, $3, $4, $5)`,
    [threadId, orgId, session.userId, side === "platform", body],
  );
  await c.query(
    `update support_threads set last_message_at = now(), status = 'open',
            ${side === "org" ? "org_read_at" : "platform_read_at"} = now()
     where id = $1`,
    [threadId],
  );
}

export async function startThread(db: pg.Pool, session: Session, side: Side, input: Body) {
  const subject = requiredText(input, "subject", "Emne", 200);
  const text = requiredText(input, "body", "Melding", 5000);
  let orgId = session.activeOrganizationId;
  if (side === "platform") {
    const target = input.organizationId;
    if (typeof target !== "string" || !isUuid(target)) throw new BadRequest("Velg et callsenter.");
    orgId = target;
  }
  if (!orgId) throw new BadRequest("Velg et callsenter.");
  return withSession(db, context(session, side), async (c) => {
    const org = await c.query("select 1 from organizations where id = $1", [orgId]);
    if (!org.rowCount) throw new BadRequest("Ukjent callsenter.");
    const { rows } = await c.query<{ id: string }>(
      "insert into support_threads (organization_id, subject, created_by) values ($1, $2, $3) returning id",
      [orgId, subject, session.userId],
    );
    await addMessage(c, session, side, rows[0]!.id, orgId, text);
    return { id: rows[0]!.id };
  });
}

export async function reply(db: pg.Pool, session: Session, side: Side, threadId: string, input: Body) {
  const text = requiredText(input, "body", "Melding", 5000);
  return withSession(db, context(session, side), async (c) => {
    const thread = await c.query<{ organization_id: string }>("select organization_id from support_threads where id = $1", [
      threadId,
    ]);
    if (!thread.rows[0]) throw new NotFound();
    await addMessage(c, session, side, threadId, thread.rows[0].organization_id, text);
    return { id: threadId };
  });
}

export async function setThreadStatus(db: pg.Pool, session: Session, side: Side, threadId: string, input: Body) {
  const status = input.status;
  if (status !== "open" && status !== "closed") throw new BadRequest("Ugyldig status.");
  return withSession(db, context(session, side), async (c) => {
    const { rowCount } = await c.query("update support_threads set status = $2 where id = $1", [threadId, status]);
    if (!rowCount) throw new NotFound();
    return { id: threadId, status };
  });
}
