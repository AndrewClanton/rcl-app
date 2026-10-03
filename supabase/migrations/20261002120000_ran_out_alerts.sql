-- Ran-out alerts: when staff tap "Ran out" on the register, the people who
-- buy for the week get an email right away, instead of a "Buy it" bar on the
-- register aimed at the cashier on shift. Running out before the week is over
-- is a problem to fix (a par that's too low), not a chore for whoever's
-- working.
--
-- settings 'ran_out_alert_to': the staff who get the email, as a JSON array
-- of employee ids, picked in Back office → Ran out by an owner or admin.
-- Seeded with Nathan and Mary (who buy for the week) only when it isn't set
-- yet; the app reads whatever's saved.
--
-- stock_outages.alert_claimed_at: the email for a report was claimed (one
-- email per report: a second tap, or the same line reported again, finds it
-- claimed). Given back if no email went out, so the next report retries.
-- stock_outages.alert_sent_to: who it actually reached, for the register's
-- "Nathan and Mary have been emailed".
--
-- Staff-only data: RLS on, no policies; read and written by the server with
-- the service role. Additive and safe to run twice.

alter table stock_outages add column if not exists alert_claimed_at timestamptz;
alter table stock_outages add column if not exists alert_sent_to uuid[] not null default '{}';

alter table settings add column if not exists updated_by uuid references employees(id) on delete set null;

insert into settings (key, value)
select 'ran_out_alert_to', coalesce(jsonb_agg(id order by split_part(name, ' ', 1) <> 'Nathan', name), '[]'::jsonb)
from employees
where active and role in ('owner', 'admin') and split_part(name, ' ', 1) in ('Nathan', 'Mary')
on conflict (key) do nothing;

alter table settings enable row level security;
alter table stock_outages enable row level security;

grant select, insert, update, delete on table settings to service_role;
grant select, insert, update, delete on table stock_outages to service_role;
