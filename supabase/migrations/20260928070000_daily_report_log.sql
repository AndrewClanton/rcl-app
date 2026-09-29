-- The end-of-day email to the admins: one row per business day it went
-- out, so a retried or repeated trigger can never send the same day twice.
create table if not exists daily_report_log (
  business_date date primary key,
  sent_at timestamptz not null default now(),
  recipients text[] not null default '{}',
  errors text
);

alter table daily_report_log enable row level security;
