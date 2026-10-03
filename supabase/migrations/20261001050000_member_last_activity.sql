-- Members' most recent activity, so Back office → Members can list whoever
-- just checked in, earned points, bought something or booked a ticket at
-- the top (Andrew, 10/1).
--
-- members.last_activity_at is kept current by small triggers on the four
-- places activity is recorded. The bookkeeping can never break the thing it
-- follows: every trigger swallows its own errors (a check-in, a sale or a
-- points award always goes through), and it only ever moves the time
-- forward. Backfilled from everything recorded so far. Idempotent.

alter table members add column if not exists last_activity_at timestamptz;
create index if not exists members_last_activity_idx on members (last_activity_at desc nulls last);

create or replace function touch_member_activity(p_member uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member is null or p_at is null then
    return;
  end if;
  update members
     set last_activity_at = p_at
   where id = p_member
     and (last_activity_at is null or last_activity_at < p_at);
exception when others then
  raise warning 'touch_member_activity: %', sqlerrm;
end;
$$;
revoke all on function touch_member_activity(uuid, timestamptz) from public, anon, authenticated;

create or replace function member_activity_from_visit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_member_activity(new.member_id, coalesce(new.checked_in_at, now()));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function member_activity_from_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_member_activity(new.member_id, coalesce(new.created_at, now()));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function member_activity_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_member_activity(new.member_id, new.completed_at);
  return null;
exception when others then
  return null;
end;
$$;

create or replace function member_activity_from_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_member_activity(new.member_id, coalesce(new.created_at, now()));
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function member_activity_from_visit() from public, anon, authenticated;
revoke all on function member_activity_from_points() from public, anon, authenticated;
revoke all on function member_activity_from_order() from public, anon, authenticated;
revoke all on function member_activity_from_booking() from public, anon, authenticated;

drop trigger if exists member_activity_visit on member_visits;
create trigger member_activity_visit
  after insert or update of checked_in_at on member_visits
  for each row execute function member_activity_from_visit();

drop trigger if exists member_activity_points on points_ledger;
create trigger member_activity_points
  after insert on points_ledger
  for each row execute function member_activity_from_points();

drop trigger if exists member_activity_order on orders;
create trigger member_activity_order
  after insert or update of member_id, completed_at on orders
  for each row
  when (new.member_id is not null and new.completed_at is not null)
  execute function member_activity_from_order();

drop trigger if exists member_activity_booking on bookings;
create trigger member_activity_booking
  after insert or update of member_id on bookings
  for each row
  when (new.member_id is not null)
  execute function member_activity_from_booking();

-- Everything recorded so far.
update members m
   set last_activity_at = x.at
  from (
    select member_id, max(at) as at
      from (
        select member_id, checked_in_at as at from member_visits
        union all select member_id, created_at from points_ledger
        union all select member_id, completed_at from orders where completed_at is not null
        union all select member_id, created_at from bookings
      ) u
     where member_id is not null and at is not null
     group by member_id
  ) x
 where x.member_id = m.id
   and (m.last_activity_at is null or m.last_activity_at < x.at);
