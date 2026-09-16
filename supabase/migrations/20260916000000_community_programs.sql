-- Nonprofit community-benefit tracking: which social program (if any) a
-- comped membership came through, so reporting can tally grant-relevant
-- numbers ("N members receiving free access via the Community Access
-- Program") separately from paying Insiders+ members.

create table community_programs (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table members add column comped boolean not null default false;
alter table members add column community_program_id uuid references community_programs(id) on delete set null;
alter table members add column comp_notes text;
alter table members add column comped_by uuid references employees(id) on delete set null;
alter table members add column comped_at timestamptz;

alter table community_programs enable row level security;
create policy "authenticated read community_programs" on community_programs for select using (auth.role() = 'authenticated');
