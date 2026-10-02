-- Phase 1, the call centre's admin portal (docs/plan.md, section 11).

-- An admin invites by mobile number or e-mail. The person may already be a user in another
-- call centre, which this admin cannot see (RLS on users), so the lookup happens here: it
-- returns the existing user's id, and only to someone holding users.manage in the current
-- call centre.
create function app.user_id_for_invitation(lookup_phone text, lookup_email text) returns uuid
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select u.id from users u
    where app.has_permission('users.manage')
      and ((lookup_phone is not null and u.phone = lookup_phone)
        or (lookup_email is not null and lower(u.email) = lower(lookup_email)))
    order by u.created_at
    limit 1
  $$;

revoke all on function app.user_id_for_invitation(text, text) from public;
grant execute on function app.user_id_for_invitation(text, text) to app_user;
