import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { setMarketingOptIn } from "./consent";
import { emailTokensReady, openEmailToken } from "./tokens";
import { currentMemberId } from "@/lib/member-forward";

// Unsubscribe the member in an email link's token from all marketing email.
// Used by the one-click endpoint (the mailbox's own Unsubscribe button) and
// by the page the footer's "Unsubscribe" link opens. It cancels anything
// already scheduled for them and marks the send it came from. Safe to
// repeat. Returns the member it unsubscribed, or null for a token that
// doesn't open (logged only, nothing revealed). Throws when something on
// our side is wrong (no EMAIL_TOKEN_SECRET, a failed write), so the caller
// can say "try again" rather than pretend it worked.
export async function unsubscribeByToken(token: string | null | undefined, detail: Record<string, unknown> = {}): Promise<{ memberId: string } | null> {
  if (!emailTokensReady()) {
    console.error("unsubscribe: EMAIL_TOKEN_SECRET is missing, so no unsubscribe link can work. Set it in Vercel now.");
    throw new Error("EMAIL_TOKEN_SECRET missing");
  }
  const t = openEmailToken(token);
  if (!t) {
    console.warn("unsubscribe: a token that didn't open");
    return null;
  }
  // An email sent before its account was merged into another unsubscribes
  // the account it became (otherwise it would quietly do nothing).
  const memberId = (await currentMemberId(t.memberId)) ?? t.memberId;
  const r = await setMarketingOptIn(memberId, false, "one_click", { sendId: t.sendId, detail });
  if (!r.ok) throw new Error(r.error);
  if (t.sendId) {
    const admin = createAdminClient();
    const at = new Date().toISOString();
    const { data } = await admin.from("email_sends").update({ unsubscribed_at: at }).eq("id", t.sendId).eq("member_id", memberId).is("unsubscribed_at", null).select("id");
    if (data?.length) await admin.from("email_events").insert({ send_id: t.sendId, type: "unsubscribed", occurred_at: at, detail: {} });
  }
  return { memberId };
}
