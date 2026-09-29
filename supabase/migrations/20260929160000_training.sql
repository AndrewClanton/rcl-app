-- Employee training: managers assign trainings (written in code, see
-- src/lib/training/catalog.ts), staff open them on the register or their
-- phone and sign off, passing a short quiz on the key ones. Additive and
-- safe to run twice.

create table if not exists training_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  module_slug text not null,
  due_date date,
  note text,
  assigned_by uuid references employees(id),
  assigned_at timestamptz not null default now(),
  -- First time they opened it, to tell "not started" from "started".
  first_opened_at timestamptz,
  unique (employee_id, module_slug)
);

-- Every sign-off is kept (a training that's updated gets signed again), so
-- there's a history of who agreed to which version, when, and where.
create table if not exists training_completions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  module_slug text not null,
  module_version int not null,
  completed_at timestamptz not null default now(),
  quiz_correct int,
  quiz_total int,
  -- 'register' (signed on the shared iPad by whoever's on shift) or
  -- 'phone' (signed in as themselves).
  via text not null default 'phone' check (via in ('register', 'phone')),
  -- The login that recorded it (the register's, for 'register').
  recorded_by uuid references employees(id)
);

create index if not exists training_completions_who on training_completions (employee_id, module_slug, completed_at desc);
create index if not exists training_assignments_slug on training_assignments (module_slug);

-- Server-only, like the rest: no client policies.
alter table training_assignments enable row level security;
alter table training_completions enable row level security;
