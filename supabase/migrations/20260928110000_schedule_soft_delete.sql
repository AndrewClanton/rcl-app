-- Removing a scheduled shift keeps the record (who removed it, when) and
-- can be undone; the schedule and timesheets skip removed shifts. The same
-- person can't be scheduled twice at the same start time, so copying a
-- week forward twice can't double it (and make false "didn't clock in"s).
alter table staff_schedule add column if not exists deleted_at timestamptz;
alter table staff_schedule add column if not exists deleted_by uuid references employees(id) on delete set null;
create unique index if not exists staff_schedule_one_per_start on staff_schedule(employee_id, starts_at) where deleted_at is null;
