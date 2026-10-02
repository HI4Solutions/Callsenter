-- Phase 3, sale verification (docs/plan.md, section 14, module 8): the customer gets the offer as
-- a link, reads it, and accepts it in writing by identifying with BankID or Vipps (or declines).
-- The document the customer saw is frozen with its hash, together with how, when and from where
-- it was accepted. The customer is not a user: the public pages go through the narrow login role
-- (app_auth) and security definer functions that take the hash of the secret link token.

create table sale_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sale_id uuid not null,
  token_hash bytea not null unique check (length(token_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'revoked')),
  -- The offer exactly as the customer is shown it, and the SHA-256 of its canonical JSON.
  document jsonb not null,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  template_version_id uuid not null,
  sent_via text not null default 'link' check (sent_via in ('link', 'sms')),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  viewed_at timestamptz,
  decided_at timestamptz,
  -- How the customer decided: identified with BankID or Vipps, or declined without identifying.
  method text check (method in ('bankid', 'vipps', 'none')),
  identity_name text check (length(identity_name) <= 200),
  identity_phone text check (length(identity_phone) <= 30),
  -- SHA-256 of provider and subject: the same person can be recognised without storing the id.
  identity_ref text check (identity_ref ~ '^[0-9a-f]{64}$'),
  acr text check (length(acr) <= 200),
  -- Whether the identity matches the customer: the verified phone number (Vipps) or the name.
  identity_match text check (identity_match in ('phone', 'name', 'none')),
  ip inet,
  user_agent text check (length(user_agent) <= 500),
  unique (id, organization_id),
  foreign key (sale_id, organization_id) references sales (id, organization_id) on delete cascade,
  foreign key (template_version_id, organization_id) references product_template_versions (id, organization_id),
  check (status = 'pending' or decided_at is not null or status = 'revoked')
);
create index sale_confirmations_sale_idx on sale_confirmations (sale_id, created_at desc);
create unique index sale_confirmations_pending on sale_confirmations (sale_id) where status = 'pending';

-- Decided confirmations are evidence: nothing about them changes. A pending one can only be
-- revoked by the call centre or decided by the customer (through the functions below).
create function app.guard_sale_confirmation() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if old.status <> 'pending' then
      raise exception 'a decided confirmation cannot be changed' using errcode = 'check_violation';
    end if;
    if (to_jsonb(new) - 'status' - 'viewed_at' - 'decided_at' - 'method' - 'identity_name' - 'identity_phone'
        - 'identity_ref' - 'acr' - 'identity_match' - 'ip' - 'user_agent')
      <> (to_jsonb(old) - 'status' - 'viewed_at' - 'decided_at' - 'method' - 'identity_name' - 'identity_phone'
        - 'identity_ref' - 'acr' - 'identity_match' - 'ip' - 'user_agent') then
      raise exception 'the confirmed document cannot be changed' using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;
create trigger sale_confirmations_guard before update on sale_confirmations
  for each row execute function app.guard_sale_confirmation();
create trigger sale_confirmations_audit after insert or update on sale_confirmations
  for each row execute function app.audit_row_change();

alter table sale_confirmations enable row level security;
-- Visible with the sale; created and revoked with sales.manage.
create policy sale_confirmations_select on sale_confirmations for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from sales s where s.id = sale_id));
create policy sale_confirmations_insert on sale_confirmations for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage'))
    and exists (select 1 from sales s where s.id = sale_id)
  );
create policy sale_confirmations_update on sale_confirmations for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage'))
         and exists (select 1 from sales s where s.id = sale_id))
  with check (organization_id = (select app.current_org_id()) and status in ('pending', 'revoked'));
grant select, insert on sale_confirmations to app_user;
grant update (status) on sale_confirmations to app_user;

-- An identification started from a confirmation link goes through the normal OIDC callback; the
-- state says which confirmation it belongs to, and no session is created.
alter table auth_states add column confirmation_id uuid references sale_confirmations (id) on delete cascade;

-- --- Public functions for the customer (app_auth) ---------------------------------------------

-- The offer behind a link, for the confirmation page. Marks it viewed the first time.
create function app.confirmation_view(token bytea) returns jsonb
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    c sale_confirmations;
  begin
    select * into c from sale_confirmations where token_hash = token;
    if not found then
      return null;
    end if;
    if c.status = 'pending' and c.viewed_at is null and c.expires_at > now() then
      update sale_confirmations set viewed_at = now() where id = c.id;
    end if;
    return jsonb_build_object(
      'id', c.id,
      'status', case when c.status = 'pending' and c.expires_at <= now() then 'expired' else c.status end,
      'document', c.document,
      'documentHash', c.document_hash,
      'expiresAt', c.expires_at,
      'decidedAt', c.decided_at,
      'method', c.method
    );
  end
  $$;

-- The customer's decision. Accepting needs a verified identity; declining does not. The sale
-- follows: accepted → confirmed, declined → rejected (when it is still waiting for this).
create function app.confirmation_decide(
  confirmation uuid, decision text, how text, who text, verified_phone text, ref text, level text, from_ip inet, agent text
) returns text
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    c sale_confirmations;
    customer record;
    matched text := 'none';
    event_note text;
  begin
    if decision not in ('accepted', 'rejected') then
      raise exception 'unknown decision' using errcode = 'check_violation';
    end if;
    if decision = 'accepted' and (how not in ('bankid', 'vipps') or ref is null) then
      raise exception 'acceptance needs a verified identity' using errcode = 'check_violation';
    end if;
    select * into c from sale_confirmations where id = confirmation for update;
    if not found or c.status <> 'pending' then
      return 'not_pending';
    end if;
    if c.expires_at <= now() then
      return 'expired';
    end if;

    if decision = 'accepted' then
      select cu.name, cu.phone into customer
      from sales s join customers cu on cu.id = s.customer_id where s.id = c.sale_id;
      if verified_phone is not null and customer.phone is not null and verified_phone = customer.phone then
        matched := 'phone';
      elsif who is not null and customer.name is not null and lower(trim(who)) = lower(trim(customer.name)) then
        matched := 'name';
      end if;
    end if;

    update sale_confirmations set
      status = decision, decided_at = now(),
      method = case when decision = 'accepted' then how else 'none' end,
      identity_name = case when decision = 'accepted' then left(who, 200) end,
      identity_phone = case when decision = 'accepted' then left(verified_phone, 30) end,
      identity_ref = case when decision = 'accepted' then ref end,
      acr = case when decision = 'accepted' then left(level, 200) end,
      identity_match = case when decision = 'accepted' then matched end,
      ip = from_ip, user_agent = left(agent, 500)
    where id = c.id;

    event_note := case
      when decision = 'accepted' then 'Godtatt skriftlig av kunden med ' || case how when 'bankid' then 'BankID' else 'Vipps' end
      else 'Avslått av kunden' end;
    update sales set status = case when decision = 'accepted' then 'confirmed' else 'rejected' end, status_note = event_note
    where id = c.sale_id and status = 'awaiting_confirmation';
    return decision;
  end
  $$;

revoke all on function app.confirmation_view(bytea), app.confirmation_decide(uuid, text, text, text, text, text, text, inet, text) from public;
grant execute on function app.confirmation_view(bytea), app.confirmation_decide(uuid, text, text, text, text, text, text, inet, text) to app_auth;
