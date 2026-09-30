-- Fixing a clock-in or clock-out after the fact (Back office → Team →
-- Timesheets): a forgotten End shift, or times that were plainly wrong.
-- Managers and up only, and every fix needs a reason.
--
-- The latest fix is on the shift itself (so the timesheet can mark it
-- "edited"), and every fix, with the times before and after, is kept in
-- shift_edits. Additive only: nothing existing changes.
--
-- The edited_by columns are deliberately NOT foreign keys: a second path
-- from shifts to employees (directly, or through shift_edits) could make the
-- existing `employee:employees(name)` lookups (the daily email) ambiguous
-- to the API and break them.

alter table shifts add column if not exists edited_by uuid;
alter table shifts add column if not exists edited_at timestamptz;
alter table shifts add column if not exists edit_note text;

create table if not exists shift_edits (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  edited_by uuid,
  edited_at timestamptz not null default now(),
  note text not null,
  old_started_at timestamptz not null,
  old_ended_at timestamptz,
  new_started_at timestamptz not null,
  new_ended_at timestamptz
);
create index if not exists shift_edits_shift_idx on shift_edits(shift_id, edited_at desc);

-- Staff-only data: RLS on, no policies; read and written by the server.
alter table shift_edits enable row level security;
