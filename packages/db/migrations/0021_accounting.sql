-- Economy, Regnskap (docs/plan.md, section 16): costs against revenue.
-- - Revenue is counted when the money arrives: invoice payments, and manual income entries.
--   VAT is kept apart.
-- - Costs are usage (from Forbruk), manual costs and adjustments (a negative amount is a credit
--   or refund), and fixed monthly costs entered once.

create table accounting_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cost', 'income')),
  description text not null check (length(trim(description)) between 1 and 300),
  -- Income includes VAT at vat_rate; costs are what was paid.
  amount numeric(12, 2) not null check (amount <> 0),
  currency text not null default 'NOK' check (currency in ('NOK', 'USD')),
  vat_rate numeric(4, 3) not null default 0 check (vat_rate between 0 and 1),
  occurred_on date not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (kind = 'income' or vat_rate = 0),
  check (kind = 'cost' or currency = 'NOK')
);
create index accounting_entries_day_idx on accounting_entries (occurred_on);

create table fixed_costs (
  id uuid primary key default gen_random_uuid(),
  description text not null check (length(trim(description)) between 1 and 300),
  -- Per month.
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'NOK' check (currency in ('NOK', 'USD')),
  -- From and including this month (the first day of it); until and including ends_month.
  starts_month date not null check (extract(day from starts_month) = 1),
  ends_month date check (ends_month is null or (extract(day from ends_month) = 1 and ends_month >= starts_month)),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table accounting_entries enable row level security;
alter table fixed_costs enable row level security;
create policy accounting_entries_platform on accounting_entries for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy fixed_costs_platform on fixed_costs for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert, update, delete on accounting_entries, fixed_costs to app_user;

create trigger accounting_entries_audit after insert or update or delete on accounting_entries
  for each row execute function app.audit_row_change();
create trigger fixed_costs_audit after insert or update or delete on fixed_costs
  for each row execute function app.audit_row_change();
