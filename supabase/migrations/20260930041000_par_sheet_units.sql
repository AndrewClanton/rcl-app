-- Par sheet, v2: how each line is counted, what size it comes in, and
-- tidier unit words. Andrew (Sep 29): bottles should count in quarter
-- bottles, and every line should say the unit it's measured in.
--
-- par_items.count_step: what − and + move by on the count (0.25, 0.5 or 1).
-- Null means automatic: bottles (not spray bottles), kegs, jugs, gallons,
-- quarts and cartons, and any line with a fractional par, count in
-- quarters; everything else in whole units. (Same rule as autoStep() in
-- src/lib/ops/shared.ts.) Today's lines get that rule written in, so the
-- tablet shows an explicit choice staff can change.
--
-- par_items.unit_size: the size one unit comes in ("750 ml", "1.75 L",
-- "12.5 lb", "1/2 barrel"). Optional. Sizes that were written into the unit
-- ("bags (12.5 lb)") move here.
--
-- par_latest_lines(): each par line's most recent count line in a time
-- range, so the shopping list and "Since the last count" can merge every
-- count saved in a day instead of reading only the newest one.
--
-- Additive, safe to run twice, and no par number changes. The unit tidy-up
-- is logged to ops_changes (the register's History).

alter table par_items add column if not exists count_step numeric(4,2);
alter table par_items add column if not exists unit_size text;
alter table par_items drop constraint if exists par_items_count_step_check;
alter table par_items add constraint par_items_count_step_check check (count_step is null or count_step in (0.25, 0.5, 1));
alter table par_items drop constraint if exists par_items_unit_size_check;
alter table par_items add constraint par_items_unit_size_check check (unit_size is null or char_length(unit_size) between 1 and 40);

create index if not exists par_counts_completed_at_idx on par_counts(completed_at desc);
create index if not exists par_count_lines_item_idx on par_count_lines(item_id);

create or replace function public.par_latest_lines(p_since timestamptz default null, p_before timestamptz default null)
returns table (item_id uuid, qty numeric, par_qty numeric, count_id uuid, completed_at timestamptz, counted_by uuid)
language sql
stable
set search_path = public
as $$
  select distinct on (l.item_id) l.item_id, l.qty, l.par_qty, c.id, c.completed_at, c.counted_by
  from par_count_lines l
  join par_counts c on c.id = l.count_id
  where (p_since is null or c.completed_at >= p_since)
    and (p_before is null or c.completed_at < p_before)
  order by l.item_id, c.completed_at desc, c.id desc
$$;
revoke execute on function public.par_latest_lines(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.par_latest_lines(timestamptz, timestamptz) to service_role;

-- ---------- tidy the unit words ----------
do $$
declare
  renamed text;
  sized text;
  n_sized int;
  n_quarters int;
begin
  create temp table par_units_before on commit drop as select id, unit, unit_size, count_step from par_items;

  -- A size in brackets moves to its own field: "bags (12.5 lb)" -> "bags", "12.5 lb".
  update par_items
  set unit_size = trim(substring(unit from '\(([^()]+)\)\s*$')),
      unit = trim(regexp_replace(unit, '\s*\([^()]+\)\s*$', ''))
  where unit ~ '\S\s*\([^()]+\)\s*$' and unit_size is null;

  -- "reserve bottles" -> "bottles": the unit is what it's counted in.
  update par_items set unit = trim(regexp_replace(unit, '^\s*reserve\s+', '', 'i'))
  where unit ~* '^\s*reserve\s+\S';

  -- Singular -> plural, so every line reads the same ("Par 2 bottles").
  update par_items
  set unit = case lower(unit)
    when 'bottle' then 'bottles'
    when 'spray bottle' then 'spray bottles'
    when 'case' then 'cases'
    when 'bag' then 'bags'
    when 'sleeve' then 'sleeves'
    when 'carton' then 'cartons'
    when 'shaker' then 'shakers'
    when 'sheet' then 'sheets'
    when 'keg' then 'kegs'
    when 'box' then 'boxes'
    when '24-pack' then '24-packs'
    when 'can' then 'cans'
    when 'jug' then 'jugs'
    when 'pack' then 'packs'
    when 'gallon' then 'gallons'
    when 'quart' then 'quarts'
    else unit end
  where lower(unit) in ('bottle', 'spray bottle', 'case', 'bag', 'sleeve', 'carton', 'shaker', 'sheet', 'keg', 'box', '24-pack', 'can', 'jug', 'pack', 'gallon', 'quart');

  -- Count by: the automatic rule, written in.
  update par_items
  set count_step = case
    when par_qty is not null and par_qty <> trunc(par_qty) then 0.25
    when unit ~* '\mspray\s+bottles?\M' then 1
    when unit ~* '\m(bottles?|kegs?|jugs?|gallons?|quarts?|cartons?)\M' then 0.25
    else 1 end
  where count_step is null;

  select string_agg(format('"%s" to "%s" (%s)', old_unit, new_unit, n), ', ' order by n desc, old_unit)
  into renamed
  from (
    select b.unit as old_unit, p.unit as new_unit, count(*) as n
    from par_items p join par_units_before b on b.id = p.id
    where b.unit is distinct from p.unit and b.unit is not null
    group by b.unit, p.unit
  ) x;

  select count(*), string_agg(distinct '"' || p.unit_size || '"', ', ')
  into n_sized, sized
  from par_items p join par_units_before b on b.id = p.id
  where b.unit_size is null and p.unit_size is not null;

  select count(*) into n_quarters
  from par_items p join par_units_before b on b.id = p.id
  where b.count_step is null and p.count_step = 0.25;

  if renamed is not null or n_sized > 0 or n_quarters > 0 then
    insert into ops_changes (entity, entity_id, action, summary, changed_by)
    values (
      'par_item', null, 'changed',
      left(concat_ws('; ',
        'the par sheet''s units (no par numbers changed)',
        case when renamed is not null then 'renamed ' || renamed end,
        case when n_sized > 0 then format('sizes moved to their own field on %s lines (%s)', n_sized, sized) end,
        case when n_quarters > 0 then format('%s lines now count in quarters (bottles, kegs, jugs, gallons, quarts, cartons, and lines with a fractional par)', n_quarters) end
      ), 2000),
      null
    );
  end if;

  drop table par_units_before;
end $$;
