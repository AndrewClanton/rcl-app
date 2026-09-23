-- Senior and student rates are only ever set in person: someone signs up at
-- the standard rate, then staff check an ID at the register and switch them.
-- Record who made each switch and when. A rate with no "set by" came over
-- from the old website.
alter table members add column if not exists price_tier_set_by uuid references employees(id) on delete set null;
alter table members add column if not exists price_tier_set_at timestamptz;

-- The register looks members up by phone as typed ("4175551234" or
-- "555-1234"), but phones are stored formatted ("(417) 555-1234").
alter table members add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored;
