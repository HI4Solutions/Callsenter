-- Transcription in pieces while the call goes on (docs/plan.md, section 13), the way MedSide does
-- it: the browser records a separate, complete audio file every 15 seconds, uploads it, and the
-- worker transcribes it with Soniox's async model (stt-async-v5). The text shows in the studio
-- as the call goes on, and when the recording stops the transcript is already there: the pieces
-- become the call's transcript. If a piece is missing or failed, the whole recording is
-- transcribed instead.
-- The continuous recording (chunks) is still what is stored and played back.

create table call_pieces (
  call_id uuid not null,
  organization_id uuid not null,
  seq int not null check (seq between 0 and 2000),
  -- When the piece started, from the start of the recording.
  start_ms int not null check (start_ms >= 0),
  -- uploading: URL handed out; pending: uploaded, waiting for the worker; done; failed.
  status text not null default 'uploading' check (status in ('uploading', 'pending', 'done', 'failed')),
  attempts int not null default 0,
  lease_until timestamptz,
  -- [{speaker, startMs, endMs, text}], times from the start of the recording.
  segments jsonb,
  audio_ms int check (audio_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (call_id, seq),
  foreign key (call_id, organization_id) references calls (id, organization_id) on delete cascade
);
create index call_pieces_pending_idx on call_pieces (created_at) where status in ('uploading', 'pending');
create trigger call_pieces_touch before update on call_pieces
  for each row execute function app.touch_updated_at();

-- How many pieces the browser recorded, sent when the recording is finished.
alter table calls add column piece_count int check (piece_count between 0 and 2001);
grant update (piece_count) on calls to app_user;

alter table call_pieces enable row level security;
-- Seen with the call (the text is part of its transcript).
create policy call_pieces_select on call_pieces for select to app_user
  using (organization_id = (select app.current_org_id()) and exists (select 1 from calls c where c.id = call_id));
-- Only the recorder adds pieces, and only while recording.
create policy call_pieces_insert on call_pieces for insert to app_user
  with check (
    organization_id = (select app.current_org_id()) and status = 'uploading'
    and exists (
      select 1 from calls c where c.id = call_id and c.user_id = (select app.current_user_id()) and c.status = 'recording'
    )
  );
-- ...and marks them uploaded (the worker does the rest).
create policy call_pieces_uploaded on call_pieces for update to app_user
  using (
    organization_id = (select app.current_org_id()) and status = 'uploading'
    and exists (select 1 from calls c where c.id = call_id and c.user_id = (select app.current_user_id()))
  )
  with check (status = 'pending');
grant select, insert (call_id, organization_id, seq, start_ms, status), update (status) on call_pieces to app_user;

create policy call_pieces_worker on call_pieces for all to app_worker using (true) with check (true);
grant select, update, delete on call_pieces to app_worker;

-- Transcription in pieces is now the default (Nadeem, 3 October); realtime stays a choice.
update platform_settings set value = '"chunked"' where key = 'transcription_mode';
