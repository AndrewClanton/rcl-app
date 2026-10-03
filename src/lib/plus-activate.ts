import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { currentMemberId } from "@/lib/member-forward";
import { setMarketingOptIn } from "@/lib/email/consent";
import { memberJoined } from "@/lib/email/automations";
import { markLegacyOnboarded } from "@/lib/legacy-plus-server";

// Makes the member Insiders+ once their Stripe checkout for it completes:
// the member named in the checkout (signed in), else the one with that
// email, else a new member. Run by the webhook, and also by the welcome
// redirect so the page they land on already shows them as Insiders+.
// Safe to run twice. From here on, the subscription events in the webhook
// keep the row in step with Stripe.
// - memberId: the member's id (null if the checkout wasn't one of these,
//   or the member couldn't be saved).
// - ok: false when a read or save failed, so the webhook answers Stripe
//   with an error and Stripe sends the event again (nothing here minds a
//   rerun).
export type PlusActivation = { ok: boolean; memberId: string | null };

export async function activatePlusFromCheckout(session: Stripe.Checkout.Session): Promise<PlusActivation> {
  if (session.mode !== "subscription") return { ok: true, memberId: null };
  const email = session.metadata?.pending_email;
  const name = session.metadata?.pending_name;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscription = session.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  // Not one of our Insiders+ checkouts: nothing to do, and a retry won't change that.
  if (!email || !name || !customerId || !subscriptionId) return { ok: true, memberId: null };

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
  // They ticked "email me the weekly lineup" on the join form. Only ever
  // switches it on: leaving the box empty isn't a request to unsubscribe.
  const optIn = session.metadata?.email_opt_in === "1";
  // Only an unticked box ("0") starts a new member with email off. A
  // checkout with no answer at all (one started before the box existed)
  // keeps the default: members stay opted in.
  const optedOut = session.metadata?.email_opt_in === "0";
  const turnOnEmail = async (id: string) => {
    if (!optIn) return;
    await setMarketingOptIn(id, true, "checkout").catch(() => null);
  };

  // The account the checkout was made for, or the one it was merged into
  // since (Back office merge; a card link lasts 24 hours).
  const memberId = await currentMemberId(session.metadata?.member_id || null);
  const { data: existing, error: lookupErr } = memberId
    ? await supabase.from("members").select("id").eq("id", memberId).maybeSingle()
    : await supabase.from("members").select("id").ilike("email", exactEmail(email)).maybeSingle();
  if (lookupErr) return { ok: false, memberId: null };
  if (existing) {
    const { error: updateErr } = await supabase.from("members").update(memberFields).eq("id", existing.id);
    // Not saved: the follow-ups wait for Stripe's retry, so nobody is
    // marked set up before they're Insiders+.
    if (updateErr) return { ok: false, memberId: null };
    await turnOnEmail(existing.id);
    // A former unlimited member (lib/legacy-plus.ts) is set up now: from the
    // link staff gave them, or on the website by themselves. Only touches
    // someone who was unlimited on the old site; never fails this.
    await markLegacyOnboarded(existing.id as string, session.metadata?.legacy_finish === "1" ? "phone" : "online", null);
    return { ok: true, memberId: existing.id as string };
  }
  const { data: made, error } = await supabase
    .from("members")
    .insert({ name, email, phone: session.metadata?.pending_phone || null, points: 0, ...memberFields, ...(optedOut ? { email_opt_in: false } : {}) })
    .select("id")
    .single();
  if (made) {
    await turnOnEmail(made.id);
    if (optIn) memberJoined(made.id);
    return { ok: true, memberId: made.id as string };
  }
  if (error?.code !== "23505") return { ok: false, memberId: null };
  // The webhook and the welcome redirect raced and the other one created
  // the row first: update it instead. No row with that email means the
  // clash was on something else and nobody got the membership they paid
  // for: that's a failure too, so Stripe keeps retrying (and flags it in
  // the dashboard) instead of it going missing quietly.
  const { data: rows, error: raceErr } = await supabase.from("members").update(memberFields).ilike("email", exactEmail(email)).select("id");
  if (raceErr || !rows?.length) return { ok: false, memberId: null };
  for (const r of rows) await turnOnEmail(r.id);
  return { ok: true, memberId: rows.length === 1 ? (rows[0].id as string) : null };
}
