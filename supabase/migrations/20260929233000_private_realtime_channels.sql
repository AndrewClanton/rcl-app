-- Private Realtime channels: the register <-> customer screen link, the
-- ramp TV and the kitchen/bar/prep boards.
--
-- ORDER:
-- 1. Apply this BEFORE the app code that joins these channels as private
--    deploys (branch loose/land-security-realtime). Without these policies
--    Realtime refuses every private join, and the register's cart mirror on
--    the customer tablet, check-in for points, the ramp TV's refresh and the
--    kitchen/bar/prep boards all stop updating.
-- 2. After that code is live and checked on the devices, turn off "Allow
--    public access" in Supabase (Realtime settings). Until then a public
--    channel on these topics can still be joined, the HMAC topic name
--    (src/lib/register-topic.ts) being the only lock.
--
-- Needs public.is_active_employee() (20260929000000_screenings_not_public.sql)
-- and realtime.topic() (built into Supabase Realtime). Both already exist
-- in production.
--
-- The register (/pos) and the customer tablet (/display/customer) talk over
-- Realtime broadcast: the live cart mirror and check-in for points. Those
-- were public channels, so anyone holding the site's public key who learned
-- the topic name could listen in or send fake messages. The app now joins
-- them as private channels, and Realtime only lets a client join (receive)
-- or send on a private channel when these policies on realtime.messages
-- allow it: a signed-in, active employee, display screens included (the
-- customer tablet runs on a display-only login). Nobody else: no policy is
-- granted to anon, and a signed-in customer has no employees row.
--
-- Sending: the tablet has to send on both register topics ('request-state'
-- on the cart topic, its check-in requests on the check-in topic), so a
-- display login may send there. Realtime decides who may send from the
-- topic alone, when the client joins; a policy can't see which event a
-- message carries, so it can't be narrowed to 'request-state'. The app
-- covers that instead: on the cart topic the register acts only on
-- 'request-state' and never reads its payload (src/app/pos/PosApp.tsx), and
-- a check-in request is a sealed reference only the server can open
-- (src/lib/checkin-server.ts).
--
-- The ramp TV and the kitchen/bar/prep boards listen for database changes
-- (postgres_changes), not broadcasts. Once public channels are off they
-- must be private too, and Realtime only lets a client join a private
-- channel when it may receive on that topic. They get receive only; which
-- rows they see is still decided by each table's own policies (the boards'
-- order_items need a staff login, not a display one).
--
-- realtime.topic() is the channel name the client joined:
--   register:<32 hex>          cart mirror          src/lib/register-topic.ts
--   register:<32 hex>:checkin  check-in for points  src/lib/checkin.ts
--   ramp-screenings            ramp TV              src/app/display/ramp/RampCountdown.tsx
--   prep-tickets-<board>       kitchen/bar boards   src/app/display/PrepTicketBoard.tsx
--                              (kitchen, bar, all)
-- A new channel in the app needs its topic added here. Keep 'ramp-screenings'
-- as is even if the ramp TV's page is renamed.
--
-- Realtime checks these when a client joins (and again when its login token
-- is refreshed), not on every message.
--
-- Safe to run more than once.

drop policy if exists "employees receive register broadcasts" on realtime.messages;
create policy "employees receive register broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) ~ '^register:[0-9a-f]{32}(:checkin)?$'
    and (select public.is_active_employee())
  );

drop policy if exists "employees send register broadcasts" on realtime.messages;
create policy "employees send register broadcasts" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) ~ '^register:[0-9a-f]{32}(:checkin)?$'
    and (select public.is_active_employee())
  );

drop policy if exists "employees join live display channels" on realtime.messages;
create policy "employees join live display channels" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) in ('ramp-screenings', 'prep-tickets-kitchen', 'prep-tickets-bar', 'prep-tickets-all')
    and (select public.is_active_employee())
  );
