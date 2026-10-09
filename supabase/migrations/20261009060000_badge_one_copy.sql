-- The Badge Case: one copy per badge, per holder, per period.
--
-- The quirk: a check-in undone after its copy sealed (the permanence rule,
-- 20261009050000) drops its claim (member_badges) but keeps the copy. The
-- next check-in makes a fresh claim, and minting looked only at the claim
-- (source_ref), so it minted a second Welcome.
--
-- Now a copy carries the key it was earned under:
--   mint_holder_id  the holder it was minted for (a merge moves holder_id,
--                   never this), and
--   period_key      '' for a once-ever badge (Welcome, visits_10, an event
--                   badge: each event has its own badge), the year for a
--                   yearly one (Birthday). Null only for a copy minted
--                   without a claim (scripts' rehearsals).
-- and the database allows one live (not void, not revoked) copy per badge,
-- holder and period: badge_copies_one_live. badge_reserve_copy finds the
-- live copy first and hands it back instead of minting, linking the new
-- claim to it (member_badges.copy_id). The claim still pays its points as
-- before: undoing the check-in took them back, so they're paid once.
--
-- Additive and safe to run twice. Server-only: RLS on, no client policies.

alter table public.badge_copies add column if not exists mint_holder_id uuid references public.badge_holders(id);
alter table public.badge_copies add column if not exists period_key text;

-- The claim's copy: the one minted for it, or the live one it already had.
alter table public.member_badges add column if not exists copy_id uuid references public.badge_copies(id) on delete set null;
create index if not exists member_badges_copy_idx on public.member_badges (copy_id) where copy_id is not null;

-- ---------- fill in the copies out now ----------
-- Signed copies are frozen (badge_copies_frozen): the two new columns are
-- written once, here, with the guard off for this transaction only.
alter table public.badge_copies disable trigger badge_copies_frozen;
update public.badge_copies c set
  mint_holder_id = coalesce(
    (select (h->>'from_holder')::uuid from jsonb_array_elements(c.history) with ordinality t(h, i) where h->>'kind' = 'transferred' order by i limit 1),
    c.holder_id
  ),
  period_key = case
    when d.period = 'yearly' then coalesce(
      (select mb.period from public.member_badges mb where 'member_badges:' || mb.id::text = c.source_ref),
      c.stats->>'year'
    )
    when c.source_ref is not null then ''
  end
from public.badge_defs d
where d.id = c.def_id and c.mint_holder_id is null;
alter table public.badge_copies enable trigger badge_copies_frozen;

update public.member_badges mb set copy_id = c.id
from public.badge_copies c
where c.source_ref = 'member_badges:' || mb.id::text and mb.copy_id is null;

-- ---------- one live copy per badge, holder and period ----------
-- (Checked before this ran: no holder had two live copies of a badge.)
create unique index if not exists badge_copies_one_live on public.badge_copies (def_id, mint_holder_id, period_key)
  where period_key is not null and voided_at is null and revoked_at is null;

-- ---------- minting: the copy they have, if they have one ----------
-- The permanence rule's badge_reserve_copy, plus: for a claim, the period
-- key, and the holder's live copy of that badge and period if there is one
-- (returned as is, never a second). The badge row is locked, so two
-- mintings at once can't both miss it; badge_copies_one_live backs it up.
create or replace function public.badge_reserve_copy(
  p_def uuid, p_holder uuid, p_source text, p_id uuid, p_code text, p_stats jsonb,
  p_event_kind text default null, p_event_ref text default null, p_event_label text default null,
  p_minted_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d badge_defs%rowtype;
  s badge_series%rowtype;
  c badge_copies%rowtype;
  claim member_badges%rowtype;
  k text;
begin
  if p_source is not null then
    select * into c from badge_copies where source_ref = p_source;
    if found then
      return to_jsonb(c);
    end if;
  end if;
  select * into d from badge_defs where id = p_def for update;
  if not found then
    raise exception 'badge % not found', p_def;
  end if;
  -- Locked: a second minting of the same source waits here, then finds it.
  if p_source is not null then
    select * into c from badge_copies where source_ref = p_source;
    if found then
      return to_jsonb(c);
    end if;
    if p_source like 'member_badges:%' then
      select * into claim from member_badges where id::text = substr(p_source, 15);
      if not found then
        return null;
      end if;
    end if;
    k := case when d.period = 'yearly' then coalesce(claim.period, '') else '' end;
    select * into c from badge_copies
     where def_id = d.id and period_key = k
       and (holder_id = p_holder or mint_holder_id = p_holder)
       and voided_at is null and revoked_at is null
     order by minted_at
     limit 1;
    if found then
      if claim.id is not null then
        update member_badges set copy_id = c.id where id = claim.id;
      end if;
      return to_jsonb(c);
    end if;
  end if;
  select * into s from badge_series where id = d.series_id;
  update badge_defs set minted_count = minted_count + 1 where id = d.id;
  insert into badge_copies (id, def_id, issuer_id, series, serial, holder_id, code, minted_at, name, flavor, generator, stats, event_kind, event_ref, event_label, source_ref, mint_holder_id, period_key)
  values (p_id, d.id, d.issuer_id, s.number, d.minted_count + 1, p_holder, p_code, date_trunc('milliseconds', coalesce(p_minted_at, now())),
    d.name, d.flavor, d.generator, coalesce(p_stats, '{}'::jsonb), p_event_kind, p_event_ref, p_event_label, p_source, p_holder, k)
  returning * into c;
  if claim.id is not null then
    update member_badges set copy_id = c.id where id = claim.id;
  end if;
  return to_jsonb(c);
end;
$$;

-- ---------- grants ----------
revoke execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) to service_role;
