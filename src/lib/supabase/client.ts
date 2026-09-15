import { createBrowserClient } from "@supabase/ssr";

// flowType: "implicit" -- the default ("pkce") requires a code_verifier
// stored in this same browser session to complete an email-link flow
// (password reset is the only one we still use). That verifier can go
// missing for reasons outside our control -- Gmail and other mail
// clients pre-fetching links in the email, or the reset link being
// opened in a different browser/profile than the one that requested it
// -- producing "PKCE code verifier not found in storage" on an
// otherwise-valid click. Implicit flow's tokens are self-contained in
// the redirect URL, so completing the flow doesn't depend on anything
// having been stored earlier in this browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit" } }
  );
}
