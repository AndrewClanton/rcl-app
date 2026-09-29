-- A short line a member writes about themselves on their account (a
-- favorite quote, a signature, "Horror or nothing"). Staff see it on the
-- register when they check in and on the member's back-office page; it's
-- never shown publicly. Additive and safe to run twice.
alter table members add column if not exists tagline text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_tagline_length') then
    alter table members add constraint members_tagline_length check (tagline is null or char_length(tagline) <= 120);
  end if;
end $$;
