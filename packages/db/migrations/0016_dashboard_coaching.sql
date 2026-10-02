-- Phase 4, dashboard and coaching (docs/plan.md, section 15, module 11). The dashboard shows
-- counts, never content: sales, confirmations, calls, AI flags and complaints for oneself, a team
-- or the whole call centre. The counts come from a security definer function that checks the
-- dashboard permissions itself, so a leader sees the team's numbers without reading the team's
-- transcripts. Coaching notes are feedback from a leader to a seller, optionally about a call.

-- --- Coaching notes ---------------------------------------------------------------------------

create table coaching_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  seller_id uuid not null,
  author_id uuid not null references users (id),
  -- The call the feedback is about. Kept when the call is deleted at the end of its retention.
  call_id uuid,
  kind text not null check (kind in ('praise', 'improve')),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- When the seller marked it as read.
  read_at timestamptz,
  unique (id, organization_id),
  foreign key (organization_id, seller_id) references memberships (organization_id, user_id),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete set null (call_id),
  check (seller_id <> author_id)
);
create index coaching_notes_seller_idx on coaching_notes (organization_id, seller_id, created_at desc);
create index coaching_notes_call_idx on coaching_notes (call_id);

-- Whether the current user may give feedback to (and read the feedback of) this seller:
-- coaching.give, and the seller is in the leader's team, or the leader sees the whole call centre.
create function app.can_coach(seller uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select seller is distinct from app.current_user_id()
      and app.has_permission('coaching.give')
      and exists (
        select 1 from memberships s
        where s.organization_id = app.current_org_id() and s.user_id = seller
          and (
            app.has_permission('dashboard.all')
            or exists (
              select 1 from memberships m
              where m.organization_id = s.organization_id and m.user_id = app.current_user_id()
                and m.status = 'active' and m.team_id is not null and m.team_id = s.team_id
            )
          )
      )
  $$;
revoke all on function app.can_coach(uuid) from public;
grant execute on function app.can_coach(uuid) to app_user;

-- Feedback is not edited or deleted; the seller can only mark it as read.
create function app.guard_coaching_note() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    -- The call was deleted at the end of its retention (on delete set null).
    if old.call_id is not null and new.call_id is null and (to_jsonb(new) - 'call_id') = (to_jsonb(old) - 'call_id') then
      return new;
    end if;
    if old.read_at is not null then
      raise exception 'feedback is already read' using errcode = 'check_violation';
    end if;
    if (to_jsonb(new) - 'read_at') <> (to_jsonb(old) - 'read_at') or new.read_at is null then
      raise exception 'feedback cannot be changed' using errcode = 'check_violation';
    end if;
    new.read_at := now();
    return new;
  end
  $$;
create trigger coaching_notes_guard before update on coaching_notes
  for each row execute function app.guard_coaching_note();
create trigger coaching_notes_audit after insert or update on coaching_notes
  for each row execute function app.audit_row_change();

alter table coaching_notes enable row level security;
create policy coaching_notes_select on coaching_notes for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (seller_id = (select app.current_user_id()) or author_id = (select app.current_user_id()) or app.can_coach(seller_id))
  );
-- The call must be the seller's, and one the leader can see (calls_select applies inside).
create policy coaching_notes_insert on coaching_notes for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and author_id = (select app.current_user_id())
    and app.can_coach(seller_id)
    and (call_id is null or exists (select 1 from calls c where c.id = call_id and c.user_id = seller_id))
  );
create policy coaching_notes_update on coaching_notes for update to app_user
  using (organization_id = (select app.current_org_id()) and seller_id = (select app.current_user_id()))
  with check (organization_id = (select app.current_org_id()) and seller_id = (select app.current_user_id()));
grant select, insert on coaching_notes to app_user;
grant update (read_at) on coaching_notes to app_user;

-- --- Dashboard --------------------------------------------------------------------------------

-- Counts for a period. scope is 'me', 'seller' (target = a user), 'team' (target = a team) or
-- 'all'. Sales and calls count by the team they were made in, as for visibility. Days are
-- counted in Norwegian time.
create function app.dashboard(scope text, target uuid, from_ts timestamptz, to_ts timestamptz) returns jsonb
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
      if seller is distinct from me and not (
        app.has_permission('dashboard.all')
        or (app.has_permission('dashboard.team') and my_team is not null
            and exists (select 1 from memberships m where m.organization_id = org and m.user_id = seller and m.team_id = my_team))
      ) then
        raise exception 'no access to this seller' using errcode = 'insufficient_privilege';
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
    findings as (
      select f->>'label' as label, f->>'level' as level
      from a, jsonb_array_elements(a.findings) f
      where f->>'level' in ('yellow', 'red') and coalesce(f->>'label', '') <> ''
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
          'calls', (select count(*) from c where (c.started_at at time zone 'Europe/Oslo')::date = d.day)
        ) order by d.day), '[]'::jsonb)
        from days d
      ),
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
