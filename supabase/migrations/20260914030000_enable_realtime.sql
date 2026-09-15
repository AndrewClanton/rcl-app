-- Kitchen-prep and box-office displays subscribe to these tables via
-- Supabase Realtime (postgres_changes) so they update the instant a POS
-- checkout completes, per the "true realtime, not polling" decision.
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table screenings;
