-- register_state (from the previous migration) turned out to be the wrong
-- mechanism for mirroring an in-progress POS cart onto the customer-facing
-- kiosk: the cart isn't otherwise persisted to the database until held/
-- tabbed/completed, and routing the live mirror through that lifecycle
-- would mean touching payment-critical checkout code for a display-only
-- feature. Using Supabase Realtime's broadcast channel instead (ephemeral,
-- no table involved) -- see src/app/pos/PosApp.tsx and
-- src/app/display/customer/CustomerDisplay.tsx.
drop table if exists register_state;
