-- Phase 2, the call (docs/plan.md, section 13): recordings, transcripts, AI control against the
-- product template, reports, usage, and how long recordings are kept.
--
-- The API (app_user) creates calls and links them; the worker Lambda (app_worker) transcribes,
-- analyses and deletes expired calls. The worker acts for no user, so it has its own narrow role
-- with policies on exactly the tables it touches.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker nologin;
  end if;
end
$$;
grant usage on schema app to app_worker;
grant usage on schema public to app_worker;

-- --- Settings ---------------------------------------------------------------------------------

-- Platform-wide settings, changed by superadmins under System.
create table platform_settings (
  key text primary key check (key in ('transcription_mode', 'transcription_terms', 'ai_model')),
  value jsonb not null,
  updated_by uuid references users (id),
  updated_at timestamptz not null default now()
);
insert into platform_settings (key, value) values
  -- realtime: live text while recording, falling back to chunked on any error. chunked: upload only.
  ('transcription_mode', '"realtime"'),
  -- Words and names Soniox should recognise (product and company names).
  ('transcription_terms', '[]'),
  -- The Claude model for AI control and reports (AI_MODELS in packages/shared/src/ai-models.ts).
  ('ai_model', '"sonnet-4-6"');

create trigger platform_settings_touch before update on platform_settings
  for each row execute function app.touch_updated_at();

alter table platform_settings enable row level security;
create policy platform_settings_select on platform_settings for select to app_user, app_worker using (true);
create policy platform_settings_update on platform_settings for update to app_user
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
grant select, update (value, updated_by) on platform_settings to app_user;
grant select on platform_settings to app_worker;

-- How long recordings and transcripts are kept, chosen per call centre by superadmins.
alter table organizations add column recording_retention_months int not null default 12
  check (recording_retention_months in (3, 6, 9, 12));

-- --- Calls ------------------------------------------------------------------------------------

create table calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Who recorded or uploaded it (the seller). Visibility follows calls.read.own/team/all.
  user_id uuid not null,
  -- The recorder's team when the call was made.
  team_id uuid,
  customer_id uuid,
  sale_id uuid,
  product_id uuid,
  -- Set by the database: the template version the call is checked against.
  template_version_id uuid,
  -- microphone, tab (microphone mixed with a browser tab's audio) or upload (a file).
  source text not null check (source in ('microphone', 'tab', 'upload')),
  transcription_mode text not null check (transcription_mode in ('realtime', 'chunked')),
  status text not null default 'recording' check (status in ('recording', 'processing', 'transcribed', 'analyzed', 'failed')),
  title text check (length(title) <= 200),
  note text check (length(note) <= 2000),
  audio_mime text check (audio_mime ~ '^audio/[a-z0-9.+-]+(;[ a-z0-9=.,"-]*)?$' and length(audio_mime) <= 100),
  -- Chunks are uploaded while recording; the worker joins them into one object.
  chunk_count int not null default 0 check (chunk_count between 0 and 2000),
  -- When the browser last asked to upload a chunk; a recording silent for hours was abandoned.
  last_chunk_at timestamptz,
  audio_key text,
  audio_bytes bigint,
  duration_ms int check (duration_ms >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Set from the call centre's retention when the call is created. After it the call is hidden
  -- at once and deleted by the worker.
  expires_at timestamptz not null,
  error text check (length(error) <= 500),
  processing_started_at timestamptz,
  -- The worker holds a lease while it works on the call, so two runs never process it at once.
  lease_until timestamptz,
  -- How many runs have claimed the call; after three the worker gives up.
  attempts int not null default 0,
  -- Files and transcriptions at Soniox not yet deleted (a run that was cut off leaves them).
  soniox_file_id text,
  soniox_transcription_id text,
  -- Temporary Soniox keys handed out for this recording (capped).
  realtime_keys int not null default 0 check (realtime_keys between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (organization_id, user_id) references memberships (organization_id, user_id),
  foreign key (team_id, organization_id) references teams (id, organization_id),
  foreign key (customer_id, organization_id) references customers (id, organization_id),
  foreign key (sale_id, organization_id) references sales (id, organization_id),
  foreign key (product_id, organization_id) references products (id, organization_id),
  foreign key (template_version_id, organization_id) references product_template_versions (id, organization_id)
);
create index calls_org_started_idx on calls (organization_id, started_at desc);
create index calls_user_idx on calls (user_id, started_at desc);
create index calls_team_idx on calls (team_id, started_at desc);
create index calls_customer_idx on calls (customer_id);
create index calls_sale_idx on calls (sale_id);
create index calls_expires_idx on calls (expires_at);

-- Links: a sale decides customer, product and template version; otherwise the product's
-- published version applies. Runs with the caller's rights.
create function app.link_call() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  declare
    s record;
  begin
    if new.sale_id is not null then
      select customer_id, product_id, template_version_id into s from sales
      where id = new.sale_id and organization_id = new.organization_id;
      if not found then
        raise exception 'sale not found' using errcode = 'check_violation';
      end if;
      new.customer_id := s.customer_id;
      new.product_id := s.product_id;
      new.template_version_id := s.template_version_id;
    elsif new.product_id is not null then
      if tg_op = 'UPDATE' and new.product_id is not distinct from old.product_id
        and old.sale_id is null and old.template_version_id is not null then
        new.template_version_id := old.template_version_id;
      else
        select tv.id into new.template_version_id from product_template_versions tv
        where tv.product_id = new.product_id and tv.organization_id = new.organization_id
          and tv.status = 'published';
        if new.template_version_id is null then
          raise exception 'product has no published template version' using errcode = 'check_violation';
        end if;
      end if;
    else
      new.template_version_id := null;
    end if;
    return new;
  end
  $$;

create function app.prepare_call() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  begin
    select now() + make_interval(months => o.recording_retention_months) into new.expires_at
    from organizations o where o.id = new.organization_id;
    select m.team_id into new.team_id from memberships m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.status = 'active';
    if not found then
      raise exception 'recorder is not an active member' using errcode = 'check_violation';
    end if;
    new.status := 'recording';
    new.started_at := now();
    new.chunk_count := 0;
    new.audio_key := null;
    new.error := null;
    return new;
  end
  $$;

-- What the API may change, and when. The worker (app_worker) moves calls through processing.
create function app.guard_call() returns trigger
  language plpgsql set search_path = pg_catalog, public
  as $$
  declare
    worker boolean := pg_has_role(current_user, 'app_worker', 'member');
  begin
    if new.status is distinct from old.status and not worker
      and not (old.status = 'recording' and new.status = 'processing')
      and not (old.status = 'failed' and new.status in ('processing', 'transcribed')) then
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
    if new.status = 'processing' and old.status <> 'processing' then
      new.processing_started_at := now();
      new.error := null;
      new.ended_at := coalesce(new.ended_at, now());
    end if;
    return new;
  end
  $$;

create trigger calls_prepare before insert on calls
  for each row execute function app.prepare_call();
create trigger calls_link before insert or update of customer_id, sale_id, product_id on calls
  for each row execute function app.link_call();
create trigger calls_guard before update on calls
  for each row execute function app.guard_call();
create trigger calls_touch before update on calls
  for each row execute function app.touch_updated_at();
create trigger calls_audit after insert or update or delete on calls
  for each row execute function app.audit_row_change();

-- Calls are seen like sales (own, team or all) until they expire.
create function app.can_see_call(recorder uuid, team uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select app.can_see_sale(recorder, team) $$;
revoke all on function app.can_see_call(uuid, uuid) from public;
grant execute on function app.can_see_call(uuid, uuid) to app_user;

alter table calls enable row level security;
create policy calls_select on calls for select to app_user
  using (
    organization_id = (select app.current_org_id()) and expires_at > now()
    and app.can_see_call(user_id, team_id)
  );
-- Members record their own calls.
create policy calls_insert on calls for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and user_id = (select app.current_user_id())
    and (select app.has_permission('calls.upload'))
  );
-- The recorder, or anyone who sees the call and may upload calls, can finish and link it.
create policy calls_update on calls for update to app_user
  using (
    organization_id = (select app.current_org_id()) and expires_at > now()
    and app.can_see_call(user_id, team_id) and (select app.has_permission('calls.upload'))
  )
  with check (organization_id = (select app.current_org_id()));
create policy calls_worker on calls for all to app_worker using (true) with check (true);

grant select, insert on calls to app_user;
grant update (title, note, customer_id, sale_id, product_id, status, chunk_count, last_chunk_at, audio_mime, duration_ms, ended_at,
  transcription_mode, realtime_keys)
  on calls to app_user;
grant select, update, delete on calls to app_worker;

-- --- Transcripts ------------------------------------------------------------------------------
-- Not audited: the audit log is append-only and must not keep a copy of what a customer said
-- after the recording has expired.

create table transcripts (
  call_id uuid primary key,
  organization_id uuid not null,
  text text not null,
  -- Norwegian full-text search.
  search tsvector generated always as (to_tsvector('norwegian', text)) stored,
  model text,
  audio_ms int,
  created_at timestamptz not null default now(),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade
);
create index transcripts_search_idx on transcripts using gin (search);

create table transcript_segments (
  call_id uuid not null,
  organization_id uuid not null,
  seq int not null,
  speaker text check (length(speaker) <= 20),
  start_ms int not null check (start_ms >= 0),
  end_ms int not null check (end_ms >= start_ms),
  text text not null,
  primary key (call_id, seq),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade
);

-- --- AI control and reports -------------------------------------------------------------------

create table call_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  template_version_id uuid not null,
  model text not null,
  -- green, yellow or red for the whole call: the worst finding.
  flag text not null check (flag in ('green', 'yellow', 'red')),
  summary text not null default '',
  -- [{"kind": "required_point"|"forbidden_phrase"|"other", "pointId", "label", "level":
  --   "green"|"yellow"|"red", "quote", "startMs", "comment"}]
  findings jsonb not null default '[]' check (jsonb_typeof(findings) = 'array'),
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  -- Yellow and red flags are reviewed by someone with flags.review.
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade,
  foreign key (template_version_id, organization_id) references product_template_versions (id, organization_id)
);
create index call_analyses_call_idx on call_analyses (call_id, created_at desc);
create index call_analyses_open_idx on call_analyses (organization_id, created_at desc)
  where flag <> 'green' and reviewed_at is null;

create table report_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  instructions text not null check (length(trim(instructions)) between 1 and 10000),
  is_default boolean not null default false,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);
create unique index report_templates_default on report_templates (organization_id)
  where is_default and archived_at is null;
create trigger report_templates_touch before update on report_templates
  for each row execute function app.touch_updated_at();
create trigger report_templates_audit after insert or update or delete on report_templates
  for each row execute function app.audit_row_change();

create table reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  template_id uuid,
  template_name text not null,
  content text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade,
  foreign key (template_id, organization_id) references report_templates (id, organization_id) on delete set null (template_id)
);
create index reports_call_idx on reports (call_id, created_at desc);

-- Analyses, reviews and reports are audited without the text of the call.
create function app.audit_analysis_review() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    insert into audit_log (organization_id, actor_user_id, action, table_name, record_id, old_data, new_data)
    values (
      new.organization_id, app.current_user_id(), lower(tg_op), tg_table_name, new.id::text,
      case when tg_op = 'UPDATE' then jsonb_build_object('reviewed_at', old.reviewed_at) end,
      jsonb_build_object('call_id', new.call_id, 'flag', new.flag, 'reviewed_at', new.reviewed_at,
        'review_note', new.review_note)
    );
    return null;
  end
  $$;
create trigger call_analyses_audit after insert or update on call_analyses
  for each row execute function app.audit_analysis_review();

-- --- Usage --------------------------------------------------------------------------------------
-- Audio minutes and AI tokens per call centre, the basis for invoicing (phase 4).

create table usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  call_id uuid references calls (id) on delete set null,
  kind text not null check (kind in ('transcription_async', 'transcription_realtime', 'ai_control', 'report')),
  audio_seconds int,
  input_tokens int,
  output_tokens int,
  model text,
  created_at timestamptz not null default now()
);
create index usage_events_org_idx on usage_events (organization_id, created_at desc);

-- --- RLS for the call's children --------------------------------------------------------------

alter table transcripts enable row level security;
alter table transcript_segments enable row level security;
alter table call_analyses enable row level security;
alter table report_templates enable row level security;
alter table reports enable row level security;
alter table usage_events enable row level security;

-- Visible when the call is (calls_select applies inside the subquery).
create policy transcripts_select on transcripts for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));
create policy transcript_segments_select on transcript_segments for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));
create policy call_analyses_select on call_analyses for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));
create policy call_analyses_review on call_analyses for update to app_user
  using (
    organization_id = (select app.current_org_id()) and (select app.has_permission('flags.review'))
    and exists (select 1 from calls c where c.id = call_id)
  )
  with check (organization_id = (select app.current_org_id()));
create policy reports_select on reports for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));

create policy report_templates_select on report_templates for select to app_user
  using (organization_id = (select app.current_org_id()));
create policy report_templates_insert on report_templates for insert to app_user
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('report_templates.manage')));
create policy report_templates_update on report_templates for update to app_user
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('report_templates.manage')))
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('report_templates.manage')));

-- Superadmins read usage (Økonomi); the worker writes it.
create policy usage_events_select on usage_events for select to app_user using ((select app.is_platform_admin()));

grant select on transcripts, transcript_segments, call_analyses, reports, report_templates to app_user;
grant update (reviewed_by, reviewed_at, review_note) on call_analyses to app_user;
grant insert, update (name, instructions, is_default, archived_at) on report_templates to app_user;
grant select on usage_events to app_user;

create policy transcripts_worker on transcripts for all to app_worker using (true) with check (true);
create policy transcript_segments_worker on transcript_segments for all to app_worker using (true) with check (true);
create policy call_analyses_worker on call_analyses for all to app_worker using (true) with check (true);
create policy reports_worker on reports for all to app_worker using (true) with check (true);
create policy report_templates_worker on report_templates for select to app_worker using (true);
create policy usage_events_worker on usage_events for insert to app_worker with check (true);
create policy usage_events_worker_select on usage_events for select to app_worker using (true);
grant select, insert, delete on transcripts, transcript_segments, call_analyses, reports to app_worker;
grant select on report_templates to app_worker;
grant select, insert on usage_events to app_worker;

-- What the worker reads to analyse a call.
create policy organizations_worker on organizations for select to app_worker using (true);
create policy organization_modules_worker on organization_modules for select to app_worker using (true);
create policy products_worker on products for select to app_worker using (true);
create policy template_versions_worker on product_template_versions for select to app_worker using (true);
grant select (id, name, recording_retention_months, status) on organizations to app_worker;
grant select on organization_modules, products, product_template_versions to app_worker;
-- The audit trigger on calls needs these when the worker changes or deletes a call.
grant execute on function app.current_user_id(), app.current_org_id(), app.is_platform_admin() to app_worker;
