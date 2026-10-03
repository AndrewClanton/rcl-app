# Database migrations

Each change to the database is a file in `migrations/`, named
`<YYYYMMDDHHMMSS>_<what>.sql`. Make the timestamp later than every existing
one: two files with the same timestamp collide when they're applied.

They're applied by hand, from a computer with `.env.local`:

```
node scripts/apply-sql.mjs supabase/migrations/<file>.sql
node scripts/check-sql.mjs "select ..."      # look at the result
```

Write every migration so it's safe to run twice (`create table if not
exists`, `create or replace function`, `drop policy if exists` before
`create policy`, and so on).

## Grants (from Oct 30, 2026)

Supabase stopped granting new things in the `public` schema automatically.
A table, view, sequence or function created after Oct 30 can't be reached
by the app through supabase-js until a migration grants it. That includes
the service role key, which skips row level security but still needs a
grant. Existing tables keep the grants they have.

So every migration that creates something grants it, in the same file.
Most of our tables are server-only: RLS on, no policies, and the app reads
and writes with the service role. Use the block that matches:

```sql
-- Server-only table (the usual case): RLS on, no client policies.
alter table public.my_table enable row level security;
grant select, insert, update, delete on public.my_table to service_role;

-- The website reads it with the public key too (a "public read" policy):
grant select on public.my_table to anon, authenticated;

-- Signed-in staff or members read it through a policy (and Realtime
-- postgres_changes on it needs this too):
grant select on public.my_table to authenticated;

-- An identity or serial column makes a sequence, <table>_<column>_seq:
grant usage, select on sequence public.my_table_id_seq to service_role;

-- A function the app calls with supabase.rpc():
revoke execute on function public.my_fn(uuid) from public, anon, authenticated;
grant execute on function public.my_fn(uuid) to service_role;

-- A function only triggers or other SQL call: just the revoke above.
-- Trigger functions (returns trigger) need neither.
```

Grant only what the app does: if nothing deletes from a table, leave out
`delete`. A grant opens the door, and RLS policies still decide which rows
anon and authenticated see. Never grant insert, update or delete to anon.

`node scripts/check-grants.mjs` checks migrations from 2026-10-03 on (or
the files you name) and lists anything created but not granted.
`apply-sql.mjs` runs the same check and refuses such a file. A table that
only plain SQL touches, like a backup, can opt out with a comment in its
migration: `-- no-grants: <table>`.

`node scripts/check-grants.mjs --db` checks the live database for anything
in `public` the service role can't reach, and for tables with a public-read
policy that anon can't read.
