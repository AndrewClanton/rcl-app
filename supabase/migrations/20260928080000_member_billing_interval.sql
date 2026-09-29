-- Insiders+ can be paid monthly or yearly (15% off). Which one a member is
-- on, kept in step with Stripe by the webhook, for their account page.
alter table members add column if not exists billing_interval text check (billing_interval in ('month', 'year'));
