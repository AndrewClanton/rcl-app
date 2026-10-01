-- Merging duplicate member accounts (Back office → Members → a member →
-- "Merge a duplicate into this account"; Andrew 10/1).
--
-- Why: about 970 members imported from the old website have the
-- placeholder phone "-" (and a few have junk), so the door tablet can't
-- find them by phone and makes them a second account the first time they
-- check in. This folds one account into the other:
--
--   merge_members(keep, drop, staff)  in one transaction: moves everything
--     the duplicate has (visits, points history, badges, rewards, orders,
--     tickets, booths, gifts, payments, the old-site record, held profile
--     links) onto the kept account, carries over whatever the kept account
--     lacks (a usable phone, email, login, Stripe billing, birthday, photo,
--     profile page, flair...), logs it in member_merges and deletes the
--     duplicate. Staff's hides on a profile line or page stay in place, and
--     a profile link that doesn't survive is held for the member for 90
--     days like any other given-up link (member_retired_handles). The rules
--     are the same as src/lib/member-merge.ts, which shows staff the
--     preview first; change one, change the other
--     (scripts/check-member-merge.mjs checks both).
--   member_duplicate_pairs([member])  pairs of accounts that may be the
--     same person, for Back office → Members → Possible duplicates and the
--     register's gentle hint after a check-in.
--
-- Removing the kept account's personal info later (erase_member_personal_
-- info) also reaches what the merged-in account left behind: its old-site
-- record, and anything booked under an email the merge didn't keep
-- (member_merge_emails, below).
--
-- Also clears the old site's placeholder phones ("-", "n/a" and the like),
-- so they read as "no phone on file".
--
-- Server-only, like the rest: RLS on, no client policies, functions for
-- service_role only. Safe to run more than once.

-- ---------- the log ----------
create table if not exists member_merges (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys on these two: the dropped account is deleted, and
  -- when a kept account is itself merged later, its rows here are pointed
  -- on to the new one (below), so an old id can always be followed to the
  -- account it became (src/lib/member-forward.ts).
  keep_id uuid not null,
  dropped_id uuid not null,
  -- What the dropped account was, without its contact details. The name
  -- goes if the kept account's personal info is ever removed (trigger
  -- below): it's the same person.
  dropped_name text,
  dropped_tier text,
  dropped_created_at timestamptz,
  dropped_points numeric(10,2),
  -- How many of each thing moved, and the overlaps that were dropped.
  moved jsonb not null default '{}'::jsonb,
  -- What the kept account took from it (the keys of CARRIED_LABEL in
  -- src/lib/member-merge.ts).
  carried text[] not null default '{}',
  merged_by uuid references employees(id) on delete set null,
  merged_at timestamptz not null default now()
);
create unique index if not exists member_merges_dropped_idx on member_merges (dropped_id);
create index if not exists member_merges_keep_idx on member_merges (keep_id);
alter table member_merges enable row level security;

-- The merged-in account's email, when the kept account kept its own: the
-- erase finds a person's private events, gifts they bought and guest
-- bookings by their email, and the merged-in email would otherwise be
-- forgotten with that account. Only the erase trigger below reads it, and
-- it clears the rows. Server-only, like the rest.
create table if not exists member_merge_emails (
  keep_id uuid not null references members(id) on delete cascade,
  email text not null, -- lowercase, trimmed
  merged_at timestamptz not null default now(),
  primary key (keep_id, email)
);
alter table member_merge_emails enable row level security;

-- Removing the kept account's personal info (erase_member_personal_info)
-- also reaches what merged-in accounts left: the dropped name in the log,
-- old-site records imported into this account (the erase itself matches
-- only the account's own old-site id and email), and anything under an
-- email the merge didn't keep, cleared the way the erase clears the
-- person's own. Runs inside the erase's transaction.
create or replace function public.members_erase_merges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update member_merges set dropped_name = null where keep_id = new.id and dropped_name is not null;

  update legacy_accounts
     set email = null, username = null, first_name = null, last_name = null, phone = null,
         subscription_fortis_id = null, decision = 'skip', decided_by = new.erased_by, decided_at = now(), erased_at = now()
   where erased_at is null
     and (imported_member_id = new.id
          or lower(btrim(email)) in (select e.email from member_merge_emails e where e.keep_id = new.id));

  if exists (select 1 from member_merge_emails where keep_id = new.id) then
    update bookings set customer_name = null, customer_email = null
     where lower(btrim(customer_email)) in (select e.email from member_merge_emails e where e.keep_id = new.id);
    update booth_reservations set customer_name = 'Removed member', customer_email = '', customer_phone = null
     where lower(btrim(customer_email)) in (select e.email from member_merge_emails e where e.keep_id = new.id);
    update events set organizer_name = null, organizer_email = '', event_name = 'Private event'
     where lower(btrim(organizer_email)) in (select e.email from member_merge_emails e where e.keep_id = new.id);
    update gift_memberships set buyer_name = 'Removed member', buyer_email = '', message = null
     where lower(btrim(buyer_email)) in (select e.email from member_merge_emails e where e.keep_id = new.id);
    delete from member_merge_emails where keep_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists members_erase_merges on members;
create trigger members_erase_merges after update of erased_at on members
  for each row when (new.erased_at is not null and old.erased_at is null)
  execute function public.members_erase_merges();

-- ---------- the merge ----------
-- Folds p_drop into p_keep; p_staff is who did it (employees.id). Returns
-- {keep_id, dropped_id, name, points, visits, moved: {...counts}, carried:
-- [...]}. Refuses (raises, nothing changed) when either account is gone or
-- had its personal info removed, when they're the same account, when both
-- have a website login, or when both have Stripe billing; those messages
-- are the ones src/lib/member-merge.ts shows in the preview.
create or replace function public.merge_members(p_keep uuid, p_drop uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k members%rowtype;
  d members%rowtype;
  k_billing boolean;
  d_billing boolean;
  v_carried text[] := '{}';
  v_moved jsonb := '{}'::jsonb;
  n int;
  n2 int;
  fk record;
  leftover boolean;
  -- The kept account as it will be.
  v_name text;
  v_email text;
  v_phone text;
  v_cust text;
  v_sub text;
  v_sub_status text;
  v_interval text;
  v_price_tier text;
  v_price_by uuid;
  v_price_at timestamptz;
  v_comped boolean;
  v_program uuid;
  v_comp_notes text;
  v_comped_by uuid;
  v_comped_at timestamptz;
  v_gift timestamptz;
  v_legacy int;
  v_imported timestamptz;
  v_tier text;
  v_opt_in boolean;
  v_opt_in_at timestamptz;
  v_line_hidden_at timestamptz;
  v_line_hidden_by uuid;
  v_share boolean;
  v_handle text;
  v_display text;
  v_page_hidden_at timestamptz;
  v_page_hidden_by uuid;
  v_flair_color text;
  v_flair_effect text;
  v_flair_sticker text;
  v_party boolean;
  v_points numeric;
  v_visits int;
begin
  if p_keep is not null and p_keep = p_drop then
    raise exception 'Those are the same account.';
  end if;

  -- Both rows locked, in a fixed order so two merges can't deadlock. A
  -- check-in, sale or points change for either waits until this is done
  -- (and one for the duplicate then fails, rather than landing on a
  -- deleted account).
  perform 1 from members where id in (p_keep, p_drop) order by id for update;
  select * into k from members where id = p_keep;
  if not found then
    raise exception 'One of these accounts is gone. It may have been merged or removed already.';
  end if;
  select * into d from members where id = p_drop;
  if not found then
    raise exception 'One of these accounts is gone. It may have been merged or removed already.';
  end if;
  if k.erased_at is not null or d.erased_at is not null then
    raise exception 'One of these accounts had its personal info removed, so it cannot be merged.';
  end if;
  if k.auth_user_id is not null and d.auth_user_id is not null then
    raise exception 'Both accounts have a website login, and an account can only have one, so these cannot be merged here.';
  end if;
  k_billing := k.stripe_customer_id is not null or k.stripe_subscription_id is not null;
  d_billing := d.stripe_customer_id is not null or d.stripe_subscription_id is not null;
  if k_billing and d_billing then
    raise exception 'Both accounts have Stripe billing on file, and an account can only have one, so these cannot be merged here.';
  end if;

  -- ----- what the kept account will be (same order as mergedProfile) -----
  -- A one-word name ("Jake", a quick sign-up at the register) gives way to
  -- the other account's full name when that starts with it.
  v_name := k.name;
  if btrim(k.name) !~ '\s' and left(lower(btrim(d.name)), length(btrim(k.name)) + 1) = lower(btrim(k.name)) || ' ' then
    v_name := btrim(d.name);
    v_carried := array_append(v_carried, 'name');
  end if;

  v_email := k.email;
  if nullif(btrim(k.email), '') is null and nullif(btrim(d.email), '') is not null then
    v_email := d.email;
    v_carried := array_append(v_carried, 'email');
  end if;

  -- A usable phone: ten digits that make a US number (lib/member-merge.ts usablePhone).
  v_phone := k.phone;
  if not (right(coalesce(k.phone_digits, ''), 10) ~ '^[2-9][0-9]{9}$') and right(coalesce(d.phone_digits, ''), 10) ~ '^[2-9][0-9]{9}$' then
    v_phone := d.phone;
    v_carried := array_append(v_carried, 'phone');
  end if;

  if k.auth_user_id is null and d.auth_user_id is not null then
    v_carried := array_append(v_carried, 'login');
  end if;

  -- Stripe billing comes over whole: the customer, the subscription, its
  -- status and plan, and the rate it charges.
  v_cust := k.stripe_customer_id;
  v_sub := k.stripe_subscription_id;
  v_sub_status := k.subscription_status;
  v_interval := k.billing_interval;
  v_price_tier := k.price_tier;
  v_price_by := k.price_tier_set_by;
  v_price_at := k.price_tier_set_at;
  if not k_billing and d_billing then
    v_cust := d.stripe_customer_id;
    v_sub := d.stripe_subscription_id;
    v_sub_status := d.subscription_status;
    v_interval := d.billing_interval;
    v_price_tier := d.price_tier;
    v_price_by := d.price_tier_set_by;
    v_price_at := d.price_tier_set_at;
    v_carried := array_append(v_carried, 'billing');
  elsif not k_billing and k.price_tier is null and d.price_tier is not null then
    -- A senior/student rate, onto an account no card is billing.
    v_price_tier := d.price_tier;
    v_price_by := d.price_tier_set_by;
    v_price_at := d.price_tier_set_at;
    v_carried := array_append(v_carried, 'rate');
  end if;

  if k.birthday is null and d.birthday is not null then
    v_carried := array_append(v_carried, 'birthday');
  end if;
  if k.avatar_url is null and d.avatar_url is not null then
    v_carried := array_append(v_carried, 'photo');
  end if;
  if k.tagline is null and d.tagline is not null then
    v_carried := array_append(v_carried, 'tagline');
  end if;
  -- Staff hiding the profile line is about the person, not one wording (it
  -- holds even after they edit the line), so hidden on either account, the
  -- line stays hidden until staff show it again.
  v_line_hidden_at := k.tagline_hidden_at;
  v_line_hidden_by := k.tagline_hidden_by;
  if k.tagline_hidden_at is null and d.tagline_hidden_at is not null then
    v_line_hidden_at := d.tagline_hidden_at;
    v_line_hidden_by := d.tagline_hidden_by;
    v_carried := array_append(v_carried, 'line_hidden');
  end if;

  -- The shared profile page: its link, whether it's on, and its name come
  -- over together, onto an account with no link of its own. Otherwise the
  -- kept account's link stays and the other is held for this member (below).
  v_share := k.share_profile;
  v_handle := k.profile_handle;
  v_display := k.display_name;
  if k.profile_handle is null and d.profile_handle is not null then
    v_share := d.share_profile;
    v_handle := d.profile_handle;
    v_display := coalesce(d.display_name, k.display_name);
    v_carried := array_append(v_carried, 'profile_page');
  elsif k.display_name is null and d.display_name is not null then
    v_display := d.display_name;
    v_carried := array_append(v_carried, 'display_name');
  end if;
  -- Staff turning a shared page off stays in place the same way, with the
  -- page off (as when staff turn it off).
  v_page_hidden_at := k.profile_hidden_at;
  v_page_hidden_by := k.profile_hidden_by;
  if k.profile_hidden_at is null and d.profile_hidden_at is not null then
    v_page_hidden_at := d.profile_hidden_at;
    v_page_hidden_by := d.profile_hidden_by;
    v_carried := array_append(v_carried, 'page_hidden');
  end if;
  if v_page_hidden_at is not null then
    v_share := false;
  end if;

  -- Check-in flair (color, entrance, sticker) comes over as a set, onto an
  -- account with none. A birthday-week party turned off on either stays off.
  v_flair_color := k.flair_color;
  v_flair_effect := k.flair_effect;
  v_flair_sticker := k.flair_sticker;
  if coalesce(k.flair_color, k.flair_effect, k.flair_sticker) is null and coalesce(d.flair_color, d.flair_effect, d.flair_sticker) is not null then
    v_flair_color := d.flair_color;
    v_flair_effect := d.flair_effect;
    v_flair_sticker := d.flair_sticker;
    v_carried := array_append(v_carried, 'flair');
  end if;
  v_party := k.birthday_party and d.birthday_party;
  if k.birthday_party and not d.birthday_party then
    v_carried := array_append(v_carried, 'party_off');
  end if;

  v_comped := k.comped;
  v_program := k.community_program_id;
  v_comp_notes := k.comp_notes;
  v_comped_by := k.comped_by;
  v_comped_at := k.comped_at;
  if not k.comped and d.comped then
    v_comped := true;
    v_program := d.community_program_id;
    v_comp_notes := d.comp_notes;
    v_comped_by := d.comped_by;
    v_comped_at := d.comped_at;
    v_carried := array_append(v_carried, 'free_membership');
  end if;

  -- Gifted Insiders+ time: gifts on one account stack (each starts where
  -- the last ends), so time left on both adds up. Otherwise the later end.
  v_gift := k.plus_gift_until;
  if k.plus_gift_until > now() and d.plus_gift_until > now() then
    v_gift := greatest(k.plus_gift_until, d.plus_gift_until) + (least(k.plus_gift_until, d.plus_gift_until) - now());
    v_carried := array_append(v_carried, 'gift');
  elsif d.plus_gift_until is not null and (k.plus_gift_until is null or d.plus_gift_until > k.plus_gift_until) then
    v_gift := d.plus_gift_until;
    v_carried := array_append(v_carried, 'gift');
  end if;

  v_legacy := k.legacy_user_id;
  v_imported := k.imported_at;
  if k.legacy_user_id is null and d.legacy_user_id is not null then
    v_legacy := d.legacy_user_id;
    v_imported := coalesce(k.imported_at, d.imported_at);
    v_carried := array_append(v_carried, 'old_site');
  end if;

  -- The higher tier wins.
  v_tier := case when k.tier = 'Insiders+' or d.tier = 'Insiders+' then 'Insiders+' else k.tier end;
  if k.tier <> 'Insiders+' and d.tier = 'Insiders+' then
    v_carried := array_append(v_carried, 'tier');
  end if;

  -- The kept account's email preference stays, unless it never chose one
  -- and the other account did.
  v_opt_in := k.email_opt_in;
  v_opt_in_at := k.email_opt_in_changed_at;
  if k.email_opt_in_changed_at is null and d.email_opt_in_changed_at is not null then
    v_opt_in := d.email_opt_in;
    v_opt_in_at := d.email_opt_in_changed_at;
    v_carried := array_append(v_carried, 'email_choice');
  end if;

  if d.created_at < k.created_at then
    v_carried := array_append(v_carried, 'member_since');
  end if;

  v_points := k.points + d.points;

  -- ----- everything that points at the duplicate -----
  -- Check-in visits: one per member per business day. A day both accounts
  -- checked in keeps the kept account's visit; the other goes (the points
  -- it paid are in the points history, which moves below).
  delete from member_visits dv using member_visits kv
   where dv.member_id = p_drop and kv.member_id = p_keep and kv.business_date = dv.business_date;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('visits_same_day', n);
  update member_visits set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('visits', n);

  -- Badges: one per badge and period. Earned on both, the earlier stays.
  delete from member_badges kb using member_badges db
   where kb.member_id = p_keep and db.member_id = p_drop
     and kb.badge = db.badge and kb.period = db.period and db.earned_at < kb.earned_at;
  get diagnostics n = row_count;
  delete from member_badges db using member_badges kb
   where db.member_id = p_drop and kb.member_id = p_keep
     and kb.badge = db.badge and kb.period = db.period;
  get diagnostics n2 = row_count;
  v_moved := v_moved || jsonb_build_object('badges_same', n + n2);
  update member_badges set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('badges', n);

  -- Streak rewards: one per kind per day. Earned on both the same day, an
  -- unused one beats a used one; otherwise the kept account's stays.
  delete from member_rewards kr using member_rewards dr
   where kr.member_id = p_keep and dr.member_id = p_drop and kr.kind = dr.kind and kr.earned_on = dr.earned_on
     and kr.redeemed_at is not null and dr.redeemed_at is null;
  get diagnostics n = row_count;
  delete from member_rewards dr using member_rewards kr
   where dr.member_id = p_drop and kr.member_id = p_keep and kr.kind = dr.kind and kr.earned_on = dr.earned_on;
  get diagnostics n2 = row_count;
  v_moved := v_moved || jsonb_build_object('rewards_same', n + n2);
  update member_rewards set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('rewards', n);

  -- Points history: every row moves, and the balance is the two added up.
  update points_ledger set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('points_history', n);

  update orders set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('orders', n);

  update bookings set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('tickets', n);

  update booth_reservations set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('booths', n);

  -- The duplicate's email, when the kept account keeps its own: tickets
  -- and booths booked as a guest under it become this member's, and the
  -- email is kept (server-only) so removing this member's personal info
  -- later still finds what else was booked under it (events, gifts bought).
  n := 0;
  n2 := 0;
  if nullif(btrim(d.email), '') is not null and lower(btrim(d.email)) is distinct from lower(btrim(v_email)) then
    update bookings set member_id = p_keep where member_id is null and lower(btrim(customer_email)) = lower(btrim(d.email));
    get diagnostics n = row_count;
    update booth_reservations set member_id = p_keep where member_id is null and lower(btrim(customer_email)) = lower(btrim(d.email));
    get diagnostics n2 = row_count;
    insert into member_merge_emails (keep_id, email) values (p_keep, lower(btrim(d.email))) on conflict do nothing;
  end if;
  v_moved := v_moved || jsonb_build_object('guest_tickets', n, 'guest_booths', n2);

  update gift_memberships set recipient_member_id = p_keep where recipient_member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('gifts', n);

  update member_payments set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('payments', n);

  update member_subscription_ends set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('subscription_ends', n);

  update legacy_accounts set imported_member_id = p_keep where imported_member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('old_site', n);

  update member_erasures set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('erasures', n);

  -- "Claim your account" links name the account they were made for, so
  -- the duplicate's can't work any more: they go. (The kept account gets
  -- its own the next time it checks in, if it still has no login.)
  delete from member_claims where member_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('claim_links', n);

  -- An earlier merge into the duplicate now points at the kept account.
  update member_merges set keep_id = p_keep where keep_id = p_drop;
  get diagnostics n = row_count;
  v_moved := v_moved || jsonb_build_object('earlier_merges', n);
  update member_merge_emails set keep_id = p_keep where keep_id = p_drop;

  -- Profile links the duplicate gave up stay held for this person, and its
  -- current link, when the kept account keeps its own, is held too:
  -- deleting the duplicate would otherwise free it at once, and someone
  -- else could take over a link the member already shared.
  update member_retired_handles set member_id = p_keep where member_id = p_drop;
  get diagnostics n = row_count;
  n2 := 0;
  if d.profile_handle is not null and v_handle is distinct from d.profile_handle then
    insert into member_retired_handles (handle, member_id, retired_at)
    values (d.profile_handle, p_keep, now())
    on conflict (handle) do update set member_id = excluded.member_id, retired_at = excluded.retired_at;
    n2 := 1;
  end if;
  v_moved := v_moved || jsonb_build_object('held_links', n + n2);

  -- Anything else still pointing at the duplicate (a table added after
  -- this was written) stops the merge, rather than being deleted with it
  -- or blocking the delete with a confusing error.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.members'::regclass and array_length(c.conkey, 1) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col) into leftover using p_drop;
    if leftover then
      raise exception 'The duplicate still has % rows (%), which merging does not handle yet. Nothing was changed.', fk.tbl, fk.col;
    end if;
  end loop;

  -- ----- log it, delete the duplicate, update the kept account -----
  insert into member_merges (keep_id, dropped_id, dropped_name, dropped_tier, dropped_created_at, dropped_points, moved, carried, merged_by)
  values (p_keep, p_drop, d.name, d.tier, d.created_at, d.points, v_moved, v_carried, p_staff);

  -- Gone before the kept account takes its email, login, Stripe ids,
  -- old-site link and profile link, which are one account each.
  delete from members where id = p_drop;

  update members set
    name = v_name,
    email = v_email,
    phone = v_phone,
    auth_user_id = coalesce(k.auth_user_id, d.auth_user_id),
    stripe_customer_id = v_cust,
    stripe_subscription_id = v_sub,
    subscription_status = v_sub_status,
    billing_interval = v_interval,
    price_tier = v_price_tier,
    price_tier_set_by = v_price_by,
    price_tier_set_at = v_price_at,
    monthly_member = k.monthly_member or d.monthly_member,
    tier = v_tier,
    birthday = coalesce(k.birthday, d.birthday),
    avatar_url = coalesce(k.avatar_url, d.avatar_url),
    tagline = coalesce(k.tagline, d.tagline),
    tagline_hidden_at = v_line_hidden_at,
    tagline_hidden_by = v_line_hidden_by,
    share_profile = v_share,
    profile_handle = v_handle,
    display_name = v_display,
    profile_hidden_at = v_page_hidden_at,
    profile_hidden_by = v_page_hidden_by,
    flair_color = v_flair_color,
    flair_effect = v_flair_effect,
    flair_sticker = v_flair_sticker,
    birthday_party = v_party,
    comped = v_comped,
    community_program_id = v_program,
    comp_notes = v_comp_notes,
    comped_by = v_comped_by,
    comped_at = v_comped_at,
    plus_gift_until = v_gift,
    legacy_user_id = v_legacy,
    legacy_plus = k.legacy_plus or d.legacy_plus,
    imported_at = v_imported,
    email_opt_in = v_opt_in,
    email_opt_in_changed_at = v_opt_in_at,
    -- "Member since" is the earlier date; last activity the later one
    -- (moving orders and tickets above may already have moved it on).
    created_at = least(k.created_at, d.created_at),
    last_activity_at = greatest(last_activity_at, k.last_activity_at, d.last_activity_at),
    points = v_points
  where id = p_keep;

  -- The points history reads as one account: each row's "balance after"
  -- is the combined balance at that moment, ending at the new balance.
  if (v_moved->>'points_history')::int > 0 then
    update points_ledger l
       set balance_after = x.bal
      from (
        select pl.id,
               v_points - coalesce(sum(pl.delta) over (order by pl.created_at desc, pl.id desc rows between unbounded preceding and 1 preceding), 0) as bal
          from points_ledger pl
         where pl.member_id = p_keep
      ) x
     where l.id = x.id and l.balance_after is distinct from x.bal;
  end if;

  select count(*) into v_visits from member_visits where member_id = p_keep;
  return jsonb_build_object(
    'keep_id', p_keep,
    'dropped_id', p_drop,
    'name', v_name,
    'points', v_points,
    'visits', v_visits,
    'moved', v_moved,
    'carried', to_jsonb(v_carried)
  );
end;
$$;

-- ---------- possible duplicates ----------
-- Pairs of accounts (older first) with the same name ignoring case and
-- extra spaces, the same email, or the same 10-digit phone. A name only
-- counts with at least two words: "Chris" alone (a quick register sign-up)
-- could be anyone. With p_member, only the pairs it's in. Removed members
-- are left out.
create or replace function public.member_duplicate_pairs(p_member uuid default null)
returns table (older_id uuid, newer_id uuid, same_name boolean, same_email boolean, same_phone boolean)
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select id,
           created_at,
           nullif(lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), '') as nm,
           nullif(lower(btrim(email)), '') as em,
           case when right(phone_digits, 10) ~ '^[2-9][0-9]{9}$' then right(phone_digits, 10) end as ph
      from members
     where erased_at is null
  ),
  hits as (
    select a.id as a_id, b.id as b_id, 'name' as why
      from m a join m b on a.nm = b.nm
     where a.nm ~ ' ' and (a.created_at, a.id) < (b.created_at, b.id) and (p_member is null or p_member in (a.id, b.id))
    union all
    select a.id, b.id, 'email'
      from m a join m b on a.em = b.em
     where (a.created_at, a.id) < (b.created_at, b.id) and (p_member is null or p_member in (a.id, b.id))
    union all
    select a.id, b.id, 'phone'
      from m a join m b on a.ph = b.ph
     where (a.created_at, a.id) < (b.created_at, b.id) and (p_member is null or p_member in (a.id, b.id))
  )
  select a_id, b_id, bool_or(why = 'name'), bool_or(why = 'email'), bool_or(why = 'phone')
    from hits
   group by a_id, b_id
   limit 2000;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.merge_members(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.member_duplicate_pairs(uuid) from public, anon, authenticated;
revoke execute on function public.members_erase_merges() from public, anon, authenticated;
grant execute on function public.merge_members(uuid, uuid, uuid) to service_role;
grant execute on function public.member_duplicate_pairs(uuid) to service_role;

-- ---------- the old site's placeholder phones ----------
-- "-", "n/a", "none" and the like read as a phone on file; they're
-- nothing. Only those shapes: anything else with no digits (something
-- typed into the wrong box) and junk with digits in it are left for
-- staff, with a count.
do $$
declare
  n int;
begin
  update members set phone = null
   where phone is not null and phone_digits = '' and btrim(phone) ~* '^([-./x[:space:]]*|n/?a|none)$';
  get diagnostics n = row_count;
  raise notice 'placeholder phones cleared: %', n;
  select count(*) into n from members where phone is not null and phone_digits = '';
  raise notice 'phones with no digits left for staff: %', n;
end $$;
