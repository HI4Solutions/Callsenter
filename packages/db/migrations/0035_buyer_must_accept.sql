-- Only the buyer can accept a sale (Nadeem, 3 October; docs/plan.md, section 14). Before, an
-- acceptance by someone whose name and phone did not match the customer still confirmed the sale,
-- with a warning to the seller. Now it is refused: the link stays open for the buyer, the sale
-- keeps waiting, and the attempt is written to the sale's history (without the other person's
-- name). The buyer is the customer for a person, and the contact person for a business.

-- The words of a name, without accents and case, for comparing names from BankID or Vipps with
-- the name the call centre registered. Mirrors nameWords in apps/api/src/auth/flow.ts.
create function app.name_words(name text) returns text[]
  language sql immutable set search_path = pg_catalog
  as $$
    select coalesce(array_remove(
      regexp_split_to_array(lower(regexp_replace(normalize(coalesce(name, ''), NFKD), '[̀-ͯ]', '', 'g')), '[^[:alpha:]]+'),
      ''), '{}')
  $$;

-- Whether a verified name is the registered person: its first and last name are both in the
-- registered name, which may leave out or add middle names (as sameName in apps/api/src/auth/flow.ts).
-- A single word is not enough: BankID and Vipps always give the full name.
create function app.same_person_name(verified text, registered text) returns boolean
  language sql immutable set search_path = pg_catalog
  as $$
    select cardinality(v) >= 2 and v[1] = any (r) and v[cardinality(v)] = any (r)
    from (select app.name_words(verified) as v, app.name_words(registered) as r) w
  $$;

create or replace function app.confirmation_decide(
  confirmation uuid, decision text, how text, who text, verified_phone text, ref text, level text, from_ip inet, agent text
) returns text
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    c sale_confirmations;
    buyer record;
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
    -- The sale must still be waiting for this answer (it may have been cancelled meanwhile).
    perform 1 from sales where id = c.sale_id and status = 'awaiting_confirmation' for update;
    if not found then
      update sale_confirmations set status = 'revoked' where id = c.id;
      return 'not_pending';
    end if;

    if decision = 'accepted' then
      select case when cu.kind = 'business' then cu.contact_name else cu.name end as name, cu.phone into buyer
      from sales s join customers cu on cu.id = s.customer_id where s.id = c.sale_id;
      if verified_phone is not null and buyer.phone is not null and verified_phone = buyer.phone then
        matched := 'phone';
      elsif buyer.name is not null and app.same_person_name(who, buyer.name) then
        matched := 'name';
      end if;
      if matched = 'none' then
        insert into sale_events (organization_id, sale_id, from_status, to_status, note)
        values (c.organization_id, c.sale_id, 'awaiting_confirmation', 'awaiting_confirmation',
                'Forsøk på å godta med ' || case how when 'bankid' then 'BankID' else 'Vipps' end
                  || ' av en annen enn kjøperen. Navnet eller mobilnummeret stemte ikke. Salget venter fortsatt.');
        return 'wrong_person';
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
