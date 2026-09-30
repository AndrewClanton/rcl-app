-- "Ran out" hands the buying to the managers: reporting that something ran
-- out makes one restock to-do ("Buy Hot dog buns at Walmart") for anyone
-- with manager access or above. The register's cashier only sees OUT on the
-- menu buttons.
--
-- staff_todos.outage_id: the "Ran out" report a to-do is for. One to-do per
-- report (reporting the same par line again adds to the open report, so it
-- never makes a second one). Marking the to-do done closes the report as
-- bought; closing the report (Bought it, Found some, False alarm) marks the
-- to-do done.
--
-- staff_todos.audience: 'managers' for a to-do for every manager, admin and
-- owner rather than one person (assignee_id stays null). Null is the old
-- meaning: assignee_id's person, or anyone on shift.
--
-- Additive and safe to run twice.

alter table staff_todos add column if not exists outage_id uuid references stock_outages(id) on delete set null;
alter table staff_todos add column if not exists audience text;

alter table staff_todos drop constraint if exists staff_todos_audience_check;
alter table staff_todos add constraint staff_todos_audience_check check (audience is null or audience = 'managers');

-- Not partial, so a plain insert racing another register fails with 23505
-- instead of making a second to-do. Nulls (ordinary to-dos) don't collide.
create unique index if not exists staff_todos_outage_id_key on staff_todos(outage_id);

-- "Ran out 3 times in 30 days": reports per par line, newest first.
create index if not exists stock_outages_par_item_reported_idx on stock_outages(par_item_id, reported_at desc) where par_item_id is not null;
