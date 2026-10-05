-- Emailing an organization's helper sign-up link from the website (Andrew,
-- 10/5): from the organization's Back office page, or at the register with
-- the helper typing their work email (src/lib/org-invite-server.ts). One row
-- per email sent: the organization, the address, who sent it (the staff
-- login) and from where. The organization page lists them, and they cap the
-- sends at 10 an hour per organization.
--
-- Server-only like the other staff tables: RLS on, no client policies.
-- Additive and safe to run more than once.

create table if not exists org_invite_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null check (length(email) <= 200),
  sent_by uuid references employees(id) on delete set null,
  sent_by_name text check (sent_by_name is null or length(sent_by_name) <= 120),
  source text not null check (source in ('back_office', 'register')),
  resend_id text,
  created_at timestamptz not null default now()
);
create index if not exists org_invite_sends_org_idx on org_invite_sends (organization_id, created_at desc);
alter table org_invite_sends enable row level security;
grant select, insert, delete on public.org_invite_sends to service_role;
