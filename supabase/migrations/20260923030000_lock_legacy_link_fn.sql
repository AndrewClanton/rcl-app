-- Supabase's default privileges grant execute on new public functions to
-- anon and authenticated directly, so "revoke ... from public" alone left
-- link_imported_legacy_accounts() callable with the public key. Only the
-- server (service role) should run it.
revoke execute on function public.link_imported_legacy_accounts() from anon, authenticated;
