-- The Royale Bar Book (the study, Oct 4 2026).
--
-- Ingredients get what the register's drink icons and the Bar Book need:
--   kind     what it is: spirit, liqueur, mixer, juice, syrup, bitters,
--            garnish, beer, wine or other
--   family   its color family on the drink icons (the fixed spirit legend in
--            src/lib/bar/icons.ts): whiskey, rum, gin, vodka, tequila,
--            brandy, liqueur, coffee, vermouth, citrus, grapefruit, ginger,
--            cola, cream, syrup, soda, beer or wine. Optional: the icons
--            read the name when it's empty.
--   carried  whether the bar stocks it. Everything already on the list is;
--            the Bar Book's seed list adds the ones we don't as not carried.
--
-- Columns only (no new tables or functions, so no grants). Additive and
-- safe to run twice. Before it's applied, the register's Bar tab draws its
-- icons from ingredient names and the Bar Book stays hidden.

alter table ingredients add column if not exists kind text;
alter table ingredients add column if not exists family text;
alter table ingredients add column if not exists carried boolean not null default true;

alter table ingredients drop constraint if exists ingredients_kind_check;
alter table ingredients add constraint ingredients_kind_check
  check (kind is null or kind in ('spirit', 'liqueur', 'mixer', 'juice', 'syrup', 'bitters', 'garnish', 'beer', 'wine', 'other'));
alter table ingredients drop constraint if exists ingredients_family_check;
alter table ingredients add constraint ingredients_family_check
  check (family is null or family in ('whiskey', 'rum', 'gin', 'vodka', 'tequila', 'brandy', 'liqueur', 'coffee', 'vermouth', 'citrus', 'grapefruit', 'ginger', 'cola', 'cream', 'syrup', 'soda', 'beer', 'wine'));

-- Fill in kind and family from the name, only where they're empty and only
-- for names that leave no doubt ("Well Gin", "Triple Sec", "Lime juice").
-- Anything else stays empty for a manager to set (Back office → Bar Book).
-- Running it again changes nothing.
with named as (
  select id, lower(name) as n from ingredients where kind is null
),
guess as (
  select id,
    case
      when n ~ 'bitters|angostura|peychaud' then 'bitters'
      when n ~ '\m(wedges?|wheels?|twists?|peels?|garnish|cherr(y|ies)|olives?|celery|nutmeg|mint)\M' and n !~ 'brine|juice|liqueur|schnapps|cr[eè]me de' then 'garnish'
      when n ~ 'juice|lemonade|limeade|pur[eé]e|clamato' then 'juice'
      when n ~ 'syrup|grenadine|orgeat|\magave\M' and n !~ 'whiske?y|liqueur' then 'syrup'
      when n ~ 'liqueur|schnapps|triple sec|cointreau|cura[cç]ao|amaretto|kahl[uú]a|baileys|irish cream|vermouth|campari|aperol|chartreuse|b[eé]n[eé]dictine|drambuie|galliano|frangelico|chambord|cr[eè]me de|j[aä]germeister|sloe gin|licor 43|limoncello|southern comfort|lillet|\mamaro\M' then 'liqueur'
      when n ~ 'ginger beer|ginger ale|tonic|club soda|soda water|seltzer|\mcola\M|\mcoke\M|coca[- ]?cola|pepsi|sprite|7[- ]?up|lemon[- ]lime|sour mix|sweet (and|&|n) sour|red bull|energy drink' then 'mixer'
      when n ~ 'vodka|\mgin\M|\mrum\M|tequila|mezcal|whiske?y|bourbon|\mrye\M|scotch|brandy|cognac|pisco|cacha[cç]a|tito.?s|absolut|grey goose|smirnoff|tanqueray|bombay|hendrick|bacardi|captain morgan|malibu|patr[oó]n|don julio|cuervo|jimador|crown royal|jack daniel|jameson|buffalo trace|woodford|maker.?s mark|wild turkey|seagram|fireball|meyers|hennessy' then 'spirit'
      when n ~ '\m(beer|lager|ale|ipa|stout|porter|pilsner|guinness|budweiser|bud light|coors|michelob|stella|corona|modelo)\M' and n !~ 'ginger|root beer' then 'beer'
      when n ~ '\m(wine|prosecco|champagne|merlot|cabernet|chardonnay|pinot|sauvignon|moscato|riesling|sangria)\M' then 'wine'
    end as kind
  from named
)
update ingredients i
set kind = g.kind
from guess g
where i.id = g.id and g.kind is not null and i.kind is null;

with named as (
  select id, lower(name) as n from ingredients where family is null
),
guess as (
  select id,
    case
      when n ~ 'cream soda' then 'ginger'
      when n ~ 'lemon[- ]lime|\msprite\M|7[- ]?up' then 'soda'
      when n ~ 'irish cream|baileys|cream of coconut|coconut cream|half (and|&) half|heavy cream|\mmilk\M|egg white|\mcream\M' then 'cream'
      when n ~ 'coffee|kahl[uú]a|espresso|cold brew' then 'coffee'
      when n ~ 'ginger beer|ginger ale|pineapple|prosecco|champagne|sparkling wine|white wine|pinot grigio|sauvignon|chardonnay|moscato|riesling|vivace|\mmead\M|lillet' then 'ginger'
      when n ~ 'sloe gin|schnapps|triple sec|cointreau|cura[cç]ao|amaretto|frangelico|chambord|chartreuse|b[eé]n[eé]dictine|drambuie|galliano|cr[eè]me de|liqueur|limoncello|j[aä]germeister|aperol|campari|licor 43|\mamaro\M|southern comfort' then 'liqueur'
      when n ~ 'vermouth|bitters|angostura|peychaud' then 'vermouth'
      when n ~ '\mcola\M|\mcoke\M|coca[- ]?cola|pepsi|root beer' then 'cola'
      when n ~ 'grapefruit|cranberry|tomato|clamato|grenadine|pomegranate' then 'grapefruit'
      when n ~ '\mlimes?\M|\mlemons?\M|sour mix|sweet (and|&|n) sour|lemonade|limeade' then 'citrus'
      when n ~ 'whiske?y|bourbon|\mrye\M|scotch|crown royal|jack daniel|jameson|buffalo trace|woodford|maker.?s mark|wild turkey|seagram|american honey|fireball|jim beam|bulleit' then 'whiskey'
      when n ~ '\mrum\M|bacardi|captain morgan|meyers|malibu|kraken|cacha[cç]a' then 'rum'
      when n ~ '\mgin\M|tanqueray|bombay|hendrick|beefeater' then 'gin'
      when n ~ 'vodka|tito.?s|absolut|grey goose|smirnoff|ketel' then 'vodka'
      when n ~ 'tequila|mezcal|patr[oó]n|don julio|cuervo|jimador|espol[oó]n' then 'tequila'
      when n ~ 'brandy|cognac|hennessy|pisco' then 'brandy'
      when n ~ '\msyrup\M|\magave\M|orgeat|\mhoney\M|orange juice' then 'syrup'
      when n ~ '\m(beer|lager|ale|ipa|stout|porter|pilsner|guinness|budweiser|bud light|coors|michelob|stella|corona|modelo)\M' and n !~ 'ginger|root beer' then 'beer'
      when n ~ '\m(wine|merlot|cabernet|sangria)\M|pinot noir|house red' then 'wine'
      when n ~ 'tonic|club soda|soda water|seltzer' then 'soda'
    end as family
  from named
)
update ingredients i
set family = g.family
from guess g
where i.id = g.id and g.family is not null and i.family is null;

-- ---------- The Bar Book: recipes that stand on their own ----------
-- A recipe still belongs to at most one menu item (unique), but can now
-- belong to none: a drink in the book we don't sell yet. Such a drink needs
-- its own name.
--   name         the drink's name when there's no menu item (a menu item's
--                recipe goes by the item's name)
--   method       build, shake, stir or blend
--   garnishes    the garnishes, one per entry ("Salt rim", "Lime wheel");
--                the old free-text garnish column stays for menu recipes
--   ice          none, cubes or crushed; empty goes by the glass
--   source       menu (a menu item's own), house (ours, added in Back
--                office) or seed (the starter list, scripts/seed-bar-book.mjs)
--   description  a line about the drink, for the recipe card
-- recipe_ingredients.optional: a line that never stops the drink being made
-- (a garnish, a float).

alter table recipes alter column menu_item_id drop not null;
alter table recipes add column if not exists name text;
alter table recipes add column if not exists method text;
alter table recipes add column if not exists garnishes text[] not null default '{}';
alter table recipes add column if not exists ice text;
alter table recipes add column if not exists source text not null default 'menu';
alter table recipes add column if not exists description text;

alter table recipes drop constraint if exists recipes_method_check;
alter table recipes add constraint recipes_method_check check (method is null or method in ('build', 'shake', 'stir', 'blend'));
alter table recipes drop constraint if exists recipes_ice_check;
alter table recipes add constraint recipes_ice_check check (ice is null or ice in ('none', 'cubes', 'crushed'));
alter table recipes drop constraint if exists recipes_source_check;
alter table recipes add constraint recipes_source_check check (source in ('menu', 'house', 'seed'));
alter table recipes drop constraint if exists recipes_name_check;
alter table recipes add constraint recipes_name_check check (name is null or char_length(btrim(name)) between 1 and 80);
alter table recipes drop constraint if exists recipes_named_check;
alter table recipes add constraint recipes_named_check check (menu_item_id is not null or name is not null);
alter table recipes drop constraint if exists recipes_description_check;
alter table recipes add constraint recipes_description_check check (description is null or char_length(description) <= 400);

-- One book drink per name (the seed script inserts by lower(name)).
create unique index if not exists recipes_book_name_idx on recipes (lower(btrim(name))) where menu_item_id is null;

alter table recipe_ingredients add column if not exists optional boolean not null default false;
