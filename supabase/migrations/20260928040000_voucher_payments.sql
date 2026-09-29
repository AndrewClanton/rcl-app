-- Paper vouchers ($10/$20, handed out at trivia) as a way to pay at the
-- register. The sale is recorded like any other; the voucher part is kept
-- apart from cash and card so the drawer and the bank deposits still add up.
alter table orders add column if not exists payment_voucher_amount numeric(10,2) not null default 0;

-- 'voucher' when vouchers covered the whole order; otherwise the method is
-- how the rest was paid (cash, card or split) and the voucher amount sits
-- alongside.
alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (payment_method in ('cash', 'card', 'split', 'voucher'));
