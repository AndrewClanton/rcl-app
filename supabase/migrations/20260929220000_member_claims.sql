-- "Claim your account" links (src/lib/member-claim.ts): a QR code on the
-- check-in tablet or a receipt that lets a member with no website login set
-- one up. The link itself is signed by the app; this table records each
-- link's random nonce, so a link works once, and counts wrong guesses at
-- the phone digits, so a found receipt can't be tried forever.
--
-- The app tolerates this being missing (no claim links are made until it's
-- applied), so it can go in any time. Additive and safe to run twice.

create table if not exists member_claims (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique,
  member_id uuid not null references members(id) on delete cascade,
  kind text not null check (kind in ('kiosk', 'receipt')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  failed_tries int not null default 0,
  used_at timestamptz,
  used_by_auth_user uuid references auth.users(id) on delete set null
);

create index if not exists member_claims_member_idx on member_claims (member_id);

-- Server-only, like the rest: RLS on, no client policies.
alter table member_claims enable row level security;

-- The last step of a claim: attach login p_user to member p_member using
-- the link with nonce p_nonce, all in one go so two taps (or two phones)
-- can't both get through. The app has already checked the link's signature
-- and the phone digits. p_email is the login's email if the login proved it
-- owns it (else null); it's saved only on an account with no email yet, and
-- only if no other account has it. Returns what happened:
--   linked / linked_email   done (linked_email: the email was saved too)
--   mine                    this login already had it (a double tap)
--   no_claim                no such link for this member
--   gone                    the member was removed
--   has_login               the member already has a different login
--   used / expired          the link was used, or has run out
--   screen                  p_user is a signage login (a TV or the tablet)
--   user_linked             p_user already belongs to another member
create or replace function public.claim_member_account(p_nonce text, p_member uuid, p_user uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c member_claims%rowtype;
  m members%rowtype;
  saved_email boolean := false;
begin
  select * into c from member_claims where nonce = p_nonce for update;
  if not found or c.member_id <> p_member then
    return 'no_claim';
  end if;

  select * into m from members where id = p_member for update;
  if not found or m.erased_at is not null then
    return 'gone';
  end if;

  if m.auth_user_id = p_user then
    update member_claims
    set used_at = coalesce(used_at, now()), used_by_auth_user = coalesce(used_by_auth_user, p_user)
    where id = c.id;
    return 'mine';
  end if;
  if m.auth_user_id is not null then
    return 'has_login';
  end if;
  if c.used_at is not null then
    return 'used';
  end if;
  if c.expires_at <= now() then
    return 'expired';
  end if;
  if exists (select 1 from employees where auth_user_id = p_user and role = 'display') then
    return 'screen';
  end if;
  if exists (select 1 from members where auth_user_id = p_user) then
    return 'user_linked';
  end if;

  begin
    update members set auth_user_id = p_user where id = p_member;
  exception when unique_violation then
    -- Linked to another member a moment ago (members_auth_user_id_idx).
    return 'user_linked';
  end;

  if p_email is not null and m.email is null
     and not exists (select 1 from members where lower(email) = lower(p_email)) then
    begin
      update members set email = p_email where id = p_member;
      saved_email := true;
    exception when unique_violation then
      saved_email := false;
    end;
  end if;

  update member_claims set used_at = now(), used_by_auth_user = p_user where id = c.id;
  return case when saved_email then 'linked_email' else 'linked' end;
end;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.claim_member_account(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_member_account(text, uuid, uuid, text) to service_role;
