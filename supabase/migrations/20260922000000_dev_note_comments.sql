-- Follow-up notes on a dev_notes row -- e.g. explaining why something
-- marked 'done' got reopened, or leaving context while it's still being
-- worked. A small append-only thread per note, not a status field, so
-- history survives multiple rounds instead of getting overwritten.
create table dev_note_comments (
  id uuid primary key default gen_random_uuid(),
  dev_note_id uuid not null references dev_notes(id) on delete cascade,
  message text not null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index dev_note_comments_note_idx on dev_note_comments(dev_note_id, created_at);

alter table dev_note_comments enable row level security;
