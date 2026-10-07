-- Back office > Showtimes > Sync from calendar (Andrew, 10/7): Caleb
-- uploads the staff calendar and the schedule follows it
-- (src/lib/calendar-sync.ts). One row per sync, so the page can say "Last
-- synced by Caleb · 2:14 PM", and apply_calendar_sync() writes a sync's
-- removals, changes and adds in one transaction: all of it lands or none.
--
-- A removal skips any showing that has tickets held by then (the same rule
-- as screenings_keep_sold_tickets, 20260929213000), instead of failing the
-- whole sync; the count comes back as `kept`.
--
-- Server-only like the other staff tables: RLS on, no client policies.
-- Additive and safe to run more than once.

create table if not exists calendar_syncs (
  id uuid primary key default gen_random_uuid(),
  synced_by uuid references employees(id) on delete set null,
  synced_by_name text check (synced_by_name is null or length(synced_by_name) <= 120),
  file_name text check (file_name is null or length(file_name) <= 300),
  added int not null default 0,
  changed int not null default 0,
  removed int not null default 0,
  kept int not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists calendar_syncs_created_idx on calendar_syncs (created_at desc);
alter table calendar_syncs enable row level security;
grant select, insert on public.calendar_syncs to service_role;

create or replace function public.apply_calendar_sync(
  p_adds jsonb,
  p_changes jsonb,
  p_removes uuid[],
  p_by uuid,
  p_by_name text,
  p_file text,
  p_summary jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  n_removed int := 0;
  n_kept int := 0;
  n_changed int := 0;
  n_added int := 0;
  c jsonb;
begin
  -- Removals first, so a showing moved or added into that slot fits.
  with gone as (
    delete from screenings s
    where s.id = any(coalesce(p_removes, '{}'))
      and not exists (
        select 1 from bookings b
        where b.screening_id = s.id
          and (b.status = 'confirmed' or (b.status = 'pending' and b.created_at > now() - interval '35 minutes'))
      )
    returning 1
  )
  select count(*) into n_removed from gone;
  n_kept := coalesce(array_length(p_removes, 1), 0) - n_removed;

  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    update screenings set
      room_id = coalesce((c->>'room_id')::uuid, room_id),
      starts_at = coalesce((c->>'starts_at')::timestamptz, starts_at),
      visibility = coalesce(c->>'visibility', visibility),
      ticket_price = coalesce((c->>'ticket_price')::numeric, ticket_price),
      capacity = coalesce((c->>'capacity')::int, capacity)
    where id = (c->>'id')::uuid;
    if found then n_changed := n_changed + 1; end if;
  end loop;

  insert into screenings (movie_id, room_id, starts_at, visibility, ticket_price, capacity)
  select (a->>'movie_id')::uuid, (a->>'room_id')::uuid, (a->>'starts_at')::timestamptz, a->>'visibility', (a->>'ticket_price')::numeric, (a->>'capacity')::int
  from jsonb_array_elements(coalesce(p_adds, '[]'::jsonb)) a;
  get diagnostics n_added = row_count;

  insert into calendar_syncs (synced_by, synced_by_name, file_name, added, changed, removed, kept, summary)
  values (p_by, left(p_by_name, 120), left(p_file, 300), n_added, n_changed, n_removed, n_kept, coalesce(p_summary, '{}'::jsonb));

  return jsonb_build_object('added', n_added, 'changed', n_changed, 'removed', n_removed, 'kept', n_kept);
end;
$$;

revoke execute on function public.apply_calendar_sync(jsonb, jsonb, uuid[], uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_calendar_sync(jsonb, jsonb, uuid[], uuid, text, text, jsonb) to service_role;
