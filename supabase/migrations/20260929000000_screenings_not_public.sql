-- Movies and screenings were readable by anyone holding the site's public
-- (anon) key, which let older MPLC-licensed titles -- never advertised
-- publicly -- be listed straight from the database. The public site now
-- reads them on the server (service role) and filters those titles out, so
-- the public read policies go.
--
-- Signed-in staff and the in-venue display screens still read them in the
-- browser for live updates (the ramp countdown's realtime subscription).

create or replace function public.is_active_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Like is_active_staff(), but display screens count too.
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and active
  );
$$;
revoke all on function public.is_active_employee() from public;
grant execute on function public.is_active_employee() to authenticated;

drop policy if exists "public read movies" on movies;
drop policy if exists "public read screenings" on screenings;

create policy "employees read movies" on movies for select to authenticated using (public.is_active_employee());
create policy "employees read screenings" on screenings for select to authenticated using (public.is_active_employee());
