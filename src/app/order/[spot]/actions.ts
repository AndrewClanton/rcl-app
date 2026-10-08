"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSignedInMember } from "@/lib/member-auth";
import { allowAttempt } from "@/lib/rate-limit";
import { connectionKey, TOO_MANY_FROM_CONNECTION } from "@/lib/public-form-guard";
import {
  TOO_MANY_DECLINES,
  closeIfDeclined,
  finishSeatCheckout,
  isUuid,
  seatCheckoutStatus,
  startSeatCheckout,
  type CheckoutStatus,
  type FinishResult,
  type StartResult,
} from "@/lib/seat-ordering-server";
import { isTipChoice, type CartLineInput } from "@/lib/seat-ordering";
import { createAdminClient } from "@/lib/supabase/admin";

// The phone menu's calls (public: no login needed). The cart comes as ids
// and is priced on the server; a signed-in member's account comes from their
// session, never from the page.
//
// Limits (code review N2, N11, M8, N24). Most guests share the venue Wi-Fi,
// so one IP is everyone in the room: the tight limit is per phone (a cookie)
// and spot, the per-IP one is a generous ceiling, and an hourly cap on new
// Stripe payments for the whole site stops a script that drops its cookie
// and rotates IPs.
const DEVICE_COOKIE = "rcl_seat_device";
const PER_PHONE = { max: 12, seconds: 300 };
const PER_PHONE_HOURLY_NEW = 20; // new Stripe payments per phone per hour
const PER_IP = { max: 150, seconds: 300 };
const PER_IP_HOURLY = 600;
const ALL_NEW_HOURLY = 400; // new Stripe payments per hour, the whole site
const TOO_MANY_FROM_PHONE = "Too many tries from this phone. Wait a minute and try again, or order at the counter.";

async function phoneKey(): Promise<string> {
  const jar = await cookies();
  let id = jar.get(DEVICE_COOKIE)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) {
    id = randomBytes(18).toString("base64url");
    jar.set(DEVICE_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86_400 });
  }
  return id;
}

async function ipAllowed(ip: string): Promise<boolean> {
  if (!(await allowAttempt(`seat-ip:${ip}:5m`, PER_IP.max, PER_IP.seconds))) return false;
  return allowAttempt(`seat-ip:${ip}:h`, PER_IP_HOURLY, 3600);
}

export async function startSeatOrder(input: { code: string; lines: CartLineInput[]; tip: number; name?: string; quietly?: boolean; reuse?: string | null }): Promise<StartResult> {
  const code = String(input?.code ?? "");
  const phone = await phoneKey();
  if (!(await allowAttempt(`seat-order:${phone}:${code}`, PER_PHONE.max, PER_PHONE.seconds))) return { ok: false, error: TOO_MANY_FROM_PHONE };
  if (!(await ipAllowed(await connectionKey()))) return { ok: false, error: TOO_MANY_FROM_CONNECTION };
  const member = await getSignedInMember().catch(() => null);
  try {
    return await startSeatCheckout({
      code,
      lines: Array.isArray(input?.lines) ? input.lines : [],
      tip: isTipChoice(input?.tip) ? input.tip : 0,
      name: typeof input?.name === "string" ? input.name : null,
      note: input?.quietly ? "Deliver quietly" : null,
      memberId: member?.id ?? null,
      reuseId: typeof input?.reuse === "string" ? input.reuse : null,
      // Only a new Stripe payment counts against the hourly caps.
      mayCreate: async () => (await allowAttempt(`seat-new:${phone}`, PER_PHONE_HOURLY_NEW, 3600)) && (await allowAttempt("seat-new:all", ALL_NEW_HOURLY, 3600)),
    });
  } catch (e) {
    console.error("seat order: start failed", e);
    return { ok: false, error: "Something went wrong. Try again, or order at the counter." };
  }
}

// The phone, after paying (and while it waits). Each checks Stripe, so one
// call per checkout every 3 seconds, under the per-IP ceiling.
export async function finishSeatOrder(checkoutId: string): Promise<FinishResult> {
  const id = String(checkoutId ?? "");
  if (!isUuid(id)) return { ok: false, error: "That order wasn't found." };
  const wait = { ok: false as const, pending: true, error: "Your payment went through. We're still sending your order through." };
  if (!(await allowAttempt(`seat-finish:${id}`, 1, 3))) return wait;
  if (!(await ipAllowed(await connectionKey()))) return wait;
  try {
    return await finishSeatCheckout(id);
  } catch (e) {
    console.error("seat order: finish failed", id, e);
    return wait;
  }
}

// The guest's status page polls this. A refused call throws, which the page
// treats like a dropped connection (it waits longer before asking again).
export async function seatOrderStatus(checkoutId: string): Promise<CheckoutStatus | null> {
  const id = String(checkoutId ?? "");
  if (!isUuid(id)) return null;
  if (!(await allowAttempt(`seat-status:${id}`, 40, 60))) throw new Error("busy");
  if (!(await ipAllowed(await connectionKey()))) throw new Error("busy");
  try {
    return await seatCheckoutStatus(id);
  } catch {
    return null;
  }
}

// The phone's card was declined: after MAX_DECLINES the payment is called
// off (the webhook's payment_intent.payment_failed does the same for a
// script that never calls this). closed: send the guest to the counter.
export async function seatPaymentDeclined(checkoutId: string): Promise<{ closed: boolean; error?: string }> {
  const id = String(checkoutId ?? "");
  if (!isUuid(id)) return { closed: false };
  if (!(await allowAttempt(`seat-declined:${id}`, 10, 300))) return { closed: false };
  try {
    const { data } = await createAdminClient().from("seat_checkouts").select("stripe_payment_intent_id, status").eq("id", id).maybeSingle();
    if (!data?.stripe_payment_intent_id || data.status !== "pending") return { closed: false };
    const closed = await closeIfDeclined(data.stripe_payment_intent_id as string);
    return closed ? { closed, error: TOO_MANY_DECLINES } : { closed };
  } catch (e) {
    console.error("seat order: decline not checked", id, e);
    return { closed: false };
  }
}
