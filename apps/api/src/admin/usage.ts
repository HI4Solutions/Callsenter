// Økonomi → Forbruk (docs/plan.md, section 16): what the call centres used of paid services and
// what it cost us.
// - AI: Claude through Bedrock, tokens × the model's price.
// - Soniox: hours of audio, async and realtime.
// - eID: BankID and Vipps logins.
// Costs in USD are converted with Norges Bank's rate (exchange_rates); eID prices are in NOK.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { updateUsdNok } from "../exchange.ts";
import { withSession } from "../me.ts";
import { money } from "./billing.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body } from "./validate.ts";

function day(value: string | undefined, label: string): string | null {
  if (value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequest(`Ugyldig dato: ${label}.`);
  return value;
}

// A period of whole days in Norwegian time, from and to inclusive. No from: from the start.
function period(query: Record<string, string | undefined>) {
  const from = day(query.from, "fra");
  const to = day(query.to, "til");
  if (from && to && from > to) throw new BadRequest("Fra-datoen må være før til-datoen.");
  return { from, to };
}

const RANGE = `($1::date is null or u.created_at >= $1::date::timestamp at time zone 'Europe/Oslo')
  and ($2::date is null or u.created_at < ($2::date + 1)::timestamp at time zone 'Europe/Oslo')
  and ($3::uuid is null or u.organization_id = $3)`;

const MODULE_NAMES: Record<string, string> = {
  transcription_async: "Transkribering",
  transcription_realtime: "Sanntidstekst",
  ai_control: "AI-kontroll",
  report: "Rapporter",
};

async function summary(c: pg.PoolClient, from: string | null, to: string | null, org: string | null) {
  const params = [from, to, org];
  const usage = await c.query(
    `with u as (
       select u.*, mp.name as model_name,
              coalesce(u.input_tokens, 0) / 1e6 * mp.input_usd_per_million + coalesce(u.output_tokens, 0) / 1e6 * mp.output_usd_per_million as ai_usd,
              case u.kind
                when 'transcription_async' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_async_hour')
                when 'transcription_realtime' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_realtime_hour')
              end as soniox_usd
       from usage_events u left join model_prices mp on mp.model = u.model
       where ${RANGE}
     )
     select
       (select json_build_object(
          'calls', count(*), 'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0),
          'usd', round(coalesce(sum(ai_usd), 0), 4), 'unpriced', count(*) filter (where ai_usd is null))
        from u where kind in ('ai_control', 'report')) as ai,
       (select json_build_object(
          'transcriptions', count(distinct coalesce(call_id::text, id::text)) filter (where kind = 'transcription_async'),
          'asyncHours', round(coalesce(sum(audio_seconds) filter (where kind = 'transcription_async'), 0) / 3600.0, 2),
          'realtimeHours', round(coalesce(sum(audio_seconds) filter (where kind = 'transcription_realtime'), 0) / 3600.0, 2),
          'usd', round(coalesce(sum(soniox_usd), 0), 4))
        from u where kind like 'transcription%') as soniox,
       (select coalesce(json_agg(m order by m.kind), '[]') from (
          select kind, count(*) as count, coalesce(sum(input_tokens), 0) as "inputTokens", coalesce(sum(output_tokens), 0) as "outputTokens",
                 round(coalesce(sum(ai_usd), 0) + coalesce(sum(soniox_usd), 0), 4) as usd,
                 round(coalesce(sum(audio_seconds), 0) / 3600.0, 2) as hours
          from u group by kind) m) as modules,
       (select coalesce(json_agg(m order by m.usd desc), '[]') from (
          select model, coalesce(max(model_name), model) as name, count(*) as count, coalesce(sum(input_tokens), 0) as "inputTokens",
                 coalesce(sum(output_tokens), 0) as "outputTokens", round(coalesce(sum(ai_usd), 0), 4) as usd, bool_or(ai_usd is null) as unpriced
          from u where model is not null group by model) m) as models`,
    params,
  );
  const range = {
    from: from ? `${from}T00:00:00` : "1970-01-01T00:00:00",
    to: to ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  };
  const eid = await c.query<{ provider: string; logins: string; registrations: string; failed: string; cancelled: string }>(
    `select provider, logins, registrations, failed, cancelled
     from app.eid_usage($1::timestamp at time zone 'Europe/Oslo', ($2::date + 1)::timestamp at time zone 'Europe/Oslo')
     where organization_id is not distinct from $3`,
    [range.from, range.to, org],
  );
  const prices = await c.query<{ key: string; amount: string | null }>("select key, amount::text from service_prices");
  const price = (key: string) => {
    const p = prices.rows.find((r) => r.key === key)?.amount;
    return p === undefined || p === null ? null : Number(p);
  };
  const rate = (
    await c.query<{ day: string | null; usd_nok: string | null }>(
      "select day::text, usd_nok::text from exchange_rates where day <= coalesce($1::date, app.oslo_today()) order by day desc limit 1",
      [to],
    )
  ).rows[0];
  const usdNok = rate?.usd_nok ? Number(rate.usd_nok) : null;
  const eidRows = ["bankid", "vipps"].map((provider) => {
    const r = eid.rows.find((x) => x.provider === provider);
    const logins = Number(r?.logins ?? 0);
    const unit = price(`${provider}_login`);
    return {
      provider,
      logins,
      registrations: Number(r?.registrations ?? 0),
      failed: Number(r?.failed ?? 0),
      cancelled: Number(r?.cancelled ?? 0),
      nok: unit === null ? null : Math.round(logins * unit * 100) / 100,
    };
  });
  const row = usage.rows[0];
  const usd = Number(row.ai.usd) + Number(row.soniox.usd);
  const eidNok = eidRows.reduce((sum, e) => sum + (e.nok ?? 0), 0);
  return {
    from,
    to,
    ai: row.ai,
    soniox: row.soniox,
    eid: eidRows,
    modules: (row.modules as { kind: string }[]).map((m) => ({ ...m, name: MODULE_NAMES[m.kind] ?? m.kind })),
    models: row.models,
    usd: Math.round(usd * 10000) / 10000,
    rate: rate?.day ? { day: rate.day, usdNok } : null,
    nok: usdNok === null ? null : Math.round((usd * usdNok + eidNok) * 100) / 100,
    eidNok,
  };
}

export async function usageSummary(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const { from, to } = period(query);
  return withSession(db, session, (c) => summary(c, from, to, null));
}

export async function organizationUsage(db: pg.Pool, session: Session, id: string, query: Record<string, string | undefined>) {
  const { from, to } = period(query);
  return withSession(db, session, async (c) => {
    const org = await c.query("select 1 from organizations where id = $1", [id]);
    if (!org.rowCount) throw new NotFound();
    return summary(c, from, to, id);
  });
}

// One row per call centre: cost in NOK today, this week, month and year, and in total, and the
// number of transcriptions. eID is included at its NOK price.
export async function usageByOrganization(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `with rate as (select app.usd_nok(app.oslo_today()) as usd_nok),
       today as (select app.oslo_today() as d),
       bounds as (
         select (select d from today)::timestamp at time zone 'Europe/Oslo' as day_start,
                date_trunc('week', (select d from today))::timestamp at time zone 'Europe/Oslo' as week_start,
                date_trunc('month', (select d from today))::timestamp at time zone 'Europe/Oslo' as month_start,
                date_trunc('year', (select d from today))::timestamp at time zone 'Europe/Oslo' as year_start
       ),
       u as (
         select u.organization_id, u.created_at, u.kind, u.call_id, u.id,
                coalesce(coalesce(u.input_tokens, 0) / 1e6 * mp.input_usd_per_million + coalesce(u.output_tokens, 0) / 1e6 * mp.output_usd_per_million, 0)
                + coalesce(case u.kind
                    when 'transcription_async' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_async_hour')
                    when 'transcription_realtime' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_realtime_hour')
                  end, 0) as usd
         from usage_events u left join model_prices mp on mp.model = u.model
       )
       select o.id, o.name, o.customer_number as "customerNumber",
              round(coalesce(sum(u.usd) filter (where u.created_at >= b.day_start), 0) * coalesce(r.usd_nok, 0), 2)::float as today,
              round(coalesce(sum(u.usd) filter (where u.created_at >= b.week_start), 0) * coalesce(r.usd_nok, 0), 2)::float as week,
              round(coalesce(sum(u.usd) filter (where u.created_at >= b.month_start), 0) * coalesce(r.usd_nok, 0), 2)::float as month,
              round(coalesce(sum(u.usd) filter (where u.created_at >= b.year_start), 0) * coalesce(r.usd_nok, 0), 2)::float as year,
              round(coalesce(sum(u.usd), 0) * coalesce(r.usd_nok, 0), 2)::float as total,
              round(coalesce(sum(u.usd), 0), 4)::float as "totalUsd",
              count(distinct coalesce(u.call_id::text, u.id::text)) filter (where u.kind = 'transcription_async')::int as transcriptions
       from organizations o
       cross join bounds b cross join rate r
       left join u on u.organization_id = o.id
       group by o.id, o.name, o.customer_number, r.usd_nok
       order by total desc, o.name`,
    );
    // eID at its NOK price, per period.
    const today = (await c.query<{ d: string }>("select app.oslo_today()::text as d")).rows[0]!.d;
    const startOf = (unit: "week" | "month" | "year") =>
      c.query<{ d: string }>(`select date_trunc('${unit}', $1::date)::date::text as d`, [today]).then((r) => r.rows[0]!.d);
    const periods: [string, string][] = [
      ["today", today],
      ["week", await startOf("week")],
      ["month", await startOf("month")],
      ["year", await startOf("year")],
      ["total", "1970-01-01"],
    ];
    const prices = await c.query<{ key: string; amount: string | null }>("select key, amount::text from service_prices where key like '%_login'");
    const unit = Object.fromEntries(prices.rows.map((p) => [p.key.replace("_login", ""), p.amount === null ? 0 : Number(p.amount)]));
    const byOrg = new Map<string, Record<string, number>>();
    for (const [name, start] of periods) {
      const eid = await c.query<{ organization_id: string; provider: string; logins: string }>(
        `select organization_id, provider, logins from app.eid_usage($1::date::timestamp at time zone 'Europe/Oslo', ($2::date + 1)::timestamp at time zone 'Europe/Oslo')
         where organization_id is not null`,
        [start, today],
      );
      for (const e of eid.rows) {
        const entry = byOrg.get(e.organization_id) ?? {};
        entry[name] = (entry[name] ?? 0) + Number(e.logins) * (unit[e.provider] ?? 0);
        byOrg.set(e.organization_id, entry);
      }
    }
    return rows.map((r) => {
      const eid = byOrg.get(r.id) ?? {};
      const add = (key: string) => Math.round((r[key] + (eid[key] ?? 0)) * 100) / 100;
      return { ...r, today: add("today"), week: add("week"), month: add("month"), year: add("year"), total: add("total") };
    });
  });
}

// --- Prices -----------------------------------------------------------------------------------

export async function getPrices(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const models = await c.query(
      `select model, name, input_usd_per_million::float as input, output_usd_per_million::float as output, updated_at as "updatedAt"
       from model_prices order by name`,
    );
    const services = await c.query(`select key, amount::float as amount, currency, updated_at as "updatedAt" from service_prices order by key`);
    const rates = await c.query(`select day::text, usd_nok::float as "usdNok" from exchange_rates order by day desc limit 10`);
    return { models: models.rows, services: services.rows, rates: rates.rows };
  });
}

export async function updatePrices(db: pg.Pool, session: Session, body: Body) {
  const models = body.models === undefined ? [] : body.models;
  if (!Array.isArray(models) || models.length > 50) throw new BadRequest("Ugyldige modellpriser.");
  const parsedModels = models.map((raw) => {
    const m = (raw ?? {}) as Body;
    const model = typeof m.model === "string" ? m.model.trim() : "";
    const name = typeof m.name === "string" ? m.name.trim() : "";
    if (!model || model.length > 200 || !name || name.length > 100) throw new BadRequest("Modellen trenger ID og navn.");
    return { model, name, input: money(m.input, "pris inn"), output: money(m.output, "pris ut") };
  });
  const services = (body.services ?? {}) as Body;
  const parsedServices = Object.entries(services).map(([key, value]) => {
    if (!["soniox_async_hour", "soniox_realtime_hour", "bankid_login", "vipps_login"].includes(key)) throw new BadRequest("Ukjent pris.");
    return [key, value === null || value === "" ? null : money(value, "pris")] as const;
  });
  return withSession(db, session, async (c) => {
    for (const m of parsedModels) {
      await c.query(
        `insert into model_prices (model, name, input_usd_per_million, output_usd_per_million) values ($1, $2, $3, $4)
         on conflict (model) do update set name = excluded.name, input_usd_per_million = excluded.input_usd_per_million,
           output_usd_per_million = excluded.output_usd_per_million, updated_at = now()`,
        [m.model, m.name, m.input, m.output],
      );
    }
    for (const [key, amount] of parsedServices) {
      await c.query("update service_prices set amount = $2, updated_at = now() where key = $1", [key, amount]);
    }
    return { ok: true };
  });
}

export async function refreshRate(db: pg.Pool, session: Session, fetcher: typeof fetch = fetch) {
  return withSession(db, session, async (c) => {
    try {
      return await updateUsdNok(c, fetcher);
    } catch (error) {
      console.error("exchange rate failed", error);
      throw new BadRequest("Fikk ikke hentet kursen fra Norges Bank. Prøv igjen senere.");
    }
  });
}
