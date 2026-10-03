-- Back office -> Email: the owners' "Sending on/off" switch (v1.10).
-- Email to a list goes only when BOTH the EMAIL_SENDING_ENABLED setting in
-- Vercel (the master setting, the ceiling) and this switch are on
-- (src/lib/email/campaign-send.ts sendingGate). It starts off: an owner
-- turns it on from the Email page, and it takes effect at once. Receipts,
-- password resets and claim links never check it.
--
-- Also used in email_settings from v1.10 (no row needed up front):
--   'golive_unsubscribe_tested'  the go-live checklist's hand tick.
insert into email_settings (key, value)
values ('sending_switch', '{"on": false}'::jsonb)
on conflict (key) do nothing;
