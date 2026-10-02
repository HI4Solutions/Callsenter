-- Phase 0 foundation: call centres (tenants), users, roles and permissions, login tables,
-- audit and access logs. See docs/plan.md, section 4, and docs/auth.md.
--
-- Database roles
--   (migration owner)  owns every object; only migrations run as it.
--   app_user           used by the API. Subject to RLS; the API sets app.current_user_id and
--                      app.current_org_id with SET LOCAL in every transaction.
--   app_auth           used only by the login Lambda, before any user or call centre is known.
--                      Reaches only the login tables (and what it must read in users).
-- Both are NOLOGIN group roles. Login users are created per environment by infrastructure
-- (PR 4) and granted one of them, so no password ever lives in a migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_auth') then
    create role app_auth nologin;
  end if;
end
$$;

create schema app;
revoke all on schema app from public;
grant usage on schema app to app_user, app_auth;

-- Nobody but the owner creates objects in public.
revoke create on schema public from public;
grant usage on schema public to app_user, app_auth;

-- ---------------------------------------------------------------------------
-- Request context
-- ---------------------------------------------------------------------------

-- The user the API is acting for, as set with SET LOCAL app.current_user_id.
create function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.current_user_id', true), '')::uuid $$;

-- The organization id exactly as the API set it. Only used internally; policies use
-- app.current_org_id(), which also checks membership.
create function app.requested_org_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.current_org_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Permission catalog (mirrors packages/shared/src/permissions.ts)
-- ---------------------------------------------------------------------------

create table permissions (
  key text primary key,
  description text not null
);

insert into permissions (key, description) values
  ('calls.read.own', 'Egne samtaler'),
  ('calls.read.team', 'Teamets samtaler'),
  ('calls.read.all', 'Alle samtaler i callsenteret'),
  ('calls.audio.play', 'Avspilling av opptak'),
  ('calls.upload', 'Laste opp opptak'),
  ('customers.read', 'Se kunder og historikk'),
  ('customers.manage', 'Opprette og endre kunder'),
  ('sales.manage', 'Registrere og endre salg'),
  ('flags.review', 'Behandle gule og røde flagg'),
  ('complaints.manage', 'Klagesaker'),
  ('coaching.give', 'Tilbakemeldinger til selgere'),
  ('dashboard.team', 'Dashboard for teamet'),
  ('dashboard.all', 'Dashboard for hele callsenteret'),
  ('products.manage', 'Produkter og produktmaler'),
  ('report_templates.manage', 'Rapportmaler'),
  ('users.manage', 'Brukere og team'),
  ('roles.manage', 'Roller og rettigheter'),
  ('audit.read', 'Revisjons- og tilgangslogg'),
  ('billing.read', 'Fakturaer');

-- Default roles seeded for every new organization (mirrors DEFAULT_ROLES).
create table default_role_permissions (
  role_key text not null,
  role_name text not null,
  permission text not null references permissions (key),
  primary key (role_key, permission)
);

insert into default_role_permissions (role_key, role_name, permission)
select 'seller', 'Selger', p from unnest(array[
  'calls.read.own', 'calls.audio.play', 'calls.upload', 'customers.read', 'customers.manage', 'sales.manage'
]) as p
union all
select 'leader', 'Leder', p from unnest(array[
  'calls.read.own', 'calls.read.team', 'calls.audio.play', 'calls.upload', 'customers.read',
  'customers.manage', 'sales.manage', 'flags.review', 'coaching.give', 'dashboard.team'
]) as p
union all
select 'compliance', 'Compliance', p from unnest(array[
  'calls.read.all', 'calls.audio.play', 'customers.read', 'flags.review', 'complaints.manage',
  'dashboard.all', 'audit.read'
]) as p
union all
select 'admin', 'Admin', key from permissions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  org_number text unique check (org_number ~ '^[0-9]{9}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_modules (
  organization_id uuid not null references organizations (id) on delete cascade,
  module text not null check (module ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, module)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  -- E.164, for example +4712345678. Used once to link a first Vipps login to an invitation.
  phone text unique check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_key on users (lower(email)) where email is not null;

-- Superadmins (MedInnova). Outside every call centre; created by a script, never by the API.
create table platform_admins (
  user_id uuid primary key references users (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, key),
  unique (id, organization_id)
);

create table role_permissions (
  role_id uuid not null,
  organization_id uuid not null,
  permission text not null references permissions (key),
  primary key (role_id, permission),
  -- The composite key keeps organization_id equal to the role's organization.
  foreign key (role_id, organization_id) references roles (id, organization_id) on delete cascade
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id),
  role_id uuid not null,
  team_id uuid,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  -- Role and team must belong to the same organization as the membership.
  foreign key (role_id, organization_id) references roles (id, organization_id),
  foreign key (team_id, organization_id) references teams (id, organization_id)
);
create index memberships_user_idx on memberships (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id),
  token_hash bytea not null unique check (length(token_hash) = 32),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '72 hours',
  used_at timestamptz,
  revoked_at timestamptz
);

create table auth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash bytea not null unique check (length(state_hash) = 32),
  provider text not null check (provider in ('vipps', 'bankid')),
  nonce text not null,
  code_verifier text not null,
  return_to text check (return_to ~ '^/[^/\\]'  or return_to = '/'),
  invitation_id uuid references invitations (id),
  -- Set when a signed-in user adds a second login method from their profile.
  link_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  provider text not null check (provider in ('vipps', 'bankid')),
  subject text not null,
  -- HMAC of the national identity number, only if it is ever needed. Never the number itself.
  ssn_hmac bytea check (length(ssn_hmac) = 32),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (provider, subject),
  unique (user_id, provider)
);

create table sessions (
  id_hash bytea primary key check (length(id_hash) = 32),
  user_id uuid not null references users (id),
  provider text not null check (provider in ('vipps', 'bankid')),
  acr text,
  active_organization_id uuid references organizations (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip inet,
  user_agent text,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index sessions_user_idx on sessions (user_id);

create table login_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  provider text not null check (provider in ('vipps', 'bankid')),
  result text not null check (result in ('success', 'cancelled', 'unknown_identity', 'invalid', 'error')),
  reason text,
  user_id uuid references users (id),
  ip inet,
  user_agent text
);
create index login_events_user_idx on login_events (user_id, occurred_at desc);

-- Append-only. Written by triggers (app.audit_row_change), never directly by the API.
create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  organization_id uuid,
  actor_user_id uuid,
  -- True when a superadmin acted in a call centre they are not a member of.
  as_platform_admin boolean not null default false,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb
);
create index audit_log_org_idx on audit_log (organization_id, occurred_at desc);

-- Append-only. One row per view or playback of a recording or transcript (from phase 2).
create table access_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  organization_id uuid not null references organizations (id),
  user_id uuid not null references users (id),
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_]*$'),
  resource_id text not null,
  action text not null check (action in ('view', 'play', 'download')),
  ip inet,
  user_agent text
);
create index access_log_org_idx on access_log (organization_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Context and permission helpers (security definer: they read membership data the caller
-- may not see directly, and must not recurse into RLS)
-- ---------------------------------------------------------------------------

create function app.is_platform_admin() returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from platform_admins
      where user_id = app.current_user_id() and revoked_at is null
    )
  $$;

-- The call centre the request acts in, but only if the current user may act there:
-- an active member of an active organization, or a superadmin. Otherwise null, so a wrong
-- or forged app.current_org_id shows nothing rather than another tenant's data.
create function app.current_org_id() returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select o.id
    from organizations o
    where o.id = app.requested_org_id()
      and (
        app.is_platform_admin()
        or (
          o.status = 'active'
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

-- Permissions the current user holds in the current call centre. Superadmins hold all.
create function app.current_permissions() returns setof text
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select p.key from permissions p
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
  $$;

create function app.has_permission(permission text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select permission in (select app.current_permissions()) $$;

-- True when the current user and the given user share the current call centre.
create function app.is_member_of_current_org(target_user uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from memberships
      where organization_id = app.current_org_id() and user_id = target_user
    )
  $$;

-- Organizations the current user belongs to (for picking the active call centre).
create function app.my_organization_ids() returns setof uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.organization_id from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = app.current_user_id() and m.status = 'active' and o.status = 'active'
  $$;

-- ---------------------------------------------------------------------------
-- Guard: nobody can hand out a permission they do not hold themselves
-- ---------------------------------------------------------------------------

-- The guards run as the caller (not security definer), so current_user tells who is
-- writing. The table owner (migrations, and the security definer seeding below) is not
-- restricted. Without a user context there is nothing to compare against, and RLS already
-- refuses writes from app_user without a user.
create function app.is_owner_writing(rel oid) returns boolean
  language sql stable
  as $$ select current_user = (select pg_get_userbyid(relowner) from pg_class where oid = rel) $$;

create function app.guard_role_permission() returns trigger
  language plpgsql
  as $$
  begin
    if app.is_owner_writing(tg_relid) or app.current_user_id() is null then
      return new;
    end if;
    if not app.has_permission(new.permission) then
      raise exception 'cannot grant permission % that you do not hold', new.permission
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end
  $$;

create trigger role_permissions_guard
  before insert or update on role_permissions
  for each row execute function app.guard_role_permission();

create function app.guard_membership_role() returns trigger
  language plpgsql
  as $$
  declare
    missing text;
  begin
    if tg_op = 'UPDATE'
      and (new.user_id <> old.user_id or new.organization_id <> old.organization_id) then
      raise exception 'a membership cannot move to another user or call centre'
        using errcode = 'insufficient_privilege';
    end if;
    if app.is_owner_writing(tg_relid) or app.current_user_id() is null then
      return new;
    end if;
    if tg_op = 'UPDATE' and new.role_id = old.role_id then
      return new;
    end if;
    select rp.permission into missing
    from role_permissions rp
    where rp.role_id = new.role_id
      and not app.has_permission(rp.permission)
    limit 1;
    if missing is not null then
      raise exception 'cannot assign a role with permission % that you do not hold', missing
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end
  $$;

create trigger memberships_guard
  before insert or update on memberships
  for each row execute function app.guard_membership_role();

-- Changing a role's permissions also changes what everyone holding it can do, which is
-- covered by role_permissions_guard above (insert) and by RLS (delete needs roles.manage).

-- ---------------------------------------------------------------------------
-- Seed the default roles for every new organization
-- ---------------------------------------------------------------------------

-- Security definer, so the inserts run as the owner and are not limited by the grant guard:
-- seeding is not a grant made by the current user.
create function app.seed_default_roles() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    insert into roles (organization_id, key, name, is_default)
    select distinct new.id, role_key, role_name, true from default_role_permissions;

    insert into role_permissions (role_id, organization_id, permission)
    select r.id, r.organization_id, d.permission
    from default_role_permissions d
    join roles r on r.organization_id = new.id and r.key = d.role_key;
    return new;
  end
  $$;

create trigger organizations_seed_roles
  after insert on organizations
  for each row execute function app.seed_default_roles();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create function app.touch_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at := now(); return new; end $$;

create trigger organizations_touch before update on organizations
  for each row execute function app.touch_updated_at();
create trigger organization_modules_touch before update on organization_modules
  for each row execute function app.touch_updated_at();
create trigger users_touch before update on users
  for each row execute function app.touch_updated_at();
create trigger memberships_touch before update on memberships
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log: every change to these tables is recorded, append-only
-- ---------------------------------------------------------------------------

create function app.audit_row_change() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
    new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
    row_data jsonb := coalesce(new_row, old_row);
    org uuid;
    actor uuid := app.current_user_id();
  begin
    -- Secrets never reach the audit log.
    old_row := old_row - 'token_hash' - 'ssn_hmac';
    new_row := new_row - 'token_hash' - 'ssn_hmac';

    org := case
      when tg_table_name = 'organizations' then (row_data ->> 'id')::uuid
      when row_data ? 'organization_id' then (row_data ->> 'organization_id')::uuid
      -- users, identities and platform_admins belong to no single call centre; record the one
      -- the change was made in.
      else app.current_org_id()
    end;

    insert into audit_log (
      organization_id, actor_user_id, as_platform_admin, action, table_name, record_id,
      old_data, new_data
    ) values (
      org,
      actor,
      actor is not null and app.is_platform_admin()
        and not exists (
          select 1 from memberships
          where organization_id = org and user_id = actor and status = 'active'
        ),
      lower(tg_op),
      tg_table_name,
      coalesce(row_data ->> 'id', row_data ->> 'user_id', row_data ->> 'role_id'),
      old_row,
      new_row
    );
    return null;
  end
  $$;

create trigger organizations_audit after insert or update or delete on organizations
  for each row execute function app.audit_row_change();
create trigger organization_modules_audit after insert or update or delete on organization_modules
  for each row execute function app.audit_row_change();
create trigger users_audit after insert or update or delete on users
  for each row execute function app.audit_row_change();
create trigger platform_admins_audit after insert or update or delete on platform_admins
  for each row execute function app.audit_row_change();
create trigger teams_audit after insert or update or delete on teams
  for each row execute function app.audit_row_change();
create trigger roles_audit after insert or update or delete on roles
  for each row execute function app.audit_row_change();
create trigger role_permissions_audit after insert or update or delete on role_permissions
  for each row execute function app.audit_row_change();
create trigger memberships_audit after insert or update or delete on memberships
  for each row execute function app.audit_row_change();
create trigger invitations_audit after insert or update or delete on invitations
  for each row execute function app.audit_row_change();
create trigger identities_audit after insert or update or delete on identities
  for each row execute function app.audit_row_change();

-- Append-only, also for the owner: updates, deletes and truncation are refused.
create function app.refuse_change() returns trigger
  language plpgsql
  as $$
  begin
    raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
  end
  $$;

create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function app.refuse_change();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function app.refuse_change();
create trigger access_log_append_only before update or delete on access_log
  for each row execute function app.refuse_change();
create trigger access_log_no_truncate before truncate on access_log
  for each statement execute function app.refuse_change();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table organization_modules enable row level security;
alter table users enable row level security;
alter table platform_admins enable row level security;
alter table teams enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table auth_states enable row level security;
alter table identities enable row level security;
alter table sessions enable row level security;
alter table login_events enable row level security;
alter table audit_log enable row level security;
alter table access_log enable row level security;

-- RLS is enabled but not forced: the owner (migrations, security definer helpers and
-- triggers) bypasses it, while app_user and app_auth never own tables and are always subject
-- to it.
--
-- Policies wrap the helpers in (select ...) so they are evaluated once per statement.

-- organizations: members see their own; superadmins see and manage all.
create policy organizations_select on organizations for select to app_user
  using (id in (select app.my_organization_ids()) or (select app.is_platform_admin()));
create policy organizations_insert on organizations for insert to app_user
  with check ((select app.is_platform_admin()));
create policy organizations_update on organizations for update to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));

-- organization_modules: visible in the current call centre; superadmins switch them.
create policy organization_modules_select on organization_modules for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy organization_modules_write on organization_modules for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.is_platform_admin()))
  with check (organization_id = (select app.current_org_id()) and (select app.is_platform_admin()));

-- users: yourself, people in your current call centre, or everyone for superadmins.
create policy users_select on users for select to app_user
  using (
    id = (select app.current_user_id())
    or app.is_member_of_current_org(id)
    or (select app.is_platform_admin())
  );
-- A new user is not visible to the admin until a membership exists, so the API generates the
-- user id itself instead of reading it back with RETURNING (see test/invite-flow.test.ts).
create policy users_insert on users for insert to app_user
  with check ((select app.has_permission('users.manage')));
create policy users_update on users for update to app_user
  using (
    (app.is_member_of_current_org(id) and (select app.has_permission('users.manage')))
    or (select app.is_platform_admin())
  )
  with check (
    (app.is_member_of_current_org(id) and (select app.has_permission('users.manage')))
    or (select app.is_platform_admin())
  );

-- platform_admins: readable by superadmins and by the user themself; changed only by script.
create policy platform_admins_select on platform_admins for select to app_user
  using (user_id = (select app.current_user_id()) or (select app.is_platform_admin()));

-- teams, roles, role_permissions, memberships: current call centre only.
create policy teams_select on teams for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy teams_write on teams for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

create policy roles_select on roles for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy roles_write on roles for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')));

create policy role_permissions_select on role_permissions for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy role_permissions_write on role_permissions for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')));

create policy memberships_select on memberships for select to app_user
  using (organization_id = (select app.current_org_id()) or user_id = (select app.current_user_id()));
create policy memberships_write on memberships for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

-- invitations: admins of the call centre create, list and revoke them.
create policy invitations_admin on invitations for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

-- audit_log: read with audit.read in the current call centre; superadmins also see
-- platform-level rows (no organization). Inserted only by the security definer trigger.
create policy audit_log_select on audit_log for select to app_user
  using (
    (organization_id = (select app.current_org_id()) and (select app.has_permission('audit.read')))
    or (select app.is_platform_admin())
  );

-- access_log: the API writes one row per view as the current user in the current call centre.
create policy access_log_insert on access_log for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and user_id = (select app.current_user_id())
  );
create policy access_log_select on access_log for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('audit.read')));

-- login_events: readable with audit.read for members of the current call centre.
create policy login_events_select on login_events for select to app_user
  using (
    (app.is_member_of_current_org(user_id) and (select app.has_permission('audit.read')))
    or (select app.is_platform_admin())
  );

-- The login role (app_auth) works before any user or call centre is known.
create policy auth_states_login on auth_states for all to app_auth using (true) with check (true);
create policy identities_login on identities for all to app_auth using (true) with check (true);
create policy sessions_login on sessions for all to app_auth using (true) with check (true);
create policy login_events_login on login_events for insert to app_auth with check (true);
create policy invitations_login on invitations for select to app_auth using (true);
create policy invitations_login_use on invitations for update to app_auth using (true) with check (true);
create policy users_login_select on users for select to app_auth using (true);
create policy users_login_update on users for update to app_auth using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Grants. Nothing is granted to PUBLIC; each role gets only what it needs.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from public;
revoke all on all functions in schema app from public;

grant select on permissions, default_role_permissions to app_user;
grant select, insert, update on organizations to app_user;
grant select, insert, update, delete on organization_modules to app_user;
grant select, insert, update on users to app_user;
grant select on platform_admins to app_user;
grant select, insert, update, delete on teams, roles, role_permissions, memberships to app_user;
grant select, insert, update on invitations to app_user;
grant select on audit_log, login_events to app_user;
grant select, insert on access_log to app_user;

grant select, insert, update, delete on auth_states, sessions to app_auth;
grant select, insert, update on identities to app_auth;
grant insert on login_events to app_auth;
grant select, update (used_at) on invitations to app_auth;
grant select, update (status, last_login_at) on users to app_auth;

grant execute on all functions in schema app to app_user;
grant execute on function app.current_user_id(), app.requested_org_id() to app_auth;
