-- Register sales the server wanted a person to look at. Written by
-- lib/register-sale-checks.ts (flagSale) and read on the back office's
-- Reports -> Register checks (managers and up). One row per thing to look at:
--
--   totals_mismatch       the order's math didn't match the server's own from
--                         menu prices, modifiers, tickets, discounts and tax
--                         (saved anyway: the check is log-only for now)
--   totals_refused        the same, refused (only once enforcing is switched on)
--   card_refused          a card payment Stripe said wasn't real, didn't go
--                         through, wasn't the register's, or was for a
--                         different amount; the sale wasn't saved
--   card_unchecked        Stripe couldn't be reached to confirm the card
--                         payment, so the sale was saved unchecked (or a tab's
--                         card on file paid a different tab)
--   points_short          a points reward was used but the member no longer
--                         had the points, so none were taken off
--   tab_closed_elsewhere  a tab's card payment arrived after the tab had been
--                         closed (paid or cancelled) on another register, so
--                         it was saved as a new walk-up order. Possible double
--                         charge: check both and refund one.
--   sale_abandoned        a card was charged but the sale never saved, and
--                         someone tapped "Stop trying" on the register's
--                         warning. The card stays charged with no sale in
--                         Reports: refund it or ring the sale up by hand.
--   items_not_saved       an order saved but its items didn't; the lines the
--                         register sent are in details, to put back by hand
--
-- kind is free text, so a new kind needs no migration (list it here and in
-- SaleFlagKind). `details` holds what the register sent and what the server
-- figured, but no customer names (no order or tab name): an order is found by
-- its number, a tab by its id, so erasing a member's details
-- (erase_member_personal_info) has no names to clear here.
--
-- Named 20261001200000 (it was written as 20260929210000, then
-- 20261001100000; both prefixes are taken by other migrations). The app
-- tolerates this table being missing (it still writes the server log, and
-- the report says the table isn't there), so it can be applied any time.
-- Safe to run more than once.

create table if not exists register_sale_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  order_id uuid references orders(id) on delete set null,
  order_number bigint,
  employee_id uuid references employees(id) on delete set null,
  stripe_payment_intent_id text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists register_sale_flags_created_idx on register_sale_flags (created_at desc);
create index if not exists register_sale_flags_kind_idx on register_sale_flags (kind, created_at desc);
create index if not exists register_sale_flags_payment_idx on register_sale_flags (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- Server-only, like the rest: RLS on, no client policies.
alter table register_sale_flags enable row level security;
