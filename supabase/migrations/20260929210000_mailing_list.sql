-- The members' mailing list, sent through Resend (src/lib/mailing-list.ts).
-- Safe to run twice.

-- ---------- opt-in is off unless someone asked ----------
-- email_opt_in started out defaulting to true, so everyone added by the
-- join form, a website sign-up, staff or the old-site import was marked as
-- wanting the weekly email without ever ticking a box. From now on it's
-- off unless the person turns it on (register kiosk, their account, or the
-- join form), and every one of those records when (email_opt_in_changed_at).
alter table members alter column email_opt_in set default false;

-- Anyone still on only because of the old default (no recorded choice)
-- goes off. Someone who chose -- either way -- has email_opt_in_changed_at
-- set and is left alone, so running this again changes nothing.
update members
set email_opt_in = false
where email_opt_in
  and email_opt_in_changed_at is null;

-- ---------- sends to the list ----------
-- One row per "Send to the list" press. send_key comes from the page, so a
-- double click (or a retried request) finds its own row instead of sending
-- again. Only one send can be in flight at a time.
create table if not exists mailing_sends (
  id uuid primary key default gen_random_uuid(),
  send_key uuid not null unique,
  kind text not null default 'lineup' check (kind in ('lineup')),
  range_start date,
  range_days int,
  subject text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  resend_broadcast_id text,
  recipients int,
  error text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists mailing_sends_created_idx on mailing_sends(created_at desc);
create unique index if not exists mailing_sends_one_in_flight on mailing_sends(status) where status = 'sending';
alter table mailing_sends enable row level security;

-- ---------- list syncs ----------
-- Each time the website brings Resend's list in line with who opted in:
-- nightly, from the Mailing list page, and right before every send.
create table if not exists mailing_list_syncs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual', 'send')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  complete boolean not null default false,
  subscribers int,
  added int not null default 0,
  removed int not null default 0,
  opted_out int not null default 0,
  errors text
);
create index if not exists mailing_list_syncs_started_idx on mailing_list_syncs(started_at desc);
alter table mailing_list_syncs enable row level security;
