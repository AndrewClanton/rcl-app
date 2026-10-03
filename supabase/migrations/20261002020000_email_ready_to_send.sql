-- Back office -> Email -> Ready to send: the three ready-made invite emails
-- ("The new Royale is here", "Come in", "Press play"), sent through the
-- ordinary email system (src/lib/email/designs, campaign-send.ts).
--
-- 1. email-assets: a public Storage bucket for the emails' pictures (made
--    from the canvas designs by scripts/email-designs/render.mjs and put
--    there by scripts/email-designs/upload.mjs). Our own host, never
--    anyone else's. Public read only through the public URL; nothing but
--    the service key writes to it (no policies, so no client can).
-- 2. email_sends.had_login: whether the person had a website login when
--    the email was queued, so the results can say who signed in since
--    ("Come in" goes to people with and without one).
--
-- Additive and safe to run more than once. Until it runs, the app still
-- sends (the queue just doesn't record had_login, and the results count
-- "signed in" for the invite only), but the pictures have nowhere to go.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table email_sends add column if not exists had_login boolean;

-- As before, plus had_login.
create or replace function public.email_queue_sends(p_campaign uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into email_sends (campaign_id, member_id, status, dedupe_key, deliver_at, tier_at_send, had_login)
  select p_campaign, r.member_id, r.status, nullif(r.dedupe_key, ''), r.deliver_at, r.tier_at_send, r.had_login
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(member_id uuid, status text, dedupe_key text, deliver_at timestamptz, tier_at_send text, had_login boolean)
  where r.status in ('queued', 'held_out')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.email_queue_sends(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.email_queue_sends(uuid, jsonb) to service_role;
