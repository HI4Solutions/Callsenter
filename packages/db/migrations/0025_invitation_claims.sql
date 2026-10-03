-- Invitations to people who already exist (security review, October 2026).
--
-- An invitation link lets whoever opens it attach a new BankID or Vipps login to the invited
-- user. That is only safe for a user who has never logged in and belongs to no other call
-- centre: otherwise an admin in one call centre could invite someone from another, open the
-- link with their own BankID and take over that person's account. Existing users are added to
-- the call centre without a link, and see it under their own login.

-- Whether the user may still be claimed by an invitation from this call centre. Superadmin
-- invitations (no call centre) are made by the migrator with the master user, and stay as they
-- are.
create function app.claimable_by_invitation(target_user uuid, org uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select org is null or (
      exists (select 1 from users where id = target_user and status = 'invited')
      and not exists (select 1 from identities where user_id = target_user)
      and not exists (select 1 from passkeys where user_id = target_user)
      and not exists (select 1 from platform_admins where user_id = target_user)
      and not exists (select 1 from memberships where user_id = target_user and organization_id <> org)
    )
  $$;

-- For the admin inviting: only in their own call centre, and only with users.manage.
create function app.invitation_claimable(target_user uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select app.current_org_id() is not null and app.has_permission('users.manage')
      and app.claimable_by_invitation(target_user, app.current_org_id())
  $$;

revoke all on function app.claimable_by_invitation(uuid, uuid) from public;
revoke all on function app.invitation_claimable(uuid) from public;
grant execute on function app.invitation_claimable(uuid) to app_user;

-- At login: the invitation is redeemed by a new identity only while its user can be claimed.
create function app.invitation_redeemable(invitation uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select coalesce((
      select app.claimable_by_invitation(i.user_id, i.organization_id) from invitations i where i.id = invitation
    ), false)
  $$;

revoke all on function app.invitation_redeemable(uuid) from public;
grant execute on function app.invitation_redeemable(uuid) to app_auth;

-- Links already handed out for users who can no longer be claimed are withdrawn.
update invitations i set revoked_at = now()
where i.used_at is null and i.revoked_at is null and not app.claimable_by_invitation(i.user_id, i.organization_id);

-- A call centre's admin changes only users who belong to no other call centre. The user row
-- is global (name, phone, e-mail, status), so one call centre must not change it for another.
create function app.only_in_current_org(target_user uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select app.is_member_of_current_org(target_user)
      and not exists (select 1 from memberships where user_id = target_user and organization_id <> app.current_org_id())
  $$;

revoke all on function app.only_in_current_org(uuid) from public;
grant execute on function app.only_in_current_org(uuid) to app_user;

drop policy users_update on users;
create policy users_update on users for update to app_user
  using (
    (app.only_in_current_org(id) and (select app.has_permission('users.manage')))
    or (select app.is_platform_admin())
  )
  with check (
    (app.only_in_current_org(id) and (select app.has_permission('users.manage')))
    or (select app.is_platform_admin())
  );
