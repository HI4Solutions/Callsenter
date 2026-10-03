-- A dashboard for each level (docs/plan.md, section 15, Nadeem's wish 3 October 2026): the
-- seller sees their own numbers against the team's average, the leader sees each seller in the
-- team day by day and who needs follow-up. Counts only, never content, and the permissions are
-- checked here, as in app.dashboard.

-- The average per seller in the current user's team, without names. Only when at least three
-- were active in the team in the period: with fewer, an average would reveal what a colleague
-- did. Calls and sales count in the team they were made in.
create function app.dashboard_benchmark(from_ts timestamptz, to_ts timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    org uuid := app.current_org_id();
    me uuid := app.current_user_id();
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
    select m.team_id into team from memberships m where m.organization_id = org and m.user_id = me and m.status = 'active';
    if team is null then
      return null;
    end if;

    with
    s as (
      select seller_id as user_id, count(*) as sales, count(*) filter (where status in ('confirmed', 'active')) as confirmed
      from sales
      where organization_id = org and team_id = team and sold_at >= from_ts and sold_at < to_ts
      group by seller_id
    ),
    c as (
      select c.user_id, count(*) as calls, coalesce(sum(c.duration_ms), 0) as duration_ms,
             count(a.flag) as analyzed, count(*) filter (where a.flag = 'green') as green, count(*) filter (where a.flag = 'red') as red
      from calls c
      left join lateral (
        select x.flag from call_analyses x where x.call_id = c.id order by x.created_at desc limit 1
      ) a on true
      where c.organization_id = org and c.team_id = team and c.started_at >= from_ts and c.started_at < to_ts and c.expires_at > now()
      group by c.user_id
    ),
    people as (
      select coalesce(s.user_id, c.user_id) as user_id, coalesce(s.sales, 0) as sales, coalesce(s.confirmed, 0) as confirmed,
             coalesce(c.calls, 0) as calls, coalesce(c.duration_ms, 0) as duration_ms, coalesce(c.analyzed, 0) as analyzed,
             coalesce(c.green, 0) as green, coalesce(c.red, 0) as red
      from s full join c on c.user_id = s.user_id
    )
    select jsonb_build_object(
      'teamName', (select name from teams where id = team),
      'sellers', count(*),
      'tooFew', count(*) < 3,
      'perSeller', case when count(*) < 3 then null else jsonb_build_object(
        'calls', round(avg(calls), 1),
        'sales', round(avg(sales), 1),
        'confirmed', round(avg(confirmed), 1),
        'durationMs', round(avg(duration_ms))
      ) end,
      'shares', case when count(*) < 3 then null else jsonb_build_object(
        'confirmed', case when sum(sales) > 0 then round(sum(confirmed) * 100.0 / sum(sales)) end,
        'green', case when sum(analyzed) > 0 then round(sum(green) * 100.0 / sum(analyzed)) end,
        'red', case when sum(analyzed) > 0 then round(sum(red) * 100.0 / sum(analyzed)) end
      ) end
    ) into result
    from people;
    return result;
  end
  $$;
revoke all on function app.dashboard_benchmark(timestamptz, timestamptz) from public;
grant execute on function app.dashboard_benchmark(timestamptz, timestamptz) to app_user;

-- Each seller in a team (or the whole call centre when team is null) day by day: calls, sales
-- and breaches per day, AI flags not yet reviewed, and feedback given. Same access as the team
-- scope of app.dashboard: dashboard.all, or dashboard.team for one's own team.
create function app.dashboard_team(team uuid, from_ts timestamptz, to_ts timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    org uuid := app.current_org_id();
    me uuid := app.current_user_id();
    my_team uuid;
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
    if team is null then
      if not app.has_permission('dashboard.all') then
        raise exception 'no access to the whole call centre' using errcode = 'insufficient_privilege';
      end if;
    elsif not exists (select 1 from teams t where t.id = team and t.organization_id = org)
       or not (app.has_permission('dashboard.all') or (app.has_permission('dashboard.team') and team = my_team)) then
      raise exception 'no access to this team' using errcode = 'insufficient_privilege';
    end if;

    with
    days as (
      select d::date as day
      from generate_series((from_ts at time zone 'Europe/Oslo')::date, ((to_ts - interval '1 microsecond') at time zone 'Europe/Oslo')::date, interval '1 day') d
    ),
    c as (
      select c.id, c.user_id, (c.started_at at time zone 'Europe/Oslo')::date as day, a.flag, a.reviewed_at
      from calls c
      left join lateral (
        select x.flag, x.reviewed_at from call_analyses x where x.call_id = c.id order by x.created_at desc limit 1
      ) a on true
      where c.organization_id = org and c.started_at >= from_ts and c.started_at < to_ts and c.expires_at > now()
        and (team is null or c.team_id = team)
    ),
    s as (
      select seller_id as user_id, (sold_at at time zone 'Europe/Oslo')::date as day
      from sales
      where organization_id = org and sold_at >= from_ts and sold_at < to_ts and (team is null or team_id = team)
    ),
    -- Who to show: everyone with calls or sales here, and the team's active members, also those
    -- who did nothing (that is worth seeing too). As in app.dashboard.
    people as (
      select user_id from c
      union select user_id from s
      union select m.user_id from memberships m
        where team is not null and m.organization_id = org and m.team_id = team and m.status = 'active'
    ),
    calls_by_day as (
      select user_id, day, count(*) as calls, count(*) filter (where flag = 'red') as red from c group by user_id, day
    ),
    sales_by_day as (
      select user_id, day, count(*) as sales from s group by user_id, day
    ),
    -- Every seller on every day, grouped once (not looked up per seller).
    series as (
      select p.user_id,
             jsonb_agg(coalesce(cd.calls, 0) order by d.day) as calls,
             jsonb_agg(coalesce(sd.sales, 0) order by d.day) as sales,
             jsonb_agg(coalesce(cd.red, 0) order by d.day) as red
      from people p
      cross join days d
      left join calls_by_day cd on cd.user_id = p.user_id and cd.day = d.day
      left join sales_by_day sd on sd.user_id = p.user_id and sd.day = d.day
      group by p.user_id
    ),
    open_flags as (
      select user_id, count(*) as unreviewed from c where flag in ('yellow', 'red') and reviewed_at is null group by user_id
    ),
    feedback as (
      select seller_id as user_id,
             count(*) filter (where created_at >= from_ts and created_at < to_ts) as given,
             max(created_at) as last_at
      from coaching_notes
      where organization_id = org and seller_id in (select user_id from people)
      group by seller_id
    )
    select jsonb_build_object(
      'days', (select coalesce(jsonb_agg(day order by day), '[]'::jsonb) from days),
      'sellers', coalesce((
        select jsonb_agg(row order by row->>'name')
        from (
          select jsonb_build_object(
            'userId', p.user_id,
            'name', u.full_name,
            'calls', x.calls,
            'sales', x.sales,
            'red', x.red,
            'unreviewed', coalesce(o.unreviewed, 0),
            'feedback', coalesce(f.given, 0),
            'lastFeedbackAt', f.last_at
          ) as row
          from people p
          join users u on u.id = p.user_id
          join series x on x.user_id = p.user_id
          left join open_flags o on o.user_id = p.user_id
          left join feedback f on f.user_id = p.user_id
        ) rows
      ), '[]'::jsonb)
    ) into result;
    return result;
  end
  $$;
revoke all on function app.dashboard_team(uuid, timestamptz, timestamptz) from public;
grant execute on function app.dashboard_team(uuid, timestamptz, timestamptz) to app_user;
