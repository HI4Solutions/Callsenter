-- Background jobs and the dashboard at volume (review of the API and database, October 2026).

-- 1. The dashboard counted calls, flags and sales again for every day, hour and seller
--    (a subquery per day over all calls in the period). With 100,000 calls one day took six
--    seconds and a month ten. The same figures are now grouped once per table; the result is
--    unchanged.

-- JIT compilation is off for it: the row estimates for the grouped counts are far too high,
-- which made Postgres spend seconds compiling a query that runs in a fraction of that.
create or replace function app.dashboard(scope text, target uuid, from_ts timestamptz, to_ts timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    org uuid := app.current_org_id();
    me uuid := app.current_user_id();
    my_team uuid;
    seller uuid;
    team uuid;
    result jsonb;
  begin
    if org is null or me is null then
      raise exception 'not a member' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from organization_modules where organization_id = org and module = 'dashboard' and enabled) then
      raise exception 'the dashboard module is off' using errcode = 'insufficient_privilege';
    end if;
    if from_ts is null or to_ts is null or to_ts <= from_ts or to_ts - from_ts > interval '367 days' then
      raise exception 'invalid period' using errcode = 'check_violation';
    end if;
    select m.team_id into my_team from memberships m where m.organization_id = org and m.user_id = me and m.status = 'active';

    if scope = 'me' then
      seller := me;
    elsif scope = 'seller' then
      seller := target;
      if not exists (select 1 from memberships m where m.organization_id = org and m.user_id = seller) then
        raise exception 'no access to this seller' using errcode = 'insufficient_privilege';
      end if;
      if seller is distinct from me and not app.has_permission('dashboard.all') then
        -- A team leader sees a seller only as part of the team: what was done in the team.
        if not app.has_permission('dashboard.team') or my_team is null then
          raise exception 'no access to this seller' using errcode = 'insufficient_privilege';
        end if;
        team := my_team;
      end if;
    elsif scope = 'team' then
      team := target;
      if team is null or not exists (select 1 from teams t where t.id = team and t.organization_id = org) or not (app.has_permission('dashboard.all') or (app.has_permission('dashboard.team') and team = my_team)) then
        raise exception 'no access to this team' using errcode = 'insufficient_privilege';
      end if;
    elsif scope = 'all' then
      if not app.has_permission('dashboard.all') then
        raise exception 'no access to the whole call centre' using errcode = 'insufficient_privilege';
      end if;
    else
      raise exception 'unknown scope' using errcode = 'check_violation';
    end if;

    with
    s as (
      select * from sales
      where organization_id = org and sold_at >= from_ts and sold_at < to_ts
        and (seller is null or seller_id = seller) and (team is null or team_id = team)
    ),
    c as (
      select * from calls
      where organization_id = org and started_at >= from_ts and started_at < to_ts and expires_at > now()
        and (seller is null or user_id = seller) and (team is null or team_id = team)
    ),
    -- The latest AI control of each call.
    a as (
      select distinct on (x.call_id) x.*, c.user_id
      from call_analyses x join c on c.id = x.call_id
      order by x.call_id, x.created_at desc
    ),
    k as (
      select k.*, ks.seller_id
      from complaints k left join sales ks on ks.id = k.sale_id
      where k.organization_id = org
        and k.received_on between (from_ts at time zone 'Europe/Oslo')::date and ((to_ts - interval '1 microsecond') at time zone 'Europe/Oslo')::date
        and (seller is null or ks.seller_id = seller) and (team is null or ks.team_id = team)
    ),
    days as (
      select d::date as day
      from generate_series((from_ts at time zone 'Europe/Oslo')::date, ((to_ts - interval '1 microsecond') at time zone 'Europe/Oslo')::date, interval '1 day') d
    ),
    people as (
      select seller_id as user_id from s
      union select user_id from c
      union select seller_id from k where seller_id is not null
      union select m.user_id from memberships m where team is not null and m.organization_id = org and m.team_id = team and m.status = 'active'
    ),
    -- Grouped by the template's required point, or by kind: never the AI's own words, which
    -- describe what happened in a call.
    findings as (
      select case
               when f->>'kind' = 'required_point' then coalesce(
                 (select p->>'text' from product_template_versions tv, jsonb_array_elements(tv.required_points) p
                  where tv.id = a.template_version_id and p->>'id' = f->>'pointId' limit 1),
                 'Obligatorisk punkt')
               when f->>'kind' = 'forbidden_phrase' then 'Forbudte formuleringer'
               when f->>'kind' = 'price_terms' then 'Pris og vilkår som ikke stemmer'
               else 'Andre forhold'
             end as label,
             f->>'level' as level
      from a, jsonb_array_elements(a.findings) f
      where f->>'level' in ('yellow', 'red')
    ),
    -- Each call once, with its latest AI flag and its day and hour in Norway. The figures per
    -- day, hour and seller are grouped from these in one pass each, never counted again for
    -- every day, hour or seller.
    cc as (
      select c.id, c.user_id, (c.started_at at time zone 'Europe/Oslo')::date as day,
             extract(hour from c.started_at at time zone 'Europe/Oslo')::int as hour, a.flag
      from c left join a on a.call_id = c.id
    ),
    sales_by_day as (
      select (s.sold_at at time zone 'Europe/Oslo')::date as day, count(*) as sales,
             count(*) filter (where s.status in ('confirmed', 'active')) as confirmed
      from s group by 1
    ),
    calls_by_day as (
      select cc.day, count(*) as calls, count(*) filter (where cc.flag = 'green') as green,
             count(*) filter (where cc.flag = 'yellow') as yellow, count(*) filter (where cc.flag = 'red') as red
      from cc group by cc.day
    ),
    calls_by_hour as (
      select cc.hour, count(*) as calls, count(*) filter (where cc.flag = 'green') as green,
             count(*) filter (where cc.flag = 'yellow') as yellow, count(*) filter (where cc.flag = 'red') as red
      from cc group by cc.hour
    ),
    sales_by_seller as (
      select s.seller_id as user_id, count(*) as sales, count(*) filter (where s.status in ('confirmed', 'active')) as confirmed
      from s group by s.seller_id
    ),
    calls_by_seller as (
      select c.user_id, count(*) as calls from c group by c.user_id
    ),
    flags_by_seller as (
      select a.user_id, count(*) filter (where a.flag = 'yellow') as yellow, count(*) filter (where a.flag = 'red') as red
      from a group by a.user_id
    ),
    complaints_by_seller as (
      select k.seller_id as user_id, count(*) as complaints from k where k.seller_id is not null group by k.seller_id
    )
    select jsonb_build_object(
      'sales', (
        select jsonb_build_object(
          'total', count(*),
          'confirmed', count(*) filter (where status in ('confirmed', 'active')),
          'pending', count(*) filter (where status in ('registered', 'awaiting_confirmation')),
          'rejected', count(*) filter (where status = 'rejected'),
          'withdrawn', count(*) filter (where status = 'withdrawn'),
          'cancelled', count(*) filter (where status = 'cancelled'),
          'revenueOnce', coalesce(sum(price_once) filter (where status in ('confirmed', 'active')), 0),
          'revenueMonthly', coalesce(sum(price_monthly) filter (where status in ('confirmed', 'active')), 0)
        ) from s
      ),
      'calls', (
        select jsonb_build_object(
          'total', (select count(*) from c),
          'durationMs', (select coalesce(sum(duration_ms), 0) from c),
          'analyzed', count(*),
          'green', count(*) filter (where flag = 'green'),
          'yellow', count(*) filter (where flag = 'yellow'),
          'red', count(*) filter (where flag = 'red'),
          'unreviewed', count(*) filter (where flag in ('yellow', 'red') and reviewed_at is null)
        ) from a
      ),
      'complaints', (
        select jsonb_build_object(
          'received', count(*),
          'open', count(*) filter (where status in ('open', 'investigating'))
        ) from k
      ),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day,
          'sales', coalesce(sd.sales, 0),
          'confirmed', coalesce(sd.confirmed, 0),
          'calls', coalesce(cd.calls, 0),
          'green', coalesce(cd.green, 0),
          'yellow', coalesce(cd.yellow, 0),
          'red', coalesce(cd.red, 0)
        ) order by d.day), '[]'::jsonb)
        from days d
          left join sales_by_day sd on sd.day = d.day
          left join calls_by_day cd on cd.day = d.day
      ),
      -- Hour by hour when the period is one day ("I dag", "I går").
      'hourly', case when (select count(*) from days) <> 1 then '[]'::jsonb else (
        select jsonb_agg(jsonb_build_object(
          'hour', h,
          'calls', coalesce(ch.calls, 0),
          'green', coalesce(ch.green, 0),
          'yellow', coalesce(ch.yellow, 0),
          'red', coalesce(ch.red, 0)
        ) order by h)
        from generate_series(0, 23) h left join calls_by_hour ch on ch.hour = h
      ) end,
      'sellers', case when seller is not null then '[]'::jsonb else (
        select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) from (
          select jsonb_build_object(
            'userId', p.user_id,
            'name', u.full_name,
            'sales', coalesce(ss.sales, 0),
            'confirmed', coalesce(ss.confirmed, 0),
            'calls', coalesce(cs.calls, 0),
            'yellow', coalesce(fs.yellow, 0),
            'red', coalesce(fs.red, 0),
            'complaints', coalesce(ks.complaints, 0)
          ) as row
          from people p join users u on u.id = p.user_id
            left join sales_by_seller ss on ss.user_id = p.user_id
            left join calls_by_seller cs on cs.user_id = p.user_id
            left join flags_by_seller fs on fs.user_id = p.user_id
            left join complaints_by_seller ks on ks.user_id = p.user_id
        ) rows
      ) end,
      'findings', (
        select coalesce(jsonb_agg(jsonb_build_object('label', label, 'yellow', yellow, 'red', red) order by red + yellow desc, label), '[]'::jsonb)
        from (
          select label, count(*) filter (where level = 'yellow') as yellow, count(*) filter (where level = 'red') as red
          from findings group by label order by count(*) desc, label limit 10
        ) top
      )
    ) into result;
    return result;
  end
  $$;
revoke all on function app.dashboard(text, uuid, timestamptz, timestamptz) from public;
grant execute on function app.dashboard(text, uuid, timestamptz, timestamptz) to app_user;

-- 2. The worker's housekeeping looks for calls that are not finished (recording, processing,
--    transcribed) on every run. They are few, so this index keeps it from reading every call.
create index calls_open_idx on calls (status, started_at) where status in ('recording', 'processing', 'transcribed');

-- 3. Login states and passkey challenges live for minutes, and anyone can create them without
--    being logged in, but nothing removed them. The worker removes those older than an hour.
create function app.purge_login_states() returns void
  language sql security definer set search_path = pg_catalog, public
  as $$
    delete from auth_states where created_at < now() - interval '1 hour';
    delete from webauthn_challenges where created_at < now() - interval '1 hour';
  $$;
revoke all on function app.purge_login_states() from public;
grant execute on function app.purge_login_states() to app_worker;
