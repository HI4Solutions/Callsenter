-- Complaint handling by call reference (Nadeem, 15 October; docs/plan.md, section 14).
--
-- Most call centres keep customers and sales in their own systems and only have the call's
-- reference (VQ-XXXX-XXXX). A complaint can therefore be about a call directly, fetched with its
-- reference, without a customer or sale in VeriQall. The case handler sees the transcript and
-- the notes, plays the recording, and asks the AI for an assessment of the complaint against the
-- call and for a draft reply to the customer (complaint_ai).
--
-- What the AI writes quotes the call, so it is deleted with the call at the end of its retention,
-- like the transcript. The complaint itself stays, and keeps the call's reference.

-- --- The call a complaint is about ------------------------------------------------------------

alter table complaints
  alter column customer_id drop not null,
  add column call_id uuid,
  -- The call's reference, kept when the call is deleted at the end of its retention.
  add column call_reference text check (call_reference ~ '^VQ-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$'),
  add constraint complaints_call_fkey foreign key (call_id, organization_id)
    references calls (id, organization_id) on delete set null (call_id);
create index complaints_call_idx on complaints (call_id);

-- As before, with three changes: a complaint may have no customer (one can be added later, but
-- never changed); a linked sale or call brings its customer; and a linked call's reference is
-- kept on the complaint.
create or replace function app.guard_complaint() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if new.customer_id is null and new.sale_id is not null then
      new.customer_id := (select customer_id from sales where id = new.sale_id);
    end if;
    if new.customer_id is null and new.call_id is not null then
      new.customer_id := (select customer_id from calls where id = new.call_id);
    end if;
    if new.sale_id is not null and not exists (
      select 1 from sales s where s.id = new.sale_id and s.customer_id = new.customer_id
    ) then
      raise exception 'the sale belongs to another customer' using errcode = 'check_violation';
    end if;
    if new.call_id is not null then
      new.call_reference := (select reference from calls where id = new.call_id);
    elsif tg_op = 'INSERT' then
      new.call_reference := null;
    else
      -- The call was deleted (or unlinked): the reference stays.
      new.call_reference := old.call_reference;
    end if;
    if tg_op = 'UPDATE' then
      if (old.customer_id is not null and new.customer_id is distinct from old.customer_id)
        or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
        raise exception 'a complaint keeps its customer' using errcode = 'check_violation';
      end if;
      if new.status <> old.status then
        new.closed_at := case when new.status in ('resolved', 'rejected') then now() end;
        -- A note left from the previous change does not belong to this one.
        if new.status_note is not distinct from old.status_note then
          new.status_note := null;
        end if;
      else
        new.status_note := old.status_note;
      end if;
    else
      new.status := 'open';
      new.closed_at := null;
      new.created_by := app.current_user_id();
    end if;
    return new;
  end
  $$;

grant update (call_id, customer_id) on complaints to app_user;

-- --- AI work on a complaint -------------------------------------------------------------------
-- An assessment of the complaint against the call, or a draft reply to the customer. Asked for
-- by the case handler (pending) and written by the worker, like the notes in Salgsstudio.

create table complaint_ai (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  complaint_id uuid not null,
  -- The call the work was done against.
  call_id uuid not null,
  kind text not null check (kind in ('assessment', 'reply')),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- The complaint as it read when the work was asked for, and for a reply the case handler's
  -- instructions ("offer to cancel without a fee").
  complaint_text text not null check (length(trim(complaint_text)) between 1 and 10000),
  instructions text check (length(instructions) <= 2000),
  locale text not null references locales (code),
  -- An assessment: {verdict, summary, claims, nextSteps}.
  result jsonb,
  -- A reply: the AI's draft, and the draft as the case handler has adjusted it.
  ai_content text check (length(ai_content) <= 20000),
  content text check (length(trim(content)) between 1 and 20000),
  edited_by uuid references users (id),
  edited_at timestamptz,
  model text,
  input_tokens int,
  output_tokens int,
  attempts int not null default 0,
  lease_until timestamptz,
  error text check (length(error) <= 500),
  requested_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'reply' or (instructions is null and ai_content is null and content is null)),
  check (kind = 'assessment' or result is null),
  check (status <> 'done' or (model is not null and (result is not null or ai_content is not null))),
  foreign key (complaint_id, organization_id) references complaints (id, organization_id) on delete cascade,
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade
);
create index complaint_ai_complaint_idx on complaint_ai (complaint_id, created_at desc);
create index complaint_ai_call_idx on complaint_ai (call_id);
create index complaint_ai_pending_idx on complaint_ai (created_at) where status = 'pending';

create trigger complaint_ai_touch before update on complaint_ai
  for each row execute function app.touch_updated_at();

-- At most 3 being written at a time and 50 in all per complaint.
create function app.complaint_ai_limit() returns trigger
  language plpgsql
  as $$
  begin
    perform pg_advisory_xact_lock(hashtext('complaint_ai:' || new.complaint_id::text));
    if (select count(*) from complaint_ai where complaint_id = new.complaint_id and status = 'pending') >= 3 then
      raise exception 'complaint work is already being done' using errcode = 'check_violation';
    end if;
    if (select count(*) from complaint_ai where complaint_id = new.complaint_id) >= 50 then
      raise exception 'too much complaint work' using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;
create trigger complaint_ai_limit before insert on complaint_ai
  for each row execute function app.complaint_ai_limit();

-- The audit log records who asked for what and when, never the text: it quotes the call, and
-- the audit log outlives the call's retention.
create function app.audit_complaint_ai() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    r complaint_ai := case when tg_op = 'DELETE' then old else new end;
    logged jsonb;
    actor uuid := app.current_user_id();
  begin
    logged := jsonb_strip_nulls(jsonb_build_object(
      'id', r.id, 'organization_id', r.organization_id, 'complaint_id', r.complaint_id, 'call_id', r.call_id,
      'kind', r.kind, 'status', r.status, 'locale', r.locale, 'model', r.model, 'error', r.error,
      'requested_by', r.requested_by, 'edited_by', r.edited_by, 'has_instructions', r.instructions is not null
    ));
    -- Leases and attempts only: not logged.
    if tg_op = 'UPDATE' and old.status = new.status and old.edited_at is not distinct from new.edited_at then
      return null;
    end if;
    insert into audit_log (
      organization_id, actor_user_id, as_platform_admin, action, table_name, record_id, old_data, new_data
    ) values (
      r.organization_id,
      actor,
      actor is not null and app.is_platform_admin()
        and not exists (select 1 from memberships where organization_id = r.organization_id and user_id = actor and status = 'active'),
      lower(tg_op),
      tg_table_name,
      r.id::text,
      null,
      logged || case when tg_op = 'UPDATE' and old.edited_at is distinct from new.edited_at then '{"edited": true}'::jsonb else '{}'::jsonb end
    );
    return null;
  end
  $$;
revoke all on function app.audit_complaint_ai() from public;
create trigger complaint_ai_audit after insert or update or delete on complaint_ai
  for each row execute function app.audit_complaint_ai();

alter table complaint_ai enable row level security;

-- Case handlers see the work on their call centre's complaints, when they see the call too: it
-- quotes the transcript.
create policy complaint_ai_select on complaint_ai for select to app_user
  using (
    organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage'))
    and exists (select 1 from calls c where c.id = complaint_ai.call_id)
  );
-- Asked for on the call the complaint is linked to, when that call has a transcript.
create policy complaint_ai_request on complaint_ai for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage'))
    and status = 'pending' and requested_by = (select app.current_user_id())
    and result is null and ai_content is null and content is null and edited_by is null
    and exists (select 1 from complaints k where k.id = complaint_ai.complaint_id and k.call_id = complaint_ai.call_id)
    and exists (select 1 from calls c where c.id = complaint_ai.call_id)
    and exists (select 1 from transcripts t where t.call_id = complaint_ai.call_id)
  );
-- A finished draft reply can be adjusted.
create policy complaint_ai_edit on complaint_ai for update to app_user
  using (
    organization_id = (select app.current_org_id()) and (select app.has_permission('complaints.manage'))
    and kind = 'reply' and status = 'done' and exists (select 1 from calls c where c.id = complaint_ai.call_id)
  )
  with check (
    organization_id = (select app.current_org_id()) and kind = 'reply' and status = 'done'
    and edited_by = (select app.current_user_id())
  );
grant select on complaint_ai to app_user;
grant insert (organization_id, complaint_id, call_id, kind, complaint_text, instructions, locale, requested_by) on complaint_ai to app_user;
grant update (content, edited_by, edited_at) on complaint_ai to app_user;

-- --- The worker -------------------------------------------------------------------------------
-- It writes the work, reading the complaint, the call's notes (as the seller last adjusted them)
-- and the AI control.

create policy complaint_ai_worker on complaint_ai for all to app_worker using (true) with check (true);
grant select on complaint_ai to app_worker;
grant update (status, result, ai_content, model, input_tokens, output_tokens, attempts, lease_until, error) on complaint_ai to app_worker;

create policy complaints_worker on complaints for select to app_worker using (true);
grant select (id, organization_id, call_id, summary, description, channel, received_on) on complaints to app_worker;

create policy report_edits_worker on report_edits for select to app_worker using (true);
grant select (report_id, content, created_at) on report_edits to app_worker;

-- --- Usage --------------------------------------------------------------------------------------
-- AI work on complaints is counted like the AI control and the notes.

alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
  check (kind in ('transcription_async', 'transcription_realtime', 'ai_control', 'report', 'complaint'));
