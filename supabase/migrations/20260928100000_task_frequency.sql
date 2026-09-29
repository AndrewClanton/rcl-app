-- Checklist tasks that aren't daily: "mop the back room" once a week, "deep
-- clean the popcorn machine" once a month. A weekly or monthly task shows on
-- the checklist every day until someone ticks it off, then comes back the
-- next week (Monday) or month, so it can't quietly slip for a month.
alter table shift_tasks add column if not exists frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'monthly'));
