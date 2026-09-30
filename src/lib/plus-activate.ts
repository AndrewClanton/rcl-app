import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";

// Makes the member Insiders+ once their Stripe checkout for it completes:
// the member named in the checkout (signed in), else the one with that
// email, else a new member. Run by the webhook, and also by the welcome
// redirect so the page they land on already shows them as Insiders+.
// Safe to run twice. From here on, the subscription events in the webhook
// keep the row in step with Stripe.
// ok: false when a read or save failed, so the webhook answers Stripe with
// an error and Stripe sends the event again (nothing here minds a rerun).
export async function activatePlusFromCheckout(session: Stripe.Checkout.Session): Promise<{ ok: boolean }> {
  if (session.mode !== "subscription") return { ok: true };
  const email = session.metadata?.pending_email;
  const name = session.metadata?.pending_name;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscription = session.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  // Not one of our Insiders+ checkouts: nothing to do, and a retry won't change that.
  if (!email || !name || !customerId || !subscriptionId) return { ok: true };

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
  const { data: existing, error: lookupErr } = memberId
    ? await supabase.from("members").select("id").eq("id", memberId).maybeSingle()
    : await supabase.from("members").select("id").ilike("email", exactEmail(email)).maybeSingle();
  if (lookupErr) return { ok: false };
  if (existing) {
    const { error: updateErr } = await supabase.from("members").update(memberFields).eq("id", existing.id);
    return { ok: !updateErr };
  }
  const { error } = await supabase.from("members").insert({ name, email, phone: session.metadata?.pending_phone || null, points: 0, ...memberFields });
  if (!error) return { ok: true };
  if (error.code !== "23505") return { ok: false };
  // The webhook and the welcome redirect raced and the other one created
  // the row first: update it instead.
  const { error: raceErr } = await supabase.from("members").update(memberFields).ilike("email", exactEmail(email));
  return { ok: !raceErr };
}
