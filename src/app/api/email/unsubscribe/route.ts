import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { allowAttempt } from "@/lib/rate-limit";
import { setMarketingOptIn } from "@/lib/email/consent";
import { emailTokensReady, openEmailToken, PREFERENCES_PATH } from "@/lib/email/tokens";
import { currentMemberId } from "@/lib/member-forward";

// One-click unsubscribe (RFC 8058), the address in every marketing email's
// List-Unsubscribe header: Gmail's and Yahoo's own "Unsubscribe" button
// POSTs "List-Unsubscribe=One-Click" here, with no cookies and no login.
// That turns off all marketing email for the member in the token (their
// category choices are kept, so turning email back on restores them),
// cancels anything already scheduled for them, and answers 200 with a
// short plain-text line. Safe to repeat. A bad token gets the same 200
// (nothing is revealed) and is only logged, and so does a member who has
// since been removed (there is nothing left to email). With no
// EMAIL_TOKEN_SECRET no token can open, so that answers 500 and logs loudly
// rather than pretending every unsubscribe worked.
//
// The preference page's "Unsubscribe from all marketing emails" button
// posts here too (form mode) and comes back to the page.
//
// GET never unsubscribes: link scanners open every link in an email. It
// goes to the preference page instead.
export const dynamic = "force-dynamic";

const DONE = "You're unsubscribed from Royale Cinema Lounge marketing email. Receipts and tickets still come.";

function connection(req: NextRequest) {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!emailTokensReady()) {
    console.error("unsubscribe: EMAIL_TOKEN_SECRET is missing, so no unsubscribe link can work. Set it in Vercel now.");
    throw new Error("EMAIL_TOKEN_SECRET missing");
  }
  const t = openEmailToken(token);
  if (!t) {
    console.warn("unsubscribe: a token that didn't open");
    return false;
  }
  // An email sent before its account was merged into another unsubscribes
  // the account it became (otherwise it would quietly do nothing).
  const memberId = (await currentMemberId(t.memberId)) ?? t.memberId;
  const r = await setMarketingOptIn(memberId, false, "one_click", { sendId: t.sendId });
  if (!r.ok) throw new Error(r.error);
  if (t.sendId) {
    const admin = createAdminClient();
    const at = new Date().toISOString();
    const { data } = await admin.from("email_sends").update({ unsubscribed_at: at }).eq("id", t.sendId).eq("member_id", memberId).is("unsubscribed_at", null).select("id");
    if (data?.length) await admin.from("email_events").insert({ send_id: t.sendId, type: "unsubscribed", occurred_at: at, detail: {} });
  }
  return true;
}

export async function POST(req: NextRequest) {
  if (!(await allowAttempt(`email-unsub:${connection(req)}`, 300, 60))) {
    return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const token = req.nextUrl.searchParams.get("t") ?? (typeof form?.get("t") === "string" ? (form.get("t") as string) : null);
  const fromPage = form?.get("from") === "page";

  try {
    await unsubscribe(token);
  } catch {
    // Something on our side: say so, so the mailbox (or the person) tries again.
    return new Response("Something went wrong on our end. Please try again.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (fromPage && token && /^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return new Response(null, { status: 303, headers: { Location: `${SITE_URL}${PREFERENCES_PATH}?t=${token}&done=unsubscribed#all`, "Cache-Control": "no-store" } });
  }
  return new Response(DONE, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const safe = /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : "";
  return new Response(null, { status: 303, headers: { Location: `${SITE_URL}${PREFERENCES_PATH}${safe ? `?t=${safe}` : ""}#all`, "Cache-Control": "no-store" } });
}
