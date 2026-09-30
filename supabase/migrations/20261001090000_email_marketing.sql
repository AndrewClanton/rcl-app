-- Email marketing (src/lib/email/*, Back office -> Email): who wants what,
-- proof of every opt-in and opt-out, a hashed never-mail list, campaigns,
-- one row per person per email, and what happened to each email.
--
-- Our database decides who gets what. Resend only delivers: every list
-- email is sent per person through its batch API, never as a Resend
-- broadcast, and Resend holds no contacts or segments.
--
-- members.email_opt_in stays the master switch, and its default is NOT
-- changed here: members stay opted in. Nothing in this file turns anyone's
-- email off.
--
-- Additive and safe to run twice. Server-only, like the rest: RLS on every
-- table with no client policies; functions are security definer, for
-- service_role only.

-- ---------- who wants what ----------
-- The categories, the pause, where consent came from and engagement. A
-- missing row means every category is on.
create table if not exists member_email_prefs (
  member_id uuid primary key references members(id) on delete cascade,
  lineup  boolean not null default true,   -- weekly lineup
  alerts  boolean not null default true,   -- this weekend / last chance / tonight
  events  boolean not null default true,   -- trivia, comedy, book swap
  offers  boolean not null default true,   -- Insiders+ and deals
  rewards boolean not null default true,   -- welcome, birthday, points and badges, win-back
  paused_until timestamptz,
  consent_source text not null default 'unknown' check (consent_source in
    ('old_site_import','indy_yes','indy_no','join_form','kiosk','checkout','claim','account','staff','unknown')),
  consent_at timestamptz,
  -- Old-site imports only: how the loader sorted them ('paying',
  -- 'likely_real', 'review'), copied once from legacy_accounts by the
  -- backfill so warm-up ordering never has to read that table.
  import_group text check (import_group in ('paying','likely_real','review')),
  engagement text not null default 'active' check (engagement in ('active','reconfirm_sent','dormant')),
  reconfirm_sent_at timestamptz,
  last_engaged_at timestamptz,        -- latest click, visit, booking, order, login or prefs change
  updated_at timestamptz not null default now()
);

-- Evidence of every opt-in and opt-out (CAN-SPAM timing, disputes). Append-only.
create table if not exists email_consent_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete set null,
  email_hash text,                    -- sha256(lower(trim(email))) when there's no member (e.g. a complaint)
  action text not null check (action in ('opt_in','opt_out','prefs','pause','resume','complaint',
    'hard_bounce','import','reconfirm','dormant','reactivate','resubscribe')),
  source text not null,               -- 'one_click','prefs_page','account','kiosk','join_form','staff','webhook','indy_import','sunset',...
  detail jsonb not null default '{}',
  by_employee uuid references employees(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists email_consent_log_member_idx on email_consent_log (member_id, at desc);

-- Never mail these addresses. Hashes only: no address is stored. Survives
-- email changes and erasure.
create table if not exists email_suppressions (
  email_hash text primary key,
  reason text not null check (reason in ('hard_bounce','complaint','soft_bounce_repeat','resend_suppressed','manual')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  note text
);

-- ---------- campaigns ----------
-- One row per one-off email (lineup, event, alert, offer, invite,
-- announcement). Automations are one long-lived row per step ('welcome_1',
-- 'birthday', ...) that keeps collecting sends.
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lineup','alert','event','offer','invite','announcement','automation','reconfirm')),
  automation text check (automation in ('welcome_1','welcome_2','welcome_3','birthday','plus_upsell',
    'winback_45','winback_90','reconfirm')),
  category text not null check (category in ('lineup','alerts','events','offers','rewards','account')),
  name text not null,
  subject text not null check (char_length(subject) between 1 and 150),
  preheader text check (char_length(preheader) <= 200),
  content jsonb not null default '{}',     -- blocks (src/lib/email/render.ts); lineup: {start, days, skipMovieIds, skipHappeningIds, intro, featured, barNote}
  audience jsonb not null default '{}',    -- segment definition (src/lib/email/rules.ts)
  holdout_pct int not null default 0 check (holdout_pct between 0 and 50),
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','paused','cancelled','failed','active','off')),
  scheduled_for timestamptz,
  send_key uuid unique,                    -- from the page: a double-clicked "Send" finds its own row
  lineup_start date,                       -- the "same week already sent" check
  contains_archive boolean not null default false,
  links jsonb not null default '[]',       -- frozen at send: [{i, url, label}] for click tracking
  recipients int, held_out int,
  excluded jsonb not null default '{}',    -- {"pref_off": 12, "cap_week": 40, "suppressed": 3, ...}
  locked_until timestamptz,                -- lease for the sender run in progress
  error text,
  created_by uuid references employees(id) on delete set null,
  approved_by uuid references employees(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table email_campaigns add column if not exists approved_at timestamptz;
alter table email_campaigns add column if not exists updated_at timestamptz not null default now();
create unique index if not exists email_campaigns_one_lineup_per_week
  on email_campaigns (lineup_start) where kind = 'lineup' and status in ('scheduled','sending','sent');
create unique index if not exists email_campaigns_one_row_per_automation
  on email_campaigns (automation) where automation is not null;
create index if not exists email_campaigns_status_idx on email_campaigns (status, scheduled_for);

-- One row per person per campaign (held-out people get a row too, for
-- measuring lift).
create table if not exists email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  dedupe_key text,                         -- automations: 'welcome_1', 'birthday:2026', 'winback45:2026-11-03'
  status text not null default 'queued' check (status in ('queued','held_out','submitted','scheduled','delivered',
    'bounced','complained','failed','cancelled','suppressed')),
  resend_email_id text unique,
  batch_no int,
  tier_at_send text,                       -- 'Insiders' / 'Insiders+', for "now Insiders+" in the results
  submitted_at timestamptz,                -- handed to Resend
  deliver_at timestamptz,                  -- scheduled_at, when used
  delivered_at timestamptz,
  first_opened_at timestamptz, opens int not null default 0,
  first_clicked_at timestamptz, last_clicked_at timestamptz, clicks int not null default 0,
  bounced_at timestamptz, bounce_type text,
  complained_at timestamptz,
  unsubscribed_at timestamptz,             -- unsubscribed through this email
  error text,
  created_at timestamptz not null default now()
);
alter table email_sends add column if not exists tier_at_send text;
alter table email_sends add column if not exists last_clicked_at timestamptz;
-- One-off campaigns: one row per person. Automations (the same campaign row
-- all year) repeat by dedupe key instead: 'birthday:2026', then 'birthday:2027'.
create unique index if not exists email_sends_one_per_campaign on email_sends (campaign_id, member_id) where dedupe_key is null;
create unique index if not exists email_sends_dedupe on email_sends (member_id, dedupe_key) where dedupe_key is not null;
create index if not exists email_sends_member_recent on email_sends (member_id, submitted_at desc);
create index if not exists email_sends_campaign_status on email_sends (campaign_id, status);
create index if not exists email_sends_campaign_batch on email_sends (campaign_id, batch_no) where status = 'queued';
create index if not exists email_sends_delivered_idx on email_sends (delivered_at) where delivered_at is not null;

-- Webhook events and first-party clicks. Resend deliveries are deduped by svix-id.
create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text unique,                     -- null for our own click and unsubscribe records
  send_id uuid references email_sends(id) on delete set null,
  resend_email_id text,
  type text not null,                      -- 'delivered','bounced','complained','opened','clicked','failed','suppressed','delayed','unsubscribed','sent'
  link_index int,
  suspect boolean not null default false,  -- click that looks like a mail scanner
  detail jsonb not null default '{}',      -- scrubbed: never an email address
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists email_events_send_idx on email_events (send_id, type);
create index if not exists email_events_received_idx on email_events (received_at desc);

-- A few switches for the sender, by key. 'guardrail_pause' ({at, reason}):
-- complaints or hard bounces ran too high, so nothing goes to a list until
-- an admin looks and resumes. 'lineup_autosend' (later): allow an untouched
-- Monday lineup draft to go without approval.
create table if not exists email_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null
);

-- Indy import provenance (idempotent re-runs, like legacy_user_id).
alter table members add column if not exists indy_user_id text unique;

-- The invite's "set my password" link is a claim link that lasts 30 days
-- (ClaimKind 'email' in src/lib/member-claim-token.ts).
do $$
declare c text;
begin
  if to_regclass('public.member_claims') is not null then
    for c in
      select conname from pg_constraint
      where conrelid = 'public.member_claims'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
    loop
      execute format('alter table member_claims drop constraint %I', c);
    end loop;
    alter table member_claims add constraint member_claims_kind_check check (kind in ('kiosk', 'receipt', 'email'));
  end if;
end $$;

alter table member_email_prefs enable row level security;
alter table email_consent_log enable row level security;
alter table email_suppressions enable row level security;
alter table email_campaigns enable row level security;
alter table email_sends enable row level security;
alter table email_events enable row level security;
alter table email_settings enable row level security;

-- ---------- facts about each member, for choosing who gets an email ----------
-- One row per live member with an email, a page at a time (1,000 max), in
-- member id order. p_member narrows it to one person (the welcome email).
-- The app filters these in TypeScript (src/lib/email/audience.ts).
--
-- A visit day means what frequent_members() means (a completed order with
-- them on it, or a confirmed ticket for a screening that has started), plus
-- a check-in (member_visits), counted by business date (4 a.m. to 4 a.m.
-- Central). Arrays cover the last 180 days so any "within N days" works.
create or replace function public.member_email_facts(p_offset int default 0, p_limit int default 1000, p_member uuid default null)
returns table (
  member_id uuid,
  email text,
  email_hash text,
  name text,
  tier text,
  legacy_plus boolean,
  legacy_user_id integer,
  indy_user_id text,
  has_login boolean,
  has_phone boolean,
  created_at timestamptz,
  imported_at timestamptz,
  birthday date,
  email_opt_in boolean,
  email_opt_in_changed_at timestamptz,
  has_prefs boolean,
  lineup boolean,
  alerts boolean,
  events boolean,
  offers boolean,
  rewards boolean,
  paused_until timestamptz,
  consent_source text,
  import_group text,
  engagement text,
  reconfirm_sent_at timestamptz,
  last_engaged_at timestamptz,
  suppressed text,
  visit_days date[],
  archive_days date[],
  first_visit_on date,
  last_visit_on date,
  tickets jsonb,
  orders jsonb,
  last_click_at timestamptz,
  sends jsonb,
  delivered_since_engaged integer,
  invite_delivered boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with k as (
    select ((now() at time zone 'America/Chicago') - interval '4 hours')::date as today,
           extract(year from now())::int as yr
  ),
  m as (
    select mb.*
    from members mb
    where mb.erased_at is null and mb.email is not null and btrim(mb.email) <> ''
      and (p_member is null or mb.id = p_member)
    order by mb.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  ),
  v as (
    select mv.member_id, mv.business_date as day, null::uuid as movie_id
    from member_visits mv join m on m.id = mv.member_id
    union all
    select o.member_id, ((o.completed_at at time zone 'America/Chicago') - interval '4 hours')::date, null::uuid
    from orders o join m on m.id = o.member_id
    where o.status = 'completed' and o.completed_at is not null
    union all
    select b.member_id, ((s.starts_at at time zone 'America/Chicago') - interval '4 hours')::date, s.movie_id
    from bookings b join m on m.id = b.member_id join screenings s on s.id = b.screening_id
    where b.status = 'confirmed' and s.starts_at <= now()
  ),
  vd as (
    select v.member_id,
      min(v.day) as first_day,
      max(v.day) as last_day,
      array_agg(distinct v.day) filter (where v.day > k.today - 180) as days,
      array_agg(distinct v.day) filter (where v.day > k.today - 180 and v.movie_id is not null and mo.release_year is distinct from k.yr) as archive
    from v cross join k left join movies mo on mo.id = v.movie_id
    group by v.member_id
  ),
  tk as (
    select m.id as member_id,
      jsonb_agg(jsonb_build_object('d', b.created_at, 'q', b.quantity, 'p', b.unit_price)) as list
    from m join bookings b on (b.member_id = m.id or (b.member_id is null and lower(b.customer_email) = lower(m.email)))
    where b.status = 'confirmed' and b.created_at > now() - interval '180 days'
    group by m.id
  ),
  od as (
    select o.member_id,
      jsonb_agg(jsonb_build_object('d', o.completed_at, 'a', coalesce(x.alc, false), 'c', coalesce(x.cof, false), 'f', coalesce(x.food, false), 't', o.total)) as list
    from orders o
    join m on m.id = o.member_id
    cross join lateral (
      select bool_or(oi.is_alcohol) as alc,
             bool_or(coalesce(c.key, '') = 'caffe' or coalesce(pc.key, '') = 'caffe') as cof,
             bool_or(coalesce(c.key, '') = 'grub' or coalesce(pc.key, '') = 'grub') as food
      from order_items oi
      left join menu_items mi on mi.id = oi.menu_item_id
      left join menu_categories c on c.id = mi.category_id
      left join menu_categories pc on pc.id = c.parent_id
      where oi.order_id = o.id
    ) x
    where o.status = 'completed' and o.completed_at > now() - interval '180 days'
    group by o.member_id
  ),
  sd as (
    select es.member_id,
      jsonb_agg(jsonb_build_object(
        'c', es.campaign_id,
        't', coalesce(es.deliver_at, es.submitted_at, es.created_at),
        'k', ec.kind,
        'a', ec.automation,
        'g', ec.category,
        'x', ec.content->>'alert',
        's', es.status,
        'ck', es.first_clicked_at is not null
      )) filter (where coalesce(es.deliver_at, es.submitted_at, es.created_at) > now() - interval '120 days') as list,
      max(es.last_clicked_at) as last_click,
      count(*) filter (where es.delivered_at is not null and ec.category <> 'account'
                       and es.delivered_at > coalesce(p.last_engaged_at, '-infinity'::timestamptz))::int as since_engaged,
      bool_or(ec.kind = 'invite' and es.delivered_at is not null) as invite_delivered
    from email_sends es
    join m on m.id = es.member_id
    join email_campaigns ec on ec.id = es.campaign_id
    left join member_email_prefs p on p.member_id = es.member_id
    group by es.member_id
  )
  select
    m.id,
    m.email,
    encode(sha256(convert_to(lower(btrim(m.email)), 'UTF8')), 'hex'),
    m.name,
    m.tier,
    coalesce(m.legacy_plus, false),
    m.legacy_user_id,
    m.indy_user_id,
    m.auth_user_id is not null,
    length(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')) >= 7,
    m.created_at,
    m.imported_at,
    m.birthday,
    coalesce(m.email_opt_in, true),
    m.email_opt_in_changed_at,
    p.member_id is not null,
    coalesce(p.lineup, true),
    coalesce(p.alerts, true),
    coalesce(p.events, true),
    coalesce(p.offers, true),
    coalesce(p.rewards, true),
    p.paused_until,
    coalesce(p.consent_source, 'unknown'),
    p.import_group,
    coalesce(p.engagement, 'active'),
    p.reconfirm_sent_at,
    p.last_engaged_at,
    sup.reason,
    coalesce(vd.days, '{}'::date[]),
    coalesce(vd.archive, '{}'::date[]),
    vd.first_day,
    vd.last_day,
    coalesce(tk.list, '[]'::jsonb),
    coalesce(od.list, '[]'::jsonb),
    sd.last_click,
    coalesce(sd.list, '[]'::jsonb),
    coalesce(sd.since_engaged, 0),
    coalesce(sd.invite_delivered, false)
  from m
  left join member_email_prefs p on p.member_id = m.id
  left join email_suppressions sup on sup.email_hash = encode(sha256(convert_to(lower(btrim(m.email)), 'UTF8')), 'hex')
  left join vd on vd.member_id = m.id
  left join tk on tk.member_id = m.id
  left join od on od.member_id = m.id
  left join sd on sd.member_id = m.id
  order by m.id;
$$;

-- ---------- the sender's lease ----------
-- Only one run works on a campaign at a time. A one-off campaign goes
-- 'scheduled' -> 'sending' (or a 'sending' run whose lease ran out is taken
-- over); an automation stays 'active' and only takes the lease. Returns
-- true for the run that won.
create or replace function public.email_claim_campaign(p_campaign uuid, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update email_campaigns
  set status = case when kind = 'automation' then status else 'sending' end,
      locked_until = now() + make_interval(secs => greatest(p_seconds, 30)),
      updated_at = now()
  where id = p_campaign
    and (
      (kind <> 'automation' and (status = 'scheduled' or (status = 'sending' and (locked_until is null or locked_until < now()))))
      or (kind = 'automation' and status = 'active' and (locked_until is null or locked_until < now()))
    );
  return found;
end;
$$;

-- Queues sends for one campaign: [{member_id, status ('queued' or
-- 'held_out'), dedupe_key, deliver_at, tier_at_send}]. Anyone who already
-- has a row for this campaign (or this dedupe key) is skipped, so a retried
-- run or a double click never queues anyone twice. Returns how many went in.
create or replace function public.email_queue_sends(p_campaign uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into email_sends (campaign_id, member_id, status, dedupe_key, deliver_at, tier_at_send)
  select p_campaign, r.member_id, r.status, nullif(r.dedupe_key, ''), r.deliver_at, r.tier_at_send
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(member_id uuid, status text, dedupe_key text, deliver_at timestamptz, tier_at_send text)
  where r.status in ('queued', 'held_out')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- What Resend said about one batch, written in one call: [{id,
-- resend_email_id, status, submitted_at, deliver_at}]. Only rows still
-- queued change, so a retried batch can't move a row backwards.
create or replace function public.email_mark_submitted(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update email_sends es
  set resend_email_id = coalesce(r.resend_email_id, es.resend_email_id),
      status = r.status,
      submitted_at = r.submitted_at,
      deliver_at = coalesce(r.deliver_at, es.deliver_at),
      error = r.error
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(id uuid, resend_email_id text, status text, submitted_at timestamptz, deliver_at timestamptz, error text)
  where es.id = r.id and es.status = 'queued';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- An open or a (human) click on one send: counted once per event, in one
-- statement, so two at once can't lose one.
create or replace function public.email_bump_send(p_send uuid, p_what text, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare mid uuid;
begin
  if p_what = 'open' then
    update email_sends set opens = opens + 1, first_opened_at = coalesce(first_opened_at, p_at)
    where id = p_send returning member_id into mid;
  elsif p_what = 'click' then
    update email_sends set clicks = clicks + 1,
      first_clicked_at = coalesce(first_clicked_at, p_at),
      last_clicked_at = greatest(coalesce(last_clicked_at, p_at), p_at)
    where id = p_send returning member_id into mid;
    if mid is not null then
      insert into member_email_prefs (member_id, last_engaged_at) values (mid, p_at)
      on conflict (member_id) do update set last_engaged_at = greatest(coalesce(member_email_prefs.last_engaged_at, excluded.last_engaged_at), excluded.last_engaged_at);
    end if;
  end if;
  return mid;
end;
$$;

-- ---------- engagement (daily) ----------
-- last_engaged_at catches up with the latest human click, check-in,
-- ticket, completed order or website sign-in. Anyone who was sent the
-- "Still want these?" email and has engaged since goes back to active; if
-- 14 days passed with nothing, they go quiet (dormant: no marketing, still
-- receipts). Both are logged. Returns {bumped, reactivated, dormant}.
create or replace function public.email_refresh_engagement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_bumped int := 0;
  n_active int := 0;
  n_dormant int := 0;
begin
  with latest as (
    select x.member_id, max(x.at) as at
    from (
      select es.member_id, es.last_clicked_at as at from email_sends es where es.last_clicked_at is not null
      union all
      select mv.member_id, mv.checked_in_at from member_visits mv
      union all
      select b.member_id, b.created_at from bookings b where b.member_id is not null and b.status = 'confirmed'
      union all
      select o.member_id, o.completed_at from orders o where o.member_id is not null and o.status = 'completed' and o.completed_at is not null
      union all
      select mb.id, u.last_sign_in_at from members mb join auth.users u on u.id = mb.auth_user_id where u.last_sign_in_at is not null
    ) x
    where x.member_id is not null
    group by x.member_id
  )
  insert into member_email_prefs (member_id, last_engaged_at)
  select l.member_id, l.at
  from latest l join members m on m.id = l.member_id
  where m.erased_at is null and l.at is not null and l.at <= now()
  on conflict (member_id) do update set last_engaged_at = excluded.last_engaged_at
  where member_email_prefs.last_engaged_at is null or member_email_prefs.last_engaged_at < excluded.last_engaged_at;
  get diagnostics n_bumped = row_count;

  with r as (
    update member_email_prefs set engagement = 'active', updated_at = now()
    where engagement in ('reconfirm_sent', 'dormant')
      and last_engaged_at is not null and reconfirm_sent_at is not null and last_engaged_at > reconfirm_sent_at
    returning member_id
  )
  insert into email_consent_log (member_id, action, source)
  select member_id, 'reactivate', 'engagement' from r;
  get diagnostics n_active = row_count;

  with d as (
    update member_email_prefs set engagement = 'dormant', updated_at = now()
    where engagement = 'reconfirm_sent' and reconfirm_sent_at < now() - interval '14 days'
      and (last_engaged_at is null or last_engaged_at <= reconfirm_sent_at)
    returning member_id
  )
  insert into email_consent_log (member_id, action, source)
  select member_id, 'dormant', 'sunset' from d;
  get diagnostics n_dormant = row_count;

  return jsonb_build_object('bumped', n_bumped, 'reactivated', n_active, 'dormant', n_dormant);
end;
$$;

-- ---------- "came in after" ----------
-- For one campaign, per group (sent / held_out): how many got it, how many
-- came in (a check-in, a completed order or a screening they had a ticket
-- for) within p_days of when it was delivered, tickets and money in that
-- window (tickets matched by member, or by email for a guest checkout),
-- the same after a click, and unsubscribes and complaints. It says "came
-- in after", never "because of".
create or replace function public.email_campaign_outcomes(p_campaign uuid, p_days int)
returns table (
  grp text,
  recipients int,
  delivered int,
  clickers int,
  came_in int,
  came_in_after_click int,
  tickets int,
  tickets_after_click int,
  ticket_revenue numeric,
  order_total numeric,
  now_plus int,
  unsubscribes int,
  complaints int
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select es.id, es.member_id, es.delivered_at, es.first_clicked_at, es.unsubscribed_at, es.complained_at, es.tier_at_send,
      case when es.status = 'held_out' then 'held_out' else 'sent' end as grp,
      coalesce(es.deliver_at, es.submitted_at, es.created_at) as t0
    from email_sends es
    where es.campaign_id = p_campaign and es.status not in ('queued', 'cancelled', 'failed', 'suppressed')
  ),
  w as (
    select s.*, s.t0 + make_interval(days => greatest(p_days, 1)) as t1, m.email as m_email, m.tier as m_tier
    from s left join members m on m.id = s.member_id
  ),
  vis as (
    select w.id as send_id, max(x.at) as last_at
    from w
    join lateral (
      select mv.checked_in_at as at from member_visits mv
      where mv.member_id = w.member_id and mv.checked_in_at >= w.t0 and mv.checked_in_at < w.t1
      union all
      select o.completed_at from orders o
      where o.member_id = w.member_id and o.status = 'completed' and o.completed_at >= w.t0 and o.completed_at < w.t1
      union all
      select sc.starts_at from bookings b join screenings sc on sc.id = b.screening_id
      where b.member_id = w.member_id and b.status = 'confirmed' and sc.starts_at >= w.t0 and sc.starts_at < w.t1 and sc.starts_at <= now()
    ) x on true
    group by w.id
  ),
  tk as (
    select w.id as send_id, sum(b.quantity) as q, sum(b.quantity * b.unit_price) as amt, max(b.created_at) as last_at
    from w join bookings b
      on (b.member_id = w.member_id or (b.member_id is null and w.m_email is not null and lower(b.customer_email) = lower(w.m_email)))
    where b.status = 'confirmed' and b.created_at >= w.t0 and b.created_at < w.t1
    group by w.id
  ),
  od as (
    select w.id as send_id, sum(o.total) as total
    from w join orders o on o.member_id = w.member_id
    where o.status = 'completed' and o.completed_at >= w.t0 and o.completed_at < w.t1
    group by w.id
  )
  select
    w.grp,
    count(*)::int,
    count(w.delivered_at)::int,
    count(w.first_clicked_at)::int,
    count(vis.send_id)::int,
    (count(*) filter (where w.first_clicked_at is not null and vis.last_at >= w.first_clicked_at))::int,
    coalesce(sum(tk.q), 0)::int,
    coalesce(sum(tk.q) filter (where w.first_clicked_at is not null and tk.last_at >= w.first_clicked_at), 0)::int,
    coalesce(sum(tk.amt), 0),
    coalesce(sum(od.total), 0),
    (count(*) filter (where w.tier_at_send = 'Insiders' and w.m_tier = 'Insiders+'))::int,
    count(w.unsubscribed_at)::int,
    count(w.complained_at)::int
  from w
  left join vis on vis.send_id = w.id
  left join tk on tk.send_id = w.id
  left join od on od.send_id = w.id
  group by w.grp;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.member_email_facts(int, int, uuid) from public, anon, authenticated;
revoke execute on function public.email_claim_campaign(uuid, int) from public, anon, authenticated;
revoke execute on function public.email_queue_sends(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.email_mark_submitted(jsonb) from public, anon, authenticated;
revoke execute on function public.email_bump_send(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.email_refresh_engagement() from public, anon, authenticated;
revoke execute on function public.email_campaign_outcomes(uuid, int) from public, anon, authenticated;
grant execute on function public.member_email_facts(int, int, uuid) to service_role;
grant execute on function public.email_claim_campaign(uuid, int) to service_role;
grant execute on function public.email_queue_sends(uuid, jsonb) to service_role;
grant execute on function public.email_mark_submitted(jsonb) to service_role;
grant execute on function public.email_bump_send(uuid, text, timestamptz) to service_role;
grant execute on function public.email_refresh_engagement() to service_role;
grant execute on function public.email_campaign_outcomes(uuid, int) to service_role;
