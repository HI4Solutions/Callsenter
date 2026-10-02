-- Economy, Forbruk (docs/plan.md, section 16): what usage costs us. Prices are editable by
-- superadmins:
-- - Claude per million tokens in USD, per Bedrock model id;
-- - Soniox per hour of audio in USD;
-- - BankID and Vipps per login in NOK.
-- USD is converted to NOK with Norges Bank's daily rate, fetched by the worker each morning.

create table model_prices (
  model text primary key check (length(model) <= 200),
  name text not null check (length(trim(name)) between 1 and 100),
  input_usd_per_million numeric(10, 4) not null check (input_usd_per_million >= 0),
  output_usd_per_million numeric(10, 4) not null check (output_usd_per_million >= 0),
  updated_at timestamptz not null default now()
);
-- List prices for Claude on Bedrock (on-demand), October 2026.
insert into model_prices (model, name, input_usd_per_million, output_usd_per_million) values
  ('eu.anthropic.claude-sonnet-4-6', 'Claude Sonnet 4.6', 3, 15),
  ('eu.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5', 3, 15),
  ('eu.anthropic.claude-opus-4-5-20251101-v1:0', 'Claude Opus 4.5', 5, 25),
  ('eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5', 1, 5);

create table service_prices (
  key text primary key check (key in ('soniox_async_hour', 'soniox_realtime_hour', 'bankid_login', 'vipps_login')),
  amount numeric(10, 4) check (amount >= 0),
  currency text not null check (currency in ('USD', 'NOK')),
  updated_at timestamptz not null default now()
);
-- Soniox list prices per hour of audio; eID prices depend on the agreements and are set by hand.
insert into service_prices (key, amount, currency) values
  ('soniox_async_hour', 0.10, 'USD'),
  ('soniox_realtime_hour', 0.12, 'USD'),
  ('bankid_login', null, 'NOK'),
  ('vipps_login', null, 'NOK');

create table exchange_rates (
  day date primary key,
  usd_nok numeric(10, 4) not null check (usd_nok > 0),
  fetched_at timestamptz not null default now()
);

alter table model_prices enable row level security;
alter table service_prices enable row level security;
alter table exchange_rates enable row level security;
create policy model_prices_platform on model_prices for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy service_prices_platform on service_prices for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy exchange_rates_platform on exchange_rates for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy exchange_rates_worker on exchange_rates for all to app_worker using (true) with check (true);
grant select, insert, update on model_prices to app_user;
grant select, update on service_prices to app_user;
grant select, insert, update on exchange_rates to app_user;
grant select, insert, update on exchange_rates to app_worker;

create trigger model_prices_audit after insert or update on model_prices
  for each row execute function app.audit_row_change();
create trigger service_prices_audit after update on service_prices
  for each row execute function app.audit_row_change();

-- The rate on a day: the latest one published on or before it.
create function app.usd_nok(on_day date) returns numeric
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select usd_nok from exchange_rates where day <= on_day order by day desc limit 1 $$;
revoke all on function app.usd_nok(date) from public;
grant execute on function app.usd_nok(date) to app_user;

-- eID logins per provider in a period, for the whole platform (organization null) and per call
-- centre. Logins belong to users, not call centres; a user in two call centres counts in both.
-- Registrations are a user's first successful login.
create function app.eid_usage(from_ts timestamptz, to_ts timestamptz)
  returns table (organization_id uuid, provider text, logins bigint, registrations bigint, failed bigint, cancelled bigint)
  language plpgsql stable security definer set search_path = pg_catalog, public
  as $$
  #variable_conflict use_column
  begin
    if not app.is_platform_admin() then
      raise exception 'only superadmins see usage' using errcode = 'insufficient_privilege';
    end if;
    return query
    with e as (
      select l.provider, l.result, l.user_id,
             l.result = 'success' and l.occurred_at = (
               select min(f.occurred_at) from login_events f where f.user_id = l.user_id and f.result = 'success'
             ) as first
      from login_events l
      where l.occurred_at >= from_ts and l.occurred_at < to_ts
    ),
    per_org as (
      select m.organization_id, e.* from e join memberships m on m.user_id = e.user_id
      union all
      select null::uuid, e.* from e
    )
    select p.organization_id, p.provider,
           count(*) filter (where p.result = 'success'),
           count(*) filter (where p.first),
           count(*) filter (where p.result in ('invalid', 'error', 'unknown_identity')),
           count(*) filter (where p.result = 'cancelled')
    from per_org p
    group by p.organization_id, p.provider;
  end
  $$;
revoke all on function app.eid_usage(timestamptz, timestamptz) from public;
grant execute on function app.eid_usage(timestamptz, timestamptz) to app_user;
