-- Correspondence with people who used the landing page's contact form (docs/plan.md, section 20),
-- one thread per e-mail address. The thread holds their form requests (contact_requests, 0037),
-- the e-mails superadmins send from the portal, and the e-mails they send back, which SES
-- receives and the worker stores. Superadmins see it as a chat; the other side sees e-mail.

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  -- The other party's address, in lower case: the thread.
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  -- 'out': sent by a superadmin from the portal. 'in': an e-mail received from the address.
  direction text not null check (direction in ('in', 'out')),
  -- The sender's name on an incoming e-mail.
  name text check (length(name) <= 200),
  subject text check (length(subject) <= 500),
  body text not null check (length(body) between 1 and 50000),
  -- Outgoing: the e-mail exactly as it was sent, for "Vis e-post".
  html text,
  sent_by uuid references users (id),
  -- SES' message id (out), or the incoming message's id (in); null when sending failed.
  message_id text,
  -- Incoming messages until a superadmin has seen them.
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (direction = 'in' or sent_by is not null)
);
create index contact_messages_thread_idx on contact_messages (email, created_at);
create index contact_messages_unread_idx on contact_messages (email) where direction = 'in' and read_at is null;
create unique index contact_messages_incoming_key on contact_messages (message_id) where direction = 'in';

alter table contact_messages enable row level security;
create policy contact_messages_platform on contact_messages for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, insert on contact_messages to app_user;
grant update (message_id, read_at) on contact_messages to app_user;

create trigger contact_messages_audit after insert or update or delete on contact_messages
  for each row execute function app.audit_row_change();

-- An e-mail received by SES, stored by the worker. A message already stored (SES may deliver
-- twice) is ignored. Returns whether it was new.
create function app.contact_message_receive(p_email text, p_name text, p_subject text, p_body text, p_message_id text)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    added int;
  begin
    insert into contact_messages (email, direction, name, subject, body, message_id)
    values (lower(trim(p_email)), 'in', left(nullif(trim(p_name), ''), 200), left(nullif(trim(p_subject), ''), 500),
            left(coalesce(nullif(trim(p_body), ''), '(tom)'), 50000), p_message_id)
    on conflict (message_id) where direction = 'in' do nothing;
    get diagnostics added = row_count;
    return added > 0;
  end
  $$;
revoke all on function app.contact_message_receive(text, text, text, text, text) from public;
grant execute on function app.contact_message_receive(text, text, text, text, text) to app_worker;

-- The worker tells superadmins about a new e-mail, like the API does for a new request.
grant execute on function app.contact_request_recipients() to app_worker;
