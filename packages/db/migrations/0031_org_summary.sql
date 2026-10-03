-- The call centre admin's overview (docs/plan.md, sections 11 and 15): users and how they log
-- in, teams and roles, this month's usage, invoices and modules. Counts only, for users.manage.
-- Activity per team also needs dashboard.all, and invoices billing.read.

create function app.org_summary() returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public set jit = off
  as $$
  declare
    org uuid := app.current_org_id();
    me uuid := app.current_user_id();
    month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo';
    previous_start timestamptz := (date_trunc('month', now() at time zone 'Europe/Oslo') - interval '1 month') at time zone 'Europe/Oslo';
    organization_part jsonb;
    members jsonb;
    teams_part jsonb;
    roles_part jsonb;
    usage_part jsonb;
    activity jsonb;
    invoices_part jsonb;
    modules_part jsonb;
  begin
    if org is null or me is null then
      raise exception 'not a member' using errcode = 'insufficient_privilege';
    end if;
    if not app.has_permission('users.manage') then
      raise exception 'no access to the overview' using errcode = 'insufficient_privilege';
    end if;

    select jsonb_build_object('name', o.name, 'status', o.status, 'trialEndsAt', o.trial_ends_at, 'accessUntil', o.access_until)
    into organization_part
    from organizations o where o.id = org;

    -- Members: active (logged in at least once), invited (not yet), disabled, and how the active
    -- ones log in. Invitations waiting, and expired ones for people who never came in.
    with
    m as (
      select m.user_id, m.status as membership, u.status as account, u.last_login_at
      from memberships m join users u on u.id = m.user_id
      where m.organization_id = org
    ),
    active as (
      select * from m where membership = 'active' and account = 'active'
    )
    select jsonb_build_object(
      'active', (select count(*) from active),
      'invited', (select count(*) from m where membership = 'active' and account = 'invited'),
      'disabled', (select count(*) from m where membership = 'disabled' or account = 'disabled'),
      'loggedIn7', (select count(*) from active where last_login_at >= now() - interval '7 days'),
      'inactive30', (select count(*) from active where last_login_at is null or last_login_at < now() - interval '30 days'),
      'bankid', (select count(*) from active a where exists (select 1 from identities i where i.user_id = a.user_id and i.provider = 'bankid')),
      'vipps', (select count(*) from active a where exists (select 1 from identities i where i.user_id = a.user_id and i.provider = 'vipps')),
      'passkey', (select count(*) from active a where exists (select 1 from passkeys p where p.user_id = a.user_id)),
      'invitationsPending', (
        select count(*) from invitations i
        where i.organization_id = org and i.used_at is null and i.revoked_at is null and i.expires_at > now()
      ),
      'invitationsExpired', (
        select count(distinct i.user_id) from invitations i
        join m on m.user_id = i.user_id and m.account = 'invited' and m.membership = 'active'
        where i.organization_id = org and i.used_at is null and i.revoked_at is null and i.expires_at <= now()
          and not exists (
            select 1 from invitations j
            where j.organization_id = org and j.user_id = i.user_id and j.used_at is null and j.revoked_at is null and j.expires_at > now()
          )
      )
    ) into members;

    -- Teams and roles with their active members (invited included: they are on their way in).
    with active as (
      select m.user_id, m.team_id, m.role_id
      from memberships m join users u on u.id = m.user_id
      where m.organization_id = org and m.status = 'active' and u.status <> 'disabled'
    )
    select
      jsonb_build_object(
        'teams', (
          select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'members', (select count(*) from active a where a.team_id = t.id)) order by t.name), '[]'::jsonb)
          from teams t where t.organization_id = org and t.archived_at is null
        ),
        'withoutTeam', (select count(*) from active where team_id is null)
      ),
      (
        select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'members', (select count(*) from active a where a.role_id = r.id)) order by r.name), '[]'::jsonb)
        from roles r where r.organization_id = org and r.archived_at is null
      )
    into teams_part, roles_part;

    -- Usage this month and last month, counted as on the invoice: a call's pieces added
    -- together, or the whole recording once; an AI control once per call.
    with
    u as (
      select id, call_id, kind, audio_seconds, piece, case when created_at >= month_start then 'month' else 'previous' end as part
      from usage_events where organization_id = org and created_at >= previous_start
    ),
    audio as (
      select part, coalesce(max(audio_seconds) filter (where piece is null), sum(audio_seconds)) as s
      from u where kind = 'transcription_async'
      group by part, coalesce(call_id::text, id::text)
    )
    select jsonb_build_object(
      'month', jsonb_build_object(
        'hours', round(coalesce((select sum(s) from audio where part = 'month'), 0) / 3600.0, 1),
        'controls', (select count(distinct coalesce(call_id::text, id::text)) from u where part = 'month' and kind = 'ai_control'),
        'notes', (select count(*) from u where part = 'month' and kind = 'report')
      ),
      'previous', jsonb_build_object(
        'hours', round(coalesce((select sum(s) from audio where part = 'previous'), 0) / 3600.0, 1),
        'controls', (select count(distinct coalesce(call_id::text, id::text)) from u where part = 'previous' and kind = 'ai_control'),
        'notes', (select count(*) from u where part = 'previous' and kind = 'report')
      )
    ) into usage_part;

    -- This month's calls and sales per team (with dashboard.all, as on the dashboard).
    if app.has_permission('dashboard.all') then
      with
      c as (
        select team_id, count(*) as calls from calls
        where organization_id = org and started_at >= month_start and expires_at > now()
        group by team_id
      ),
      s as (
        select team_id, count(*) as sales, count(*) filter (where status in ('confirmed', 'active')) as confirmed from sales
        where organization_id = org and sold_at >= month_start
        group by team_id
      ),
      t as (
        select id, name from teams where organization_id = org and archived_at is null
        union all select null, null
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'teamId', t.id, 'name', t.name,
               'calls', coalesce(c.calls, 0), 'sales', coalesce(s.sales, 0), 'confirmed', coalesce(s.confirmed, 0)
             ) order by t.name nulls last), '[]'::jsonb)
      into activity
      from t
      left join c on c.team_id is not distinct from t.id
      left join s on s.team_id is not distinct from t.id
      where t.id is not null or c.calls is not null or s.sales is not null;
    end if;

    -- Invoices (billing.read): unpaid, overdue and the next due date.
    if app.has_permission('billing.read') then
      with i as (
        select i.kind, i.status, i.due_date, i.total, i.paid_at,
               (select coalesce(sum(p.amount), 0) from invoice_payments p where p.invoice_id = i.id) as paid
        from invoices i where i.organization_id = org
      )
      select jsonb_build_object(
        'unpaid', count(*) filter (where kind = 'invoice' and status in ('sent', 'payment_missed')),
        'unpaidAmount', coalesce(sum(total - paid) filter (where kind = 'invoice' and status in ('sent', 'payment_missed')), 0),
        'overdue', count(*) filter (where kind = 'invoice' and status in ('sent', 'payment_missed') and due_date < app.oslo_today()),
        'nextDue', min(due_date) filter (where kind = 'invoice' and status = 'sent' and due_date >= app.oslo_today()),
        'lastPaidAt', max(paid_at)
      ) into invoices_part
      from i;
    end if;

    select coalesce(jsonb_agg(module order by module), '[]'::jsonb) into modules_part
    from organization_modules where organization_id = org and enabled;

    return jsonb_build_object(
      'organization', organization_part,
      'members', members,
      'teams', teams_part,
      'roles', roles_part,
      'usage', usage_part,
      'activity', activity,
      'invoices', invoices_part,
      'modules', modules_part
    );
  end
  $$;
revoke all on function app.org_summary() from public;
grant execute on function app.org_summary() to app_user;
