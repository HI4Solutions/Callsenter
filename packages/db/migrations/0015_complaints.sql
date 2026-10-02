-- Phase 3, complaints (docs/plan.md, section 14, module 10): a case per complaint, linked to the
-- customer and usually a sale, with a status flow and an append-only history. The documentation
-- (offer, acceptance, calls, AI findings) is assembled from the sale. complaints.manage handles
-- complaints; the history is written by triggers and by notes, never changed afterwards.

create table complaints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id uuid not null,
  sale_id uuid,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'rejected')),
  channel text not null default 'phone' check (channel in ('phone', 'email', 'letter', 'web', 'other')),
  received_on date not null default current_date,
  summary text not null check (length(trim(summary)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  -- What was decided and why, when the case is closed.
  outcome text check (length(outcome) <= 10000),
  assigned_to uuid,
  status_note text check (length(status_note) <= 1000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references customers (id, organization_id),
  foreign key (sale_id, organization_id) references sales (id, organization_id),
  foreign key (organization_id, assigned_to) references memberships (organization_id, user_id)
);
create index complaints_org_idx on complaints (organization_id, status, received_on desc);
create index complaints_customer_idx on complaints (customer_id);
create index complaints_sale_idx on complaints (sale_id);

create table complaint_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  complaint_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'note')),
  from_status text,
  to_status text,
  note text check (length(note) <= 5000),
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  foreign key (complaint_id, organization_id) references complaints (id, organization_id) on delete cascade
);
create index complaint_events_idx on complaint_events (complaint_id, id);

-- A sale linked to a complaint must belong to the same customer. Security definer: the case
-- handler may not see the sale itself (calls.read.all needs BankID), but the link must hold.
create function app.guard_complaint() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if new.sale_id is not null and not exists (
      select 1 from sales s where s.id = new.sale_id and s.customer_id = new.customer_id
    ) then
      raise exception 'the sale belongs to another customer' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' then
      if new.customer_id <> old.customer_id or new.created_by is distinct from old.created_by
        or new.created_at <> old.created_at then
        raise exception 'a complaint keeps its customer' using errcode = 'check_violation';
      end if;
      if new.status <> old.status then
        new.closed_at := case when new.status in ('resolved', 'rejected') then now() end;
        -- A note left from the previous change does not belong to this one.
        if new.status_note is not distinct from old.status_note then
          new.status_note := null;
        end if;
      else
        new.status_note := old.status_note;
      end if;
    else
      new.status := 'open';
      new.closed_at := null;
      new.created_by := app.current_user_id();
    end if;
    return new;
  end
  $$;

create function app.record_complaint_event() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if tg_op = 'INSERT' then
      insert into complaint_events (organization_id, complaint_id, kind, to_status, actor_user_id)
      values (new.organization_id, new.id, 'created', new.status, app.current_user_id());
    elsif new.status <> old.status then
      insert into complaint_events (organization_id, complaint_id, kind, from_status, to_status, note, actor_user_id)
      values (new.organization_id, new.id, 'status', old.status, new.status, new.status_note, app.current_user_id());
    end if;
    return null;
  end
  $$;

create trigger complaints_guard before insert or update on complaints
  for each row execute function app.guard_complaint();
create trigger complaints_touch before update on complaints
  for each row execute function app.touch_updated_at();
create trigger complaints_events after insert or update on complaints
  for each row execute function app.record_complaint_event();
create trigger complaints_audit after insert or update or delete on complaints
  for each row execute function app.audit_row_change();
create trigger complaint_events_append_only before update or delete on complaint_events
  for each row execute function app.refuse_change();

alter table complaints enable row level security;
alter table complaint_events enable row level security;

create policy complaints_all on complaints for all to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage')));
create policy complaint_events_select on complaint_events for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage')));
-- Notes are added by the API; status entries come from the trigger.
create policy complaint_events_insert on complaint_events for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage'))
    and kind = 'note' and actor_user_id = (select app.current_user_id())
  );

grant select, insert on complaints to app_user;
grant update (sale_id, status, channel, received_on, summary, description, outcome, assigned_to, status_note) on complaints to app_user;
grant select, insert on complaint_events to app_user;
