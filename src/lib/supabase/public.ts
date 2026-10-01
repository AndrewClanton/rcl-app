import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// The public (anon) key with no login attached, for the website's cached
// pages (the menu, private events). It reads only tables everyone may read
// (row level security still applies), and unlike lib/supabase/server.ts it
// doesn't touch the visitor's cookies, which would make the page render per
// request.
export function createPublicClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
