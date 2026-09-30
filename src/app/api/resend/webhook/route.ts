import { NextResponse, type NextRequest } from "next/server";
import { verifyResendSignature } from "@/lib/email/webhook-signature";
import { handleResendEvent, type ResendEvent } from "@/lib/email/webhook";

// Resend tells us what happened to each email (lib/email/webhook.ts has
// what each event does). Configure it in Resend with this address and the
// events email.sent, email.delivered, email.delivery_delayed,
// email.bounced, email.complained, email.opened, email.failed and
// email.suppressed (not email.clicked: click tracking is our own, /e/...).
//
// Resend signs each request (Svix); RESEND_WEBHOOK_SECRET is the signing
// secret from the webhook's page in Resend. The raw body is verified before
// anything is parsed. A database error answers 500, so Resend sends the
// event again later; a re-sent event is recognized by its svix-id.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });

  const body = await request.text();
  const svixId = request.headers.get("svix-id");
  const verified = verifyResendSignature(body, { id: svixId, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret);
  if (!verified || !svixId) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const r = await handleResendEvent(event, svixId);
    return NextResponse.json({ received: true, duplicate: r.duplicate, matched: r.matched });
  } catch {
    return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  }
}
