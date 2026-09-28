import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { activatePlusFromCheckout } from "@/lib/plus-activate";
import { safePath } from "@/lib/safe-path";

// Where Stripe sends someone after they pay for Insiders+. Makes them
// Insiders+ right away (the webhook does the same moments later), so the
// page they land on already greets them as a member -- badge in the header,
// no "Get Insiders+" -- then shows the welcome at the top of /membership.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const next = safePath(url.searchParams.get("next"));
  const dest = new URL("/membership", url);

  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
      const sub = session.subscription;
      const status = typeof sub === "object" && sub ? sub.status : null;
      if (status === "active" || status === "trialing") await activatePlusFromCheckout(session);
      dest.searchParams.set("checkout", "success");
      dest.searchParams.set("session_id", sessionId);
    } catch {
      // Couldn't reach Stripe: the webhook still makes them a member; the
      // page just won't show the welcome.
    }
  }
  if (next) dest.searchParams.set("next", next);
  return NextResponse.redirect(dest, 303);
}
