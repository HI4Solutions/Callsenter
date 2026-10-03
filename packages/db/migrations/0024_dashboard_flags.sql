-- Dashboard for leaders (docs/plan.md, section 15): the AI flags per day, and hour by hour for a
-- single day, so the overview can show green, yellow and red over time. Looking up the log of
-- one call (who viewed, played and reviewed it) gets indexes.

create or replace function app.dashboard(scope text, target uuid, from_ts timestamptz, to_ts timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public
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
          'sales', (select count(*) from s where (s.sold_at at time zone 'Europe/Oslo')::date = d.day),
          'confirmed', (select count(*) from s where (s.sold_at at time zone 'Europe/Oslo')::date = d.day and s.status in ('confirmed', 'active')),
          'calls', (select count(*) from c where (c.started_at at time zone 'Europe/Oslo')::date = d.day),
          'green', (select count(*) from a join c on c.id = a.call_id where (c.started_at at time zone 'Europe/Oslo')::date = d.day and a.flag = 'green'),
          'yellow', (select count(*) from a join c on c.id = a.call_id where (c.started_at at time zone 'Europe/Oslo')::date = d.day and a.flag = 'yellow'),
          'red', (select count(*) from a join c on c.id = a.call_id where (c.started_at at time zone 'Europe/Oslo')::date = d.day and a.flag = 'red')
        ) order by d.day), '[]'::jsonb)
        from days d
      ),
      -- Hour by hour when the period is one day ("I dag", "I går").
      'hourly', case when (select count(*) from days) <> 1 then '[]'::jsonb else (
        select jsonb_agg(jsonb_build_object(
          'hour', h,
          'calls', (select count(*) from c where extract(hour from c.started_at at time zone 'Europe/Oslo') = h),
          'green', (select count(*) from a join c on c.id = a.call_id where extract(hour from c.started_at at time zone 'Europe/Oslo') = h and a.flag = 'green'),
          'yellow', (select count(*) from a join c on c.id = a.call_id where extract(hour from c.started_at at time zone 'Europe/Oslo') = h and a.flag = 'yellow'),
          'red', (select count(*) from a join c on c.id = a.call_id where extract(hour from c.started_at at time zone 'Europe/Oslo') = h and a.flag = 'red')
        ) order by h)
        from generate_series(0, 23) h
      ) end,
      'sellers', case when seller is not null then '[]'::jsonb else (
        select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) from (
          select jsonb_build_object(
            'userId', p.user_id,
            'name', u.full_name,
            'sales', (select count(*) from s where s.seller_id = p.user_id),
            'confirmed', (select count(*) from s where s.seller_id = p.user_id and s.status in ('confirmed', 'active')),
            'calls', (select count(*) from c where c.user_id = p.user_id),
            'yellow', (select count(*) from a where a.user_id = p.user_id and a.flag = 'yellow'),
            'red', (select count(*) from a where a.user_id = p.user_id and a.flag = 'red'),
            'complaints', (select count(*) from k where k.seller_id = p.user_id)
          ) as row
          from people p join users u on u.id = p.user_id
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

create index access_log_resource_idx on access_log (resource_type, resource_id, occurred_at desc);
create index audit_log_record_idx on audit_log (table_name, record_id);
create index audit_log_call_idx on audit_log ((new_data ->> 'call_id')) where new_data ? 'call_id';
