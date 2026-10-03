-- The quality dashboard for compliance (docs/plan.md, section 15): the queue of AI flags waiting
-- for review, deviations per product and seller, complaints, customer acceptance and who opens
-- recordings. Counts only, never content. For the whole call centre: dashboard.all together with
-- flags.review or complaints.manage; who opened recordings only with audit.read.

create function app.dashboard_quality(from_ts timestamptz, to_ts timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    org uuid := app.current_org_id();
    me uuid := app.current_user_id();
    first_day date;
    last_day date;
    flags jsonb;
    products jsonb;
    sellers jsonb;
    complaints_part jsonb;
    confirmations_part jsonb;
    access_part jsonb;
  begin
    if org is null or me is null then
      raise exception 'not a member' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from organization_modules where organization_id = org and module = 'dashboard' and enabled) then
      raise exception 'the dashboard module is off' using errcode = 'insufficient_privilege';
    end if;
    if not app.has_permission('dashboard.all') or not (app.has_permission('flags.review') or app.has_permission('complaints.manage')) then
      raise exception 'no access to the quality dashboard' using errcode = 'insufficient_privilege';
    end if;
    if from_ts is null or to_ts is null or to_ts <= from_ts or to_ts - from_ts > interval '367 days' then
      raise exception 'invalid period' using errcode = 'check_violation';
    end if;
    first_day := (from_ts at time zone 'Europe/Oslo')::date;
    last_day := ((to_ts - interval '1 microsecond') at time zone 'Europe/Oslo')::date;

    -- AI flags: the queue now (whatever the period), and what happened in the period. The queue
    -- reads only open flags (call_analyses_open_idx), each the latest control of its call.
    with
    open_now as (
      select x.created_at as checked_at
      from call_analyses x
      join calls c on c.id = x.call_id
      where x.organization_id = org and x.flag <> 'green' and x.reviewed_at is null and c.expires_at > now()
        and not exists (select 1 from call_analyses y where y.call_id = x.call_id and y.created_at > x.created_at)
    ),
    reviewed as (
      select extract(epoch from x.reviewed_at - x.created_at) / 3600 as hours
      from call_analyses x
      where x.organization_id = org and x.reviewed_at >= from_ts and x.reviewed_at < to_ts
    ),
    in_period as (
      select a.flag
      from calls c
      join lateral (
        select x.flag from call_analyses x where x.call_id = c.id order by x.created_at desc limit 1
      ) a on true
      where c.organization_id = org and c.expires_at > now() and c.started_at >= from_ts and c.started_at < to_ts
    )
    select jsonb_build_object(
      'open', (select count(*) from open_now),
      'openByAge', jsonb_build_object(
        'day', (select count(*) from open_now where checked_at > now() - interval '1 day'),
        'days3', (select count(*) from open_now where checked_at <= now() - interval '1 day' and checked_at > now() - interval '3 days'),
        'week', (select count(*) from open_now where checked_at <= now() - interval '3 days' and checked_at > now() - interval '7 days'),
        'older', (select count(*) from open_now where checked_at <= now() - interval '7 days')
      ),
      'oldestOpenAt', (select min(checked_at) from open_now),
      'reviewed', (select count(*) from reviewed),
      'medianHoursToReview', (select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from reviewed),
      'checked', (select count(*) from in_period),
      'yellow', (select count(*) from in_period where flag = 'yellow'),
      'red', (select count(*) from in_period where flag = 'red')
    ) into flags;

    -- Deviations per product, and the sellers with the largest share of breaches (at least three
    -- calls checked, so one unlucky call does not top the list).
    with
    checked as (
      select c.user_id, c.product_id, a.flag
      from calls c
      join lateral (
        select x.flag from call_analyses x where x.call_id = c.id order by x.created_at desc limit 1
      ) a on true
      where c.organization_id = org and c.expires_at > now() and c.started_at >= from_ts and c.started_at < to_ts
    )
    select
      (select coalesce(jsonb_agg(row order by (row->>'red')::int + (row->>'yellow')::int desc, row->>'name'), '[]'::jsonb) from (
         select jsonb_build_object('name', p.name, 'checked', count(*),
                                   'yellow', count(*) filter (where k.flag = 'yellow'), 'red', count(*) filter (where k.flag = 'red')) as row
         from checked k join products p on p.id = k.product_id
         group by p.id, p.name
         order by count(*) filter (where k.flag in ('yellow', 'red')) desc, p.name
         limit 10
       ) top),
      (select coalesce(jsonb_agg(row order by (row->>'red')::numeric / (row->>'checked')::numeric desc, (row->>'red')::int desc, row->>'name'), '[]'::jsonb) from (
         select jsonb_build_object('userId', k.user_id, 'name', u.full_name, 'checked', count(*),
                                   'yellow', count(*) filter (where k.flag = 'yellow'), 'red', count(*) filter (where k.flag = 'red')) as row
         from checked k join users u on u.id = k.user_id
         group by k.user_id, u.full_name
         having count(*) >= 3 and count(*) filter (where k.flag = 'red') > 0
         order by count(*) filter (where k.flag = 'red')::numeric / count(*) desc, count(*) filter (where k.flag = 'red') desc
         limit 10
       ) top)
    into products, sellers;

    -- Complaints: received in the period by status and channel, per week, and how long the ones
    -- closed in the period took.
    if exists (select 1 from organization_modules where organization_id = org and module = 'complaints' and enabled) then
      with k as (
        select status, channel, received_on from complaints
        where organization_id = org and received_on between first_day and last_day
      )
      select jsonb_build_object(
        'received', (select count(*) from k),
        'byStatus', jsonb_build_object(
          'open', (select count(*) from k where status = 'open'),
          'investigating', (select count(*) from k where status = 'investigating'),
          'resolved', (select count(*) from k where status = 'resolved'),
          'rejected', (select count(*) from k where status = 'rejected')
        ),
        'openNow', (select count(*) from complaints where organization_id = org and status in ('open', 'investigating')),
        'medianDaysToClose', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from closed_at - created_at) / 86400))::numeric, 1)
          from complaints where organization_id = org and closed_at >= from_ts and closed_at < to_ts
        ),
        'byChannel', (
          select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (select channel, count(*) as n from k group by channel) x
        ),
        'weekly', (
          select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'received', coalesce(x.n, 0)) order by w.week), '[]'::jsonb)
          from (
            select distinct date_trunc('week', d)::date as week
            from generate_series(first_day, last_day, interval '1 day') d
          ) w
          left join (select date_trunc('week', received_on)::date as week, count(*) as n from k group by 1) x on x.week = w.week
        )
      ) into complaints_part;
    end if;

    -- Customer acceptance: links sent in the period and how they ended. An acceptance where the
    -- identity did not match the customer (identity_match none) is worth a look.
    if exists (select 1 from organization_modules where organization_id = org and module = 'sale_verification' and enabled) then
      select jsonb_build_object(
        'sent', count(*),
        'accepted', count(*) filter (where status = 'accepted'),
        'rejected', count(*) filter (where status = 'rejected'),
        'pending', count(*) filter (where status = 'pending' and expires_at > now()),
        'expired', count(*) filter (where status = 'pending' and expires_at <= now()),
        'revoked', count(*) filter (where status = 'revoked'),
        'bankid', count(*) filter (where status = 'accepted' and method = 'bankid'),
        'vipps', count(*) filter (where status = 'accepted' and method = 'vipps'),
        'identityMismatch', count(*) filter (where status = 'accepted' and identity_match = 'none')
      ) into confirmations_part
      from sale_confirmations
      where organization_id = org and created_at >= from_ts and created_at < to_ts;
    end if;

    -- Who opened, played and searched recordings and transcripts in the period (audit.read).
    if app.has_permission('audit.read') then
      with l as (
        select user_id, resource_type, action from access_log
        where organization_id = org and occurred_at >= from_ts and occurred_at < to_ts and resource_type in ('call', 'call_search')
      )
      select jsonb_build_object(
        'views', count(*) filter (where resource_type = 'call' and action = 'view'),
        'plays', count(*) filter (where resource_type = 'call' and action = 'play'),
        'downloads', count(*) filter (where resource_type = 'call' and action = 'download'),
        'searches', count(*) filter (where resource_type = 'call_search'),
        'users', (
          select coalesce(jsonb_agg(row order by (row->>'total')::int desc, row->>'name'), '[]'::jsonb) from (
            select jsonb_build_object('userId', l2.user_id, 'name', u.full_name, 'total', count(*),
                                      'views', count(*) filter (where l2.resource_type = 'call' and l2.action = 'view'),
                                      'plays', count(*) filter (where l2.resource_type = 'call' and l2.action = 'play'),
                                      'searches', count(*) filter (where l2.resource_type = 'call_search')) as row
            from l l2 join users u on u.id = l2.user_id
            group by l2.user_id, u.full_name
            order by count(*) desc
            limit 10
          ) top
        )
      ) into access_part
      from l;
    end if;

    return jsonb_build_object(
      'flags', flags,
      'products', products,
      'sellers', sellers,
      'complaints', complaints_part,
      'confirmations', confirmations_part,
      'access', access_part
    );
  end
  $$;
revoke all on function app.dashboard_quality(timestamptz, timestamptz) from public;
-- Flags reviewed in a period, for the time it took.
create index call_analyses_reviewed_idx on call_analyses (organization_id, reviewed_at) where reviewed_at is not null;
grant execute on function app.dashboard_quality(timestamptz, timestamptz) to app_user;
