-- A "choose one" modifier group normally starts with its first option
-- picked (Size: Small), so a cashier can add the item in one tap. Some
-- choices have no sensible default and must be asked every time: which
-- soda comes with the $5 Special. must_choose starts that group empty and
-- the register won't add the item until one is picked.
--
-- Additive and safe to run twice.

alter table menu_modifier_groups add column if not exists must_choose boolean not null default false;
