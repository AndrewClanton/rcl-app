-- Cost per unit (same unit as ingredients.unit -- $/oz, $/ml, or $/count),
-- so the alcohol usage report can show variance in dollars and pour-cost %
-- per drink, not just raw quantity.
alter table ingredients add column unit_cost numeric(10,4);
