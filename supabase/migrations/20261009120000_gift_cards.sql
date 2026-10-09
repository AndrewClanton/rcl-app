-- Gift cards (Andrew, 10/9: "build the gift card button"). Until now staff
-- rang a gift card as a "$50 Gift Card" custom item and nothing kept the
-- balance. (The Indy staging tables have the old system's gift cards; they
-- are separate, and nothing here touches them.)
--
--   gift_cards               one row per card: its code (RCL-XXXX-XXXX, no
--                            0/O, 1/I/L), what it started at, what's left,
--                            the member it's on (optional), active or void,
--                            and the order that sold it.
--   gift_card_transactions   every change to a balance, signed (+ adds,
--                            - takes): issue, redeem (spent on an order),
--                            refund (an order paid with it was refunded),
--                            adjust (Back office, with a reason) and void
--                            (the order that sold it was refunded). Who,
--                            when, which order and why. This is the audit
--                            log: nothing changes a balance without a row.
--   orders.payment_gift_card_amount   what gift cards paid on an order
--   orders.gift_card_sales            what gift cards sold on it came to
--   orders.payment_method             'gift_card' when a card paid it all
--
-- Balances only move inside the functions below, each with the card's row
-- locked (select ... for update), so two registers can't spend the same
-- dollars and a balance never goes below zero (the check constraint is the
-- backstop).
--
-- No foreign key from gift_cards to members, on purpose (like member_notes,
-- 20261005030000): merge_members() refuses to merge an account any foreign
-- key still points at. Triggers keep it right instead: a merge moves the
-- cards to the kept account; deleting an account or erasing its personal
-- info takes the cards off it (the card and its balance stay: whoever holds
-- the code can still spend it).
--
-- Server-only like the other register tables: RLS on, no client policies
-- (the app reads and writes with the service role). Additive and safe to
-- run more than once.

create table if not exists gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^RCL-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'),
  initial_amount numeric(10, 2) not null check (initial_amount > 0 and initial_amount <= 1000),
  balance numeric(10, 2) not null check (balance >= 0),
  member_id uuid, -- no foreign key: see the top
  status text not null default 'active' check (status in ('active', 'void')),
  sold_order_id uuid references orders(id) on delete set null,
  sold_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_cards_member_idx on gift_cards (member_id) where member_id is not null;
create index if not exists gift_cards_order_idx on gift_cards (sold_order_id) where sold_order_id is not null;
create index if not exists gift_cards_created_idx on gift_cards (created_at desc);
alter table gift_cards enable row level security;
grant select, insert, update on public.gift_cards to service_role;

create table if not exists gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references gift_cards(id) on delete cascade,
  kind text not null check (kind in ('issue', 'redeem', 'refund', 'adjust', 'void')),
  amount numeric(10, 2) not null, -- signed: + adds to the balance, - takes from it
  balance_after numeric(10, 2) not null check (balance_after >= 0),
  order_id uuid references orders(id) on delete set null,
  reason text check (reason is null or length(reason) <= 200),
  employee_id uuid references employees(id) on delete set null,
  -- A redeem or issue asked twice (a retry) lands once.
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists gift_card_transactions_card_idx on gift_card_transactions (gift_card_id, created_at desc);
create index if not exists gift_card_transactions_order_idx on gift_card_transactions (order_id) where order_id is not null;
alter table gift_card_transactions enable row level security;
grant select, insert, update on public.gift_card_transactions to service_role;

alter table orders add column if not exists payment_gift_card_amount numeric(10, 2) not null default 0 check (payment_gift_card_amount >= 0);
alter table orders add column if not exists gift_card_sales numeric(10, 2) not null default 0 check (gift_card_sales >= 0);
alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (payment_method in ('cash', 'card', 'split', 'voucher', 'owner_tab', 'gift_card')) not valid;
alter table orders validate constraint orders_payment_method_check;

-- ---------- issue ----------
-- A new card, sold on an order. The code is made by the app (crypto
-- random); a clash returns null and the app tries another. p_key makes a
-- retry return the card already made.
create or replace function public.issue_gift_card(p_code text, p_amount numeric, p_order_id uuid, p_member_id uuid, p_employee_id uuid, p_key text)
returns table (id uuid, code text)
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_key is not null then
    select t.gift_card_id into v_id from gift_card_transactions t where t.idempotency_key = p_key;
    if found then
      return query select g.id, g.code from gift_cards g where g.id = v_id;
      return;
    end if;
  end if;
  if not (p_amount > 0 and p_amount <= 1000) then
    raise exception 'A gift card is $0.01 to $1,000.';
  end if;
  begin
    insert into gift_cards (code, initial_amount, balance, member_id, sold_order_id, sold_by)
      values (p_code, round(p_amount, 2), round(p_amount, 2), p_member_id, p_order_id, p_employee_id)
      returning gift_cards.id into v_id;
  exception when unique_violation then
    return; -- the code is taken: no row, the app tries another
  end;
  insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, order_id, employee_id, idempotency_key)
    values (v_id, 'issue', round(p_amount, 2), round(p_amount, 2), p_order_id, p_employee_id, p_key);
  return query select v_id, p_code;
end;
$$;

-- ---------- redeem ----------
-- Spend up to p_amount from a card, all or nothing: the whole amount comes
-- off, or nothing does and the answer says why. The order is linked once
-- it's saved (link_gift_card_redemption). A repeat with the same p_key
-- answers the same and takes nothing more.
create or replace function public.redeem_gift_card(p_code text, p_amount numeric, p_employee_id uuid, p_key text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_card gift_cards%rowtype;
  v_amount numeric(10, 2) := round(p_amount, 2);
  v_prev gift_card_transactions%rowtype;
begin
  if p_key is null or length(p_key) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;
  select * into v_prev from gift_card_transactions where idempotency_key = p_key;
  if found then
    -- Put back because its sale didn't save: that payment is spent; the
    -- register takes payment again (with a new key).
    if exists (select 1 from gift_card_transactions where idempotency_key = 'undo:' || p_key) then
      return jsonb_build_object('ok', false, 'error', 'used_key');
    end if;
    return jsonb_build_object('ok', true, 'repeat', true, 'transaction_id', v_prev.id, 'balance', v_prev.balance_after, 'amount', -v_prev.amount);
  end if;
  if not (v_amount > 0) then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  select * into v_card from gift_cards where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_card.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'void', 'balance', v_card.balance);
  end if;
  if v_card.balance < v_amount then
    return jsonb_build_object('ok', false, 'error', 'short', 'balance', v_card.balance);
  end if;
  update gift_cards set balance = balance - v_amount, updated_at = now() where gift_cards.id = v_card.id;
  insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, employee_id, idempotency_key)
    values (v_card.id, 'redeem', -v_amount, v_card.balance - v_amount, p_employee_id, p_key)
    returning * into v_prev;
  return jsonb_build_object('ok', true, 'transaction_id', v_prev.id, 'balance', v_card.balance - v_amount, 'amount', v_amount);
end;
$$;

-- The order a redemption paid for, once the order is saved.
create or replace function public.link_gift_card_redemption(p_key text, p_order_id uuid)
returns void
language sql
set search_path = public
as $$
  update gift_card_transactions set order_id = p_order_id where idempotency_key = p_key and kind = 'redeem' and order_id is null;
$$;

-- Puts back one redemption whose order never saved. Once only.
create or replace function public.undo_gift_card_redemption(p_key text, p_employee_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_tx gift_card_transactions%rowtype;
  v_balance numeric(10, 2);
begin
  select * into v_tx from gift_card_transactions where idempotency_key = p_key and kind = 'redeem';
  if not found or v_tx.order_id is not null then
    return;
  end if;
  perform 1 from gift_cards where id = v_tx.gift_card_id for update;
  if exists (select 1 from gift_card_transactions where idempotency_key = 'undo:' || p_key) then
    return;
  end if;
  update gift_cards set balance = balance - v_tx.amount, updated_at = now() where id = v_tx.gift_card_id returning balance into v_balance;
  insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, employee_id, reason, idempotency_key)
    values (v_tx.gift_card_id, 'refund', -v_tx.amount, v_balance, p_employee_id, 'The sale didn''t save', 'undo:' || p_key);
end;
$$;

-- ---------- a refunded order ----------
-- Everything gift cards paid on the order goes back on them, and any card
-- the order sold is voided (what's left on it comes off). Once per order:
-- a second call finds it done. Returns what it did, for the message.
create or replace function public.refund_order_gift_cards(p_order_id uuid, p_employee_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_balance numeric(10, 2);
  v_code text;
  v_back jsonb := '[]'::jsonb;
  v_void jsonb := '[]'::jsonb;
  v_card gift_cards%rowtype;
begin
  for r in
    select t.id, t.gift_card_id, t.amount from gift_card_transactions t
    where t.order_id = p_order_id and t.kind = 'redeem'
    order by t.created_at
  loop
    perform 1 from gift_cards where id = r.gift_card_id for update;
    if exists (select 1 from gift_card_transactions where idempotency_key = 'refund:' || r.id) then
      continue;
    end if;
    update gift_cards set balance = balance - r.amount, updated_at = now() where id = r.gift_card_id returning balance, code into v_balance, v_code;
    insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, order_id, employee_id, reason, idempotency_key)
      values (r.gift_card_id, 'refund', -r.amount, v_balance, p_order_id, p_employee_id, 'Order refunded', 'refund:' || r.id);
    v_back := v_back || jsonb_build_object('code', v_code, 'amount', -r.amount, 'balance', v_balance);
  end loop;

  for v_card in select * from gift_cards where sold_order_id = p_order_id and status = 'active' for update loop
    update gift_cards set status = 'void', balance = 0, updated_at = now() where id = v_card.id;
    insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, order_id, employee_id, reason, idempotency_key)
      values (v_card.id, 'void', -v_card.balance, 0, p_order_id, p_employee_id, 'The order that sold it was refunded', 'void:' || v_card.id);
    v_void := v_void || jsonb_build_object('code', v_card.code, 'left', v_card.balance, 'spent', v_card.initial_amount - v_card.balance);
  end loop;
  return jsonb_build_object('restored', v_back, 'voided', v_void);
end;
$$;

-- ---------- Back office ----------
-- A manager's change to a balance, with a reason (required). Never below
-- zero; a void card can't be changed.
create or replace function public.adjust_gift_card(p_card_id uuid, p_delta numeric, p_reason text, p_employee_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_card gift_cards%rowtype;
  v_delta numeric(10, 2) := round(p_delta, 2);
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'reason');
  end if;
  if v_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'zero');
  end if;
  select * into v_card from gift_cards where id = p_card_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_card.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'void');
  end if;
  if v_card.balance + v_delta < 0 then
    return jsonb_build_object('ok', false, 'error', 'below_zero', 'balance', v_card.balance);
  end if;
  if v_card.balance + v_delta > 1000 then
    return jsonb_build_object('ok', false, 'error', 'too_much', 'balance', v_card.balance);
  end if;
  update gift_cards set balance = balance + v_delta, updated_at = now() where id = p_card_id;
  insert into gift_card_transactions (gift_card_id, kind, amount, balance_after, employee_id, reason)
    values (p_card_id, 'adjust', v_delta, v_card.balance + v_delta, p_employee_id, left(trim(p_reason), 200));
  return jsonb_build_object('ok', true, 'balance', v_card.balance + v_delta);
end;
$$;

revoke execute on function public.issue_gift_card(text, numeric, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_gift_card(text, numeric, uuid, uuid, uuid, text) to service_role;
revoke execute on function public.redeem_gift_card(text, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_gift_card(text, numeric, uuid, text) to service_role;
revoke execute on function public.link_gift_card_redemption(text, uuid) from public, anon, authenticated;
grant execute on function public.link_gift_card_redemption(text, uuid) to service_role;
revoke execute on function public.undo_gift_card_redemption(text, uuid) from public, anon, authenticated;
grant execute on function public.undo_gift_card_redemption(text, uuid) to service_role;
revoke execute on function public.refund_order_gift_cards(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refund_order_gift_cards(uuid, uuid) to service_role;
revoke execute on function public.adjust_gift_card(uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.adjust_gift_card(uuid, numeric, text, uuid) to service_role;

-- ---------- members ----------
-- A merge (merge_members logs it in member_merges just before deleting the
-- duplicate) moves the duplicate's cards to the kept account.
create or replace function public.gift_cards_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update gift_cards set member_id = new.keep_id, updated_at = now() where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists gift_cards_member_merged on member_merges;
create trigger gift_cards_member_merged after insert on member_merges
  for each row execute function public.gift_cards_member_merged();

-- Deleting an account or erasing its personal info takes its cards off it.
-- The cards stay, balance and all: the code still spends.
create or replace function public.members_release_gift_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update gift_cards set member_id = null, updated_at = now() where member_id = old.id;
    return old;
  end if;
  if new.erased_at is not null and old.erased_at is null then
    update gift_cards set member_id = null, updated_at = now() where member_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists members_release_gift_cards on members;
create trigger members_release_gift_cards after update of erased_at on members
  for each row execute function public.members_release_gift_cards();
drop trigger if exists members_delete_gift_cards on members;
create trigger members_delete_gift_cards after delete on members
  for each row execute function public.members_release_gift_cards();

revoke execute on function public.gift_cards_member_merged() from public, anon, authenticated;
revoke execute on function public.members_release_gift_cards() from public, anon, authenticated;
