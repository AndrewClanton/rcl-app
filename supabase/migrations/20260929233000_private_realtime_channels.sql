-- The register <-> customer screen link becomes private Realtime channels.
--
-- The register (/pos) and the customer tablet (/display/customer) talk over
-- Realtime broadcast: the live cart mirror and check-in for points. Those
-- were public channels, so anyone holding the site's public key who learned
-- the topic name could listen in or send fake messages. The app now joins
-- them as private channels, and Realtime only lets a client join (receive)
-- or send on a private channel when these policies on realtime.messages
-- allow it: a signed-in, active employee, display screens included (see
-- public.is_active_employee(), 20260929000000_screenings_not_public.sql).
-- Nobody else: no policy is granted to anon, and a signed-in customer has
-- no employees row.
--
-- The ramp TV and the kitchen/bar ticket boards listen for database changes
-- (postgres_changes), not broadcasts. Once the project stops allowing public
-- channels (Realtime settings, "Allow public access" off) they must be
-- private too, and Realtime only lets a client join a private channel when
-- it may receive on that topic. They get receive only; which rows they see
-- is still decided by each table's own policies.
--
-- realtime.topic() is the channel name the client joined:
--   register:<32 hex>          cart mirror          src/lib/register-topic.ts
--   register:<32 hex>:checkin  check-in for points  src/lib/checkin.ts
--   ramp-screenings            ramp TV              src/app/display/ramp/RampCountdown.tsx
--   prep-tickets-<board>       kitchen/bar boards   src/app/display/PrepTicketBoard.tsx
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
