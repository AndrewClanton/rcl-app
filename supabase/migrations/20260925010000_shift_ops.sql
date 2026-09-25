-- Shift operations on the register: who's on shift, the daily task
-- checklist, the par sheet, and reminders. Everything here is edited from
-- the register tablet by whoever is on shift, so every change is logged.
-- Staff-only data: RLS on, no policies; read and written by the server.

-- ---------- shifts ----------
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  closed_for_night boolean not null default false
);
create index if not exists shifts_open_idx on shifts(started_at) where ended_at is null;

-- ---------- tasks ----------
create table if not exists shift_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  -- When in the day it belongs: shown in the opening list, the closing list,
  -- or any time.
  timing text not null default 'anytime' check (timing in ('opening', 'closing', 'anytime')),
  -- Days of the week it's due (0 = Sunday); null = every day.
  days smallint[],
  -- A specific person, or null for whoever is on shift.
  assignee_id uuid references employees(id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One tick per task per day (Central time date).
create table if not exists task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references shift_tasks(id) on delete cascade,
  work_date date not null,
  completed_by uuid references employees(id) on delete set null,
  shift_id uuid references shifts(id) on delete set null,
  completed_at timestamptz not null default now(),
  unique (task_id, work_date)
);
create index if not exists task_completions_date_idx on task_completions(work_date);

-- ---------- par sheet ----------
create table if not exists par_items (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  section text,
  name text not null,
  par_qty numeric(10,2),
  unit text,
  source text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists par_counts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references shifts(id) on delete set null,
  counted_by uuid references employees(id) on delete set null,
  completed_at timestamptz not null default now()
);

create table if not exists par_count_lines (
  count_id uuid not null references par_counts(id) on delete cascade,
  item_id uuid not null references par_items(id) on delete cascade,
  qty numeric(10,2) not null check (qty >= 0),
  -- Snapshot of the item as counted, so old counts still read correctly
  -- after the list is edited.
  par_qty numeric(10,2),
  primary key (count_id, item_id)
);

-- ---------- reminders ----------
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  -- before_screening: `minutes` before each screening starts
  -- daily: at `time_of_day` on `days` (null = every day)
  -- schedule_low: when fewer than `minutes` days of screenings are scheduled
  kind text not null check (kind in ('before_screening', 'daily', 'schedule_low')),
  message text not null,
  minutes int,
  time_of_day time,
  days smallint[],
  assignee_id uuid references employees(id) on delete set null,
  active boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Done" on a reminder, per occurrence (a screening id, or a date).
create table if not exists reminder_dismissals (
  reminder_id uuid not null references reminders(id) on delete cascade,
  occurrence text not null,
  dismissed_by uuid references employees(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (reminder_id, occurrence)
);

-- ---------- change log ----------
create table if not exists ops_changes (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('task', 'par_item', 'reminder')),
  entity_id uuid,
  action text not null check (action in ('added', 'changed', 'removed', 'restored')),
  summary text not null,
  changed_by uuid references employees(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists ops_changes_at_idx on ops_changes(changed_at desc);

alter table shifts enable row level security;
alter table shift_tasks enable row level security;
alter table task_completions enable row level security;
alter table par_items enable row level security;
alter table par_counts enable row level security;
alter table par_count_lines enable row level security;
alter table reminders enable row level security;
alter table reminder_dismissals enable row level security;
alter table ops_changes enable row level security;
