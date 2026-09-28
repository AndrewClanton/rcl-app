import { NextResponse, type NextRequest } from "next/server";
import { safePath } from "@/lib/safe-path";
import { createClient } from "@/lib/supabase/server";
import { linkMemberForUser } from "@/lib/member-link";

// Where Google and Facebook send people back after "Continue with ...". Finishes the
// sign-in (PKCE code exchange, using the verifier cookie this browser set
// when the button was pressed), links that login to their member
// record -- matching an existing member by email, so old-site members and
// people who joined at the register land in their own account -- then goes
// to the page they came from.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // "Continue with Google" from the Insiders+ flow leaves where to go next
  // in a cookie (see AccountForm); otherwise the ?next= param.
  const fromCookie = req.cookies.get("rcl_after_sign_in")?.value;
  const safeNext = safePath(fromCookie ? decodeURIComponent(fromCookie) : null) ?? safePath(url.searchParams.get("next")) ?? "/account";
  const fail = (reason: string) => NextResponse.redirect(new URL(`/account/login?error=${encodeURIComponent(reason)}`, url.origin));

  if (url.searchParams.get("error")) return fail("oauth_cancelled");
  if (!code) return fail("oauth_failed");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("oauth_failed");

  const linked = await linkMemberForUser(data.user);
  if (!linked.ok) {
    await supabase.auth.signOut();
    return fail(linked.reason === "no_email" ? "no_email" : "link_failed");
  }
  // A brand-new account gets the welcome screen, unless they were on
  // their way somewhere (like Insiders+ payment).
  const res = NextResponse.redirect(new URL(linked.created && safeNext === "/account" ? "/account?welcome=1" : safeNext, url.origin));
  if (fromCookie) res.cookies.delete("rcl_after_sign_in");
  return res;
}
