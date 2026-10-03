-- Samtalestudio (docs/plan.md, section 18).
-- - The transcript is made from the stored recording and can never be changed by a user.
-- - The note (a report) is written by AI from the transcript, the product template and the
--   seller's additional information. The seller may adjust it: the AI text is kept unchanged in
--   reports, and each adjustment is a new row in report_edits (append-only).
-- - The note templates (notatmaler) take the place of Notatstudio's add-on templates: the seller
--   switches one or more on under the product template, and each gives its own note. They are
--   kept on the call (note_templates) for the note written after the call, and "Regenerer" asks
--   for new ones: the API adds pending reports and the worker writes them.
-- - Each member picks a default product (the template) for the studio.

-- --- Notes made on request ---------------------------------------------------------------------

alter table reports
  alter column content drop not null,
  alter column model drop not null,
  add column status text not null default 'done' check (status in ('pending', 'done', 'failed')),
  add column requested_by uuid references users (id),
  add column attempts int not null default 0,
  add column lease_until timestamptz,
  add column error text check (length(error) <= 500),
  add constraint reports_done_check check (status <> 'done' or (content is not null and model is not null)),
  add constraint reports_id_call_key unique (id, call_id, organization_id);
create index reports_pending_idx on reports (created_at) where status = 'pending';

-- The note templates chosen in the studio, used for the notes written after the call.
alter table calls add column note_templates uuid[] not null default '{}' check (cardinality(note_templates) <= 5);
grant update (note_templates) on calls to app_user;

-- At most 10 notes per call, and 5 being written at a time.
create function app.reports_limit() returns trigger
  language plpgsql
  as $$
  begin
    if new.status = 'pending' then
      perform pg_advisory_xact_lock(hashtext('reports:' || new.call_id::text));
      if (select count(*) from reports where call_id = new.call_id and status = 'pending') >= 5 then
        raise exception 'notes are already being written for this call';
      end if;
      if (select count(*) from reports where call_id = new.call_id) >= 10 then
        raise exception 'too many notes for this call';
      end if;
    end if;
    return new;
  end
  $$;
create trigger reports_limit before insert on reports
  for each row execute function app.reports_limit();

-- The call's seller, or someone who manages note templates, may ask for a note on a call they
-- see that has a transcript.
create policy reports_request on reports for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and status = 'pending' and content is null
    and requested_by = (select app.current_user_id())
    and exists (
      select 1 from calls c
      where c.id = call_id and c.status in ('transcribed', 'analyzed')
        and (c.user_id = (select app.current_user_id()) or (select app.has_permission('report_templates.manage')))
    )
    and exists (select 1 from transcripts t where t.call_id = reports.call_id)
  );
grant insert (organization_id, call_id, template_id, template_name, requested_by, status) on reports to app_user;
grant update (content, model, status, input_tokens, output_tokens, attempts, lease_until, error) on reports to app_worker;

-- --- The seller's adjustments --------------------------------------------------------------------

create table report_edits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_id uuid not null,
  call_id uuid not null,
  content text not null check (length(trim(content)) between 1 and 20000),
  edited_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  foreign key (report_id, call_id, organization_id) references reports (id, call_id, organization_id) on delete cascade,
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade
);
create index report_edits_report_idx on report_edits (report_id, created_at desc);

alter table report_edits enable row level security;
-- Visible with the call.
create policy report_edits_select on report_edits for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));
-- Only the call's own seller adjusts its notes, and only a finished note.
create policy report_edits_insert on report_edits for insert to app_user
  with check (
    organization_id = (select app.current_org_id())
    and edited_by = (select app.current_user_id())
    and exists (select 1 from calls c where c.id = call_id and c.user_id = (select app.current_user_id()))
    and exists (select 1 from reports r where r.id = report_id and r.status = 'done')
  );
grant select, insert (organization_id, report_id, call_id, content, edited_by) on report_edits to app_user;

-- Requests and adjustments are audited without the text, so it does not outlive the call.
create function app.audit_call_note() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    r jsonb := to_jsonb(new);
  begin
    if tg_table_name = 'reports' and r ->> 'requested_by' is null then
      return null;
    end if;
    insert into audit_log (organization_id, actor_user_id, action, table_name, record_id, new_data)
    values (
      (r ->> 'organization_id')::uuid, app.current_user_id(), 'insert', tg_table_name, r ->> 'id',
      case when tg_table_name = 'reports'
        then jsonb_build_object('call_id', r -> 'call_id', 'template_name', r -> 'template_name', 'status', r -> 'status')
        else jsonb_build_object('call_id', r -> 'call_id', 'report_id', r -> 'report_id', 'length', length(r ->> 'content'))
      end
    );
    return null;
  end
  $$;
revoke all on function app.audit_call_note() from public;
create trigger reports_request_audit after insert on reports
  for each row execute function app.audit_call_note();
create trigger report_edits_audit after insert on report_edits
  for each row execute function app.audit_call_note();

-- --- Default product in the studio ---------------------------------------------------------------

create table studio_preferences (
  organization_id uuid not null,
  user_id uuid not null,
  product_id uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  foreign key (product_id, organization_id) references products (id, organization_id) on delete set null (product_id)
);

alter table studio_preferences enable row level security;
create policy studio_preferences_own on studio_preferences for all to app_user
  using (organization_id = (select app.current_org_id()) and user_id = (select app.current_user_id()))
  with check (organization_id = (select app.current_org_id()) and user_id = (select app.current_user_id()));
grant select, insert, update (product_id, updated_at), delete on studio_preferences to app_user;
