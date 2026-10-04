// Correspondence with people who used the landing page's contact form (docs/plan.md, section 20),
// one thread per e-mail address: their form requests, the e-mails superadmins send from here, and
// the e-mails they send back (received by SES, stored by the worker, src/inbound.ts). Superadmins
// see a chat; the other side gets e-mail in VeriQall's design.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { brandedEmailHtml, emailEnabled, escapeHtml, sendEmail } from "../email.ts";
import { DOCUMENT_TEXTS } from "../i18n/documents.ts";
import { localeOr } from "../i18n/worker.ts";
import { withSession } from "../me.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, requiredText } from "./validate.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function platform<T>(db: pg.Pool, session: Session, fn: (c: pg.PoolClient) => Promise<T>) {
  return withSession(db, { ...session, activeOrganizationId: null }, fn);
}

// Where the other side's answers go: the inbound address when SES receives e-mail for us
// (INBOUND_EMAIL, infra/app.yml), else the superadmin's own address.
export function inboundAddress(): string | undefined {
  return process.env.INBOUND_EMAIL || undefined;
}

function threadEmail(body: Body): string {
  const email = requiredText(body, "email", "E-post", 320).toLowerCase();
  if (!EMAIL.test(email)) throw new BadRequest("E-postadressen er ugyldig.");
  return email;
}

export interface ThreadMessage {
  id: string;
  // form: a request from the contact form. email: an e-mail they sent us. reply: ours.
  kind: "form" | "email" | "reply";
  body: string;
  subject: string | null;
  createdAt: string;
  sentByName: string | null;
  sent: boolean;
  unread: boolean;
}

// Every message to and from the addresses, oldest first, as one list per address.
const THREAD_ROWS = `
  select lower(r.email) as email, r.id, 'form' as kind, r.message as body, null::text as subject, r.created_at,
         null::text as sent_by_name, true as sent, r.handled_at is null as unread,
         r.name, r.company, r.phone, r.locale
  from contact_requests r
  union all
  select m.email, m.id, case m.direction when 'in' then 'email' else 'reply' end, m.body, m.subject, m.created_at,
         u.full_name, m.direction = 'in' or m.message_id is not null, m.direction = 'in' and m.read_at is null,
         m.name, null, null, null
  from contact_messages m left join users u on u.id = m.sent_by`;

interface Row {
  email: string;
  id: string;
  kind: ThreadMessage["kind"];
  body: string;
  subject: string | null;
  created_at: Date;
  sent_by_name: string | null;
  sent: boolean;
  unread: boolean;
  name: string | null;
  company: string | null;
  phone: string | null;
  locale: string | null;
}

function toThreads(rows: Row[]) {
  const threads = new Map<
    string,
    { email: string; name: string | null; company: string | null; phone: string | null; locale: string | null; lastAt: string; unread: number; messages: ThreadMessage[] }
  >();
  for (const r of rows) {
    const t = threads.get(r.email) ?? { email: r.email, name: null, company: null, phone: null, locale: null, lastAt: "", unread: 0, messages: [] };
    // The latest name, company, phone and language the person gave.
    t.name = r.name ?? t.name;
    t.company = r.company ?? t.company;
    t.phone = r.phone ?? t.phone;
    t.locale = r.locale ?? t.locale;
    t.lastAt = r.created_at.toISOString();
    if (r.unread) t.unread++;
    t.messages.push({
      id: r.id,
      kind: r.kind,
      body: r.body,
      subject: r.subject,
      createdAt: r.created_at.toISOString(),
      sentByName: r.sent_by_name,
      sent: r.sent,
      unread: r.unread,
    });
    threads.set(r.email, t);
  }
  return [...threads.values()].sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.lastAt.localeCompare(a.lastAt));
}

async function loadThreads(c: pg.PoolClient, email?: string) {
  const { rows } = await c.query<Row>(
    `select * from (${THREAD_ROWS}) t ${email ? "where t.email = $1" : ""} order by t.created_at`,
    email ? [email] : [],
  );
  return toThreads(rows);
}

export async function listContactThreads(db: pg.Pool, session: Session) {
  return platform(db, session, async (c) => ({
    emailEnabled: emailEnabled(),
    inboundEmail: inboundAddress() ?? null,
    threads: await loadThreads(c),
  }));
}

// The e-mail a reply becomes: in the language the person wrote in, their last message quoted.
function composeReply(text: string, thread: Awaited<ReturnType<typeof loadThreads>>[number], replyTo: string | undefined) {
  const locale = localeOr(thread.locale);
  const t = DOCUMENT_TEXTS[locale].contactReply;
  const last = [...thread.messages].reverse().find((m) => m.kind !== "reply");
  const subject = last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : t.subject;
  const hint = replyTo ? t.answerHint : null;
  const quoted = last
    ? `\n\n${t.youWrote}\n${last.body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}`
    : "";
  const text_ = `${text}${hint ? `\n\n${hint}` : ""}${quoted}`;
  const html = brandedEmailHtml(
    subject,
    `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>${hint ? `<p style="margin:24px 0 0;font-size:14px;color:#555873">${escapeHtml(hint)}</p>` : ""}${
      last
        ? `<p style="margin:24px 0 6px;font-size:14px;color:#555873">${escapeHtml(t.youWrote)}</p>
<div style="padding-left:12px;border-left:3px solid #dcdcec;color:#555873;font-size:14px;white-space:pre-wrap">${escapeHtml(last.body)}</div>`
        : ""
    }`,
    locale,
  );
  return { subject, text: text_, html };
}

async function replyContext(c: pg.PoolClient, email: string) {
  const thread = (await loadThreads(c, email))[0];
  if (!thread) throw new NotFound();
  const me = (await c.query<{ email: string | null }>("select email from users where id = app.current_user_id()")).rows[0];
  return { thread, replyTo: inboundAddress() ?? me?.email ?? undefined };
}

// The e-mail exactly as it would be sent, for "Forhåndsvis".
export async function previewContactReply(db: pg.Pool, session: Session, body: Body) {
  const email = threadEmail(body);
  const text = requiredText(body, "message", "Melding", 10000);
  return platform(db, session, async (c) => {
    const { thread, replyTo } = await replyContext(c, email);
    return { to: email, replyTo: replyTo ?? null, ...composeReply(text, thread, replyTo) };
  });
}

// Sends a reply and keeps it in the thread. Replying marks the thread handled: its requests and
// the e-mails received so far.
export async function replyContactThread(db: pg.Pool, session: Session, body: Body) {
  const email = threadEmail(body);
  const text = requiredText(body, "message", "Melding", 10000);
  if (!emailEnabled()) throw new BadRequest("E-post er ikke satt opp.");
  const draft = await platform(db, session, async (c) => {
    const { thread, replyTo } = await replyContext(c, email);
    const mail = composeReply(text, thread, replyTo);
    const { rows } = await c.query<{ id: string }>(
      `insert into contact_messages (email, direction, subject, body, html, sent_by)
       values ($1, 'out', $2, $3, $4, app.current_user_id()) returning id`,
      [email, mail.subject, text, mail.html],
    );
    await markHandled(c, email, true);
    return { id: rows[0]!.id, mail, replyTo };
  });
  const messageId = await sendEmail({ to: email, replyTo: draft.replyTo, subject: draft.mail.subject, text: draft.mail.text, html: draft.mail.html }).catch(
    (error) => {
      console.error("contact reply: could not send e-mail", error);
      return null;
    },
  );
  return platform(db, session, async (c) => {
    if (messageId) await c.query("update contact_messages set message_id = $2 where id = $1", [draft.id, messageId]);
    if (!messageId) throw new BadRequest("E-posten kunne ikke sendes. Svaret er lagret, men ikke sendt.");
    return (await loadThreads(c, email))[0];
  });
}

async function markHandled(c: pg.PoolClient, email: string, handled: boolean) {
  await c.query(
    `update contact_requests set handled_at = case when $2 then coalesce(handled_at, now()) end,
            handled_by = case when $2 then coalesce(handled_by, app.current_user_id()) end
     where lower(email) = $1`,
    [email, handled],
  );
  if (handled) await c.query("update contact_messages set read_at = now() where email = $1 and direction = 'in' and read_at is null", [email]);
}

export async function setContactThreadHandled(db: pg.Pool, session: Session, body: Body) {
  const email = threadEmail(body);
  if (typeof body.handled !== "boolean") throw new BadRequest("Ugyldig verdi.");
  return platform(db, session, async (c) => {
    await markHandled(c, email, body.handled as boolean);
    const thread = (await loadThreads(c, email))[0];
    if (!thread) throw new NotFound();
    return thread;
  });
}

// A sent reply exactly as the other side got it.
export async function contactMessageEmail(db: pg.Pool, session: Session, id: string) {
  return platform(db, session, async (c) => {
    const { rows } = await c.query<{ subject: string | null; html: string | null; email: string }>(
      "select subject, html, email from contact_messages where id = $1 and direction = 'out'",
      [id],
    );
    if (!rows[0]?.html) throw new NotFound();
    return { to: rows[0].email, subject: rows[0].subject, html: rows[0].html };
  });
}
