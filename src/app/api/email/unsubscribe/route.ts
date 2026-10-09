import { type NextRequest } from "next/server";
import { SITE_URL } from "@/lib/site";
import { allowAttempt } from "@/lib/rate-limit";
import { PREFERENCES_PATH } from "@/lib/email/tokens";
import { unsubscribeByToken } from "@/lib/email/unsubscribe";

// One-click unsubscribe (RFC 8058), the address in every marketing email's
// List-Unsubscribe header: Gmail's and Yahoo's own "Unsubscribe" button
// POSTs "List-Unsubscribe=One-Click" here, with no cookies and no login.
// That turns off all marketing email for the member in the token, cancels
// anything already scheduled for them, and answers 200 with a short
// plain-text line. Safe to repeat. A bad token gets the same 200 (nothing
// is revealed) and is only logged, and so does a member who has since been
// removed (there is nothing left to email). With no EMAIL_TOKEN_SECRET no
// token can open, so that answers 500 and logs loudly rather than
// pretending every unsubscribe worked.
//
// The unsubscribe page's no-JavaScript button posts here too.
//
// GET never unsubscribes by itself: it goes to the unsubscribe page, which
// does it from the browser (so a link scanner fetching the URL doesn't).
export const dynamic = "force-dynamic";

const DONE = "You're unsubscribed from Royale Cinema Lounge marketing emails. Receipts and tickets still come.";

function connection(req: NextRequest) {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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

  try {
    await unsubscribeByToken(token);
  } catch {
    // Something on our side: say so, so the mailbox (or the person) tries again.
    return new Response("Something went wrong on our end. Please try again.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(DONE, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const safe = /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : "";
  return new Response(null, { status: 303, headers: { Location: `${SITE_URL}${PREFERENCES_PATH}${safe ? `?t=${safe}` : ""}`, "Cache-Control": "no-store" } });
}
