-- Ad-hoc calendar notes for the schedule graphic -- lets staff notate things
-- like "closed 6-9pm for a private event" on a specific day/time without
-- that needing to be a real screening or a billed private-event booking.
create table calendar_notes (
  id uuid primary key default gen_random_uuid(),
  note_date date not null,
  -- Null start_time = an all-day note for that date.
  start_time time,
  end_time time,
  label text not null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index calendar_notes_date_idx on calendar_notes(note_date);

-- Same posture as `events`/`ingredients`: staff-only, no public read policy.
alter table calendar_notes enable row level security;
