-- Phase 1, sales (docs/plan.md, section 12): a sale of a product to a customer, pointing at the
-- template version that applied, with a status flow and its history.

-- Mirrors SALE_TRANSITIONS in packages/shared/src/sales.ts (checked by a test).
create table sale_status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);
insert into sale_status_transitions (from_status, to_status) values
  ('registered', 'awaiting_confirmation'),
  ('registered', 'confirmed'),
  ('registered', 'cancelled'),
  ('awaiting_confirmation', 'confirmed'),
  ('awaiting_confirmation', 'rejected'),
  ('awaiting_confirmation', 'cancelled'),
  ('confirmed', 'active'),
  ('confirmed', 'withdrawn'),
  ('confirmed', 'cancelled'),
  ('active', 'withdrawn'),
  ('active', 'cancelled');
grant select on sale_status_transitions to app_user;

create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id uuid not null,
  product_id uuid not null,
  -- Set by the database to the product's published version when the sale is registered.
  template_version_id uuid not null,
  seller_id uuid not null,
  -- The seller's team when the sale was made; leaders see their team's sales by this.
  team_id uuid,
  status text not null default 'registered' check (status in (
    'registered', 'awaiting_confirmation', 'confirmed', 'active', 'rejected', 'withdrawn', 'cancelled'
  )),
  -- Why the status last changed; copied to the history.
  status_note text check (length(status_note) <= 1000),
  status_changed_at timestamptz not null default now(),
  -- Copied from the template version, which is frozen, so lists need no join.
  price_once numeric(12, 2),
  price_monthly numeric(12, 2),
  binding_months int not null,
  withdrawal_days int not null,
  note text check (length(note) <= 2000),
  sold_at timestamptz not null default now(),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references customers (id, organization_id),
  foreign key (product_id, organization_id) references products (id, organization_id),
  foreign key (template_version_id, organization_id) references product_template_versions (id, organization_id),
  -- The seller is (or was) a member of this call centre; the membership is never deleted while it has sales.
  foreign key (organization_id, seller_id) references memberships (organization_id, user_id),
  foreign key (team_id, organization_id) references teams (id, organization_id)
);
create index sales_org_sold_idx on sales (organization_id, sold_at desc);
create index sales_customer_idx on sales (customer_id, sold_at desc);
create index sales_seller_idx on sales (seller_id, sold_at desc);
create index sales_team_idx on sales (team_id, sold_at desc);

-- The history of each sale: one row when it is registered and one per status change. Written
-- only by the trigger below.
create table sale_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  sale_id uuid not null,
  from_status text,
  to_status text not null,
  note text,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  foreign key (sale_id, organization_id) references sales (id, organization_id) on delete cascade
);
create index sale_events_sale_idx on sale_events (sale_id, id);

-- Who may see a sale, mirroring the visibility of calls: own sales, the team's (by the team the
-- sale was made in), or all in the call centre.
create function app.can_see_sale(seller uuid, team uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select app.has_permission('calls.read.all')
      or (app.has_permission('calls.read.own') and seller = app.current_user_id())
      or (
        app.has_permission('calls.read.team') and team is not null and exists (
          select 1 from memberships m
          where m.organization_id = app.current_org_id() and m.user_id = app.current_user_id()
            and m.status = 'active' and m.team_id = team
        )
      )
  $$;
revoke all on function app.can_see_sale(uuid, uuid) from public;
grant execute on function app.can_see_sale(uuid, uuid) to app_user;

-- A new sale gets the product's published version, its prices and the seller's team. Runs with
-- the caller's rights, so it sees only what the caller may see.
create function app.prepare_sale() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  declare
    v record;
    seller_team uuid;
  begin
    select tv.id, tv.price_once, tv.price_monthly, tv.binding_months, tv.withdrawal_days into v
    from product_template_versions tv
    join products p on p.id = tv.product_id
    where tv.product_id = new.product_id and tv.organization_id = new.organization_id
      and tv.status = 'published' and p.archived_at is null;
    if not found then
      raise exception 'product has no published template version' using errcode = 'check_violation';
    end if;
    if new.template_version_id is not null and new.template_version_id <> v.id then
      raise exception 'template version is not the published one' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from customers c
      where c.id = new.customer_id and c.organization_id = new.organization_id and c.archived_at is null
    ) then
      raise exception 'customer not found or archived' using errcode = 'check_violation';
    end if;
    select m.team_id into seller_team from memberships m
    where m.organization_id = new.organization_id and m.user_id = new.seller_id and m.status = 'active';
    if not found then
      raise exception 'seller is not an active member' using errcode = 'check_violation';
    end if;

    new.template_version_id := v.id;
    new.price_once := v.price_once;
    new.price_monthly := v.price_monthly;
    new.binding_months := v.binding_months;
    new.withdrawal_days := v.withdrawal_days;
    new.team_id := seller_team;
    new.status := 'registered';
    new.status_changed_at := now();
    new.sold_at := now();
    new.created_by := app.current_user_id();
    return new;
  end
  $$;

-- After registration only the status (along the allowed transitions) and the notes change.
create function app.guard_sale() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if (to_jsonb(new) - 'status' - 'status_note' - 'status_changed_at' - 'note' - 'updated_at')
      <> (to_jsonb(old) - 'status' - 'status_note' - 'status_changed_at' - 'note' - 'updated_at') then
      raise exception 'only the status and the note of a sale can change' using errcode = 'check_violation';
    end if;
    if new.status = old.status then
      new.status_note := old.status_note;
      new.status_changed_at := old.status_changed_at;
      return new;
    end if;
    if not exists (
      select 1 from sale_status_transitions where from_status = old.status and to_status = new.status
    ) then
      raise exception 'a sale cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    new.status_changed_at := now();
    return new;
  end
  $$;

create function app.record_sale_event() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      insert into sale_events (organization_id, sale_id, from_status, to_status, note, actor_user_id)
      values (
        new.organization_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
        case when tg_op = 'UPDATE' then new.status_note end, app.current_user_id()
      );
    end if;
    return null;
  end
  $$;

create trigger sales_prepare before insert on sales
  for each row execute function app.prepare_sale();
create trigger sales_guard before update on sales
  for each row execute function app.guard_sale();
create trigger sales_touch before update on sales
  for each row execute function app.touch_updated_at();
create trigger sales_events after insert or update on sales
  for each row execute function app.record_sale_event();
create trigger sales_audit after insert or update or delete on sales
  for each row execute function app.audit_row_change();

alter table sales enable row level security;
alter table sale_events enable row level security;

create policy sales_select on sales for select to app_user
  using (organization_id = (select app.current_org_id()) and app.can_see_sale(seller_id, team_id));
-- Sellers register their own sales; with calls.read.all also on behalf of others.
create policy sales_insert on sales for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('sales.manage'))
    and (seller_id = (select app.current_user_id()) or (select app.has_permission('calls.read.all')))
  );
create policy sales_update on sales for update to app_user
  using (
    organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage'))
    and app.can_see_sale(seller_id, team_id)
  )
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage')));

-- The history follows the sale: visible when the sale is.
create policy sale_events_select on sale_events for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and exists (select 1 from sales s where s.id = sale_events.sale_id)
  );

grant select, insert, update on sales to app_user;
grant select on sale_events to app_user;
