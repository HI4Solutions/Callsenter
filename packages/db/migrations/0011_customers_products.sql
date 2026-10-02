-- Phase 1, master data (docs/plan.md, section 12): customers, products and versioned product
-- templates. Every table has organization_id, RLS and audit triggers.

-- --- Customers ----------------------------------------------------------------------------
-- A person (name, date of birth) or a business (org number, contact person). No national
-- identity number: identity is confirmed with BankID or Vipps when the customer accepts (module 8).

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  kind text not null check (kind in ('person', 'business')),
  name text not null check (length(trim(name)) between 1 and 200),
  birth_date date check (birth_date between date '1900-01-01' and current_date),
  org_number text check (org_number ~ '^[0-9]{9}$'),
  contact_name text check (length(trim(contact_name)) between 1 and 200),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  address_line text check (length(address_line) <= 200),
  postal_code text check (postal_code ~ '^[0-9]{4}$'),
  city text check (length(city) <= 100),
  note text check (length(note) <= 2000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Persons have no org number; businesses no date of birth.
  check (kind = 'business' or org_number is null),
  check (kind = 'person' or birth_date is null),
  unique (id, organization_id)
);
create index customers_org_name_idx on customers (organization_id, lower(name));
create index customers_org_phone_idx on customers (organization_id, phone);
create unique index customers_org_number_key on customers (organization_id, org_number)
  where org_number is not null and archived_at is null;

create trigger customers_touch before update on customers
  for each row execute function app.touch_updated_at();

alter table customers enable row level security;
create policy customers_select on customers for select to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('customers.read')));
create policy customers_insert on customers for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('customers.manage')));
create policy customers_update on customers for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('customers.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('customers.manage')));
grant select, insert, update on customers to app_user;

create trigger customers_audit after insert or update or delete on customers
  for each row execute function app.audit_row_change();

-- --- Products and versioned templates -----------------------------------------------------
-- A product has a line of template versions. A draft can be edited; publishing freezes it and
-- retires the previously published version. A published or retired version never changes
-- (CLAUDE.md: "Produktmaler versjoneres"); sales and calls point at the version that applied.

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text check (length(description) <= 2000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);
create unique index products_org_name_key on products (organization_id, lower(name)) where archived_at is null;

create trigger products_touch before update on products
  for each row execute function app.touch_updated_at();

create table product_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  version int not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  currency text not null default 'NOK' check (currency = 'NOK'),
  price_once numeric(12, 2) check (price_once >= 0),
  price_monthly numeric(12, 2) check (price_monthly >= 0),
  binding_months int not null default 0 check (binding_months between 0 and 120),
  notice_months int not null default 0 check (notice_months between 0 and 24),
  withdrawal_days int not null default 14 check (withdrawal_days between 0 and 365),
  terms text not null default '' check (length(terms) <= 50000),
  -- What the seller must say: [{"id": "...", "text": "..."}]. AI control checks each point.
  required_points jsonb not null default '[]' check (jsonb_typeof(required_points) = 'array'),
  approved_phrases text[] not null default '{}',
  forbidden_phrases text[] not null default '{}',
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references users (id),
  published_at timestamptz,
  unique (product_id, version),
  unique (id, organization_id),
  foreign key (product_id, organization_id) references products (id, organization_id) on delete cascade,
  check (status = 'draft' or published_at is not null)
);
-- At most one published version and one draft per product.
create unique index product_template_versions_published on product_template_versions (product_id) where status = 'published';
create unique index product_template_versions_draft on product_template_versions (product_id) where status = 'draft';

create trigger product_template_versions_touch before update on product_template_versions
  for each row execute function app.touch_updated_at();

-- Published and retired versions are frozen. The only change allowed after publishing is
-- published -> retired (when a newer version is published). Nothing is ever deleted once
-- published.
create function app.guard_template_version() returns trigger
  language plpgsql
  as $$
  begin
    if tg_op = 'DELETE' then
      if old.status <> 'draft' then
        raise exception 'a published template version cannot be deleted' using errcode = 'check_violation';
      end if;
      return old;
    end if;
    if old.status = 'draft' then
      return new;
    end if;
    if old.status = 'published' and new.status = 'retired'
      and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;
    raise exception 'template version % is % and cannot be changed', old.version, old.status
      using errcode = 'check_violation';
  end
  $$;

create trigger product_template_versions_guard before update or delete on product_template_versions
  for each row execute function app.guard_template_version();

alter table products enable row level security;
alter table product_template_versions enable row level security;

-- Every member of the call centre sees products and versions (sellers pick them for sales);
-- products.manage changes them.
create policy products_select on products for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy products_write on products for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')));
create policy products_update on products for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')));

create policy template_versions_select on product_template_versions for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy template_versions_insert on product_template_versions for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')));
create policy template_versions_update on product_template_versions for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')));
create policy template_versions_delete on product_template_versions for delete to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('products.manage')));

grant select, insert, update on products to app_user;
grant select, insert, update, delete on product_template_versions to app_user;

create trigger products_audit after insert or update or delete on products
  for each row execute function app.audit_row_change();
create trigger product_template_versions_audit after insert or update or delete on product_template_versions
  for each row execute function app.audit_row_change();
