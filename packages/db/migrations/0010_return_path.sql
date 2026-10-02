-- Tighten the return path stored with a login (auth_states.return_to). Browsers strip tabs and
-- newlines from URLs and read a backslash as a slash, so "/<tab>/evil.example" would leave the
-- site. The API already refuses such paths (safeAppPath in packages/shared); this makes the
-- database refuse them too. NOT VALID: login states are short-lived, only new rows are checked.

alter table auth_states drop constraint auth_states_return_to_check;
alter table auth_states add constraint auth_states_return_to_check
  check ((return_to ~ '^/[^/\\]' or return_to = '/') and return_to !~ '[[:cntrl:]\\]') not valid;
