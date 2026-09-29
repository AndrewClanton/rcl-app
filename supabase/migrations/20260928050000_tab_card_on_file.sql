-- A card on file for an open tab: tapped on the reader when the tab opens,
-- saved (not charged) by Stripe, charged for the final total when the tab
-- is closed, then removed. Only card references live here -- Stripe holds
-- the card itself.
alter table orders add column if not exists tab_card_customer_id text;
alter table orders add column if not exists tab_card_payment_method_id text;
alter table orders add column if not exists tab_card_label text; -- e.g. "Visa ••4242"
