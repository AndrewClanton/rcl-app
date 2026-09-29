-- Check-in for points (customer screen -> register): a small, server-only
-- log of recent attempts, so the phone lookup and the new-regular sign-up
-- can refuse a burst of tries -- someone at the tablet typing number after
-- number. Keys look like "checkin-lookup:<employee id>". Rows only live as
-- long as their window; each call clears its own key's old rows.
--
-- The app tolerates this being missing (it falls back to a per-server
-- count), so it can be applied any time. Safe to run more than once.

create table if not exists rate_limit_hits (
  id bigint generated always as identity primary key,
  key text not null,
  at timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_at_idx on rate_limit_hits (key, at);

-- Server-only, like the rest: RLS on, no client policies.
alter table rate_limit_hits enable row level security;

-- Records one attempt under p_key and says whether it's allowed: false once
-- p_max attempts have landed in the last p_window_seconds (a refused attempt
-- isn't recorded, so it doesn't push the window out). One caller per key at
-- a time, so two quick taps can't both squeeze in under the limit.
create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('rate_limit_hit:' || p_key));
  delete from rate_limit_hits where key = p_key and at < now() - make_interval(secs => p_window_seconds);
  -- Now and then, sweep keys nobody has used in a day.
  if random() < 0.01 then
    delete from rate_limit_hits where at < now() - interval '1 day';
  end if;
  select count(*) into n from rate_limit_hits where key = p_key;
  if n >= p_max then
    return false;
  end if;
  insert into rate_limit_hits (key) values (p_key);
  return true;
end;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
