-- Phase 1, superadmin portal PR C: the security tab (docs/plan.md, section 10). Superadmins
-- read the access log across call centres, and can block IP addresses or networks.

create policy access_log_select_platform on access_log for select to app_user
  using ((select app.is_platform_admin()));

create table blocked_ips (
  id uuid primary key default gen_random_uuid(),
  network cidr not null,
  reason text check (length(reason) <= 500),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  -- Null: until removed.
  expires_at timestamptz,
  removed_at timestamptz
);
-- At most one live block per network.
create unique index blocked_ips_live_network on blocked_ips (network) where removed_at is null;

alter table blocked_ips enable row level security;

create policy blocked_ips_platform on blocked_ips for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
-- The API checks every request against the list before anyone is signed in.
create policy blocked_ips_check on blocked_ips for select to app_auth using (true);

grant select, insert, update (removed_at, expires_at, reason) on blocked_ips to app_user;
grant select on blocked_ips to app_auth;

create trigger blocked_ips_audit after insert or update or delete on blocked_ips
  for each row execute function app.audit_row_change();
