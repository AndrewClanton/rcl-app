-- Card-linked points: if a member forgets to sign in (or staff forget to
-- attach them), a card sale still earns their points when they pay with a
-- card linked to their account.
--
-- APPLY THIS BEFORE THE APP CODE THAT USES IT GOES LIVE, then run
-- scripts/check-member-cards-db.mjs. (The app's reads fall back if it's
-- missing, but no card is read, linked or matched until it's here.)
--
-- How a card is recognized: Stripe gives every card payment a
-- "fingerprint", a code that is the same each time the same card number
-- is used on our Stripe account, and says nothing about the number itself.
-- We keep that code with the card's brand and last four digits (for
-- showing "Visa •••• 4242"). Never a card number.
--
--   - card_payments: the card each register card sale or online ticket
--     payment was made with (read from Stripe by the server, never sent by
--     a register or a browser), whether or not anyone was attached. Kept in
--     its own server-only table, not on orders, so staff screens that can
--     read orders can't read card codes. When the card paid a member's
--     points on a sale nobody was attached to, it says who and how, and
--     whether that was undone.
--   - member_cards: which member each card belongs to. Linked when a card
--     pays for sales a member was attached to on 2 different days, when a
--     signed-in member buys tickets online, from an Insiders+ subscription
--     started by the member (signed in) or by staff, or by a manager in
--     Back office. A link removed by the member or staff stays as a
--     "removed" row, so the same card isn't linked to them again on its
--     own. A removed link's type and last four are deleted; only Stripe's
--     code is kept, for that.
--   - orders.member_source = 'card' when the member on a sale was put
--     there by its card rather than attached by staff. The member sees only
--     the points for such a sale, never its items or receipt, and tickets
--     on it stay off their account.
--   - members.link_cards: the member's own on/off switch (their account's
--     Profile tab). Off: no new links, and no matching.
--   - credit_card_sale(): gives a sale's points to the card's member (or
--     the member picked for a shared card, or the right member after an
--     undo), once, in one transaction.
--   - credit_card_booking(): the same for tickets bought online as a guest:
--     points only; the booking stays a guest booking.
--   - undo_card_sale() / undo_card_booking(): take it back (the register's
--     Undo for 2 minutes, then a manager in Back office). The points come
--     off through the points history. The card stays linked unless staff
--     say it isn't the member's card at all.
--   - Removing a member's personal info also deletes their linked cards
--     and the card details of their sales.
--   - Merging two accounts (merge_members, 20261001150000) moves the
--     duplicate's linked cards and card points onto the kept account. Like
--     the roadmap tables (20261001210000), member_cards and card_payments
--     have no foreign key to members on purpose: merge_members refuses to
--     merge an account any foreign key still points at. Triggers below keep
--     them right instead (a merge moves them; deleting an account removes
--     its linked cards).
--
-- Comes after 20261001150000 (member_merges, which a trigger here is on);
-- it was 20261001100000 on the card-points branch, renamed when it was
-- brought up to date with main. Additive and safe to run more than once.

-- ---------- linked cards ----------
create table if not exists member_cards (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: see the top (merges and deletes are handled below).
  member_id uuid not null,
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
  -- How it was linked: register sales (a tap, an insert, or a tab's card
  -- on file), tickets bought online signed in, the Insiders+ subscription,
  -- or a manager in Back office.
  source text not null check (source in ('register', 'online', 'plus', 'staff')),
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

-- ---------- the card on each card payment ----------
create table if not exists card_payments (
  id uuid primary key default gen_random_uuid(),
  -- A register sale, or a ticket booking paid online: one or the other.
  order_id uuid unique references orders(id) on delete cascade,
  booking_id uuid unique references bookings(id) on delete cascade,
  fingerprint text not null,
  livemode boolean not null,
  brand text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  wallet text check (wallet is null or wallet ~ '^[a-z_]{1,40}$'),
  -- Points this card paid to a member on a sale nobody was attached to:
  -- 'card' (the card's only member), 'picked' (a card on more than one
  -- account; the cashier asked who was paying), or 'given' (after an
  -- undo, the cashier gave the points to the right member).
  -- No foreign key: see the top (merges and deletes are handled below).
  credited_member_id uuid,
  credited_how text check (credited_how in ('card', 'picked', 'given')),
  credited_at timestamptz,
  credited_by uuid references employees(id) on delete set null,
  -- Taken back (the register's Undo, or a manager in Back office).
  undone_at timestamptz,
  undone_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint card_payments_one_sale check ((order_id is null) <> (booking_id is null))
);
create index if not exists card_payments_fingerprint_idx on card_payments (fingerprint, livemode);
create index if not exists card_payments_credited_idx on card_payments (credited_member_id) where credited_member_id is not null;

-- Server-only: RLS on, no client policies. (The card code is here, not on
-- orders, because signed-in staff screens can read orders.)
alter table card_payments enable row level security;

-- A copy of this file from before the merge with main (20261001100000) put
-- foreign keys to members on these two columns. Gone, so a merge isn't
-- refused over them.
alter table member_cards drop constraint if exists member_cards_member_id_fkey;
alter table card_payments drop constraint if exists card_payments_credited_member_id_fkey;

-- ---------- how the member got on a sale ----------
-- null: attached by staff (or no member). 'card': put there by its card
-- (credit_card_sale). 'backfill': reserved for a later, reviewed catch-up
-- of past sales.
alter table orders add column if not exists member_source text check (member_source in ('card', 'backfill'));

-- ---------- the member's own switch ----------
alter table members add column if not exists link_cards boolean not null default true;

-- ---------- giving a sale's points by its card ----------
-- A completed register sale with nobody on it, whose card was read from
-- Stripe (card_payments). p_how:
--   'card' / 'picked': the sale's first points: a 'purchase' row, like a
--     sale rung up with the member attached (1 point per $1 after the
--     member, monthly and reward discounts, before tax and tip: pointsEarned
--     in lib/register-totals.ts, what completeOrder pays), only if nobody
--     has earned this sale's points yet.
--   'given': after an undo on this sale, the points go to the right
--     member instead. A sale earns one 'purchase' row, ever, so this is an
--     'adjustment' row tied to the order (a refund later takes it back).
-- Tickets on the sale stay off the member's account. Returns the points
-- paid, or null when nothing was done (so a repeat does nothing).
create or replace function public.credit_card_sale(p_order uuid, p_member uuid, p_how text, p_note text, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  cp card_payments%rowtype;
  pts numeric := 0;
begin
  if p_how not in ('card', 'picked', 'given') then
    return null;
  end if;
  select * into o from orders where id = p_order for update;
  if not found or o.status <> 'completed' or o.member_id is not null then
    return null;
  end if;
  select * into cp from card_payments where order_id = p_order for update;
  if not found then
    return null;
  end if;
  if not exists (select 1 from members where id = p_member and erased_at is null) then
    return null;
  end if;
  if p_how = 'given' then
    if cp.undone_at is null then
      return null;
    end if;
  elsif cp.credited_member_id is not null or cp.undone_at is not null
     or exists (select 1 from points_ledger where order_id = p_order and reason = 'purchase') then
    return null;
  end if;

  update orders set member_id = p_member, member_source = 'card' where id = p_order;
  -- pointsEarned (lib/register-totals.ts): never negative, to the cent.
  pts := greatest(0, round(coalesce(o.subtotal, 0) - coalesce(o.tier_discount, 0) - coalesce(o.monthly_discount, 0) - coalesce(o.redemption_discount, 0), 2));
  if pts > 0 then
    perform public.apply_member_points(p_member, pts, case when p_how = 'given' then 'adjustment' else 'purchase' end, p_order, null, p_note, p_by);
  end if;
  update card_payments
  set credited_member_id = p_member, credited_how = p_how, credited_at = now(), credited_by = p_by, undone_at = null, undone_by = null
  where id = cp.id;
  if p_how <> 'given' then
    update member_cards set last_used_at = now()
    where member_id = p_member and fingerprint = cp.fingerprint and livemode = cp.livemode and removed_at is null;
  end if;
  return pts;
end;
$$;

-- The same for tickets bought online by a guest: the card's only member
-- gets the tickets' points (1 per $1, like any online booking). Points
-- only: the booking stays a guest booking, so its tickets and door code
-- never show on the member's account. Once per booking.
create or replace function public.credit_card_booking(p_booking uuid, p_member uuid, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  b bookings%rowtype;
  cp card_payments%rowtype;
  pts numeric := 0;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or b.status <> 'confirmed' or b.member_id is not null or b.order_id is not null then
    return null;
  end if;
  select * into cp from card_payments where booking_id = p_booking for update;
  if not found or cp.credited_member_id is not null or cp.undone_at is not null then
    return null;
  end if;
  if exists (select 1 from points_ledger where booking_id = p_booking and reason = 'purchase') then
    return null;
  end if;
  if not exists (select 1 from members where id = p_member and erased_at is null) then
    return null;
  end if;

  pts := coalesce(b.unit_price, 0) * coalesce(b.quantity, 0);
  if pts > 0 then
    perform public.apply_member_points(p_member, pts, 'purchase', null, p_booking, p_note, null);
  end if;
  update card_payments set credited_member_id = p_member, credited_how = 'card', credited_at = now() where id = cp.id;
  update member_cards set last_used_at = now()
  where member_id = p_member and fingerprint = cp.fingerprint and livemode = cp.livemode and removed_at is null;
  return pts;
end;
$$;

-- ---------- undoing it ----------
-- Takes back whatever that member still holds from the sale (its points,
-- less any a partial refund already took back) as a 'refund' row, so a real
-- refund later finds nothing left to take. The sale goes back to having no
-- member. p_unlink: it wasn't their card at all, so their link to it is
-- removed too (only for a match the card made on its own; a cashier's pick
-- of a shared card, or points given after an undo, never unlink anyone).
-- Returns the points taken back, or null when there was nothing to undo.
create or replace function public.undo_card_sale(p_order uuid, p_unlink boolean, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  cp card_payments%rowtype;
  held numeric;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.member_id is null or o.member_source is distinct from 'card' then
    return null;
  end if;
  select * into cp from card_payments where order_id = p_order for update;

  select coalesce(sum(delta), 0) into held
  from points_ledger
  where order_id = p_order and member_id = o.member_id and reason in ('purchase', 'redeem', 'refund', 'adjustment');
  if held <> 0 then
    perform public.apply_member_points(o.member_id, -held, 'refund', p_order, null, 'Card match undone', p_by);
  end if;

  update orders set member_id = null, member_source = null where id = p_order;
  if cp.id is not null then
    update card_payments set undone_at = now(), undone_by = p_by where id = cp.id;
    if p_unlink and cp.credited_how = 'card' then
      update member_cards set removed_at = now(), removed_by = p_by, brand = null, last4 = null, wallet = null
      where member_id = o.member_id and fingerprint = cp.fingerprint and livemode = cp.livemode and removed_at is null;
    end if;
  end if;
  return held;
end;
$$;

create or replace function public.undo_card_booking(p_booking uuid, p_unlink boolean, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  cp card_payments%rowtype;
  held numeric;
begin
  select * into cp from card_payments where booking_id = p_booking for update;
  if not found or cp.credited_member_id is null or cp.undone_at is not null then
    return null;
  end if;

  select coalesce(sum(delta), 0) into held
  from points_ledger
  where booking_id = p_booking and member_id = cp.credited_member_id and reason in ('purchase', 'redeem', 'refund', 'adjustment');
  if held <> 0 then
    perform public.apply_member_points(cp.credited_member_id, -held, 'refund', null, p_booking, 'Card match undone', p_by);
  end if;

  update card_payments set undone_at = now(), undone_by = p_by where id = cp.id;
  if p_unlink and cp.credited_how = 'card' then
    update member_cards set removed_at = now(), removed_by = p_by, brand = null, last4 = null, wallet = null
    where member_id = cp.credited_member_id and fingerprint = cp.fingerprint and livemode = cp.livemode and removed_at is null;
  end if;
  return held;
end;
$$;

-- ---------- removing a member's personal info ----------
-- erase_member_personal_info (20260929220000) sets erased_at; when it does,
-- their linked cards go, and so do the card details of their sales and of
-- anything their cards paid them points for.
create or replace function public.members_erase_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    delete from member_cards where member_id = new.id;
    delete from card_payments
    where credited_member_id = new.id
       or order_id in (select id from orders where member_id = new.id)
       or booking_id in (select id from bookings where member_id = new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_cards on members;
create trigger members_erase_cards after update of erased_at on members
  for each row execute function public.members_erase_cards();

-- ---------- merging two accounts ----------
-- merge_members (20261001150000) logs the merge in member_merges just
-- before it deletes the duplicate (the roadmap tables use the same moment,
-- 20261001210000). The duplicate's linked cards, and the card points it was
-- given, become the kept account's. A card on both accounts stays one link;
-- removed on either (the person said it isn't theirs, or not to use it), it
-- stays removed. Card linking turned off on either account stays off.
create or replace function public.member_cards_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update member_cards k
     set removed_at = d.removed_at, removed_by = d.removed_by, removed_by_member = d.removed_by_member,
         brand = null, last4 = null, wallet = null
    from member_cards d
   where k.member_id = new.keep_id and d.member_id = new.dropped_id
     and k.fingerprint = d.fingerprint and k.livemode = d.livemode
     and k.removed_at is null and d.removed_at is not null;
  update member_cards k
     set last_used_at = d.last_used_at
    from member_cards d
   where k.member_id = new.keep_id and d.member_id = new.dropped_id
     and k.fingerprint = d.fingerprint and k.livemode = d.livemode
     and k.removed_at is null and d.last_used_at > coalesce(k.last_used_at, '-infinity'::timestamptz);
  delete from member_cards d using member_cards k
   where d.member_id = new.dropped_id and k.member_id = new.keep_id
     and k.fingerprint = d.fingerprint and k.livemode = d.livemode;
  update member_cards set member_id = new.keep_id where member_id = new.dropped_id;
  update card_payments set credited_member_id = new.keep_id where credited_member_id = new.dropped_id;
  update members k set link_cards = false
    from members d
   where k.id = new.keep_id and d.id = new.dropped_id and k.link_cards and not d.link_cards;
  return null;
end;
$$;
drop trigger if exists member_cards_member_merged on member_merges;
create trigger member_cards_member_merged after insert on member_merges
  for each row execute function public.member_cards_member_merged();

-- An account deleted outright (a merge has already moved everything): its
-- linked cards go, and points its cards were given point at no one.
create or replace function public.members_delete_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from member_cards where member_id = old.id;
  update card_payments set credited_member_id = null where credited_member_id = old.id;
  return old;
end;
$$;
drop trigger if exists members_delete_cards on members;
create trigger members_delete_cards after delete on members
  for each row execute function public.members_delete_cards();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.credit_card_sale(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.credit_card_booking(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.undo_card_sale(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.undo_card_booking(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.members_erase_cards() from public, anon, authenticated;
revoke execute on function public.member_cards_member_merged() from public, anon, authenticated;
revoke execute on function public.members_delete_cards() from public, anon, authenticated;
grant execute on function public.credit_card_sale(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.credit_card_booking(uuid, uuid, text) to service_role;
grant execute on function public.undo_card_sale(uuid, boolean, uuid) to service_role;
grant execute on function public.undo_card_booking(uuid, boolean, uuid) to service_role;
