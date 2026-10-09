-- The Badge Case, build 2: event badges (docs/cloud-handoff/badges,
-- src/lib/badges/attendance.ts, src/lib/badges/events.ts).
--
--   event_series   the short managed list of series tags a showing or a
--                  house event can carry (Trivia, Horror Month, ...).
--                  Managers add more in Back office -> Badges -> Series tags.
--   screenings.series, house_events.series
--                  one optional tag each. A renamed tag follows; a removed
--                  one leaves the showing untagged.
--   badge_drafts   badges suggested from the calendar (an upcoming house
--                  event, a tagged showing, a series), waiting for a
--                  manager. Nothing is awarded until one is approved: then
--                  it becomes a badge_defs row with an `event` rule.
--
-- Who "came" and the awarding live in the app (lib/badges/attendance.ts);
-- the claim and its points go through award_member_badge (build 1), so
-- points caps and rewards are exactly as before.
--
-- Additive and safe to run twice. Server-only: RLS on, no client policies.

-- ---------- series tags ----------
create table if not exists public.event_series (
  name text primary key check (char_length(name) between 2 and 40),
  sort int not null default 100,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.event_series enable row level security;
grant select, insert, update on public.event_series to service_role;

insert into public.event_series (name, sort) values
  ('Trivia', 10),
  ('Horror Month', 20),
  ('Midweek Movies', 30),
  ('Members'' Showing', 40),
  ('Outdoor', 50),
  ('Comedy', 60),
  ('Book Swap', 70)
on conflict (name) do nothing;

alter table public.screenings add column if not exists series text references public.event_series(name) on update cascade on delete set null;
alter table public.house_events add column if not exists series text references public.event_series(name) on update cascade on delete set null;
create index if not exists screenings_series_idx on public.screenings (series, starts_at) where series is not null;
create index if not exists house_events_series_idx on public.house_events (series, starts_at) where series is not null;

-- Who came to a showing: their confirmed tickets, by showing.
create index if not exists bookings_member_screening_idx on public.bookings (member_id, screening_id) where member_id is not null;

-- ---------- drafts from the calendar ----------
create table if not exists public.badge_drafts (
  id uuid primary key default gen_random_uuid(),
  -- What it's for: one showing, one house event, or a series ("came to 5
  -- Trivia nights"). source_ref: the showing's or event's id, or the
  -- series name. One draft per thing, ever: a skipped one stays skipped.
  source_kind text not null check (source_kind in ('screening', 'house_event', 'series')),
  source_ref text not null,
  source_label text not null, -- staff-facing: "Trivia Night, Fri Oct 16"
  starts_at timestamptz, -- the showing's or event's start; null for a series
  times int not null default 1 check (times between 1 and 100),
  name text not null,
  flavor text not null default '',
  parts_spec jsonb not null,
  form_label text,
  points int not null default 25 check (points between 0 and 1000),
  status text not null default 'open' check (status in ('open', 'approved', 'skipped')),
  def_id uuid references public.badge_defs(id),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_kind, source_ref)
);
create index if not exists badge_drafts_open_idx on public.badge_drafts (starts_at) where status = 'open';
alter table public.badge_drafts enable row level security;
grant select, insert, update on public.badge_drafts to service_role;
