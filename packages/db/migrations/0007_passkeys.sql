-- Passkeys (WebAuthn) as a login method, decided 2 October 2026 (docs/auth.md). A passkey can
-- only be added in a session started with BankID, and a passkey login counts as strong
-- authentication like BankID: phishing-resistant, bound to the device, with user verification.

alter table sessions drop constraint sessions_provider_check,
  add constraint sessions_provider_check check (provider in ('vipps', 'bankid', 'passkey'));
alter table login_events drop constraint login_events_provider_check,
  add constraint login_events_provider_check check (provider in ('vipps', 'bankid', 'passkey'));

create table passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  -- Credential id as base64url, as the browser reports it.
  credential_id text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 16 and 1366),
  public_key bytea not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_user_idx on passkeys (user_id);

-- Single-use WebAuthn challenges, valid for five minutes (checked by the API).
create table webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  purpose text not null check (purpose in ('register', 'login')),
  user_id uuid references users (id),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table passkeys enable row level security;
alter table webauthn_challenges enable row level security;

-- Users see and remove their own passkeys, and add one only in a BankID session. Superadmins
-- see and remove anyone's (the Brukere tab).
create policy passkeys_own_select on passkeys for select to app_user
  using (user_id = app.current_user_id() or (select app.is_platform_admin()));
create policy passkeys_own_insert on passkeys for insert to app_user
  with check (user_id = app.current_user_id() and app.session_is_strong());
create policy passkeys_own_delete on passkeys for delete to app_user
  using (user_id = app.current_user_id() or (select app.is_platform_admin()));

-- The login role looks up the passkey and moves its signature counter forward.
create policy passkeys_login on passkeys for select to app_auth using (true);
create policy passkeys_login_use on passkeys for update to app_auth using (true) with check (true);
create policy webauthn_challenges_login on webauthn_challenges for all to app_auth using (true) with check (true);

grant select, insert, delete on passkeys to app_user;
grant select, update (counter, last_used_at) on passkeys to app_auth;
grant select, insert, update (used_at) on webauthn_challenges to app_auth;
grant select, update (status, last_login_at) on users to app_auth;

create trigger passkeys_audit after insert or delete on passkeys
  for each row execute function app.audit_row_change();
