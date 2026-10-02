-- Invoicing, second version (docs/plan.md, section 16), after Nadeem's description of the
-- economy tab. The customer is the call centre:
-- - It gets a fixed customer number from 10001.
-- - Packages (a catalogue the superadmin maintains) switch on modules.
-- - An invoice can keep the call centre open through the period it covers.
-- - Invoices can be scheduled for a later date.
-- - Fixed agreements are sent automatically a set number of days before they fall due.
-- - An invoice that is still unpaid 5 days after its due date becomes "payment missed": the call
--   centre closes and its fixed agreements pause. A later payment opens it again, and the
--   agreements go on from their next due date, without the months that were skipped.

-- --- Customers --------------------------------------------------------------------------------

create sequence organization_customer_number start 10001;
alter table organizations
  add column customer_number int,
  -- When set, the call centre is open only until this moment (paid access from invoices).
  add column access_until timestamptz;
do $$
declare
  r record;
begin
  for r in select id from organizations order by created_at, id loop
    update organizations set customer_number = nextval('organization_customer_number') where id = r.id;
  end loop;
end
$$;
alter table organizations
  alter column customer_number set default nextval('organization_customer_number'),
  alter column customer_number set not null,
  add constraint organizations_customer_number_key unique (customer_number);
grant usage on sequence organization_customer_number to app_user;

create function app.guard_customer_number() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if new.customer_number <> old.customer_number then
      raise exception 'the customer number is fixed' using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;
create trigger organizations_customer_number before update of customer_number on organizations
  for each row execute function app.guard_customer_number();

create or replace function app.organization_open(org organizations) returns boolean
  language sql stable
  as $$
    select org.status = 'active' and (org.trial_ends_at is null or org.trial_ends_at > now())
      and (org.access_until is null or org.access_until > now())
  $$;

-- --- Packages ---------------------------------------------------------------------------------

create table billing_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  description text check (length(description) <= 1000),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  vat_rate numeric(4, 3) not null default 0.25 check (vat_rate between 0 and 1),
  -- Modules switched on for the call centre when an invoice with access is sent.
  modules text[] not null default '{}',
  active boolean not null default true,
  -- The matching price in Stripe, once Stripe is connected.
  stripe_price_id text check (length(stripe_price_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table billing_packages enable row level security;
create policy billing_packages_platform on billing_packages for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert, update on billing_packages to app_user;
create trigger billing_packages_audit after insert or update on billing_packages
  for each row execute function app.audit_row_change();

-- --- Settings ---------------------------------------------------------------------------------

alter table billing_settings
  add column invoice_fee numeric(12, 2) check (invoice_fee >= 0),
  add column recurring_days_before int not null default 14 check (recurring_days_before between 0 and 60),
  -- Every invoice e-mail is also sent here (blind copy), for example the bookkeeping inbox.
  add column copy_email text check (copy_email ~ '^[^@\s]+@[^@\s]+$'),
  add column logo bytea check (octet_length(logo) <= 500000),
  add column logo_type text check (logo_type in ('image/png', 'image/jpeg')),
  alter column next_number set default 1000001;
update billing_settings set next_number = 1000001
where next_number = 1 and not exists (select 1 from invoices where number is not null);

-- --- Invoices ---------------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'invoices'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%number IS NULL%' or pg_get_constraintdef(oid) like '%''credited''%')
  loop
    execute format('alter table invoices drop constraint %I', c.conname);
  end loop;
end
$$;
alter table invoices
  add constraint invoices_status_check
    check (status in ('draft', 'scheduled', 'sent', 'paid', 'credited', 'payment_missed')),
  add constraint invoices_number_check check ((status in ('draft', 'scheduled')) = (number is null)),
  -- Keeps the call centre open through the period (only invoices, not credit notes).
  add column grant_access boolean not null default false,
  add column period_start date,
  add column period_end date,
  add column missed_at timestamptz,
  add constraint invoices_period_check check (period_end is null or period_end >= period_start),
  add constraint invoices_access_kind check (not grant_access or kind = 'invoice');

alter table invoice_lines
  add column kind text not null default 'text' check (kind in ('package', 'text', 'fee')),
  add column package_id uuid references billing_packages (id),
  add constraint invoice_lines_package check ((kind = 'package') = (package_id is not null));

-- Number of days in the month a date is in (a package lasts that long).
create function app.days_in_month(d date) returns int
  language sql immutable
  as $$ select extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int $$;

-- Sending numbers the invoice and freezes it. Drafts and scheduled invoices (a future invoice
-- date, sent automatically that morning) can be changed. After sending, only the status moves.
create or replace function app.guard_invoice() returns trigger
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
    if old.status in ('draft', 'scheduled') and new.status in ('draft', 'scheduled') then
      if new.number is not null or new.seller is not null or new.recipient is not null or new.total is not null then
        raise exception 'a draft has no number' using errcode = 'check_violation';
      end if;
      if new.status = 'scheduled' and (new.issue_date is null or new.issue_date <= today) then
        raise exception 'a scheduled invoice needs a future invoice date' using errcode = 'check_violation';
      end if;
      new.updated_at := now();
      return new;
    end if;

    if old.status in ('draft', 'scheduled') and new.status = 'sent' then
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
      new.due_date := case
        when new.kind = 'credit' then today
        when new.due_date is null or new.due_date < today then today + s.due_days
        else new.due_date end;
      if new.grant_access then
        new.period_start := coalesce(new.period_start, today);
        new.period_end := coalesce(new.period_end, new.period_start + app.days_in_month(new.period_start) - 1);
      end if;
      new.seller := jsonb_build_object(
        'name', s.company_name, 'orgNumber', s.org_number, 'vatRegistered', s.vat_registered, 'address', s.address,
        'email', s.email, 'accountNumber', s.account_number, 'footer', s.footer
      );
      new.recipient := jsonb_build_object(
        'name', o.name, 'orgNumber', o.org_number, 'address', o.invoice_address, 'email', o.invoice_email,
        'contactName', o.contact_name, 'customerNumber', o.customer_number
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
    if new.status = 'payment_missed' and new.kind <> 'invoice' then
      raise exception 'only an invoice can be unpaid' using errcode = 'check_violation';
    end if;
    -- The link to a fixed agreement is cleared when the agreement is deleted; nothing else moves.
    if old.status not in ('draft', 'scheduled')
       and ((old.status = 'sent' and new.status in ('sent', 'paid', 'credited', 'payment_missed'))
            or (old.status = 'paid' and new.status in ('paid', 'credited'))
            or (old.status = 'payment_missed' and new.status in ('payment_missed', 'paid', 'credited')))
       and (new.recurring_id is null or new.recurring_id = old.recurring_id)
       and (to_jsonb(new) - 'status' - 'paid_at' - 'missed_at' - 'updated_at' - 'recurring_id')
         = (to_jsonb(old) - 'status' - 'paid_at' - 'missed_at' - 'updated_at' - 'recurring_id') then
      if new.status = 'payment_missed' and old.status <> 'payment_missed' then
        new.missed_at := now();
      end if;
      new.updated_at := now();
      return new;
    end if;
    raise exception 'a sent invoice cannot be changed' using errcode = 'check_violation';
  end
  $$;

-- Lines change only on drafts and scheduled invoices.
create or replace function app.guard_invoice_line() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    st text;
  begin
    -- Waits for a send in progress, so no line slips into an invoice as it is frozen.
    select status into st from invoices where id = coalesce(new.invoice_id, old.invoice_id) for share;
    if st is not null and st not in ('draft', 'scheduled') then
      raise exception 'the lines of a sent invoice cannot be changed' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.organization_id <> old.organization_id) then
      raise exception 'a line cannot be moved' using errcode = 'check_violation';
    end if;
    return coalesce(new, old);
  end
  $$;

create or replace function app.guard_invoice_delete() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if old.status not in ('draft', 'scheduled') then
      raise exception 'only drafts can be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end
  $$;

-- Payments go on sent (or unpaid) invoices; the invoice is paid when they cover it.
create or replace function app.apply_invoice_payment() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    inv invoices;
    paid numeric;
  begin
    select * into inv from invoices where id = new.invoice_id for update;
    if inv.kind <> 'invoice' or inv.status not in ('sent', 'paid', 'payment_missed') then
      raise exception 'payments go on sent invoices' using errcode = 'check_violation';
    end if;
    select coalesce(sum(amount), 0) + new.amount into paid from invoice_payments where invoice_id = new.invoice_id;
    if inv.status in ('sent', 'payment_missed') and paid >= inv.total then
      update invoices set status = 'paid', paid_at = now() where id = inv.id;
    end if;
    return new;
  end
  $$;

-- --- Fixed agreements -------------------------------------------------------------------------

-- next_date is now the next due date. The invoice is sent days_before (or the default in the
-- settings) before it.
alter table recurring_invoices
  add column days_before int check (days_before between 0 and 60),
  add column grant_access boolean not null default true,
  add column paused boolean not null default false;

-- The call centre's access and modules follow its invoices.
create function app.apply_invoice_access() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    r recurring_invoices;
    today date := app.oslo_today();
    resumed date;
    until timestamptz;
  begin
    if new.kind <> 'invoice' then
      return null;
    end if;
    if old.status in ('draft', 'scheduled') and new.status = 'sent' and new.grant_access then
      -- Open through the last day of the period, 23:59 Norwegian time.
      until := (new.period_end + 1)::timestamp at time zone 'Europe/Oslo';
      update organizations set access_until = greatest(coalesce(access_until, until), until), trial_ends_at = null
      where id = new.organization_id;
      insert into organization_modules (organization_id, module, enabled)
      select distinct new.organization_id, m, true
      from invoice_lines l join billing_packages p on p.id = l.package_id, unnest(p.modules) m
      where l.invoice_id = new.id
      on conflict (organization_id, module) do update set enabled = true, updated_at = now();
    elsif new.status = 'payment_missed' and old.status <> 'payment_missed' and new.grant_access then
      update organizations set access_until = now() where id = new.organization_id;
      update recurring_invoices set paused = true, updated_at = now() where organization_id = new.organization_id and active;
    elsif old.status = 'payment_missed' and new.status = 'paid' then
      -- Fixed agreements go on from their next due date; skipped months are not invoiced.
      for r in select * from recurring_invoices where organization_id = new.organization_id and paused for update loop
        while r.next_date < today loop
          r.billed_periods := r.billed_periods + 1;
          r.next_date := (r.start_date + make_interval(months => r.billed_periods * r.interval_months))::date;
        end loop;
        update recurring_invoices set paused = false, billed_periods = r.billed_periods, next_date = r.next_date, updated_at = now()
        where id = r.id;
        resumed := least(coalesce(resumed, r.next_date), r.next_date);
      end loop;
      -- Open again through the paid period, or until the next agreement invoice is due.
      until := greatest(
        coalesce((new.period_end + 1)::timestamp at time zone 'Europe/Oslo', now()),
        coalesce((resumed + 1)::timestamp at time zone 'Europe/Oslo', now())
      );
      if new.grant_access and until > now() then
        update organizations set access_until = until where id = new.organization_id;
      end if;
    end if;
    return null;
  end
  $$;
create trigger invoices_access after update of status on invoices
  for each row execute function app.apply_invoice_access();

-- Creates a draft from a fixed agreement (lines from the agreement, packages at their price).
create function app.draft_from_agreement(r recurring_invoices, due date) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    draft uuid;
  begin
    insert into invoices (organization_id, recurring_id, note, due_date, grant_access, created_by)
    values (r.organization_id, r.id, r.name, due, r.grant_access, app.current_user_id())
    returning id into draft;
    insert into invoice_lines (invoice_id, organization_id, position, kind, package_id, description, quantity, unit_price, vat_rate)
    select draft, r.organization_id, (l.ord - 1)::int,
           coalesce(l.value->>'kind', case when l.value ? 'packageId' then 'package' else 'text' end),
           (l.value->>'packageId')::uuid, l.value->>'description', (l.value->>'quantity')::numeric,
           (l.value->>'unitPrice')::numeric, coalesce((l.value->>'vatRate')::numeric, 0.25)
    from jsonb_array_elements(r.lines) with ordinality l(value, ord);
    return draft;
  end
  $$;

-- The morning run (and "Kjør nå"):
-- 1. Sends scheduled invoices whose date has come.
-- 2. Sends fixed agreements that are due to go out (one invoice each, the next due date).
-- 3. Marks invoices with access as "payment missed" 5 days after their due date.
-- Returns the invoices it sent, for e-mailing.
create function app.billing_daily() returns setof uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    today date := app.oslo_today();
    default_days int;
    r recurring_invoices;
    inv_id uuid;
  begin
    if not (app.is_platform_admin() or pg_has_role(session_user, 'app_worker', 'member')) then
      raise exception 'only superadmins and the worker run invoicing' using errcode = 'insufficient_privilege';
    end if;
    select recurring_days_before into default_days from billing_settings;

    for inv_id in select i.id from invoices i where i.status = 'scheduled' and i.issue_date <= today order by i.created_at for update loop
      update invoices set status = 'sent' where invoices.id = inv_id;
      return next inv_id;
    end loop;

    for r in
      select * from recurring_invoices
      where active and not paused and next_date - coalesce(days_before, default_days) <= today
      order by next_date
      for update
    loop
      inv_id := app.draft_from_agreement(r, greatest(r.next_date, today));
      update invoices set status = 'sent' where invoices.id = inv_id;
      return next inv_id;
      -- The next one; skipped periods (the job did not run) are not invoiced afterwards.
      loop
        r.billed_periods := r.billed_periods + 1;
        r.next_date := (r.start_date + make_interval(months => r.billed_periods * r.interval_months))::date;
        exit when r.next_date - coalesce(r.days_before, default_days) > today;
      end loop;
      update recurring_invoices set billed_periods = r.billed_periods, next_date = r.next_date, updated_at = now() where recurring_invoices.id = r.id;
    end loop;

    update invoices set status = 'payment_missed'
    where status = 'sent' and kind = 'invoice' and grant_access and due_date + 5 < today;
    return;
  end
  $$;

drop function app.generate_recurring_invoices(date);
revoke all on function app.billing_daily() from public;
grant execute on function app.billing_daily() to app_user, app_worker;
revoke all on function app.draft_from_agreement(recurring_invoices, date) from public;

-- The worker reads what it e-mails, and logs it.
create policy invoices_worker on invoices for select to app_worker using (true);
create policy invoice_lines_worker on invoice_lines for select to app_worker using (true);
create policy invoice_payments_worker on invoice_payments for select to app_worker using (true);
create policy billing_settings_worker on billing_settings for select to app_worker using (true);
create policy invoice_emails_worker on invoice_emails for all to app_worker using (true) with check (true);
grant select on invoices, invoice_lines, invoice_payments, billing_settings to app_worker;
grant select, insert on invoice_emails to app_worker;
grant select (org_number, invoice_email, invoice_address, customer_number) on organizations to app_worker;

-- The logo is on every invoice, also the call centre's own copy: readable by everyone who can
-- open an invoice, without the rest of the settings.
create function app.invoice_logo(out logo bytea, out logo_type text)
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select logo, logo_type from billing_settings $$;
revoke all on function app.invoice_logo() from public;
grant execute on function app.invoice_logo() to app_user, app_worker;
