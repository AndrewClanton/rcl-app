-- Tip payouts (Reports -> Day -> Tips -> "Record tip payout"): how a
-- business day's tips were split and handed out, one row per person.
-- A manager picks a way to split them (even, by hours, or by who rang each
-- sale), ticks who's in, and records it; recording the day again replaces
-- it (the rows for anyone no longer in it are removed). The Week report
-- adds them up per person and lists days with tips not yet recorded.
--   business_date  the 4 a.m. to 4 a.m. Central day the tips were taken
--   method         even | hours | rang (the same for every row of a day)
--   amount         what this person got, to the cent
--   recorded_by    the manager signed in when it was recorded
--   note           anything said with it, e.g. tips left unassigned
-- Tips nobody was given (rung under the shared register login, under "by
-- who rang it") have no row; the note says how much.
--
-- Written and read by the server only (src/app/admin/reports/tip-actions.ts,
-- src/lib/data/day-drill.ts): RLS on, no client policies. Additive and
-- safe to run twice.

create table if not exists tip_payouts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  method text not null check (method in ('even', 'hours', 'rang')),
  employee_id uuid not null references employees(id),
  amount numeric(10,2) not null check (amount >= 0),
  recorded_by uuid references employees(id) on delete set null,
  recorded_at timestamptz not null default now(),
  note text,
  -- Also the index for reading a day or a week (business_date leads).
  constraint tip_payouts_day_person unique (business_date, employee_id)
);

alter table tip_payouts enable row level security;
