-- Team tools for the office manager (Mary):
--   staff_todos     one-off jobs for a person ("Caleb: update the Now
--                   Playing movies"), or for whoever's on shift. They show
--                   on the register for that person until marked done.
--   staff_schedule  who's scheduled to work when. Compared with actual
--                   clock-ins (the `shifts` table) for timesheets: hours,
--                   in/out times, late arrivals, missed shifts.
-- Both are read and written through the server only.

create table if not exists staff_todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  assignee_id uuid references employees(id) on delete cascade, -- null: anyone on shift
  due_date date,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references employees(id) on delete set null
);
create index if not exists staff_todos_open_idx on staff_todos(assignee_id) where done_at is null;

create table if not exists staff_schedule (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists staff_schedule_starts_idx on staff_schedule(starts_at);

alter table staff_todos enable row level security;
alter table staff_schedule enable row level security;
