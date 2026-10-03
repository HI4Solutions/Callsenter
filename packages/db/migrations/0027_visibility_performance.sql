-- Faster row-level security on calls and sales (security and performance review, October 2026).
--
-- The policies called app.can_see_sale() for every row. It is a security definer function, so
-- Postgres can't inline it, and each call worked out the user's permissions and team again: a
-- list of 200 calls took seconds with 100,000 calls, and a count as admin did not finish. The
-- policies now ask for the permissions and the team once per query (a scalar subquery is an
-- init plan), and compare plain columns per row. Who sees what is unchanged.

-- The current user's team in the current call centre, if any.
create function app.my_team_id() returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.team_id from memberships m
    where m.organization_id = app.current_org_id() and m.user_id = app.current_user_id() and m.status = 'active'
  $$;
revoke all on function app.my_team_id() from public;
grant execute on function app.my_team_id() to app_user;

drop policy calls_select on calls;
create policy calls_select on calls for select to app_user
  using (
    organization_id = (select app.current_org_id()) and expires_at > now()
    and (
      (select app.has_permission('calls.read.all'))
      or (user_id = (select app.current_user_id()) and (select app.has_permission('calls.read.own')))
      or (team_id = (select app.my_team_id()) and (select app.has_permission('calls.read.team')))
    )
  );

drop policy calls_update on calls;
create policy calls_update on calls for update to app_user
  using (
    organization_id = (select app.current_org_id()) and expires_at > now()
    and (select app.has_permission('calls.upload'))
    and (
      (select app.has_permission('calls.read.all'))
      or (user_id = (select app.current_user_id()) and (select app.has_permission('calls.read.own')))
      or (team_id = (select app.my_team_id()) and (select app.has_permission('calls.read.team')))
    )
  )
  with check (organization_id = (select app.current_org_id()));

drop policy sales_select on sales;
create policy sales_select on sales for select to app_user
  using (
    organization_id = (select app.current_org_id())
    and (
      (select app.has_permission('calls.read.all'))
      or (seller_id = (select app.current_user_id()) and (select app.has_permission('calls.read.own')))
      or (team_id = (select app.my_team_id()) and (select app.has_permission('calls.read.team')))
    )
  );

drop policy sales_update on sales;
create policy sales_update on sales for update to app_user
  using (
    organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage'))
    and (
      (select app.has_permission('calls.read.all'))
      or (seller_id = (select app.current_user_id()) and (select app.has_permission('calls.read.own')))
      or (team_id = (select app.my_team_id()) and (select app.has_permission('calls.read.team')))
    )
  )
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('sales.manage')));

