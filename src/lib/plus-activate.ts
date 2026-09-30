import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";

// Makes the member Insiders+ once their Stripe checkout for it completes:
// the member named in the checkout (signed in), else the one with that
// email, else a new member. Run by the webhook, and also by the welcome
// redirect so the page they land on already shows them as Insiders+.
// Safe to run twice. From here on, the subscription events in the webhook
// keep the row in step with Stripe. Returns the member's id (null if the
// checkout wasn't one of these, or the member couldn't be saved).
export async function activatePlusFromCheckout(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.mode !== "subscription") return null;
  const email = session.metadata?.pending_email;
  const name = session.metadata?.pending_name;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscription = session.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (!email || !name || !customerId || !subscriptionId) return null;

  const supabase = createAdminClient();
  const memberFields = {
    tier: "Insiders+" as const,
    price_tier: session.metadata?.price_tier || null,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    // "trialing" when staff set a later first-charge date.
    subscription_status: typeof subscription === "object" && subscription ? subscription.status : "active",
    monthly_member: true,
    billing_interval: session.metadata?.billing_interval === "year" ? "year" : "month",
  };
  const memberId = session.metadata?.member_id || null;
  const { data: existing } = memberId
    ? await supabase.from("members").select("id").eq("id", memberId).maybeSingle()
    : await supabase.from("members").select("id").ilike("email", exactEmail(email)).maybeSingle();
  if (existing) {
    await supabase.from("members").update(memberFields).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: created, error } = await supabase.from("members").insert({ name, email, phone: session.metadata?.pending_phone || null, points: 0, ...memberFields }).select("id").maybeSingle();
  if (created) return created.id as string;
  // The webhook and the welcome redirect raced and the other one created
  // the row first: update it instead.
  if (error?.code === "23505") {
    const { data: raced } = await supabase.from("members").update(memberFields).ilike("email", exactEmail(email)).select("id");
    return raced?.length === 1 ? (raced[0].id as string) : null;
  }
  return null;
}
