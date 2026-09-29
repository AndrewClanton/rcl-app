-- One card payment is one sale.
--
-- The register's reader check could overlap itself, so on 9/28 four card
-- payments were saved as nine orders (#7863-7881; Stripe charged each
-- once). Keep the first order for each payment and void the copies --
-- voided orders stay on file but drop out of every report -- then have the
-- database refuse a second live order for the same payment.

update orders o
set status = 'voided'
from (
  select id,
         row_number() over (partition by stripe_payment_intent_id order by order_number) as n
  from orders
  where stripe_payment_intent_id is not null
    and status <> 'voided'
) dup
where o.id = dup.id
  and dup.n > 1;

create unique index if not exists orders_one_per_card_payment
  on orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null and status <> 'voided';
