-- Superadmin → Oversikt (docs/plan.md, section 10): the whole platform at a glance. Call centres
-- and trials, users and logins, calls and the worker's queue, this month's usage, the most and
-- the least active call centres, and support messages waiting. Counts only, never content.
-- Money (MRR, revenue against costs, unpaid invoices) is added by the API from Økonomi.

create function app.platform_overview() returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    today date := app.oslo_today();
    day_start timestamptz := today::timestamp at time zone 'Europe/Oslo';
    month_first date := date_trunc('month', today)::date;
    month_start timestamptz := month_first::timestamp at time zone 'Europe/Oslo';
    -- The last 30 days, today included, and the whole month.
    first_day date := least(today - 29, month_first);
    window_start timestamptz := first_day::timestamp at time zone 'Europe/Oslo';
    organizations_part jsonb;
    ending jsonb;
    users_part jsonb;
    logins_part jsonb;
    login_days jsonb;
    calls_part jsonb;
    call_days jsonb;
    active_part jsonb;
    quiet jsonb;
    usage_part jsonb;
    support_part jsonb;
  begin
    if not app.is_platform_admin() then
      raise exception 'not a superadmin' using errcode = 'insufficient_privilege';
    end if;

    -- Call centres: open (app.organization_open: not suspended, trial and paid access not over),
    -- on trial, with access from invoices, closed, and new this month.
    select jsonb_build_object(
      'total', count(*),
      'open', count(*) filter (where app.organization_open(o)),
      'trial', count(*) filter (where app.organization_open(o) and o.trial_ends_at is not null),
      'paying', count(*) filter (where app.organization_open(o) and o.access_until is not null),
      'closed', count(*) filter (where not app.organization_open(o)),
      'newThisMonth', count(*) filter (where o.created_at >= month_start)
    ) into organizations_part
    from organizations o;

    -- Trials ending within 14 days, and access from invoices ending within 7 days (no invoice
    -- sent for the next period).
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind', e.kind, 'endsAt', e.ends_at)
                              order by e.ends_at, e.name), '[]'::jsonb)
    into ending
    from (
      select * from (
        select o.id, o.name, 'trial' as kind, o.trial_ends_at as ends_at
        from organizations o
        where app.organization_open(o) and o.trial_ends_at <= now() + interval '14 days'
        union all
        select o.id, o.name, 'access', o.access_until
        from organizations o
        where app.organization_open(o) and o.access_until <= now() + interval '7 days'
      ) x
      order by ends_at, name
      limit 20
    ) e;

    select jsonb_build_object(
      'active', count(*) filter (where status = 'active'),
      'invited', count(*) filter (where status = 'invited'),
      'disabled', count(*) filter (where status = 'disabled'),
      'new30', count(*) filter (where created_at > now() - interval '30 days'),
      'loggedInToday', count(*) filter (where last_login_at >= day_start),
      'loggedIn7', count(*) filter (where last_login_at > now() - interval '7 days')
    ) into users_part
    from users;

    -- Logins: successful today and the last 7 days, by method over 30 days, failures the last
    -- 24 hours and the addresses behind five or more of them that are not blocked.
    with
    l as (
      select occurred_at, provider, result, ip from login_events where occurred_at >= window_start
    ),
    blocked as (
      select network from blocked_ips where removed_at is null and (expires_at is null or expires_at > now())
    ),
    per_day as (
      select (occurred_at at time zone 'Europe/Oslo')::date as day, count(*) as n
      from l where result = 'success' group by 1
    )
    select
      jsonb_build_object(
        'today', (select count(*) from l where result = 'success' and occurred_at >= day_start),
        'week', (select count(*) from l where result = 'success' and occurred_at >= (today - 6)::timestamp at time zone 'Europe/Oslo'),
        'byMethod', (
          select jsonb_build_object(
            'bankid', count(*) filter (where provider = 'bankid'),
            'vipps', count(*) filter (where provider = 'vipps'),
            'passkey', count(*) filter (where provider = 'passkey')
          )
          from l where result = 'success' and occurred_at >= (today - 29)::timestamp at time zone 'Europe/Oslo'
        ),
        'failed24h', (select count(*) from l where result <> 'success' and occurred_at > now() - interval '1 day'),
        'suspiciousIps', (
          select count(*) from (
            select ip from l
            where result <> 'success' and occurred_at > now() - interval '1 day' and ip is not null
              and not exists (select 1 from blocked b where l.ip <<= b.network)
            group by ip having count(*) >= 5
          ) x
        ),
        'blockedIps', (select count(*) from blocked)
      ),
      (select coalesce(jsonb_object_agg(day, n), '{}'::jsonb) from per_day)
    into logins_part, login_days;

    -- Calls per call centre and day, read through each call centre's (organization_id,
    -- started_at) index. Calls this recent cannot have expired (retention is at least three
    -- months), so expires_at is not read.
    with
    per_day as materialized (
      select c.organization_id, (c.started_at at time zone 'Europe/Oslo')::date as day,
             count(*) as calls, count(*) filter (where c.status = 'failed') as failed
      from organizations o
      cross join lateral (
        select x.organization_id, x.started_at, x.status from calls x
        where x.organization_id = o.id and x.started_at >= window_start
      ) c
      group by 1, 2
    ),
    this_month as (
      select organization_id, sum(calls) as calls from per_day where day >= month_first group by 1
    )
    select
      jsonb_build_object(
        'today', (select coalesce(sum(calls), 0) from per_day where day = today),
        'week', (select coalesce(sum(calls), 0) from per_day where day > today - 7),
        'month', (select coalesce(sum(calls), 0) from per_day where day >= month_first),
        'failed7', (select coalesce(sum(failed), 0) from per_day where day > today - 7),
        'recording', (select count(*) from calls where status = 'recording'),
        'processing', (select count(*) from calls where status = 'processing'),
        -- The worker retries after ten minutes and gives up after three runs.
        'stuck', (select count(*) from calls where status = 'processing' and processing_started_at < now() - interval '30 minutes'),
        'piecesWaiting', (select count(*) from call_pieces where status = 'pending'),
        'oldestPieceAt', (select min(created_at) from call_pieces where status = 'pending')
      ),
      (select coalesce(jsonb_object_agg(day, n), '{}'::jsonb) from (select day, sum(calls) as n from per_day group by day) d),
      (
        select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'calls', t.calls, 'users30', t.users30)
                                  order by t.calls desc, t.name), '[]'::jsonb)
        from (
          select o.id, o.name, m.calls,
                 (select count(*) from memberships ms join users u on u.id = ms.user_id
                  where ms.organization_id = o.id and ms.status = 'active' and u.last_login_at > now() - interval '30 days') as users30
          from this_month m join organizations o on o.id = m.organization_id
          order by m.calls desc, o.name
          limit 10
        ) t
      )
    into calls_part, call_days, active_part;

    -- Call centres that record calls (transcription on) but have not for 14 days, among those
    -- open for longer than that.
    select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'lastCallAt', q.last_call, 'lastLoginAt', q.last_login)
                              order by q.last_call nulls first, q.name), '[]'::jsonb)
    into quiet
    from (
      select * from (
        select o.id, o.name,
               (select max(c.started_at) from calls c where c.organization_id = o.id) as last_call,
               (select max(u.last_login_at) from memberships ms join users u on u.id = ms.user_id
                where ms.organization_id = o.id and ms.status = 'active') as last_login
        from organizations o
        where app.organization_open(o) and o.created_at < now() - interval '14 days'
          and exists (select 1 from organization_modules m where m.organization_id = o.id and m.module = 'transcription' and m.enabled)
      ) x
      where x.last_call is null or x.last_call < now() - interval '14 days'
      order by x.last_call nulls first, x.name
      limit 10
    ) q;

    -- This month's usage, counted as on the invoice: the pieces of a call, or the whole recording
    -- once, and each call's AI control once. One pass, grouped per call.
    with per_call as (
      select max(e.audio_seconds) filter (where e.kind = 'transcription_async' and e.piece is null) as whole,
             sum(e.audio_seconds) filter (where e.kind = 'transcription_async') as audio,
             bool_or(e.kind = 'ai_control') as controlled,
             count(*) filter (where e.kind = 'report') as notes
      from organizations o
      cross join lateral (
        select x.call_id, x.id, x.kind, x.audio_seconds, x.piece from usage_events x
        where x.organization_id = o.id and x.created_at >= month_start
      ) e
      group by e.call_id, case when e.call_id is null then e.id end
    )
    select jsonb_build_object(
      'hours', round(coalesce(sum(coalesce(whole, audio)), 0) / 3600.0, 1),
      'controls', count(*) filter (where controlled),
      'notes', coalesce(sum(notes), 0)
    ) into usage_part
    from per_call;

    -- Conversations with the call centres: open, and those with a message we have not read.
    select jsonb_build_object(
      'open', count(*) filter (where t.status = 'open'),
      'unread', count(*) filter (where exists (
        select 1 from support_messages m
        where m.thread_id = t.id and not m.from_platform and m.created_at > coalesce(t.platform_read_at, '-infinity')
      )),
      'announcements', (
        select count(*) from announcements a where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      )
    ) into support_part
    from support_threads t;

    return jsonb_build_object(
      'today', today,
      'organizations', organizations_part || jsonb_build_object('ending', ending, 'mostActive', active_part, 'quiet', quiet),
      'users', users_part,
      'logins', logins_part,
      'calls', calls_part,
      'usage', usage_part,
      'support', support_part,
      'days', (
        select jsonb_agg(jsonb_build_object(
                 'day', d.day,
                 'calls', coalesce((call_days->>(d.day::text))::int, 0),
                 'logins', coalesce((login_days->>(d.day::text))::int, 0)
               ) order by d.day)
        from (select today - i as day from generate_series(0, 29) i) d
      )
    );
  end
  $$;
revoke all on function app.platform_overview() from public;
grant execute on function app.platform_overview() to app_user;

-- Logins in a period across all users (this overview and Sikkerhet).
create index login_events_occurred_idx on login_events (occurred_at);
