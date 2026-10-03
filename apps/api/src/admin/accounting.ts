// Økonomi → Regnskap (docs/plan.md, section 16).
// - Costs: usage (AI, Soniox, eID, at the prices in Forbruk), manual costs and fixed monthly costs.
// - Revenue: invoice payments and manual income, counted when the money arrives, with VAT apart.
// - Result: net revenue minus costs.
// Also key figures and a revenue report per product. Stripe comes when it is connected.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { money } from "./billing.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, requiredText } from "./validate.ts";

const round = (n: number) => Math.round(n * 100) / 100;

function day(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequest(`Ugyldig dato: ${label}.`);
  return value;
}

function period(query: Record<string, string | undefined>, fallback: () => [string, string]) {
  if (!query.from && !query.to) return fallback();
  const from = day(query.from, "fra");
  const to = day(query.to, "til");
  if (from > to) throw new BadRequest("Fra-datoen må være før til-datoen.");
  return [from, to] as [string, string];
}

async function today(c: pg.PoolClient): Promise<string> {
  return (await c.query<{ d: string }>("select app.oslo_today()::text as d")).rows[0]!.d;
}

// Costs and revenue for whole days in Norwegian time, from and to inclusive.
export async function figures(c: pg.PoolClient, from: string, to: string) {
  const params = [from, to];
  const usage = (
    await c.query<{ ai: string; soniox: string; usd: string }>(
      `with u as (
         select u.kind, (u.created_at at time zone 'Europe/Oslo')::date as d,
                coalesce(coalesce(u.input_tokens, 0) / 1e6 * mp.input_usd_per_million + coalesce(u.output_tokens, 0) / 1e6 * mp.output_usd_per_million, 0) as ai_usd,
                coalesce(case u.kind
                  when 'transcription_async' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_async_hour')
                  when 'transcription_realtime' then coalesce(u.audio_seconds, 0) / 3600.0 * (select amount from service_prices where key = 'soniox_realtime_hour')
                end, 0) as soniox_usd
         from usage_events u left join model_prices mp on mp.model = u.model
         where u.created_at >= $1::date::timestamp at time zone 'Europe/Oslo' and u.created_at < ($2::date + 1)::timestamp at time zone 'Europe/Oslo'
       )
       select coalesce(sum(ai_usd * coalesce(app.usd_nok(d), 0)), 0)::text as ai,
              coalesce(sum(soniox_usd * coalesce(app.usd_nok(d), 0)), 0)::text as soniox,
              coalesce(sum(ai_usd + soniox_usd), 0)::text as usd
       from u`,
      params,
    )
  ).rows[0]!;
  const eid = (
    await c.query<{ nok: string }>(
      `select coalesce(sum(e.logins * coalesce(p.amount, 0)), 0)::text as nok
       from app.eid_usage($1::date::timestamp at time zone 'Europe/Oslo', ($2::date + 1)::timestamp at time zone 'Europe/Oslo') e
       left join service_prices p on p.key = e.provider || '_login'
       where e.organization_id is null`,
      params,
    )
  ).rows[0]!;
  const manual = (
    await c.query<{ costs: string; income: string; income_vat: string }>(
      `select coalesce(sum(case when kind = 'cost' then amount * case when currency = 'USD' then coalesce(app.usd_nok(occurred_on), 0) else 1 end end), 0)::text as costs,
              coalesce(sum(amount) filter (where kind = 'income'), 0)::text as income,
              coalesce(sum(amount * vat_rate / (1 + vat_rate)) filter (where kind = 'income'), 0)::text as income_vat
       from accounting_entries where occurred_on between $1 and $2`,
      params,
    )
  ).rows[0]!;
  // Fixed costs per month, for the part of each month inside the period.
  const fixed = (
    await c.query<{ nok: string }>(
      `select coalesce(sum(
                f.amount * case when f.currency = 'USD' then coalesce(app.usd_nok(least(m.month_end, $2::date)), 0) else 1 end
                * (least(m.month_end, $2::date) - greatest(m.month::date, $1::date) + 1)::numeric / app.days_in_month(m.month::date)
              ), 0)::text as nok
       from fixed_costs f
       join lateral (
         select g::date as month, (g + interval '1 month - 1 day')::date as month_end
         from generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month') g
       ) m on m.month >= f.starts_month and (f.ends_month is null or m.month <= f.ends_month)`,
      params,
    )
  ).rows[0]!;
  const payments = (
    await c.query<{ gross: string; vat: string }>(
      `select coalesce(sum(p.amount), 0)::text as gross,
              coalesce(sum(case when i.total <> 0 then p.amount * i.vat / i.total else 0 end), 0)::text as vat
       from invoice_payments p join invoices i on i.id = p.invoice_id
       where p.paid_on between $1 and $2`,
      params,
    )
  ).rows[0]!;

  const costs = {
    ai: round(Number(usage.ai)),
    soniox: round(Number(usage.soniox)),
    eid: round(Number(eid.nok)),
    manual: round(Number(manual.costs)),
    fixed: round(Number(fixed.nok)),
    total: 0,
  };
  costs.total = round(costs.ai + costs.soniox + costs.eid + costs.manual + costs.fixed);
  const gross = Number(payments.gross) + Number(manual.income);
  const vat = Number(payments.vat) + Number(manual.income_vat);
  const revenue = {
    gross: round(gross),
    vat: round(vat),
    net: round(gross - vat),
    invoices: round(Number(payments.gross)),
    manual: round(Number(manual.income)),
  };
  return { from, to, costs, revenue, result: round(revenue.net - costs.total), usageUsd: round(Number(usage.usd)) };
}

export async function accountingSummary(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  return withSession(db, session, async (c) => {
    const now = await today(c);
    const [from, to] = period(query, () => [`${now.slice(0, 7)}-01`, now]);
    const f = await figures(c, from, to);
    const kpi = (
      await c.query<{ mrr: string; agreements: number; open: number; trials: number }>(
        `select
           (select coalesce(sum((l->>'quantity')::numeric * (l->>'unitPrice')::numeric / r.interval_months), 0)
            from recurring_invoices r, jsonb_array_elements(r.lines) l where r.active and not r.paused)::text as mrr,
           (select count(*)::int from recurring_invoices where active and not paused) as agreements,
           (select count(*)::int from organizations o where o.access_until > now() and app.organization_open(o)) as open,
           (select count(*)::int from organizations o where o.status = 'active' and o.trial_ends_at > now()) as trials`,
      )
    ).rows[0]!;
    const mrr = round(Number(kpi.mrr));
    return {
      ...f,
      kpi: { mrr, arr: round(mrr * 12), invoiceMrr: mrr, agreements: kpi.agreements, payingCustomers: kpi.open, trials: kpi.trials },
    };
  });
}

// The last months (12 by default): revenue, costs and result per month.
export async function accountingMonths(db: pg.Pool, session: Session, monthsParam: string | undefined) {
  const months = Math.min(Math.max(Number(monthsParam) || 12, 1), 36);
  return withSession(db, session, async (c) => {
    const now = await today(c);
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const { rows } = await c.query<{ start: string; end: string }>(
        `select (date_trunc('month', $1::date) - make_interval(months => $2))::date::text as start,
                least((date_trunc('month', $1::date) - make_interval(months => $2) + interval '1 month - 1 day')::date, $1::date)::text as end`,
        [now, i],
      );
      const f = await figures(c, rows[0]!.start, rows[0]!.end);
      out.push({ month: rows[0]!.start.slice(0, 7), revenue: f.revenue.net, costs: f.costs.total, result: f.result });
    }
    return out;
  });
}

// Revenue per product: invoice payments spread over the invoice's lines (packages, invoice fee,
// other lines), and manual income. No customer data. Optionally per month. Packages carry their
// name; the other rows a productKey the page shows in its language (invoiceFee, otherLines,
// manualPayments).
export async function revenueReport(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const byMonth = query.byMonth === "1";
  return withSession(db, session, async (c) => {
    const now = await today(c);
    const [from, to] = period(query, () => [`${now.slice(0, 7)}-01`, now]);
    const { rows } = await c.query(
      `with paid as (
         select p.amount, p.paid_on, i.id as invoice_id, i.total, coalesce((i.seller->>'vatRegistered')::boolean, true) as vat_on
         from invoice_payments p join invoices i on i.id = p.invoice_id
         where p.paid_on between $1 and $2 and i.total <> 0
       ),
       lines as (
         select paid.paid_on, paid.amount / paid.total as share, l.quantity,
                case when l.kind = 'package' then coalesce(bp.name, l.description) end as product,
                case l.kind when 'package' then null when 'fee' then 'invoiceFee' else 'otherLines' end as product_key,
                round(l.quantity * l.unit_price, 2) as net,
                round(round(l.quantity * l.unit_price, 2) * case when paid.vat_on then l.vat_rate else 0 end, 2) as vat
         from paid join invoice_lines l on l.invoice_id = paid.invoice_id left join billing_packages bp on bp.id = l.package_id
       ),
       all_rows as (
         select paid_on, product, product_key, quantity * share as quantity, net * share as net, vat * share as vat from lines
         union all
         select occurred_on, null, 'manualPayments', 1, amount / (1 + vat_rate), amount * vat_rate / (1 + vat_rate)
         from accounting_entries where kind = 'income' and occurred_on between $1 and $2
       )
       select case when $3 then to_char(paid_on, 'YYYY-MM') end as month, product, product_key as "productKey",
              round(sum(quantity), 2)::float as quantity, round(sum(net), 2)::float as net, round(sum(vat), 2)::float as vat,
              round(sum(net + vat), 2)::float as total
       from all_rows
       group by 1, 2, 3
       order by 1 nulls first, total desc`,
      [from, to, byMonth],
    );
    return { from, to, byMonth, rows };
  });
}

// --- Manual entries and fixed costs -------------------------------------------------------------

function entryValues(body: Body) {
  const kind = body.kind;
  if (kind !== "cost" && kind !== "income") throw new BadRequest("Velg kostnad eller innbetaling.");
  const currency = body.currency ?? "NOK";
  if (currency !== "NOK" && currency !== "USD") throw new BadRequest("Ukjent valuta.");
  if (kind === "income" && currency !== "NOK") throw new BadRequest("Innbetalinger føres i kroner.");
  const vatRate = kind === "income" ? Number(body.vatRate ?? 0.25) : 0;
  if (![0, 0.12, 0.15, 0.25].includes(vatRate)) throw new BadRequest("Ugyldig mva-sats.");
  const amount = money(body.amount, "beløp", { allowNegative: true });
  if (Number(amount) === 0) throw new BadRequest("Beløpet kan ikke være null.");
  return { kind, description: requiredText(body, "description", "Beskrivelse", 300), amount, currency, vat_rate: vatRate, occurred_on: day(body.occurredOn, "dato") };
}

export async function listEntries(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  return withSession(db, session, async (c) => {
    const now = await today(c);
    const [from, to] = period(query, () => [`${now.slice(0, 4)}-01-01`, now]);
    const entries = await c.query(
      `select id, kind, description, amount::text, currency, vat_rate::float as "vatRate", occurred_on::text as "occurredOn"
       from accounting_entries where occurred_on between $1 and $2 order by occurred_on desc, created_at desc`,
      [from, to],
    );
    const fixed = await c.query(
      `select id, description, amount::text, currency, starts_month::text as "startsMonth", ends_month::text as "endsMonth"
       from fixed_costs order by (ends_month is null or ends_month >= date_trunc('month', app.oslo_today())) desc, description`,
    );
    return { entries: entries.rows, fixed: fixed.rows };
  });
}

export async function createEntry(db: pg.Pool, session: Session, body: Body) {
  const v = entryValues(body);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into accounting_entries (kind, description, amount, currency, vat_rate, occurred_on, created_by)
       values ($1, $2, $3, $4, $5, $6, app.current_user_id()) returning id`,
      [v.kind, v.description, v.amount, v.currency, v.vat_rate, v.occurred_on],
    );
    return { id: rows[0]!.id };
  });
}

export async function deleteEntry(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query("delete from accounting_entries where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { ok: true };
  });
}

function monthStart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequest(`Ugyldig måned: ${label}.`);
  return `${value}-01`;
}

function fixedValues(body: Body, creating: boolean) {
  const values: Record<string, unknown> = {};
  if (creating || body.description !== undefined) values.description = requiredText(body, "description", "Beskrivelse", 300);
  if (creating || body.amount !== undefined) {
    const amount = money(body.amount, "beløp");
    if (Number(amount) <= 0) throw new BadRequest("Beløpet må være større enn null.");
    values.amount = amount;
  }
  if (creating || body.currency !== undefined) {
    const currency = body.currency ?? "NOK";
    if (currency !== "NOK" && currency !== "USD") throw new BadRequest("Ukjent valuta.");
    values.currency = currency;
  }
  if (creating || body.startsMonth !== undefined) values.starts_month = monthStart(body.startsMonth, "fra");
  if (body.endsMonth !== undefined) values.ends_month = body.endsMonth === null || body.endsMonth === "" ? null : monthStart(body.endsMonth, "til");
  return values;
}

export async function createFixedCost(db: pg.Pool, session: Session, body: Body) {
  const v = Object.entries(fixedValues(body, true));
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into fixed_costs (created_by, ${v.map(([k]) => k).join(", ")}) values (app.current_user_id(), ${v.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      v.map(([, x]) => x),
    );
    return { id: rows[0]!.id };
  });
}

export async function updateFixedCost(db: pg.Pool, session: Session, id: string, body: Body) {
  const v = Object.entries(fixedValues(body, false));
  return withSession(db, session, async (c) => {
    const { rowCount } = v.length
      ? await c.query(`update fixed_costs set ${v.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [id, ...v.map(([, x]) => x)])
      : await c.query("select 1 from fixed_costs where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { id };
  });
}

export async function deleteFixedCost(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query("delete from fixed_costs where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { ok: true };
  });
}
