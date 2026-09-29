-- House events: trivia night, comedy, the book swap -- things happening at
-- the Royale that aren't films. The ramp TV counts down to them alongside
-- the screenings. (Private rentals stay in `events`; these are public.)
create table if not exists house_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists house_events_starts_at_idx on house_events(starts_at);

-- Read and written only through the server (service role), like screenings'
-- admin tools; no public access.
alter table house_events enable row level security;
