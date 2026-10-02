-- Phase 4, invoicing (docs/plan.md, section 16, module 15): MedInnova invoices the call centres.
-- Superadmins write drafts (by hand, from fixed agreements, or with usage), send them, register
-- payments and credit them. A sent invoice gets the next number in one unbroken sequence (credit
-- notes included) and is frozen: the seller, the recipient, the lines and the totals never change
-- afterwards. Call centre admins with billing.read see their own sent invoices.

-- Invoices are dated in Norwegian time (the database runs in UTC).
create function app.oslo_today() returns date
  language sql stable set search_path = pg_catalog
  as $$ select (now() at time zone 'Europe/Oslo')::date $$;
grant execute on function app.oslo_today() to app_user;

-- --- Settings: the seller on the invoice ------------------------------------------------------

create table billing_settings (
  id boolean primary key default true check (id),
  company_name text check (length(trim(company_name)) between 1 and 200),
  org_number text check (org_number ~ '^[0-9]{9}$'),
  vat_registered boolean not null default true,
  address text check (length(address) <= 500),
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  account_number text check (account_number ~ '^[0-9]{11}$'),
  due_days int not null default 14 check (due_days between 0 and 90),
  -- The number the next sent invoice gets.
  next_number int not null default 1 check (next_number > 0),
  -- Shown at the bottom of every invoice.
  footer text check (length(footer) <= 1000),
  -- Prices for usage lines, excluding VAT. Null: not billed.
  price_audio_hour numeric(12, 2) check (price_audio_hour >= 0),
  price_ai_control numeric(12, 2) check (price_ai_control >= 0),
  updated_at timestamptz not null default now()
);
insert into billing_settings default values;

-- --- Invoices --------------------------------------------------------------------------------

create table recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  -- [{"description": text, "quantity": number, "unitPrice": number, "vatRate": number}]
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  interval_months int not null check (interval_months in (1, 3, 6, 12)),
  -- Periods are counted from the start date, so an agreement starting on the 31st keeps billing
  -- from the last day of short months and back to the 31st (no drift).
  start_date date not null,
  billed_periods int not null default 0 check (billed_periods >= 0),
  -- The start of the next period to invoice: start_date + billed_periods intervals.
  next_date date not null,
  active boolean not null default true,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  kind text not null default 'invoice' check (kind in ('invoice', 'credit')),
  credit_of uuid references invoices (id),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'credited')),
  number int unique,
  issue_date date,
  due_date date,
  -- Frozen when sent.
  seller jsonb,
  recipient jsonb,
  subtotal numeric(12, 2),
  vat numeric(12, 2),
  total numeric(12, 2),
  note text check (length(note) <= 2000),
  recurring_id uuid references recurring_invoices (id) on delete set null,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'draft') = (number is null)),
  check ((kind = 'credit') = (credit_of is not null))
);
create index invoices_org_idx on invoices (organization_id, created_at desc);
create unique index invoices_one_credit on invoices (credit_of) where credit_of is not null;

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  organization_id uuid not null,
  position int not null default 0,
  description text not null check (length(trim(description)) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity <> 0),
  unit_price numeric(12, 2) not null,
  vat_rate numeric(4, 3) not null default 0.25 check (vat_rate between 0 and 1),
  foreign key (invoice_id, organization_id) references invoices (id, organization_id) on delete cascade
);
create index invoice_lines_invoice_idx on invoice_lines (invoice_id, position);

create table invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  organization_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null,
  method text not null default 'bank' check (method in ('bank', 'stripe', 'other')),
  reference text check (length(reference) <= 200),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  foreign key (invoice_id, organization_id) references invoices (id, organization_id)
);
create index invoice_payments_invoice_idx on invoice_payments (invoice_id);

-- --- Rules ------------------------------------------------------------------------------------

-- Sending numbers the invoice, freezes the seller and the recipient, and fixes the totals.
-- After that only the status moves: sent → paid (by payments) or → credited (by a credit note).
create function app.guard_invoice() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    s billing_settings;
    o organizations;
    original invoices;
    vat_on boolean;
    today date := app.oslo_today();
    t record;
  begin
    if new.organization_id <> old.organization_id or new.kind <> old.kind or new.credit_of is distinct from old.credit_of then
      raise exception 'the invoice cannot be moved' using errcode = 'check_violation';
    end if;
    if old.status = 'draft' and new.status = 'draft' then
      if new.number is not null or new.seller is not null or new.recipient is not null or new.total is not null then
        raise exception 'a draft has no number' using errcode = 'check_violation';
      end if;
      new.updated_at := now();
      return new;
    end if;

    if old.status = 'draft' and new.status = 'sent' then
      select * into s from billing_settings for update;
      if s.company_name is null or s.org_number is null or s.account_number is null then
        raise exception 'billing settings are incomplete' using errcode = 'check_violation';
      end if;
      vat_on := s.vat_registered;
      -- A credit note mirrors the invoice it cancels: same seller, recipient and VAT treatment.
      if new.kind = 'credit' then
        select * into original from invoices where id = new.credit_of;
        vat_on := coalesce((original.seller->>'vatRegistered')::boolean, s.vat_registered);
      end if;
      select count(*) as n,
             coalesce(sum(round(quantity * unit_price, 2)), 0) as subtotal,
             coalesce(sum(round(round(quantity * unit_price, 2) * case when vat_on then vat_rate else 0 end, 2)), 0) as vat
        into t from invoice_lines where invoice_id = old.id;
      if t.n = 0 then
        raise exception 'an invoice needs at least one line' using errcode = 'check_violation';
      end if;
      select * into o from organizations where id = old.organization_id;
      new.number := s.next_number;
      update billing_settings set next_number = next_number + 1;
      new.issue_date := today;
      new.due_date := case when new.kind = 'credit' then today else greatest(coalesce(new.due_date, today + s.due_days), today) end;
      new.seller := jsonb_build_object(
        'name', s.company_name, 'orgNumber', s.org_number, 'vatRegistered', s.vat_registered, 'address', s.address,
        'email', s.email, 'accountNumber', s.account_number, 'footer', s.footer
      );
      new.recipient := jsonb_build_object(
        'name', o.name, 'orgNumber', o.org_number, 'address', o.invoice_address, 'email', o.invoice_email,
        'contactName', o.contact_name
      );
      if new.kind = 'credit' then
        new.seller := coalesce(original.seller, new.seller);
        new.recipient := coalesce(original.recipient, new.recipient);
      end if;
      new.subtotal := t.subtotal;
      new.vat := t.vat;
      new.total := t.subtotal + t.vat;
      new.sent_at := now();
      new.updated_at := now();
      return new;
    end if;

    -- Credited only by a sent credit note (app.credit_invoice), never by hand.
    if new.status = 'credited' and old.status <> 'credited'
       and not exists (select 1 from invoices c where c.credit_of = old.id and c.status = 'sent') then
      raise exception 'an invoice is credited with a credit note' using errcode = 'check_violation';
    end if;
    -- The link to a fixed agreement is cleared when the agreement is deleted; nothing else moves.
    if old.status <> 'draft'
       and ((old.status = 'sent' and new.status in ('sent', 'paid', 'credited')) or (old.status = 'paid' and new.status in ('paid', 'credited')))
       and (new.recurring_id is null or new.recurring_id = old.recurring_id)
       and (to_jsonb(new) - 'status' - 'paid_at' - 'updated_at' - 'recurring_id') = (to_jsonb(old) - 'status' - 'paid_at' - 'updated_at' - 'recurring_id') then
      new.updated_at := now();
      return new;
    end if;
    raise exception 'a sent invoice cannot be changed' using errcode = 'check_violation';
  end
  $$;
create trigger invoices_guard before update on invoices
  for each row execute function app.guard_invoice();

create function app.guard_invoice_delete() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if old.status <> 'draft' then
      raise exception 'only drafts can be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end
  $$;
create trigger invoices_guard_delete before delete on invoices
  for each row execute function app.guard_invoice_delete();

-- Lines change only while the invoice is a draft (and when a draft is deleted).
create function app.guard_invoice_line() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    st text;
  begin
    -- Waits for a send in progress, so no line slips into an invoice as it is frozen.
    select status into st from invoices where id = coalesce(new.invoice_id, old.invoice_id) for share;
    if st is not null and st <> 'draft' then
      raise exception 'the lines of a sent invoice cannot be changed' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.organization_id <> old.organization_id) then
      raise exception 'a line cannot be moved' using errcode = 'check_violation';
    end if;
    return coalesce(new, old);
  end
  $$;
create trigger invoice_lines_guard before insert or update or delete on invoice_lines
  for each row execute function app.guard_invoice_line();

-- Payments go on sent invoices (not credit notes); the invoice is paid when they cover it.
create function app.apply_invoice_payment() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    inv invoices;
    paid numeric;
  begin
    select * into inv from invoices where id = new.invoice_id for update;
    if inv.kind <> 'invoice' or inv.status not in ('sent', 'paid') then
      raise exception 'payments go on sent invoices' using errcode = 'check_violation';
    end if;
    select coalesce(sum(amount), 0) + new.amount into paid from invoice_payments where invoice_id = new.invoice_id;
    if inv.status = 'sent' and paid >= inv.total then
      update invoices set status = 'paid', paid_at = now() where id = inv.id;
    end if;
    return new;
  end
  $$;
create trigger invoice_payments_apply before insert on invoice_payments
  for each row execute function app.apply_invoice_payment();

-- A credit note cancels a sent invoice: same lines with the opposite sign, numbered at once.
create function app.credit_invoice(original uuid, reason text) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    inv invoices;
    credit uuid;
  begin
    if not app.is_platform_admin() then
      raise exception 'only superadmins can credit invoices' using errcode = 'insufficient_privilege';
    end if;
    select * into inv from invoices where id = original for update;
    if not found or inv.kind <> 'invoice' or inv.status not in ('sent', 'paid') then
      raise exception 'only a sent invoice can be credited' using errcode = 'check_violation';
    end if;
    insert into invoices (organization_id, kind, credit_of, note, created_by)
    values (inv.organization_id, 'credit', inv.id, left(coalesce(nullif(trim(reason), ''), 'Kreditnota for faktura ' || inv.number), 2000), app.current_user_id())
    returning id into credit;
    insert into invoice_lines (invoice_id, organization_id, position, description, quantity, unit_price, vat_rate)
    select credit, organization_id, position, description, -quantity, unit_price, vat_rate from invoice_lines where invoice_id = inv.id;
    update invoices set status = 'sent' where id = credit;
    update invoices set status = 'credited' where id = inv.id;
    return credit;
  end
  $$;

-- Drafts from the fixed agreements that are due, one per period, moving each to its next date.
create function app.generate_recurring_invoices(upto date) returns int
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    r recurring_invoices;
    draft uuid;
    made int := 0;
  begin
    if not app.is_platform_admin() then
      raise exception 'only superadmins can generate invoices' using errcode = 'insufficient_privilege';
    end if;
    for r in select * from recurring_invoices where active and next_date <= upto order by next_date for update loop
      while r.next_date <= upto loop
        insert into invoices (organization_id, recurring_id, note, created_by)
        values (
          r.organization_id, r.id,
          r.name || ', ' || to_char(r.next_date, 'DD.MM.YYYY') || '–'
            || to_char((r.start_date + make_interval(months => (r.billed_periods + 1) * r.interval_months))::date - 1, 'DD.MM.YYYY'),
          app.current_user_id()
        )
        returning id into draft;
        insert into invoice_lines (invoice_id, organization_id, position, description, quantity, unit_price, vat_rate)
        select draft, r.organization_id, (l.ord - 1)::int, l.value->>'description', (l.value->>'quantity')::numeric,
               (l.value->>'unitPrice')::numeric, coalesce((l.value->>'vatRate')::numeric, 0.25)
        from jsonb_array_elements(r.lines) with ordinality l(value, ord);
        r.billed_periods := r.billed_periods + 1;
        r.next_date := (r.start_date + make_interval(months => r.billed_periods * r.interval_months))::date;
        made := made + 1;
      end loop;
      update recurring_invoices set billed_periods = r.billed_periods, next_date = r.next_date, updated_at = now() where id = r.id;
    end loop;
    return made;
  end
  $$;

revoke all on function app.credit_invoice(uuid, text), app.generate_recurring_invoices(date) from public;
grant execute on function app.credit_invoice(uuid, text), app.generate_recurring_invoices(date) to app_user;

-- --- Access -----------------------------------------------------------------------------------

alter table billing_settings enable row level security;
alter table recurring_invoices enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table invoice_payments enable row level security;

create policy billing_settings_platform on billing_settings for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy recurring_invoices_platform on recurring_invoices for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
-- New invoices start as drafts; sending and crediting go through the rules above.
create policy invoices_platform on invoices for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy invoices_insert_draft on invoices as restrictive for insert to app_user
  with check (status = 'draft' and kind = 'invoice' and credit_of is null);
create policy invoice_lines_platform on invoice_lines for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy invoice_payments_platform on invoice_payments for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));

-- The call centre sees its own sent invoices with billing.read (which needs BankID or a passkey).
create policy invoices_billing_read on invoices for select to app_user
  using (organization_id = (select app.current_org_id()) and status <> 'draft' and (select app.has_permission('billing.read')));
create policy invoice_lines_billing_read on invoice_lines for select to app_user
  using (exists (select 1 from invoices i where i.id = invoice_id));
create policy invoice_payments_billing_read on invoice_payments for select to app_user
  using (exists (select 1 from invoices i where i.id = invoice_id));

grant select, update on billing_settings to app_user;
grant select, insert, update, delete on recurring_invoices, invoices, invoice_lines to app_user;
grant select, insert on invoice_payments to app_user;

create trigger billing_settings_audit after update on billing_settings
  for each row execute function app.audit_row_change();
create trigger recurring_invoices_audit after insert or update or delete on recurring_invoices
  for each row execute function app.audit_row_change();
create trigger invoices_audit after insert or update or delete on invoices
  for each row execute function app.audit_row_change();
create trigger invoice_lines_audit after insert or update or delete on invoice_lines
  for each row execute function app.audit_row_change();
create trigger invoice_payments_audit after insert on invoice_payments
  for each row execute function app.audit_row_change();
