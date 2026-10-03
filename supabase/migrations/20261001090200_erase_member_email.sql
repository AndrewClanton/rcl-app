-- Removing a member's personal info (erase_member_personal_info, see
-- 20260929220000 and src/lib/member-erase.ts) now also clears their email
-- marketing record:
--   - their prefs row (categories, pause, consent source, engagement) goes;
--   - the address hash on their consent log rows is blanked (the rows stay,
--     nameless, as the record of what was chosen and when), and so is the
--     one on their emails' webhook events;
--   - any email still waiting to go to them here is cancelled. One already
--     handed to Resend for later is cancelled there by the app first.
-- email_sends and email_events never hold an address. The never-mail list
-- (email_suppressions) is kept on purpose: someone who asked us to stop is
-- never emailed again, even after their account is gone. That includes
-- someone who had unsubscribed: their address goes on the list (hashed) as
-- 'unsubscribed' as the member row is cleared, so a later import, the kiosk
-- or the join form can't sign them back up for marketing. (Someone who
-- still wanted email when they were removed isn't listed.)
--
-- Done with a trigger on members.erased_at, the same way the birthday and
-- badges are cleared (20260930030000), so the function itself doesn't have
-- to be rewritten and anything that sets erased_at is covered. The erase
-- function clears the email in the same update, so the trigger reads the
-- address and the email setting from the row as it was (old).
--
-- Additive and safe to run twice. The trigger briefly locks members: apply
-- outside service hours (it gives up after 5 seconds rather than queue the
-- register behind it).
set local lock_timeout = '5s';

create or replace function public.members_erase_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    if old.email is not null and btrim(old.email) <> '' and old.email_opt_in = false then
      insert into email_suppressions (email_hash, reason, note)
      values (encode(sha256(convert_to(lower(btrim(old.email)), 'UTF8')), 'hex'), 'unsubscribed', 'Had unsubscribed; account removed')
      on conflict (email_hash) do update set last_at = now();
    end if;
    delete from member_email_prefs where member_id = new.id;
    update email_consent_log set email_hash = null where member_id = new.id and email_hash is not null;
    update email_events set detail = detail - 'to_hash'
    where send_id in (select id from email_sends where member_id = new.id) and detail ? 'to_hash';
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
