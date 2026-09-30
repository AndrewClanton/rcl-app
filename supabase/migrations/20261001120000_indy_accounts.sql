-- Holding area for the customer export from Indy, the ticketing system the
-- theater used before this app (2022-2025), ahead of copying those people
-- into `members`. Same pattern as legacy_accounts (the old website): the
-- loader sorts everyone, an admin reviews at /admin/members/indy, and
-- nothing touches `members` until they press Import there.
--
-- Loaded by scripts/load-indy-accounts.mjs (rules in src/lib/indy-rules.ts).
-- Only what the import needs is kept: no addresses, no birth year, no
-- Indy password or payment details. RLS is on with no policies: service
-- role only.
--
-- Additive and safe to run more than once.
create table if not exists indy_accounts (
  -- Indy's own user id ('id' in the export).
  indy_user_id text primary key,
  email text,                 -- lowercased
  first_name text,
  last_name text,
  phone text,                 -- formatted "(417) 555-0142", or null
  phone_digits text,          -- 10 digits, or null
  birthday date,              -- month and day only, stored in 2000 (never the birth year)
  indy_created_at timestamptz,
  indy_last_visit date,       -- the only visit fact in the export (no history, no titles)
  indy_membership text,       -- Indy plan name; paid plans are not carried over
  indy_type text,             -- standard / marketing / member-guest / day-pass
  indy_points numeric,        -- kept for Andrew's decision; never imported
  -- Yes to all four of Indy's email questions. Anything less is a no.
  said_yes boolean not null,

  -- The loader's sort:
  --   fill     matched to exactly one member; only their empty fields fill
  --   new      no member matches and they have an email: a new free Insider
  --   conflict the matches disagree; a person picks
  --   skip     staff, test accounts, no email or phone, removed at their request
  classification text not null check (classification in ('fill', 'new', 'conflict', 'skip')),
  reasons text[] not null default '{}',
  email_member_id uuid references members(id) on delete set null,
  phone_member_id uuid references members(id) on delete set null,
  -- What pressing Import does with this row:
  --   decision   'import', 'skip', or 'review' (a person has to choose
  --              first; a 'review' row is never imported)
  --   import_as  'fill': fill target_member_id's empty fields and link it;
  --              'new': add a new free Insider. Null until there's a choice.
  --   target_member_id  the member a fill goes to. On a conflict, "fill the
  --              email match" copies email_member_id here, "fill the phone
  --              match" copies phone_member_id, and "add as new" sets
  --              import_as 'new' and clears it.
  -- Starts from the classification (fill and new: import; conflict: review;
  -- skip: skip). decided_by is null for that automatic default; a loader
  -- re-run re-sorts only rows nobody has decided.
  decision text not null check (decision in ('import', 'skip', 'review')),
  import_as text check (import_as in ('fill', 'new')),
  target_member_id uuid references members(id) on delete set null,
  -- ["phone", "birthday", "name"]: what a fill would add, as of the last
  -- load or choice. The import works it out again from the member as they
  -- are then, and never overwrites anything.
  planned_fills jsonb not null default '[]'::jsonb,
  -- Said no on Indy, but the matched member is opted in only by our old
  -- default (email_opt_in true, email_opt_in_changed_at null). Andrew picks
  -- 'honor' (turn their email off) or 'leave'; 'pending' holds the row out
  -- of the import until he does. Null on every other row.
  said_no_review boolean not null default false,
  said_no_decision text check (said_no_decision in ('pending', 'honor', 'leave')),
  decided_by uuid references employees(id) on delete set null,
  decided_at timestamptz,

  -- What the import did.
  imported_member_id uuid references members(id) on delete set null,
  imported_at timestamptz,
  said_no_honored_at timestamptz,   -- the import turned their email off
  -- Their Indy answer was written to the email-marketing tables
  -- (member_email_prefs, email_consent_log). Null while those tables don't
  -- exist yet, so a later Import run fills it in.
  consent_recorded_at timestamptz,
  -- Removed at their request: contact details blanked, never imported.
  erased_at timestamptz,

  -- Stable pseudo-random order, so paging through a group is a spot-check
  -- sample rather than the alphabetically-first few.
  shuffle text generated always as (md5(indy_user_id)) stored,
  loaded_at timestamptz not null default now()
);

create index if not exists indy_accounts_group_idx on indy_accounts (classification, shuffle);
create index if not exists indy_accounts_decision_idx on indy_accounts (decision);
create index if not exists indy_accounts_email_idx on indy_accounts (lower(email));
create index if not exists indy_accounts_said_no_idx on indy_accounts (shuffle) where said_no_review;

alter table indy_accounts enable row level security;

-- Imported and linked members remember their Indy account (the same
-- definition as 20261001090000_email_marketing.sql, so either can run
-- first). Their Indy answer stays in indy_accounts.said_yes.
alter table members add column if not exists indy_user_id text unique;

-- After an import batch: mark each row with its member, whether its "no"
-- was honored, and whether its answer reached the email-marketing tables,
-- in one statement. p_rows: [{indy_user_id, member_id, honored, consent}].
-- Only fills in what's still empty, so a retried batch changes nothing.
-- Service role only.
create or replace function public.mark_indy_accounts(p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with done as (
    update indy_accounts ia
    set imported_member_id = coalesce(ia.imported_member_id, r.member_id),
        imported_at = coalesce(ia.imported_at, case when r.member_id is not null then now() end),
        said_no_honored_at = coalesce(ia.said_no_honored_at, case when r.honored then now() end),
        consent_recorded_at = coalesce(ia.consent_recorded_at, case when r.consent then now() end)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(indy_user_id text, member_id uuid, honored boolean, consent boolean)
    where ia.indy_user_id = r.indy_user_id
    returning 1
  )
  select count(*)::int from done;
$$;
revoke all on function public.mark_indy_accounts(jsonb) from public, anon, authenticated;
grant execute on function public.mark_indy_accounts(jsonb) to service_role;

-- Removing a member's personal info (erase_member_personal_info) also
-- blanks their Indy copy and marks it skipped and erased, so a later load
-- can't bring it back. Matched by the Indy link, the rows pointing at them,
-- and the email they had.
--
-- member_erasures can't help recognise someone removed BEFORE this table
-- existed: it records only the member id, dates and counts, never the
-- email, and the erase blanks the member's email. Those people are caught
-- only if their member row carried an indy_user_id.
create or replace function public.forget_erased_indy_accounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update indy_accounts
  set email = null, first_name = null, last_name = null, phone = null, phone_digits = null,
      birthday = null, indy_last_visit = null, indy_points = null,
      classification = 'skip', reasons = array['removed at their request'],
      decision = 'skip', import_as = null, target_member_id = null, planned_fills = '[]'::jsonb,
      said_no_review = false, said_no_decision = null,
      erased_at = now()
  where erased_at is null
    and ((new.indy_user_id is not null and indy_user_id = new.indy_user_id)
      or imported_member_id = new.id
      or target_member_id = new.id
      or email_member_id = new.id
      or (old.email is not null and lower(email) = lower(old.email)));
  return new;
end;
$$;
revoke all on function public.forget_erased_indy_accounts() from public, anon, authenticated;

drop trigger if exists members_forget_erased_indy on members;
create trigger members_forget_erased_indy
  after update of erased_at on members
  for each row
  when (old.erased_at is null and new.erased_at is not null)
  execute function public.forget_erased_indy_accounts();
