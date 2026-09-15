-- Draft orders (held/tab status) need to round-trip the "monthly member"
-- toggle itself, not just the resulting discount dollar amount, so a
-- resumed cart can keep recomputing totals as items change.
alter table orders add column monthly_member boolean not null default false;
