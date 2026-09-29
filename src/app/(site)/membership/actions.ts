"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createPlusCheckout, giftEndsWithoutRenewal, plusPaidFor } from "@/lib/plus-checkout";
import { safePath } from "@/lib/safe-path";
import type { MemberPriceTier } from "@/lib/types";
import { exactEmail } from "@/lib/email-match";

// Next.js redacts a *thrown* Server Action error's message in production
// builds (only the generic "Minified React error #441..." reaches the
// client -- the real text only shows in dev, which is exactly why this
// class of bug is so easy to ship without noticing). Expected, user-
// actionable errors -- bad input, a duplicate signup -- are modeled as
// return values instead, per Next's own guidance, so the real message
// reaches the client in every environment.
export type SignupResult = { ok: true } | { ok: false; error: string };

export async function submitMembershipSignup(fields: { name: string; email: string; phone: string }): Promise<SignupResult> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };

  const supabase = createAdminClient();

  const { data: existing } = await supabase.from("members").select("id").ilike("email", exactEmail(email)).maybeSingle();
  if (existing) return { ok: false, error: "An Insiders account already exists for that email. Ask staff to look it up for you in person." };

  const { error } = await supabase.from("members").insert({
    name,
    email,
    phone: fields.phone.trim() || null,
    tier: "Insiders",
    points: 0,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "An Insiders account already exists for that email. Ask staff to look it up for you in person." };
    throw error;
  }
  return { ok: true };
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// The join form for someone who isn't signed in. (Signed-in members skip
// the form entirely -- see membership/join/route.ts.)
export async function startMembershipCheckout(fields: {
  name: string;
  email: string;
  phone: string;
  returnTo?: string | null;
  annual?: boolean;
}): Promise<CheckoutResult> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("members")
    .select("id, tier, comped, stripe_customer_id, stripe_subscription_id, subscription_status, plus_gift_until, price_tier")
    .ilike("email", exactEmail(email))
    .maybeSingle();
  // On a gifted year with nothing after it: sign up now, first charge when
  // the gift runs out.
  const giftEnds = existing ? giftEndsWithoutRenewal(existing) : null;
  if (existing && plusPaidFor(existing) && !giftEnds) {
    return { ok: false, error: "This email already has Insiders+. Sign in to see your membership." };
  }

  // Everyone joins online at the adult rate. Senior and student rates are
  // only set by staff after checking an ID in person -- so an existing
  // member already switched at the register is charged their rate here.
  const priceTier: MemberPriceTier = existing?.price_tier ?? "adult";
  const url = await createPlusCheckout({
    memberId: existing?.id ?? null,
    customerId: existing?.stripe_customer_id ?? null,
    name,
    email,
    phone: fields.phone.trim() || null,
    priceTier,
    returnTo: safePath(fields.returnTo),
    interval: fields.annual ? "year" : "month",
    firstChargeAt: giftEnds && new Date(giftEnds).getTime() > Date.now() + 49 * 3_600_000 ? new Date(giftEnds) : null,
  });
  if (!url) return { ok: false, error: "Could not start checkout. Please try again." };
  return { ok: true, url };
}
