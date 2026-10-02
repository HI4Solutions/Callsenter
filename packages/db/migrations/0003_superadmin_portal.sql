-- Phase 1, superadmin portal: call centre details and trial periods. See docs/plan.md,
-- section 10.

alter table organizations
  add column contact_name text check (length(trim(contact_name)) > 0),
  add column contact_email text check (contact_email ~ '^[^@\s]+@[^@\s]+$'),
  add column contact_phone text check (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column invoice_email text check (invoice_email ~ '^[^@\s]+@[^@\s]+$'),
  add column invoice_address text,
  add column note text,
  -- A call centre on trial is active until this time; after it, members are locked out
  -- (superadmins still get in) until a superadmin extends it or clears it.
  add column trial_ends_at timestamptz;

-- True when members may use the call centre: active, and not past the end of a trial.
create function app.organization_open(org organizations) returns boolean
  language sql stable
  as $$ select org.status = 'active' and (org.trial_ends_at is null or org.trial_ends_at > now()) $$;

create or replace function app.current_org_id() returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select o.id
    from organizations o
    where o.id = app.requested_org_id()
      and (
        app.is_platform_admin()
        or (
          app.organization_open(o)
          and exists (
            select 1 from memberships m
            join users u on u.id = m.user_id
            where m.organization_id = o.id
              and m.user_id = app.current_user_id()
              and m.status = 'active'
              and u.status = 'active'
          )
        )
      )
  $$;

create or replace function app.default_organization_for(target_user uuid) returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.organization_id
    from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = target_user and m.status = 'active' and app.organization_open(o)
    order by m.created_at
    limit 1
  $$;

revoke all on function app.organization_open(organizations) from public;
grant execute on function app.organization_open(organizations) to app_user;

-- Member counts for the superadmin's list of call centres. Memberships are otherwise only
-- visible inside the current call centre, so this is a security definer that returns
-- nothing to anyone but a superadmin (in a BankID session).
create function app.organization_overview()
  returns table (organization_id uuid, active_members int, invited_members int, last_login_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.organization_id,
           (count(*) filter (where m.status = 'active' and u.status = 'active'))::int,
           (count(*) filter (where m.status = 'active' and u.status = 'invited'))::int,
           max(u.last_login_at)
    from memberships m
    join users u on u.id = m.user_id
    where app.is_platform_admin()
    group by m.organization_id
  $$;

revoke all on function app.organization_overview() from public;
grant execute on function app.organization_overview() to app_user;
