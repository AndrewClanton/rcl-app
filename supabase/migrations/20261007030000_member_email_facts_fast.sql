-- member_email_facts, unchanged in what it returns, made about three times
-- quicker. As a SQL function it was planned without its arguments (it can't
-- be inlined, being security definer), and that plan for a page of 1,000
-- members took about 0.6 s where the same query planned for the actual
-- arguments takes a few hundredths. As plpgsql with plan_cache_mode
-- force_custom_plan it's planned for each call's arguments. The body is the
-- live one, word for word. Every Email page counts the member list with it,
-- and so does every send.
create or replace function public.member_email_facts(p_offset int default 0, p_limit int default 1000, p_member uuid default null, p_after uuid default null)
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
  created_at timestamp with time zone,
  imported_at timestamp with time zone,
  birthday date,
  email_opt_in boolean,
  email_opt_in_changed_at timestamp with time zone,
  has_prefs boolean,
  lineup boolean,
  alerts boolean,
  events boolean,
  offers boolean,
  rewards boolean,
  paused_until timestamp with time zone,
  consent_source text,
  import_group text,
  engagement text,
  reconfirm_sent_at timestamp with time zone,
  last_engaged_at timestamp with time zone,
  suppressed text,
  visit_days date[],
  archive_days date[],
  first_visit_on date,
  last_visit_on date,
  tickets jsonb,
  orders jsonb,
  last_click_at timestamp with time zone,
  sends jsonb,
  delivered_since_engaged integer,
  invite_delivered boolean
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $fn$
begin
  return query
with k as (
    select ((now() at time zone 'America/Chicago') - interval '4 hours')::date as today,
           extract(year from now())::int as yr
  ),
  m as (
    select mb.*
    from members mb
    where mb.erased_at is null and mb.email is not null and btrim(mb.email) <> ''
      and (p_member is null or mb.id = p_member)
      and (p_after is null or mb.id > p_after)
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
  -- Their bookings, and guest checkouts under their address (two equi-joins,
  -- so each can use its index).
  bk as (
    select m.id as member_id, b.created_at, b.quantity, b.unit_price, b.order_id
    from m join bookings b on b.member_id = m.id
    where b.status = 'confirmed' and b.created_at > now() - interval '180 days'
    union all
    select m.id, b.created_at, b.quantity, b.unit_price, b.order_id
    from m join bookings b on b.member_id is null and lower(b.customer_email) = lower(m.email)
    where b.status = 'confirmed' and b.created_at > now() - interval '180 days'
  ),
  tk as (
    select bk.member_id,
      jsonb_agg(jsonb_build_object('d', bk.created_at, 'q', bk.quantity, 'p',
        case when o.id is null then bk.unit_price
             else coalesce(round(bk.unit_price
                    * greatest(o.total - coalesce(o.tip, 0) - coalesce(o.payment_voucher_amount, 0), 0)
                    / nullif(o.total - coalesce(o.tip, 0), 0), 2), 0)
        end)) as list
    from bk left join orders o on o.id = bk.order_id
    group by bk.member_id
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
    -- Linked to the old site after the backfill ran (no prefs row yet, or
    -- one made later with the default): still an old-site import.
    case when coalesce(p.consent_source, 'unknown') = 'unknown' and m.legacy_user_id is not null then 'old_site_import'
         else coalesce(p.consent_source, 'unknown') end,
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
end
$fn$;

revoke execute on function public.member_email_facts(int, int, uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_email_facts(int, int, uuid, uuid) to service_role;
