-- Phase 1, superadmin portal PR B: users across call centres, and granting superadmin from the
-- portal (decided 2 October 2026, docs/plan.md section 10). Everything here works only for a
-- superadmin in a BankID session (app.is_platform_admin()).

-- --- Superadmins grant and revoke superadmin --------------------------------------------

create policy platform_admins_insert on platform_admins for insert to app_user
  with check ((select app.is_platform_admin()));
create policy platform_admins_update on platform_admins for update to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant insert, update (granted_at, revoked_at) on platform_admins to app_user;

-- Nobody removes their own access, and there is always at least one superadmin left.
create function app.guard_platform_admin() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if new.revoked_at is not null and (tg_op = 'INSERT' or old.revoked_at is null) then
      if new.user_id = app.current_user_id() then
        raise exception 'cannot revoke your own superadmin access' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from platform_admins where revoked_at is null and user_id <> new.user_id) then
        raise exception 'at least one superadmin must remain' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end
  $$;

create trigger platform_admins_guard before insert or update on platform_admins
  for each row execute function app.guard_platform_admin();

-- --- Read-outs across call centres ------------------------------------------------------
-- Memberships, identities and sessions are otherwise visible only inside one call centre (or
-- only to the login role). These return nothing unless the caller is a superadmin.

create function app.admin_memberships(target uuid default null)
  returns table (user_id uuid, organization_id uuid, organization_name text, role_name text, status text)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.user_id, o.id, o.name, r.name, m.status
    from memberships m
    join organizations o on o.id = m.organization_id
    join roles r on r.id = m.role_id
    where app.is_platform_admin() and (target is null or m.user_id = target)
    order by o.name
  $$;

-- Which login methods a user has. The provider's subject is never returned.
create function app.admin_identities(target uuid)
  returns table (provider text, created_at timestamptz, last_used_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select provider, created_at, last_used_at from identities
    where app.is_platform_admin() and user_id = target
    order by provider
  $$;

-- Active sessions. The session id (its hash) is never returned.
create function app.admin_sessions(target uuid)
  returns table (provider text, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, ip inet, user_agent text)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select provider, created_at, last_seen_at, expires_at, ip, user_agent from sessions
    where app.is_platform_admin() and user_id = target and revoked_at is null and expires_at > now()
    order by last_seen_at desc
  $$;

-- How many call centres have each module switched on.
create function app.admin_module_usage()
  returns table (module text, enabled_count int)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select module, (count(*) filter (where enabled))::int from organization_modules
    where app.is_platform_admin()
    group by module
  $$;

-- --- Actions --------------------------------------------------------------------------

-- Signs a user out everywhere. Sessions have no audit trigger (they change on every login),
-- so the action is written to audit_log here.
create function app.admin_revoke_sessions(target uuid) returns int
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    revoked int;
  begin
    if not app.is_platform_admin() then
      raise exception 'superadmin required' using errcode = 'insufficient_privilege';
    end if;
    update sessions set revoked_at = now()
    where user_id = target and revoked_at is null and expires_at > now();
    get diagnostics revoked = row_count;
    insert into audit_log (actor_user_id, as_platform_admin, action, table_name, record_id, new_data)
    values (app.current_user_id(), true, 'update', 'sessions', target::text, jsonb_build_object('revoked', revoked));
    return revoked;
  end
  $$;

-- Removes one login method (BankID or Vipps) from a user, for example after a lost phone.
-- The identities audit trigger records it. The user's sessions with that method end too.
create function app.admin_remove_identity(target uuid, method text) returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    removed int;
  begin
    if not app.is_platform_admin() then
      raise exception 'superadmin required' using errcode = 'insufficient_privilege';
    end if;
    delete from identities where user_id = target and provider = method;
    get diagnostics removed = row_count;
    if removed > 0 then
      update sessions set revoked_at = now()
      where user_id = target and provider = method and revoked_at is null;
    end if;
    return removed > 0;
  end
  $$;

revoke all on function
  app.guard_platform_admin(), app.admin_memberships(uuid), app.admin_identities(uuid), app.admin_sessions(uuid),
  app.admin_module_usage(), app.admin_revoke_sessions(uuid), app.admin_remove_identity(uuid, text)
  from public;
grant execute on function
  app.admin_memberships(uuid), app.admin_identities(uuid), app.admin_sessions(uuid), app.admin_module_usage(),
  app.admin_revoke_sessions(uuid), app.admin_remove_identity(uuid, text)
  to app_user;
