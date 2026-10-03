-- Genres on films (phase 4 of email marketing), for "genre fans" segments:
-- someone who came to two horror screenings in 90 days hears about the
-- next horror night. Filled from TMDB's genres (via tmdb_id) or OMDb's
-- Genre; empty until then, so the segment starts at zero.
--
-- Additive and safe to run twice.

alter table movies add column if not exists genres text[] not null default '{}';
create index if not exists movies_genres_idx on movies using gin (genres);

-- Members with at least p_min business days, since p_since, on which they
-- had a confirmed ticket for a screening (already started) of a film in
-- genre p_genre (case-insensitive). Service role only.
create or replace function public.member_genre_days(p_genre text, p_since date, p_min int)
returns table (member_id uuid, days int)
language sql
stable
security definer
set search_path = public
as $$
  select b.member_id, count(distinct ((s.starts_at at time zone 'America/Chicago') - interval '4 hours')::date)::int
  from bookings b
  join screenings s on s.id = b.screening_id
  join movies mo on mo.id = s.movie_id
  where b.member_id is not null
    and b.status = 'confirmed'
    and s.starts_at <= now()
    and ((s.starts_at at time zone 'America/Chicago') - interval '4 hours')::date >= p_since
    and exists (select 1 from unnest(mo.genres) g where lower(g) = lower(p_genre))
  group by b.member_id
  having count(distinct ((s.starts_at at time zone 'America/Chicago') - interval '4 hours')::date) >= greatest(p_min, 1);
$$;

revoke execute on function public.member_genre_days(text, date, int) from public, anon, authenticated;
grant execute on function public.member_genre_days(text, date, int) to service_role;
