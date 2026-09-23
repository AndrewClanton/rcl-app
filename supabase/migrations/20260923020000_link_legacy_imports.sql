-- After an import copies approved old-site accounts into members (each new
-- or linked member carries its legacy_user_id), point every legacy row at
-- its member in one set-based statement instead of one update per row.
-- Service role only.
create or replace function public.link_imported_legacy_accounts()
returns integer
language sql
security definer
set search_path = public
as $$
  with linked as (
    update legacy_accounts la
    set imported_member_id = m.id
    from members m
    where m.legacy_user_id = la.legacy_user_id
      and la.imported_member_id is null
    returning 1
  )
  select count(*)::int from linked;
$$;
revoke all on function public.link_imported_legacy_accounts() from public;
grant execute on function public.link_imported_legacy_accounts() to service_role;
