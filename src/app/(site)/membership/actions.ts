"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import type { MemberPriceTier } from "@/lib/types";

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

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

  const { data: existing } = await supabase.from("members").select("id").ilike("email", email).maybeSingle();
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

// Insiders+ price tier -> env var holding that tier's recurring Stripe Price
// id (created by scripts/setup-stripe-membership.mjs). Student is
// deliberately not offered here -- the real business requires visiting the
// counter in person with a valid student ID to get the discounted rate.
const PRICE_ENV_KEY: Record<"adult" | "senior", string> = {
  adult: "STRIPE_PRICE_INSIDERS_PLUS_ADULT",
  senior: "STRIPE_PRICE_INSIDERS_PLUS_SENIOR",
};

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export async function startMembershipCheckout(fields: {
  name: string;
  email: string;
  phone: string;
  priceTier: "adult" | "senior";
}): Promise<CheckoutResult> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("members").select("id, tier, subscription_status").ilike("email", email).maybeSingle();
  if (existing?.tier === "Insiders+" && existing.subscription_status === "active") {
    return { ok: false, error: "This email already has an active Insiders+ membership." };
  }

  const priceEnvKey = PRICE_ENV_KEY[fields.priceTier];
  const priceId = priceEnvKey ? process.env[priceEnvKey] : undefined;
  if (!priceId) return { ok: false, error: "Membership pricing isn't configured yet." };

  const origin = await siteOrigin();
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    success_url: `${origin}/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/membership?checkout=cancelled`,
    metadata: {
      pending_name: name,
      pending_email: email,
      pending_phone: fields.phone.trim(),
      price_tier: fields.priceTier,
    },
  });

  if (!session.url) return { ok: false, error: "Could not start checkout. Please try again." };
  return { ok: true, url: session.url };
}
