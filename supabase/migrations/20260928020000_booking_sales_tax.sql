-- Online ticket purchases now carry Missouri sales tax (8.725%, added by
-- Stripe). Record what was collected on each booking so receipts, member
-- purchase lists and the reports can show it. Register tickets keep their
-- tax on the order, as before, so theirs stays 0 here.
alter table bookings add column if not exists tax_amount numeric(10,2) not null default 0;
