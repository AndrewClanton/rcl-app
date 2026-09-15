-- Recurring Insiders+ membership billing via Stripe Subscriptions, matching
-- the real business's age-tiered pricing (adult/senior/student).

alter table members add column price_tier text check (price_tier in ('adult', 'senior', 'student'));
alter table members add column stripe_customer_id text;
alter table members add column stripe_subscription_id text;
alter table members add column subscription_status text;

create unique index members_stripe_customer_id_idx on members(stripe_customer_id) where stripe_customer_id is not null;
create unique index members_stripe_subscription_id_idx on members(stripe_subscription_id) where stripe_subscription_id is not null;
