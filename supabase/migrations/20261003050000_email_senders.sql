-- Who sends email to members (Andrew, 10/3): Nathan and Mary shape the
-- Royale's public voice, and every email to a list goes through them. A tick
-- on the person, not a role, because owners include people who never send.
-- Owners pick who on Back office -> Email (lib/email/senders.ts); everyone
-- else can still look, draft and send themselves a test.
--
-- Nobody is picked to start with: after this runs, an owner ticks Nathan and
-- Mary on the Email page. Until then nothing can be sent to a list (tests,
-- receipts and password resets still go).
--
-- Only adds a column, so no new grants (supabase/README.md). Safe to run
-- more than once.

alter table employees add column if not exists sends_email boolean not null default false;
