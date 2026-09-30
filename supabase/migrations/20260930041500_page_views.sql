-- Website usage (Reports -> Website usage): one row per page view on the
-- site, member accounts, the back office, the register and the screens,
-- with the time the page was actually on screen. Written by
-- src/app/api/usage/route.ts from the browser's beacon
-- (src/lib/usage-client.ts); read by src/lib/data/usage.ts.
--
-- Anonymous: no names, accounts, IP addresses or browser strings. A random
-- id per browser and per visit tells visits apart; for staff pages, only
-- the role (cashier, manager...) is kept, never who. Rows older than 13
-- months are cleared as new ones come in.
--
-- Nothing reads this until the report ships, and the endpoint shrugs off
-- its absence, so it can be applied any time. Safe to run more than once.

create table if not exists page_views (
  -- The page view's own id, made in the browser. If the tab is hidden and
  -- comes back, the same view is sent again with a bigger total.
  id uuid primary key,
  occurred_at timestamptz not null, -- when the page was opened
  business_date date not null, -- 4 a.m. to 4 a.m. Central, like every report
  path text not null check (char_length(path) between 1 and 200),
  pattern text not null check (char_length(pattern) between 1 and 200), -- ids swapped for [id]
  entity_id text check (char_length(entity_id) <= 64), -- the id taken out of the path
  area text not null check (area in ('site', 'account', 'admin', 'pos', 'display', 'training')),
  role text, -- staff pages: the signed-in role, not the person
  seconds int not null default 0 check (seconds between 0 and 14400), -- on screen, up to 4 hours
  device text check (device in ('phone', 'tablet', 'desktop')),
  referrer_host text check (char_length(referrer_host) <= 100), -- first page of a visit only
  visitor_id uuid not null,
  session_id uuid not null,
  is_new_visitor boolean not null default false,
  is_entry boolean not null default false, -- first page of the visit
  not_found boolean not null default false, -- the 404 page
  staff_browser boolean not null default false, -- the browser has also opened staff pages
  updated_at timestamptz not null default now()
);

create index if not exists page_views_date_area_pattern_idx on page_views (business_date, area, pattern);

-- Server-only, like the rest: RLS on, no client policies.
alter table page_views enable row level security;

-- Records a page view, or raises its time if the same view was sent before
-- (only from the same visit). Now and then clears rows past 13 months.
create or replace function public.record_page_view(
  p_id uuid,
  p_occurred_at timestamptz,
  p_business_date date,
  p_path text,
  p_pattern text,
  p_entity_id text,
  p_area text,
  p_role text,
  p_seconds int,
  p_device text,
  p_referrer_host text,
  p_visitor_id uuid,
  p_session_id uuid,
  p_is_new_visitor boolean,
  p_is_entry boolean,
  p_not_found boolean,
  p_staff_browser boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into page_views (id, occurred_at, business_date, path, pattern, entity_id, area, role, seconds, device, referrer_host,
                          visitor_id, session_id, is_new_visitor, is_entry, not_found, staff_browser)
  values (p_id, p_occurred_at, p_business_date, p_path, p_pattern, p_entity_id, p_area, p_role, greatest(0, least(p_seconds, 14400)),
          p_device, p_referrer_host, p_visitor_id, p_session_id, p_is_new_visitor, p_is_entry, p_not_found, p_staff_browser)
  on conflict (id) do update
    set seconds = greatest(page_views.seconds, excluded.seconds),
        updated_at = now()
    where page_views.session_id = excluded.session_id;

  if random() < 0.002 then
    delete from page_views where business_date < (now() at time zone 'America/Chicago')::date - interval '13 months';
  end if;
end;
$$;

-- Everything Reports -> Website usage shows for one stretch of business
-- dates and a set of areas, added up here rather than in the app (a month
-- of views is too many rows to ship). Showtime pages carry their movie.
-- p_bucket_days groups the per-page trend (1 = a point a day).
create or replace function public.page_view_report(
  p_start date,
  p_end date,
  p_areas text[],
  p_bucket_days int default 1,
  p_prev_start date default null,
  p_prev_end date default null,
  p_skip_staff_browsers boolean default false
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with v as (
    select *
    from page_views
    where business_date between p_start and p_end
      and area = any (p_areas)
      and not (p_skip_staff_browsers and staff_browser)
  ),
  found as (
    select v.*, m.id as movie_id, m.title as movie_title
    from v
    left join screenings s on v.pattern = '/showtimes/[id]' and s.id::text = v.entity_id
    left join movies m on m.id = s.movie_id
    where not v.not_found
  ),
  prev as (
    select *
    from page_views
    where p_prev_start is not null
      and business_date between p_prev_start and p_prev_end
      and area = any (p_areas)
      and not (p_skip_staff_browsers and staff_browser)
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'views', count(*) filter (where not not_found),
        'visitors', count(distinct visitor_id),
        'sessions', count(distinct session_id),
        'seconds', coalesce(sum(seconds) filter (where not not_found), 0),
        'newVisitors', count(distinct visitor_id) filter (where is_new_visitor),
        'notFound', count(*) filter (where not_found)
      )
      from v
    ),
    'previous', case when p_prev_start is null then null else (
      select jsonb_build_object(
        'views', count(*) filter (where not not_found),
        'visitors', count(distinct visitor_id),
        'sessions', count(distinct session_id),
        'seconds', coalesce(sum(seconds) filter (where not not_found), 0),
        'newVisitors', count(distinct visitor_id) filter (where is_new_visitor),
        'notFound', count(*) filter (where not_found)
      )
      from prev
    ) end,
    'staffBrowserViews', case when not p_skip_staff_browsers then 0 else (
      select count(*)
      from page_views
      where business_date between p_start and p_end and area = any (p_areas) and staff_browser and not not_found
    ) end,
    'pages', (
      select coalesce(jsonb_agg(p order by p.views desc, p.seconds desc), '[]'::jsonb)
      from (
        select pattern, min(area) as area, movie_id, max(movie_title) as movie_title,
               count(*) as views, count(distinct visitor_id) as visitors, coalesce(sum(seconds), 0) as seconds
        from found
        group by pattern, movie_id
      ) p
    ),
    'trend', (
      select coalesce(jsonb_agg(t), '[]'::jsonb)
      from (
        select pattern, movie_id, (business_date - p_start) / greatest(p_bucket_days, 1) as bucket, count(*) as views
        from found
        group by 1, 2, 3
      ) t
    ),
    'days', (
      select coalesce(jsonb_agg(d order by d.date), '[]'::jsonb)
      from (
        select business_date as date, count(*) as views, count(distinct visitor_id) as visitors, coalesce(sum(seconds), 0) as seconds
        from found
        group by 1
      ) d
    ),
    'entries', (
      select coalesce(jsonb_agg(e order by e.views desc), '[]'::jsonb)
      from (
        select pattern, movie_id, max(movie_title) as movie_title, count(*) as views
        from found
        where is_entry
        group by 1, 2
        order by 4 desc
        limit 12
      ) e
    ),
    'referrers', (
      select coalesce(jsonb_agg(r order by r.visits desc), '[]'::jsonb)
      from (
        select coalesce(referrer_host, '') as host, count(*) as visits
        from v
        where is_entry
        group by 1
        order by 2 desc
        limit 12
      ) r
    ),
    'devices', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from (
        select coalesce(device, 'unknown') as device, count(distinct session_id) as visits
        from v
        group by 1
      ) x
    ),
    'hours', (
      select coalesce(jsonb_agg(h order by h.hour), '[]'::jsonb)
      from (
        select extract(hour from occurred_at at time zone 'America/Chicago')::int as hour, count(*) as views
        from found
        group by 1
      ) h
    ),
    'roles', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select pattern, coalesce(role, '') as role, count(*) as views, coalesce(sum(seconds), 0) as seconds
        from found
        where area in ('admin', 'pos', 'training', 'display')
        group by 1, 2
      ) r
    ),
    'missing', (
      select coalesce(jsonb_agg(m order by m.views desc), '[]'::jsonb)
      from (
        select path, count(*) as views
        from v
        where not_found
        group by 1
        order by 2 desc
        limit 12
      ) m
    )
  );
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.record_page_view(uuid, timestamptz, date, text, text, text, text, text, int, text, text, uuid, uuid, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_page_view(uuid, timestamptz, date, text, text, text, text, text, int, text, text, uuid, uuid, boolean, boolean, boolean, boolean) to service_role;
revoke execute on function public.page_view_report(date, date, text[], int, date, date, boolean) from public, anon, authenticated;
grant execute on function public.page_view_report(date, date, text[], int, date, date, boolean) to service_role;
