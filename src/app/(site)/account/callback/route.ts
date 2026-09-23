import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { linkMemberForUser } from "@/lib/member-link";

// Where Google sends people back after "Continue with Google". Finishes the
// sign-in (PKCE code exchange, using the verifier cookie this browser set
// when the button was pressed), links the Google account to their member
// record -- matching an existing member by email, so old-site members and
// people who joined at the register land in their own account -- then goes
// to the page they came from.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/account";
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/account";
  const fail = (reason: string) => NextResponse.redirect(new URL(`/account/login?error=${encodeURIComponent(reason)}`, url.origin));

  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!code) return fail("google_failed");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("google_failed");

  const linked = await linkMemberForUser(data.user);
  if (!linked.ok) {
    await supabase.auth.signOut();
    return fail("link_failed");
  }
  return NextResponse.redirect(new URL(linked.created ? "/account?welcome=1" : safeNext, url.origin));
}
