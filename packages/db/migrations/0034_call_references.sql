-- A reference number for each call (Nadeem, 3 October): the seller copies it into the system the
-- call centre registers its sales in, and a complaint or a check later finds the call, its
-- transcript and its report from it. Short, easy to read aloud: VQ- and eight characters without
-- the ones that look alike (0/O, 1/I/L). Unique across all call centres; set by the database.

create function app.new_call_reference() returns text
  language plpgsql volatile security definer set search_path = pg_catalog, public
  as $$
  declare
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    bytes bytea;
    ref text;
  begin
    loop
      bytes := uuid_send(gen_random_uuid());
      ref := '';
      for i in 0..7 loop
        ref := ref || substr(alphabet, 1 + get_byte(bytes, i) % 31, 1);
      end loop;
      ref := 'VQ-' || substr(ref, 1, 4) || '-' || substr(ref, 5, 4);
      -- Across all call centres (security definer: RLS would only show one).
      exit when not exists (select 1 from calls where reference = ref);
    end loop;
    return ref;
  end
  $$;
revoke all on function app.new_call_reference() from public;

-- Existing calls get one too (the volatile default is computed per row, without triggers).
alter table calls add column reference text not null default app.new_call_reference();
create unique index calls_reference_key on calls (reference);

-- Always the database's own: what the API sends is ignored, and it never changes.
create function app.set_call_reference() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    if tg_op = 'INSERT' then
      new.reference := app.new_call_reference();
    elsif new.reference is distinct from old.reference then
      raise exception 'a call keeps its reference' using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;
grant execute on function app.new_call_reference() to app_user;
create trigger calls_reference before insert or update of reference on calls
  for each row execute function app.set_call_reference();
