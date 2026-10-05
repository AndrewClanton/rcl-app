-- Card reader status (Andrew, 10/3: the reader died mid-service). The
-- register asks Stripe about its reader about once a minute and just before
-- a card charge (lib/terminal/reader-health.ts). Stripe's answer is kept here
-- so every register, on any server, shares one answer for ~45 seconds
-- instead of each asking Stripe on its own.
--
-- card_reader_status: one row per reader, Stripe's last answer.
--   online       Stripe's status (online/offline)
--   last_seen_at when Stripe last heard from the reader
--   info         what the Devices panel shows: label, model, serial's last
--                4, software, IP, location, what it's doing
--   checked_at   when Stripe answered
-- card_reader_events: each time a reader went offline or came back, for
-- Devices' "Offline 3 times today". Stripe gives no battery level for a
-- smart reader, so going offline again and again is the warning sign.
--
-- record_card_reader_check: saves an answer and logs a change, in one go.
--
-- Staff-only data: RLS on, no policies; the server reads and writes it with
-- the service role. Safe to run twice.

create table if not exists public.card_reader_status (
  reader_id text primary key,
  online boolean,
  last_seen_at timestamptz,
  info jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create table if not exists public.card_reader_events (
  id bigint generated always as identity primary key,
  reader_id text not null,
  online boolean not null,
  at timestamptz not null default now()
);

create index if not exists card_reader_events_reader_at on public.card_reader_events (reader_id, at desc);

alter table public.card_reader_status enable row level security;
alter table public.card_reader_events enable row level security;

grant select, insert, update on public.card_reader_status to service_role;
grant select, insert on public.card_reader_events to service_role;
grant usage, select on sequence public.card_reader_events_id_seq to service_role;

create or replace function public.record_card_reader_check(p_reader_id text, p_online boolean, p_last_seen_at timestamptz, p_info jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  prev boolean;
  existed boolean;
begin
  select online into prev from card_reader_status where reader_id = p_reader_id for update;
  existed := found;
  insert into card_reader_status (reader_id, online, last_seen_at, info, checked_at)
  values (p_reader_id, p_online, p_last_seen_at, coalesce(p_info, '{}'::jsonb), now())
  on conflict (reader_id) do update
    set online = excluded.online, last_seen_at = excluded.last_seen_at, info = excluded.info, checked_at = excluded.checked_at;
  -- A change, or a reader first seen offline. No answer (null) isn't one.
  if p_online is not null and ((existed and prev is distinct from p_online) or (not existed and not p_online)) then
    insert into card_reader_events (reader_id, online) values (p_reader_id, p_online);
  end if;
end;
$$;

revoke execute on function public.record_card_reader_check(text, boolean, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_card_reader_check(text, boolean, timestamptz, jsonb) to service_role;
