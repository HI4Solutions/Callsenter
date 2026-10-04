-- Salgsstudio (docs/plan.md, section 18): the seller can discard a call while it is being
-- recorded, for a call that will not be a sale or need not be kept. A discarded call is never
-- finished, transcribed as a whole or analysed: it is hidden at once and deleted with its audio,
-- pieces and text by the worker's housekeeping, which the API starts straight away. The status
-- change is kept in the audit log.

alter table calls drop constraint calls_status_check;
alter table calls add constraint calls_status_check
  check (status in ('recording', 'processing', 'transcribed', 'analyzed', 'failed', 'discarded'));

create or replace function app.guard_call() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  declare
    worker boolean := pg_has_role(current_user, 'app_worker', 'member');
  begin
    if new.status is distinct from old.status and not worker
      and not (old.status = 'recording' and new.status = 'processing')
      and not (old.status = 'failed' and new.status in ('processing', 'transcribed'))
      and not (old.status = 'recording' and new.status = 'discarded') then
      raise exception 'a call cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if not worker and (
      new.customer_id is distinct from old.customer_id or new.sale_id is distinct from old.sale_id
      or new.product_id is distinct from old.product_id
    ) then
      -- The AI control was made against the linked template version; it stays linked.
      if exists (select 1 from call_analyses a where a.call_id = old.id) then
        raise exception 'an analysed call keeps its links' using errcode = 'check_violation';
      end if;
      if old.lease_until > now() then
        raise exception 'call is being processed' using errcode = 'check_violation';
      end if;
    end if;
    if not worker and new.chunk_count < old.chunk_count then
      raise exception 'chunks cannot be removed' using errcode = 'check_violation';
    end if;
    -- The API may only record that live text was not used, and count the keys it hands out.
    if not worker and (
      (new.transcription_mode = 'realtime' and old.transcription_mode <> 'realtime')
      or new.realtime_keys < old.realtime_keys
    ) then
      raise exception 'not allowed' using errcode = 'check_violation';
    end if;
    -- Only the seller who records the call can discard it. It is hidden at once (expires_at, see
    -- the calls_select policy) and deleted with its audio and text by the worker's housekeeping.
    if new.status = 'discarded' and old.status <> 'discarded' then
      if not worker and old.user_id is distinct from (select app.current_user_id()) then
        raise exception 'only the recorder can discard a call' using errcode = 'check_violation';
      end if;
      new.expires_at := now();
      new.ended_at := coalesce(new.ended_at, now());
    end if;
    if new.status = 'processing' and old.status <> 'processing' then
      new.processing_started_at := now();
      new.error := null;
      new.ended_at := coalesce(new.ended_at, now());
    end if;
    return new;
  end
  $$;

-- The API discards through this function: the call disappears from the seller's view in the same
-- update, which the calls_select policy would otherwise refuse for app_user.
create function app.discard_call(call_id uuid) returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    update calls c set status = 'discarded'
    where c.id = call_id and c.organization_id = (select app.current_org_id())
      and c.user_id = (select app.current_user_id()) and c.status = 'recording'
      and (select app.has_permission('calls.upload'));
    return found;
  end
  $$;
revoke all on function app.discard_call(uuid) from public;
grant execute on function app.discard_call(uuid) to app_user;
