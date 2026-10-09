-- Meme sign-in sounds (Andrew, 10/9): six more sounds to spend points on,
-- played by sounds.ts (perk_<key>), listed in lib/rewards.ts PERK_SOUNDS.
insert into reward_catalog (name, description, kind, perk_slot, perk_key, points, real_cost, is_alcohol, active, sort)
select v.name, v.description, 'perk', 'sound', v.perk_key, v.points, 0, false, true, v.sort
from (values
  ('Sound: Air horn', 'Three blasts of the air horn when you walk in.', 'airhorn', 75, 150),
  ('Sound: Sad trombone', 'Wah, wah, wah, waaah. For the humble entrance.', 'sadtrombone', 75, 160),
  ('Sound: Big boom', 'The bass boom that lands after a punchline.', 'boom', 75, 170),
  ('Sound: Dun dun dunnn', 'A dramatic sting, like the plot just twisted.', 'dramatic', 75, 180),
  ('Sound: Record scratch', 'Everything stops. Yep, that''s you.', 'scratch', 50, 190),
  ('Sound: Rimshot', 'Ba-dum, tss.', 'rimshot', 50, 200)
) as v(name, description, perk_key, points, sort)
where not exists (select 1 from reward_catalog c where c.perk_slot = 'sound' and c.perk_key = v.perk_key);
