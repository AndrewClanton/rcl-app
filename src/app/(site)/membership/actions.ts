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

export async function submitMembershipSignup(fields: { name: string; email: string; phone: string }): Promise<void> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) throw new Error("Enter your name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");

  const supabase = createAdminClient();

  const { data: existing } = await supabase.from("members").select("id").eq("email", email).maybeSingle();
  if (existing) throw new Error("An Insiders account already exists for that email. Ask staff to look it up for you in person.");

  const { error } = await supabase.from("members").insert({
    name,
    email,
    phone: fields.phone.trim() || null,
    tier: "Insiders",
    points: 0,
  });
  if (error) {
    if (error.code === "23505") throw new Error("An Insiders account already exists for that email. Ask staff to look it up for you in person.");
    throw error;
  }
}

// Insiders+ price tier -> env var holding that tier's recurring Stripe Price
// id (created by scripts/setup-stripe-membership.mjs). Student is
// deliberately not offered here -- the real business requires visiting the
// counter in person with a valid student ID to get the discounted rate.
const PRICE_ENV_KEY: Record<"adult" | "senior", string> = {
  adult: "STRIPE_PRICE_INSIDERS_PLUS_ADULT",
  senior: "STRIPE_PRICE_INSIDERS_PLUS_SENIOR",
};

export async function startMembershipCheckout(fields: {
  name: string;
  email: string;
  phone: string;
  priceTier: "adult" | "senior";
}): Promise<{ url: string }> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) throw new Error("Enter your name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("members").select("id, tier, subscription_status").eq("email", email).maybeSingle();
  if (existing?.tier === "Insiders+" && existing.subscription_status === "active") {
    throw new Error("This email already has an active Insiders+ membership.");
  }

  const priceEnvKey = PRICE_ENV_KEY[fields.priceTier];
  const priceId = priceEnvKey ? process.env[priceEnvKey] : undefined;
  if (!priceId) throw new Error("Membership pricing isn't configured yet.");

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

  if (!session.url) throw new Error("Could not start checkout. Please try again.");
  return { url: session.url };
}
