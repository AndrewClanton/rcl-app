-- Now that /admin and /pos require a real Supabase Auth session
-- (src/lib/auth.ts), and there's no public signup, "authenticated" is a
-- reasonable proxy for "staff" -- these policies let the realtime
-- kitchen/box-office displays (and any future client-side reads) work
-- for a logged-in user without going through the service-role client.
-- Finer-grained (per-employee-role) policies can replace these later.
create policy "authenticated read orders" on orders for select using (auth.role() = 'authenticated');
create policy "authenticated read order_items" on order_items for select using (auth.role() = 'authenticated');
