-- E-mail (docs/plan.md, section 17): each time an invoice is e-mailed, to whom and when. Only
-- superadmins see it; append-only.

create table invoice_emails (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  organization_id uuid not null,
  sent_to text not null check (sent_to ~ '^[^@\s]+@[^@\s]+$'),
  message_id text check (length(message_id) <= 200),
  sent_by uuid references users (id),
  sent_at timestamptz not null default now(),
  foreign key (invoice_id, organization_id) references invoices (id, organization_id)
);
create index invoice_emails_invoice_idx on invoice_emails (invoice_id, sent_at);

alter table invoice_emails enable row level security;
create policy invoice_emails_platform on invoice_emails for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert on invoice_emails to app_user;

create trigger invoice_emails_audit after insert on invoice_emails
  for each row execute function app.audit_row_change();
