-- Holding area for accounts pulled from the old site (royalecinemajoplin.com,
-- a Django app) ahead of the "claim your account" email. Kept separate from
-- `members` on purpose: ~11,000 of the ~13,200 old accounts are spam-bot
-- signups (random-string names, out-of-area phone numbers), many using real
-- strangers' email addresses. Only rows staff approve are copied into
-- `members`; the rest are deleted once the migration is finished.
--
-- Loaded by scripts/load-legacy-accounts.mjs; reviewed and imported at
-- /admin/members/old-site. RLS is on with no policies: service role only.
create table legacy_accounts (
  legacy_user_id integer primary key,
  email text,
  username text,
  first_name text,
  last_name text,
  phone text,
  joined_at timestamptz,
  active boolean,
  membership_type text,
  membership_duration text,
  membership_is_plus boolean,
  membership_status text,
  subscription_type text,
  subscription_billing_status text,
  subscription_fortis_id text,
  subscription_cancelled_at text,
  -- Automatic sort from the loader: 'paying' (subscription / Plus / paid
  -- plan), 'likely_real', 'review' (unclear or conflicting signals), 'bot'.
  classification text not null check (classification in ('paying', 'likely_real', 'review', 'bot')),
  reasons text[] not null default '{}',
  -- What happens on import. Starts from the classification; staff can
  -- override. decided_by is null for the automatic default.
  decision text not null check (decision in ('import', 'skip', 'review')),
  decided_by uuid references employees(id) on delete set null,
  decided_at timestamptz,
  imported_member_id uuid references members(id) on delete set null,
  -- Stable pseudo-random order, so paging through a group is a spot-check
  -- sample rather than the alphabetically-first few.
  shuffle text generated always as (md5(legacy_user_id::text)) stored,
  loaded_at timestamptz not null default now()
);

create index legacy_accounts_email_idx on legacy_accounts (lower(email));
create index legacy_accounts_group_idx on legacy_accounts (classification, shuffle);
create index legacy_accounts_decision_idx on legacy_accounts (decision);

alter table legacy_accounts enable row level security;

-- Imported members remember where they came from: legacy_plus marks people
-- who were paying / Plus on the old site, so their invite says "your
-- Insiders+ is moving" rather than pitching an upgrade.
alter table members add column legacy_user_id integer unique;
alter table members add column legacy_plus boolean not null default false;
alter table members add column imported_at timestamptz;
