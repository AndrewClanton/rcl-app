-- Removing a member's personal info (erase_member_personal_info, see
-- 20260929220000 and src/lib/member-erase.ts) now also clears their email
-- marketing record:
--   - their prefs row (categories, pause, consent source, engagement) goes;
--   - the address hash on their consent log rows is blanked (the rows stay,
--     nameless, as the record of what was chosen and when);
--   - any email still waiting to go to them here is cancelled. One already
--     handed to Resend for later is cancelled there by the app first.
-- email_sends and email_events never hold an address. The never-mail list
-- (email_suppressions) is kept on purpose: someone who asked us to stop is
-- never emailed again, even after their account is gone.
--
-- Done with a trigger on members.erased_at, the same way the birthday and
-- badges are cleared (20260930030000), so the function itself doesn't have
-- to be rewritten and anything that sets erased_at is covered.
--
-- Additive and safe to run twice.

create or replace function public.members_erase_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    delete from member_email_prefs where member_id = new.id;
    update email_consent_log set email_hash = null where member_id = new.id and email_hash is not null;
    update email_sends set status = 'cancelled', error = 'Member removed'
    where member_id = new.id and status = 'queued';
  end if;
  return new;
end;
$$;

drop trigger if exists members_erase_email on members;
create trigger members_erase_email after update of erased_at on members
  for each row execute function public.members_erase_email();

revoke execute on function public.members_erase_email() from public, anon, authenticated;
