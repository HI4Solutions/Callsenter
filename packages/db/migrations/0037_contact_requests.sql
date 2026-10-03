-- The contact form on the landing page (docs/plan.md, section 20). Visitors are not users: the
-- API inserts through app_auth and a security definer function, like the customer's confirmation
-- (0014). Superadmins read the requests and mark them handled.

create table contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  email text not null check (length(email) between 3 and 320 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone text check (length(phone) <= 40),
  company text check (length(company) <= 200),
  message text not null check (length(trim(message)) between 1 and 4000),
  -- The language of the page the visitor wrote in: superadmin answers in it.
  locale text references locales (code),
  ip inet,
  user_agent text,
  handled_at timestamptz,
  handled_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index contact_requests_open_idx on contact_requests (created_at desc) where handled_at is null;
create index contact_requests_ip_idx on contact_requests (ip, created_at desc);

alter table contact_requests enable row level security;
create policy contact_requests_platform on contact_requests for all to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, update (handled_at, handled_by) on contact_requests to app_user;

create trigger contact_requests_audit after update or delete on contact_requests
  for each row execute function app.audit_row_change();

-- From the form, without a session. At most 10 requests an hour from one address, so the form
-- cannot be used to fill the table.
create function app.contact_request_create(
  p_name text, p_email text, p_phone text, p_company text, p_message text, p_locale text, p_ip inet, p_user_agent text
) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    id uuid;
  begin
    if p_ip is not null and (select count(*) from contact_requests where ip = p_ip and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'too many contact requests' using errcode = 'check_violation';
    end if;
    insert into contact_requests (name, email, phone, company, message, locale, ip, user_agent)
    values (trim(p_name), trim(p_email), nullif(trim(p_phone), ''), nullif(trim(p_company), ''), trim(p_message),
            case when exists (select 1 from locales where code = p_locale) then p_locale end, p_ip, left(p_user_agent, 500))
    returning contact_requests.id into id;
    return id;
  end
  $$;
revoke all on function app.contact_request_create(text, text, text, text, text, text, inet, text) from public;
grant execute on function app.contact_request_create(text, text, text, text, text, text, inet, text) to app_auth;

-- Who is told about a new request: every superadmin with an e-mail address.
create function app.contact_request_recipients() returns setof text
  language sql security definer set search_path = pg_catalog, public stable
  as $$
    select u.email from platform_admins pa join users u on u.id = pa.user_id
    where u.email is not null and u.status = 'active' order by u.email
  $$;
revoke all on function app.contact_request_recipients() from public;
grant execute on function app.contact_request_recipients() to app_auth;
