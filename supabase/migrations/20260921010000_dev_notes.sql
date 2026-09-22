-- "Develop Mate" -- an admin-only feedback widget shown on every page of the
-- site. Lets an admin jot down a bug or a wanted change on the spot, with
-- the page they were on captured automatically, instead of texting Andrew
-- and losing the context. Reviewed at /admin/dev-notes.
create table dev_notes (
  id uuid primary key default gen_random_uuid(),
  page_path text not null,
  page_title text,
  message text not null,
  submitted_by uuid references employees(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dev_notes_status_idx on dev_notes(status);
create index dev_notes_created_at_idx on dev_notes(created_at desc);

-- Same posture as `events`/`ingredients`/`calendar_notes`: staff-only via
-- the service-role client, no public read/write policy.
alter table dev_notes enable row level security;
