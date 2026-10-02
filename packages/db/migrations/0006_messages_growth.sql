-- Phase 1, superadmin portal PR D (docs/plan.md, section 10): announcements to call centres,
-- and marketing events shown on the growth charts.

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  body text not null check (length(body) <= 2000),
  link_url text check (link_url ~ '^https://[^\s]+$'),
  link_text text check (length(link_text) <= 100),
  -- 'all': every signed-in user. 'selected': members of the call centres in
  -- announcement_organizations.
  audience text not null default 'all' check (audience in ('all', 'selected')),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table announcement_organizations (
  announcement_id uuid not null references announcements (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  primary key (announcement_id, organization_id)
);

create trigger announcements_touch before update on announcements
  for each row execute function app.touch_updated_at();

alter table announcements enable row level security;
alter table announcement_organizations enable row level security;

-- Superadmins see and change everything. Everyone else sees live announcements meant for them.
create policy announcements_platform on announcements for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy announcements_read on announcements for select to app_user
  using (
    active and starts_at <= now() and (ends_at is null or ends_at > now())
    and app.current_user_id() is not null
    and (
      audience = 'all'
      or exists (
        select 1 from announcement_organizations ao
        where ao.announcement_id = announcements.id
          and ao.organization_id in (select app.my_organization_ids())
      )
    )
  );
create policy announcement_organizations_platform on announcement_organizations for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy announcement_organizations_read on announcement_organizations for select to app_user
  using (organization_id in (select app.my_organization_ids()));

grant select, insert, update, delete on announcements, announcement_organizations to app_user;

create trigger announcements_audit after insert or update or delete on announcements
  for each row execute function app.audit_row_change();

-- Marketing events (campaigns, fairs, launches) drawn on the growth charts.
create table growth_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  occurred_on date not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

alter table growth_events enable row level security;
create policy growth_events_platform on growth_events for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert, delete on growth_events to app_user;

-- Monthly counts for the growth tab, across call centres. Empty for anyone but a superadmin.
create function app.admin_growth(months int)
  returns table (month date, new_organizations int, new_users int, successful_logins int)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    with series as (
      select generate_series(
        date_trunc('month', now()) - make_interval(months => greatest(least(months, 60), 1) - 1),
        date_trunc('month', now()),
        interval '1 month'
      )::date as month
    )
    select s.month,
      (select count(*) from organizations o where date_trunc('month', o.created_at)::date = s.month)::int,
      (select count(*) from users u where date_trunc('month', u.created_at)::date = s.month)::int,
      (select count(*) from login_events l
       where l.result = 'success' and date_trunc('month', l.occurred_at)::date = s.month)::int
    from series s
    where app.is_platform_admin()
    order by s.month
  $$;

revoke all on function app.admin_growth(int) from public;
grant execute on function app.admin_growth(int) to app_user;
