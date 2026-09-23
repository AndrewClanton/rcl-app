-- 1. A 'display' role for unattended signage logins (the ramp TV). The app
--    treats these accounts as not-staff everywhere except the screens meant
--    for them -- see getStaffSession / requireDisplayScreen in
--    src/lib/auth.ts -- so a stolen or tampered-with screen can't reach the
--    back office, the register, or any Server Action.
alter table employees drop constraint employees_role_check;
alter table employees add constraint employees_role_check check (role in ('cashier', 'manager', 'admin', 'owner', 'display'));

-- 2. These policies used "authenticated" as a stand-in for "staff" (see
--    20260914031000_staff_read_policies.sql), which stopped being true once
--    customers could create website accounts at /account/login: any member
--    could read every register order -- tab names, totals, tips, payment
--    ids. Scope them to active staff logins, excluding display accounts.
--    SECURITY DEFINER because employees has RLS with no client policies, so
--    a plain subquery from a policy would see no rows.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and active and role <> 'display'
  );
$$;
revoke all on function public.is_active_staff() from public;
grant execute on function public.is_active_staff() to authenticated;

drop policy "authenticated read orders" on orders;
drop policy "authenticated read order_items" on order_items;
drop policy "authenticated read community_programs" on community_programs;
create policy "staff read orders" on orders for select to authenticated using (public.is_active_staff());
create policy "staff read order_items" on order_items for select to authenticated using (public.is_active_staff());
create policy "staff read community_programs" on community_programs for select to authenticated using (public.is_active_staff());
