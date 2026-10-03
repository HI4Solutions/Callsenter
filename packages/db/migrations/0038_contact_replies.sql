-- Replies to the landing page's contact requests, sent by superadmins from the portal
-- (docs/plan.md, section 20). Each reply is an e-mail to the visitor; the row is the record of
-- what was sent, by whom and when. Answers from the visitor arrive in the superadmin's own inbox
-- (the reply's Reply-To) until incoming e-mail is set up.

create table contact_replies (
  id uuid primary key default gen_random_uuid(),
  contact_request_id uuid not null references contact_requests (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 10000),
  sent_to text not null,
  sent_by uuid references users (id),
  -- The address answers go to: the superadmin who wrote the reply.
  reply_to text,
  -- SES' message id; null when the e-mail could not be sent.
  message_id text,
  created_at timestamptz not null default now()
);
create index contact_replies_request_idx on contact_replies (contact_request_id, created_at);

alter table contact_replies enable row level security;
create policy contact_replies_platform on contact_replies for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert on contact_replies to app_user;
grant update (message_id) on contact_replies to app_user;

create trigger contact_replies_audit after insert or update or delete on contact_replies
  for each row execute function app.audit_row_change();
