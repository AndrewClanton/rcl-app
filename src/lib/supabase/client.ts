import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// @supabase/ssr's createBrowserClient hardcodes flowType: "pkce" and
// silently ignores any auth.flowType passed in options (it spreads that
// override in *before* its own "pkce" key -- see its source). PKCE
// requires a code_verifier stored in this same browser session to
// complete an email-link flow, and that can go missing for reasons
// outside our control (Gmail and other mail clients pre-fetching links
// in the email, or the link being opened in a different browser/profile
// than the one that requested it), producing "PKCE code verifier not
// found in storage" on an otherwise-valid click. For the one call where
// that matters -- requesting a password reset -- use the plain
// supabase-js client instead, which defaults to flowType "implicit":
// its tokens are self-contained in the reset link, so completing it
// doesn't depend on anything stored earlier in this browser. This client
// is throwaway (session persistence disabled) -- it only ever makes the
// one resetPasswordForEmail call; the resulting link is still handled by
// the regular cookie-backed client on the reset-password page via
// setSession(), which works the same regardless of flow type.
export function createImplicitFlowClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
