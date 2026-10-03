// Superadmin: announcements (docs/plan.md, section 10, "Meldinger") and the growth tab
// ("Vekst"). Announcements are read by every signed-in user through GET /announcements.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, isUuid, optionalDate, optionalText, requiredText } from "./validate.ts";

function platform<T>(db: pg.Pool, session: Session, fn: (c: pg.PoolClient) => Promise<T>) {
  return withSession(db, { ...session, activeOrganizationId: null }, fn);
}

const ANNOUNCEMENT_COLUMNS = `a.id, a.title, a.body, a.link_url as "linkUrl", a.link_text as "linkText"`;

// For the signed-in user: live announcements meant for them (RLS decides which).
export async function myAnnouncements(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${ANNOUNCEMENT_COLUMNS} from announcements a
       where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
         and (a.audience = 'all' or exists (
           select 1 from announcement_organizations ao
           where ao.announcement_id = a.id and ao.organization_id in (select app.my_organization_ids())))
       order by a.starts_at desc limit 5`,
    );
    return rows;
  });
}

export async function listAnnouncements(db: pg.Pool, session: Session) {
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${ANNOUNCEMENT_COLUMNS}, a.audience, a.active, a.starts_at as "startsAt", a.ends_at as "endsAt",
              a.created_at as "createdAt", u.full_name as "createdByName",
              coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name) order by o.name)
                        from announcement_organizations ao join organizations o on o.id = ao.organization_id
                        where ao.announcement_id = a.id), '[]') as organizations
       from announcements a left join users u on u.id = a.created_by
       order by a.created_at desc`,
    );
    return rows;
  });
}

function announcementFields(body: Body, creating: boolean) {
  const title = creating ? requiredText(body, "title", "Tittel", 200) : optionalText(body, "title", "Tittel", 200);
  if (title === null) throw new BadRequest("Tittel må fylles ut.");
  const text = creating ? requiredText(body, "body", "Tekst", 2000) : optionalText(body, "body", "Tekst", 2000);
  if (text === null) throw new BadRequest("Tekst må fylles ut.");
  const linkUrl = optionalText(body, "linkUrl", "Lenke", 500);
  if (linkUrl && !/^https:\/\/\S+$/.test(linkUrl)) throw new BadRequest("Lenken må begynne med https://.");
  const audience = body.audience;
  if (audience !== undefined && audience !== "all" && audience !== "selected") throw new BadRequest("Ugyldig mottakergruppe.");
  const active = body.active;
  if (active !== undefined && typeof active !== "boolean") throw new BadRequest("Ugyldig status.");
  const organizationIds = body.organizationIds;
  if (organizationIds !== undefined && (!Array.isArray(organizationIds) || !organizationIds.every((id) => isUuid(id as string)))) {
    throw new BadRequest("Ugyldige callsentre.");
  }
  if (audience === "selected" && Array.isArray(organizationIds) && organizationIds.length === 0) {
    throw new BadRequest("Velg minst ett callsenter.");
  }
  const startsAt = optionalDate(body, "startsAt", "Start");
  const endsAt = optionalDate(body, "endsAt", "Slutt");
  return {
    columns: {
      title,
      body: text,
      link_url: linkUrl,
      link_text: optionalText(body, "linkText", "Lenketekst", 100),
      audience: audience as string | undefined,
      active: active as boolean | undefined,
      starts_at: startsAt === null ? undefined : startsAt,
      ends_at: endsAt,
    },
    organizationIds: organizationIds as string[] | undefined,
  };
}

async function setAudience(c: pg.PoolClient, id: string, organizationIds: string[] | undefined) {
  if (organizationIds === undefined) return;
  await c.query("delete from announcement_organizations where announcement_id = $1", [id]);
  for (const org of new Set(organizationIds)) {
    await c.query("insert into announcement_organizations (announcement_id, organization_id) values ($1, $2)", [id, org]);
  }
}

export async function createAnnouncement(db: pg.Pool, session: Session, body: Body) {
  const { columns, organizationIds } = announcementFields(body, true);
  if (columns.audience === "selected" && !organizationIds?.length) throw new BadRequest("Velg minst ett callsenter.");
  const fields = Object.entries({ ...columns, created_by: session.userId }).filter(([, v]) => v !== undefined);
  return platform(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into announcements (${fields.map(([k]) => k).join(", ")})
       values (${fields.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      fields.map(([, v]) => v),
    );
    await setAudience(c, rows[0]!.id, columns.audience === "selected" ? organizationIds : []);
    return { id: rows[0]!.id };
  });
}

export async function updateAnnouncement(db: pg.Pool, session: Session, id: string, body: Body) {
  const { columns, organizationIds } = announcementFields(body, false);
  const fields = Object.entries(columns).filter(([, v]) => v !== undefined);
  return platform(db, session, async (c) => {
    const current = await c.query<{ audience: string }>("select audience from announcements where id = $1", [id]);
    if (!current.rows[0]) throw new NotFound();
    if (fields.length) {
      await c.query(
        `update announcements set ${fields.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
        [id, ...fields.map(([, v]) => v)],
      );
    }
    const audience = columns.audience ?? current.rows[0].audience;
    await setAudience(c, id, audience === "all" ? [] : organizationIds);
    if (audience === "selected") {
      const count = await c.query<{ n: number }>(
        "select count(*)::int as n from announcement_organizations where announcement_id = $1",
        [id],
      );
      if (!count.rows[0]?.n) throw new BadRequest("Velg minst ett callsenter.");
    }
    return { id };
  });
}

export async function deleteAnnouncement(db: pg.Pool, session: Session, id: string) {
  return platform(db, session, async (c) => {
    const { rowCount } = await c.query("delete from announcements where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { id };
  });
}

export async function growth(db: pg.Pool, session: Session, monthsParam: string | undefined) {
  const months = Math.min(Math.max(Number(monthsParam) || 12, 1), 60);
  return platform(db, session, async (c) => {
    const series = await c.query(
      `select to_char(month, 'YYYY-MM') as month, new_organizations as "newOrganizations", new_users as "newUsers",
              successful_logins as "logins"
       from app.admin_growth($1)`,
      [months],
    );
    const totals = await c.query(
      `select
         (select count(*) from organizations where status = 'active' and (trial_ends_at is null or trial_ends_at > now()))::int
           as "openOrganizations",
         (select count(*) from organizations where status = 'active' and trial_ends_at > now())::int as "trialOrganizations",
         (select count(*) from organizations where status = 'suspended' or trial_ends_at <= now())::int as "closedOrganizations",
         (select count(*) from users where status = 'active')::int as "activeUsers",
         (select count(*) from users where status = 'invited')::int as "invitedUsers",
         (select count(*) from users where created_at > now() - interval '30 days')::int as "newUsers30d",
         (select count(*) from users)::int as "allUsers",
         (select count(*) from users where created_at < date_trunc('month', now()) - make_interval(months => $1 - 1))::int
           as "usersBefore"`,
      [months],
    );
    const events = await c.query(
      `select id, title, to_char(occurred_on, 'YYYY-MM-DD') as "occurredOn" from growth_events
       where occurred_on >= (date_trunc('month', now()) - make_interval(months => $1 - 1))::date
       order by occurred_on`,
      [months],
    );
    return { months, totals: totals.rows[0], series: series.rows, events: events.rows };
  });
}

export async function addGrowthEvent(db: pg.Pool, session: Session, body: Body) {
  const title = requiredText(body, "title", "Tittel", 120);
  const date = body.occurredOn;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new BadRequest("Ugyldig dato.");
  }
  return platform(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "insert into growth_events (title, occurred_on, created_by) values ($1, $2, $3) returning id",
      [title, date, session.userId],
    );
    return { id: rows[0]!.id };
  });
}

export async function deleteGrowthEvent(db: pg.Pool, session: Session, id: string) {
  return platform(db, session, async (c) => {
    const { rowCount } = await c.query("delete from growth_events where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { id };
  });
}

// --- Contact requests from the landing page (docs/plan.md, section 20) -------------------------

const CONTACT_COLUMNS = `r.id, r.name, r.email, r.phone, r.company, r.message, r.locale, r.created_at as "createdAt",
       r.handled_at as "handledAt", u.full_name as "handledByName"`;

export async function listContactRequests(db: pg.Pool, session: Session) {
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${CONTACT_COLUMNS} from contact_requests r left join users u on u.id = r.handled_by
       order by r.handled_at is not null, r.created_at desc limit 500`,
    );
    return rows;
  });
}

// Marks a request handled (or open again), with who did it.
export async function setContactRequestHandled(db: pg.Pool, session: Session, id: string, body: Body) {
  if (typeof body.handled !== "boolean") throw new BadRequest("Ugyldig verdi.");
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `update contact_requests r set handled_at = case when $2 then now() end, handled_by = case when $2 then app.current_user_id() end
       where r.id = $1 returning r.id`,
      [id, body.handled],
    );
    if (!rows.length) throw new NotFound();
    const { rows: out } = await c.query(`select ${CONTACT_COLUMNS} from contact_requests r left join users u on u.id = r.handled_by where r.id = $1`, [id]);
    return out[0];
  });
}
