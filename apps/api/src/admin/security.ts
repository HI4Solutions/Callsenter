// Superadmin: the security tab (docs/plan.md, section 10, "Sikkerhet"): failed logins, the
// audit log and access log across call centres, and blocked IP addresses.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, isUuid, optionalDate, optionalText } from "./validate.ts";

function platform<T>(db: pg.Pool, session: Session, fn: (c: pg.PoolClient) => Promise<T>) {
  return withSession(db, { ...session, activeOrganizationId: null }, fn);
}

function hoursParam(value: string | undefined): number {
  const hours = Number(value ?? 24);
  return Number.isFinite(hours) && hours >= 1 && hours <= 24 * 90 ? Math.floor(hours) : 24;
}

export async function securityOverview(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const hours = hoursParam(query.hours);
  return platform(db, session, async (c) => {
    const since = "now() - make_interval(hours => $1)";
    const totals = await c.query(
      `select count(*) filter (where result = 'success')::int as success,
              count(*) filter (where result <> 'success')::int as failed
       from login_events where occurred_at > ${since}`,
      [hours],
    );
    const byIp = await c.query(
      `select host(ip) as ip, count(*)::int as failures, count(distinct user_id)::int as users, max(occurred_at) as "lastAt",
              exists (select 1 from blocked_ips b where b.removed_at is null and (b.expires_at is null or b.expires_at > now())
                      and l.ip <<= b.network) as blocked
       from login_events l
       where occurred_at > ${since} and result <> 'success' and ip is not null
       group by ip order by failures desc, "lastAt" desc limit 20`,
      [hours],
    );
    const byUser = await c.query(
      `select u.id, u.full_name as name, count(*)::int as failures, max(l.occurred_at) as "lastAt"
       from login_events l join users u on u.id = l.user_id
       where l.occurred_at > ${since} and l.result <> 'success'
       group by u.id, u.full_name order by failures desc limit 20`,
      [hours],
    );
    const recent = await c.query(
      `select l.occurred_at as "occurredAt", l.provider, l.result, l.reason, host(l.ip) as ip, l.user_agent as "userAgent",
              u.id as "userId", u.full_name as "userName"
       from login_events l left join users u on u.id = l.user_id
       where l.occurred_at > ${since}
       order by l.occurred_at desc limit 100`,
      [hours],
    );
    return { hours, totals: totals.rows[0], failedByIp: byIp.rows, failedByUser: byUser.rows, recent: recent.rows };
  });
}

const PAGE = 100;

function cursor(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequest("Ugyldig side.");
  return n;
}

// Newest first, in pages of 100: pass the last id as ?before= for the next page.
export async function auditLog(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const filters: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    filters.push(sql.replace("?", `$${values.length}`));
  };
  const before = cursor(query.before);
  if (before) add("a.id < ?", before);
  if (query.table) {
    if (!/^[a-z_]+$/.test(query.table)) throw new BadRequest("Ugyldig tabell.");
    add("a.table_name = ?", query.table);
  }
  if (query.action) {
    if (!["insert", "update", "delete"].includes(query.action)) throw new BadRequest("Ugyldig handling.");
    add("a.action = ?", query.action);
  }
  if (query.org) {
    if (!isUuid(query.org)) throw new BadRequest("Ugyldig callsenter.");
    add("a.organization_id = ?", query.org);
  }
  if (query.actor) {
    if (!isUuid(query.actor)) throw new BadRequest("Ugyldig bruker.");
    add("a.actor_user_id = ?", query.actor);
  }
  if (query.from) add("a.occurred_at >= ?", new Date(dateOnly(query.from)));
  if (query.to) add("a.occurred_at < ?::timestamptz + interval '1 day'", new Date(dateOnly(query.to)));

  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `select a.id::text, a.occurred_at as "occurredAt", a.action, a.table_name as "table", a.record_id as "recordId",
              a.as_platform_admin as "asPlatformAdmin", a.old_data as "oldData", a.new_data as "newData",
              a.organization_id as "organizationId", o.name as "organizationName",
              a.actor_user_id as "actorId", u.full_name as "actorName"
       from audit_log a
       left join organizations o on o.id = a.organization_id
       left join users u on u.id = a.actor_user_id
       ${filters.length ? `where ${filters.join(" and ")}` : ""}
       order by a.id desc limit ${PAGE}`,
      values,
    );
    return { rows, next: rows.length === PAGE ? rows[rows.length - 1].id : null };
  });
}

function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequest("Ugyldig dato.");
  return value;
}

export async function accessLog(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const filters: string[] = [];
  const values: unknown[] = [];
  const before = cursor(query.before);
  if (before) {
    values.push(before);
    filters.push(`a.id < $${values.length}`);
  }
  if (query.org) {
    if (!isUuid(query.org)) throw new BadRequest("Ugyldig callsenter.");
    values.push(query.org);
    filters.push(`a.organization_id = $${values.length}`);
  }
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `select a.id::text, a.occurred_at as "occurredAt", a.action, a.resource_type as "resourceType",
              a.resource_id as "resourceId", host(a.ip) as ip, o.name as "organizationName",
              a.user_id as "userId", u.full_name as "userName"
       from access_log a
       join organizations o on o.id = a.organization_id
       join users u on u.id = a.user_id
       ${filters.length ? `where ${filters.join(" and ")}` : ""}
       order by a.id desc limit ${PAGE}`,
      values,
    );
    return { rows, next: rows.length === PAGE ? rows[rows.length - 1].id : null };
  });
}

export async function listBlockedIps(db: pg.Pool, session: Session) {
  return platform(db, session, async (c) => {
    const { rows } = await c.query(
      `select b.id, b.network::text as network, b.reason, b.created_at as "createdAt", b.expires_at as "expiresAt",
              u.full_name as "createdByName"
       from blocked_ips b left join users u on u.id = b.created_by
       where b.removed_at is null and (b.expires_at is null or b.expires_at > now())
       order by b.created_at desc`,
    );
    return rows;
  });
}

export async function blockIp(db: pg.Pool, session: Session, requesterIp: string | undefined, body: Body) {
  const network = optionalText(body, "network", "IP-adresse", 64);
  if (!network) throw new BadRequest("Fyll ut IP-adresse eller nettverk.");
  const reason = optionalText(body, "reason", "Begrunnelse", 500) ?? null;
  const expiresAt = optionalDate(body, "expiresAt", "Utløper") ?? null;
  if (expiresAt && expiresAt <= new Date()) throw new BadRequest("Utløpsdatoen må være fram i tid.");

  return platform(db, session, async (c) => {
    // Postgres validates the address; a host address becomes /32 (or /128).
    let cidr: string;
    try {
      await c.query("savepoint parse");
      cidr = (await c.query<{ n: string }>("select $1::cidr::text as n", [network])).rows[0]!.n;
      await c.query("release savepoint parse");
    } catch {
      await c.query("rollback to savepoint parse");
      throw new BadRequest("Ugyldig IP-adresse eller nettverk.");
    }
    if (requesterIp) {
      const own = await c.query<{ hit: boolean }>("select $1::inet <<= $2::cidr as hit", [requesterIp, cidr]);
      if (own.rows[0]?.hit) throw new BadRequest("Du kan ikke sperre din egen IP-adresse.");
    }
    // An expired block is no longer live; clear it so the same network can be blocked again.
    await c.query("update blocked_ips set removed_at = now() where network = $1 and removed_at is null and expires_at <= now()", [
      cidr,
    ]);
    const { rows } = await c.query<{ id: string }>(
      "insert into blocked_ips (network, reason, expires_at, created_by) values ($1, $2, $3, $4) returning id",
      [cidr, reason, expiresAt, session.userId],
    );
    return { id: rows[0]!.id, network: cidr };
  });
}

export async function unblockIp(db: pg.Pool, session: Session, id: string) {
  return platform(db, session, async (c) => {
    const { rowCount } = await c.query("update blocked_ips set removed_at = now() where id = $1 and removed_at is null", [id]);
    if (!rowCount) throw new NotFound();
    return { id };
  });
}
