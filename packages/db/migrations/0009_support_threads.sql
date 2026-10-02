-- Conversations between a call centre's admins and the superadmins (docs/plan.md, sections 10
-- and 11). Admins are those holding users.manage in the call centre.

create table support_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  subject text not null check (length(trim(subject)) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- When each side last read the thread, for unread markers.
  org_read_at timestamptz,
  platform_read_at timestamptz,
  unique (id, organization_id)
);
create index support_threads_org_idx on support_threads (organization_id, last_message_at desc);

create table support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  organization_id uuid not null,
  author_user_id uuid not null references users (id),
  -- Written by a superadmin (shown as "VeriQall") rather than by the call centre.
  from_platform boolean not null,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (thread_id, organization_id) references support_threads (id, organization_id) on delete cascade
);
create index support_messages_thread_idx on support_messages (thread_id, created_at);

alter table support_threads enable row level security;
alter table support_messages enable row level security;

create policy support_threads_org on support_threads for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));
create policy support_threads_platform on support_threads for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));

create policy support_messages_org_select on support_messages for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));
create policy support_messages_platform_select on support_messages for select to app_user
  using ((select app.is_platform_admin()));
-- Messages are written as yourself, and marked as from VeriQall exactly when a superadmin writes.
create policy support_messages_insert on support_messages for insert to app_user
  with check (
    author_user_id = app.current_user_id()
    and from_platform = app.is_platform_admin()
    and (
      app.is_platform_admin()
      or (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
    )
  );

grant select, insert, update (status, last_message_at, org_read_at, platform_read_at) on support_threads to app_user;
grant select, insert on support_messages to app_user;

create trigger support_threads_audit after insert or update of status on support_threads
  for each row execute function app.audit_row_change();
