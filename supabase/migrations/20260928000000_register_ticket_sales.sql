-- Movie tickets sold at the register.
--
-- A register ticket is one order line tied to its screening (so the sale
-- keeps the exact showing and time for analytics) plus a confirmed booking
-- with bookings.order_id set (so it takes a seat, shows in attendance and
-- box-office numbers, and appears under the member's movies).
--
-- To count each ticket's money once: ticket/box-office figures read
-- bookings (register + online); bar/food figures skip order lines that have
-- a screening; revenue totals and purchase lists skip bookings that belong to
-- a register order.

alter table order_items add column if not exists screening_id uuid references screenings(id) on delete set null;
create index if not exists order_items_screening_id_idx on order_items(screening_id) where screening_id is not null;
create index if not exists bookings_order_id_idx on bookings(order_id) where order_id is not null;
