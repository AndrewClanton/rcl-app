-- Card-linked points: if a member forgets to sign in (or staff forget to
-- attach them), a card sale still earns their points when they pay with a
-- card they've paid with before on their account.
--
-- How a card is recognized: Stripe gives every card payment a
-- "fingerprint", a code that is the same each time the same card number
-- is used on our Stripe account, and says nothing about the number itself.
-- We keep that code with the card's brand and last four digits (for
-- showing "Visa •••• 4242"). Never a card number.
--
--   - member_cards: which member each card belongs to. Linked when a card
--     sale is saved with a member attached, when a signed-in member buys
--     tickets online, and from an Insiders+ subscription's card. A link
--     removed by the member or staff stays as a "removed" row, so the same
--     card isn't linked to them again on its own.
--   - orders.card_*: the card a register sale was paid with (read from
--     Stripe by the server, never sent by the register), and
--     member_source = 'card' when the member was found by that card rather
--     than attached by staff.
--   - members.link_cards: the member's own on/off switch (their account's
--     Profile tab). Off: no new links, and no matching.
--   - attach_card_member(): gives a card-matched sale to its member and
--     pays its points, once, in one transaction.
--   - undo_card_match(): takes that back (the register's Undo, or a
--     manager in Back office): the points come off through the points
--     history, and that member's link to the card is removed.
--   - Removing a member's personal info also deletes their linked cards
--     and the card details on their orders.
--
-- Additive and safe to run more than once. The app code that uses this
-- must be deployed only after it has been applied.

-- ---------- linked cards ----------
create table if not exists member_cards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  -- Stripe's card fingerprint. Never a card number.
  fingerprint text not null,
  -- Test-mode payments must never match real ones.
  livemode boolean not null,
  brand text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  -- apple_pay, google_pay, ... when a phone or watch paid; null for the
  -- card itself. A phone counts as its own card: Stripe gives it a
  -- different fingerprint from the plastic card.
  wallet text check (wallet is null or wallet ~ '^[a-z_]{1,40}$'),
  -- How it was linked: a register sale (a tap, an insert, or a tab's card
  -- on file), tickets bought online, or the Insiders+ subscription.
  source text not null check (source in ('register', 'online', 'plus')),
  linked_order_id uuid references orders(id) on delete set null,
  linked_booking_id uuid references bookings(id) on delete set null,
  linked_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Removed: no longer used for matching, and never linked to this member
  -- again on its own (a manager can link it again on their page).
  removed_at timestamptz,
  removed_by_member boolean not null default false,
  removed_by uuid references employees(id) on delete set null,
  unique (member_id, fingerprint, livemode)
);
-- Every link to a card, removed ones too (a removed link is what keeps it
-- from coming back). A member's own cards use the unique index above.
create index if not exists member_cards_fingerprint_idx on member_cards (fingerprint, livemode);

-- Server-only, like the rest: RLS on, no client policies.
alter table member_cards enable row level security;

-- ---------- the card on each sale ----------
alter table orders add column if not exists card_fingerprint text;
alter table orders add column if not exists card_livemode boolean;
alter table orders add column if not exists card_brand text;
alter table orders add column if not exists card_last4 text;
alter table orders add column if not exists card_wallet text;
-- null: attached by staff (or no member). 'card': found by the card.
-- 'backfill': reserved for a later, reviewed catch-up of past sales.
alter table orders add column if not exists member_source text check (member_source in ('card', 'backfill'));
create index if not exists orders_card_fingerprint_idx on orders (card_fingerprint) where card_fingerprint is not null;

-- ---------- the member's own switch ----------
alter table members add column if not exists link_cards boolean not null default true;

-- ---------- giving a sale to the card's member ----------
-- Only a completed sale with nobody on it, whose points nobody has earned
-- yet (after an Undo, the sale stays without a member: a second member's
-- points go on by hand with Adjust points). Pays 1 point per $1 of the
-- subtotal, like a sale rung up with the member attached. Returns the
-- points paid, or null when nothing was done (so a repeat does nothing).
create or replace function public.attach_card_member(p_order uuid, p_member uuid, p_note text, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  paid numeric := 0;
begin
  select * into o from orders where id = p_order for update;
  -- Only a card sale whose card is on it (read from Stripe by the server).
  if not found or o.status <> 'completed' or o.member_id is not null or o.card_fingerprint is null then
    return null;
  end if;
  if exists (select 1 from points_ledger where order_id = p_order and reason = 'purchase') then
    return null;
  end if;
  if not exists (select 1 from members where id = p_member and erased_at is null) then
    return null;
  end if;

  update orders set member_id = p_member, member_source = 'card' where id = p_order;
  if coalesce(o.subtotal, 0) > 0 then
    perform public.apply_member_points(p_member, o.subtotal, 'purchase', p_order, null, p_note, p_by);
    paid := o.subtotal;
  end if;
  -- Movie tickets sold on the sale go in their history too.
  update bookings set member_id = p_member where order_id = p_order and member_id is null;
  update member_cards set last_used_at = now()
  where member_id = p_member and fingerprint = o.card_fingerprint and livemode = coalesce(o.card_livemode, livemode) and removed_at is null;
  return paid;
end;
$$;

-- ---------- undoing it ----------
-- Only for a sale whose member was found by the card. Takes back whatever
-- that member still holds from the sale (its points, less any a partial
-- refund already took back) as a 'refund' row, so a real refund later
-- finds nothing left to take. The sale goes back to having no member, and
-- that member's link to the card is removed so it doesn't match again.
-- Returns the points taken back, or null when there was nothing to undo.
create or replace function public.undo_card_match(p_order uuid, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  held numeric;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.member_id is null or o.member_source is distinct from 'card' then
    return null;
  end if;

  select coalesce(sum(delta), 0) into held
  from points_ledger
  where order_id = p_order and member_id = o.member_id and reason in ('purchase', 'redeem', 'refund');
  if held <> 0 then
    perform public.apply_member_points(o.member_id, -held, 'refund', p_order, null, 'Card match undone', p_by);
  end if;

  update orders set member_id = null, member_source = null where id = p_order;
  update bookings set member_id = null where order_id = p_order and member_id = o.member_id;
  if o.card_fingerprint is not null then
    update member_cards set removed_at = now(), removed_by = p_by
    where member_id = o.member_id and fingerprint = o.card_fingerprint and livemode = coalesce(o.card_livemode, livemode) and removed_at is null;
  end if;
  return held;
end;
$$;

-- ---------- removing a member's personal info ----------
-- erase_member_personal_info (20260929220000) sets erased_at; when it does,
-- their linked cards go, and so do the card details on their orders.
create or replace function public.members_erase_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    delete from member_cards where member_id = new.id;
    update orders set card_fingerprint = null, card_brand = null, card_last4 = null, card_wallet = null
    where member_id = new.id and (card_fingerprint is not null or card_last4 is not null);
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_cards on members;
create trigger members_erase_cards after update of erased_at on members
  for each row execute function public.members_erase_cards();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.attach_card_member(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.undo_card_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.members_erase_cards() from public, anon, authenticated;
grant execute on function public.attach_card_member(uuid, uuid, text, uuid) to service_role;
grant execute on function public.undo_card_match(uuid, uuid) to service_role;
