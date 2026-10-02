-- Phase 0, PR 3: what the login needs in the database. See docs/auth.md.
--
-- 1. BankID requirement (decided 2 October 2026): administrative permissions and superadmin
--    powers exist only in a session started with BankID. The API sets
--    app.session_strong = 'on' with SET LOCAL for such sessions; without it those permissions
--    simply are not held. Enforced here so every RLS policy and grant guard follows it.
-- 2. Superadmin invitations, which belong to no call centre.
-- 3. A helper the login role uses to pick the call centre a new session starts in.

-- Mirrors STRONG_AUTH_PERMISSIONS in packages/shared/src/permissions.ts (checked by a test).
create table strong_auth_permissions (
  permission text primary key references permissions (key)
);

insert into strong_auth_permissions (permission) values
  ('audit.read'),
  ('users.manage'),
  ('roles.manage'),
  ('calls.read.all'),
  ('billing.read');

grant select on strong_auth_permissions to app_user;

-- True when the request's session was started with BankID.
create function app.session_is_strong() returns boolean
  language sql stable
  as $$ select coalesce(current_setting('app.session_strong', true), '') = 'on' $$;

-- Superadmin powers need a BankID session too.
create or replace function app.is_platform_admin() returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select app.session_is_strong() and exists (
      select 1 from platform_admins
      where user_id = app.current_user_id() and revoked_at is null
    )
  $$;

create or replace function app.current_permissions() returns setof text
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select held.permission
    from (
      select p.key as permission from permissions p
      where app.current_org_id() is not null and app.is_platform_admin()
      union
      select rp.permission
      from memberships m
      join users u on u.id = m.user_id
      join role_permissions rp on rp.role_id = m.role_id
      join roles r on r.id = m.role_id
      where m.organization_id = app.current_org_id()
        and m.user_id = app.current_user_id()
        and m.status = 'active'
        and u.status = 'active'
        and r.archived_at is null
    ) held
    where app.session_is_strong()
      or held.permission not in (select permission from strong_auth_permissions)
  $$;

-- Superadmin invitations have no call centre. RLS already keeps them out of every call
-- centre's view (organization_id = app.current_org_id() is never true for null).
alter table invitations alter column organization_id drop not null;

-- The call centre a new session starts in: the user's oldest active membership in an active
-- call centre, or null (superadmins without membership, users who lost access).
create function app.default_organization_for(target_user uuid) returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.organization_id
    from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = target_user and m.status = 'active' and o.status = 'active'
    order by m.created_at
    limit 1
  $$;

revoke all on function app.session_is_strong(), app.default_organization_for(uuid) from public;
grant execute on function app.session_is_strong() to app_user;
grant execute on function app.default_organization_for(uuid) to app_auth;
