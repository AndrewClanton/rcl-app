import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { verifyResendSignature } from "@/lib/email/webhook-signature";
import { optOutByEmail, syncMemberSoon } from "@/lib/mailing-list";

// Resend tells us when someone leaves the mailing list from their side:
//  - contact.updated with unsubscribed: true -- they used the unsubscribe
//    link in a list email (or were unsubscribed in Resend's dashboard);
//  - email.complained / suppression.added (origin "complaint") -- they
//    marked one of our emails as spam.
// Either way their weekly email goes off here too. Resend can only turn
// someone off, never on. Every step is safe to repeat, so a re-delivered
// event does nothing new.
//
// Resend signs each request (Svix); RESEND_WEBHOOK_SECRET is the signing
// secret from the webhook's page in Resend. The raw body is verified before
// anything is parsed.
export const dynamic = "force-dynamic";

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email?: string;
    unsubscribed?: boolean;
    updated_at?: string;
    to?: string[];
    origin?: string;
  };
}

async function leaveList(email: string, at: string | null) {
  const turnedOff = await optOutByEmail(email, at);
  // Take the contact off Resend too (Resend only keeps current subscribers).
  // A member who said yes again on our site since then is left alone: their
  // sync puts them back.
  const { data: members } = await createAdminClient().from("members").select("id").ilike("email", exactEmail(email)).is("erased_at", null);
  if (members?.length) for (const m of members) syncMemberSoon(m.id);
  else syncMemberSoon(null, { removeEmail: email });
  return turnedOff;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });

  const body = await request.text();
  const verified = verifyResendSignature(
    body,
    { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") },
    secret,
  );
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data = event.data ?? {};
  let optedOut = 0;
  try {
    if (event.type === "contact.updated" && data.unsubscribed === true && data.email) {
      optedOut += await leaveList(data.email, data.updated_at ?? event.created_at ?? null);
    } else if (event.type === "email.complained") {
      for (const to of data.to ?? []) optedOut += await leaveList(to, null);
    } else if (event.type === "suppression.added" && data.origin === "complaint" && data.email) {
      optedOut += await leaveList(data.email, null);
    }
  } catch {
    // Answer with an error so Resend sends the event again later.
    return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  }
  return NextResponse.json({ received: true, optedOut });
}
