-- VeriQall in several languages (docs/plan.md, section 19). Three separate choices:
--
--   * the language of the pages, per user (users.locale), else the call centre's
--     (organizations.default_locale), else the browser's;
--   * the language notes and the AI control are written in, per call (calls.output_locale),
--     else the call centre's (organizations.content_locale);
--   * the languages spoken in the calls, as hints for Soniox (calls.spoken_languages, else
--     organizations.transcription_languages). Soniox recognises more than 60 languages, so this
--     is not limited to the languages of the pages.
--
-- The supported languages are rows in locales, mirrored from packages/shared/src/locales.ts (a
-- test checks they match). A new language is a migration that inserts its row and extends
-- app.search_config.

create table locales (
  code text primary key check (code ~ '^[a-z]{2,3}$')
);
insert into locales (code) values ('nb'), ('en'), ('sv'), ('da'), ('de');
grant select on locales to app_user, app_auth, app_worker;

-- A list of Soniox language codes ("no", "sv", "en", ...): one to ten, two or three letters each.
create function app.valid_soniox_languages(codes text[]) returns boolean
  language sql immutable set search_path = pg_catalog
  as $$
    select cardinality(codes) between 1 and 10
      and array_to_string(codes, ',') ~ '^[a-z]{2,3}(,[a-z]{2,3})*$'
      and cardinality(codes) = (select count(distinct c) from unnest(codes) c)
  $$;

-- A call centre's languages, set by superadmins under Callsentre.
alter table organizations
  add column default_locale text not null default 'nb' references locales (code),
  add column content_locale text not null default 'nb' references locales (code),
  add column transcription_languages text[] not null default '{no}' check (app.valid_soniox_languages(transcription_languages));
grant select (default_locale, content_locale, transcription_languages) on organizations to app_worker;

-- The user's own language for the pages; null follows the call centre. Users cannot update their
-- own row (only admins can), so they set it through app.set_my_locale.
alter table users add column locale text references locales (code);

create function app.set_my_locale(code text) returns void
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if app.current_user_id() is null then
      raise exception 'not signed in' using errcode = 'insufficient_privilege';
    end if;
    update users set locale = code, updated_at = now() where id = app.current_user_id();
  end
  $$;
revoke all on function app.set_my_locale(text) from public;
grant execute on function app.set_my_locale(text) to app_user;

-- Chosen in the studio; null follows the call centre.
alter table calls
  add column output_locale text references locales (code),
  add column spoken_languages text[] check (spoken_languages is null or app.valid_soniox_languages(spoken_languages));
grant update (output_locale, spoken_languages) on calls to app_user;

-- The audit log records the call's languages too (0028 lists what it keeps).
create or replace function app.call_audit_view(r jsonb) returns jsonb
  language sql immutable
  as $$
    select jsonb_strip_nulls(jsonb_build_object(
      'id', r -> 'id', 'organization_id', r -> 'organization_id', 'user_id', r -> 'user_id', 'team_id', r -> 'team_id',
      'customer_id', r -> 'customer_id', 'sale_id', r -> 'sale_id', 'product_id', r -> 'product_id',
      'template_version_id', r -> 'template_version_id', 'source', r -> 'source', 'transcription_mode', r -> 'transcription_mode',
      'status', r -> 'status', 'error', r -> 'error', 'duration_ms', r -> 'duration_ms', 'started_at', r -> 'started_at',
      'ended_at', r -> 'ended_at', 'expires_at', r -> 'expires_at', 'note_templates', r -> 'note_templates',
      'output_locale', r -> 'output_locale', 'spoken_languages', r -> 'spoken_languages',
      'has_note', coalesce(r ->> 'note', '') <> '', 'has_title', coalesce(r ->> 'title', '') <> ''
    ))
  $$;

-- The text search configuration for a language (LOCALES[...].search in packages/shared).
create function app.search_config(code text) returns regconfig
  language sql immutable set search_path = pg_catalog
  as $$
    select case code
      when 'nb' then 'norwegian'::regconfig
      when 'en' then 'english'::regconfig
      when 'sv' then 'swedish'::regconfig
      when 'da' then 'danish'::regconfig
      when 'de' then 'german'::regconfig
      else 'simple'::regconfig
    end
  $$;
grant execute on function app.search_config(text) to app_user, app_worker;

-- The language Soniox heard most in the transcript, when it is one of ours; null otherwise.
-- Transcripts made before this have none and were Norwegian.
alter table transcripts add column language text references locales (code);

-- Search in every language: the words stemmed in the transcript's language, and as they are
-- (simple), so a search finds a word whatever language the transcript is in. The API searches
-- with the user's language and simple together. The old Norwegian column goes in a later
-- migration, once no running code reads it.
alter table transcripts add column search_all tsvector generated always as (
  to_tsvector(app.search_config(coalesce(language, 'nb')), text) || to_tsvector('simple'::regconfig, text)
) stored;
create index transcripts_search_all_idx on transcripts using gin (search_all);

-- The language each note and AI control was written in. A note asked for in the studio may be in
-- another language than the call's (Regenerer in English, say); the worker fills in the rest.
alter table reports add column locale text references locales (code);
alter table call_analyses add column locale text references locales (code);
grant insert (locale) on reports to app_user;
grant update (locale) on reports to app_worker;
