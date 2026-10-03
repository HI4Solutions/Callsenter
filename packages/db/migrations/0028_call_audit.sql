-- What the audit log keeps of calls (security review, October 2026).
--
-- calls_audit wrote the whole row on every update. While recording, the browser and the worker
-- update counters, leases and Soniox ids every few seconds, so a call left a hundred or more
-- append-only rows, and each one held the seller's additional information (note) and title,
-- which often name the customer. Those rows outlived the call's retention, against the rule
-- that what was said in a call is deleted with it.
--
-- Now an update is logged only when something a person would follow up changes (status,
-- links, error, duration, the note templates), and the note and title are recorded only as
-- having been changed, never their text.

create function app.call_audit_view(r jsonb) returns jsonb
  language sql immutable
  as $$
    select jsonb_strip_nulls(jsonb_build_object(
      'id', r -> 'id', 'organization_id', r -> 'organization_id', 'user_id', r -> 'user_id', 'team_id', r -> 'team_id',
      'customer_id', r -> 'customer_id', 'sale_id', r -> 'sale_id', 'product_id', r -> 'product_id',
      'template_version_id', r -> 'template_version_id', 'source', r -> 'source', 'transcription_mode', r -> 'transcription_mode',
      'status', r -> 'status', 'error', r -> 'error', 'duration_ms', r -> 'duration_ms', 'started_at', r -> 'started_at',
      'ended_at', r -> 'ended_at', 'expires_at', r -> 'expires_at', 'note_templates', r -> 'note_templates',
      'has_note', coalesce(r ->> 'note', '') <> '', 'has_title', coalesce(r ->> 'title', '') <> ''
    ))
  $$;

create function app.audit_call_change() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then app.call_audit_view(to_jsonb(old)) end;
    new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then app.call_audit_view(to_jsonb(new)) end;
    row_data jsonb := coalesce(new_row, old_row);
    org uuid := (row_data ->> 'organization_id')::uuid;
    actor uuid := app.current_user_id();
  begin
    if tg_op = 'UPDATE' then
      -- The text is never logged, only that it changed.
      if old.note is distinct from new.note then new_row := new_row || '{"note_changed": true}'; end if;
      if old.title is distinct from new.title then new_row := new_row || '{"title_changed": true}'; end if;
      -- Counters, leases and Soniox ids only: not logged.
      if old_row = new_row then return null; end if;
    end if;
    insert into audit_log (
      organization_id, actor_user_id, as_platform_admin, action, table_name, record_id, old_data, new_data
    ) values (
      org,
      actor,
      actor is not null and app.is_platform_admin()
        and not exists (select 1 from memberships where organization_id = org and user_id = actor and status = 'active'),
      lower(tg_op),
      tg_table_name,
      row_data ->> 'id',
      old_row,
      new_row
    );
    return null;
  end
  $$;
revoke all on function app.audit_call_change() from public;

drop trigger calls_audit on calls;
create trigger calls_audit after insert or update or delete on calls
  for each row execute function app.audit_call_change();

-- The rows already written are reduced the same way, once. The audit log is otherwise never
-- changed; this removes customer information that should not have been kept.
alter table audit_log disable trigger audit_log_append_only;
update audit_log
set old_data = case when old_data is not null then app.call_audit_view(old_data) end,
    new_data = case when new_data is not null then app.call_audit_view(new_data) end
where table_name = 'calls';
alter table audit_log enable trigger audit_log_append_only;
