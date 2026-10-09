"use server";

import type Stripe from "stripe";
import { assertStaff } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberLabel } from "@/lib/member-name";
import type { DeclineInfo } from "@/lib/decline-slip";

// The register's "Declines" list (RecentDeclines.tsx): every declined card
// since midnight (at least the last 2 hours), read straight from Stripe, so
// staff can print a decline slip for the guest after the fact. That covers
// the reader at checkout and an Insiders+ signup's first charge, whether it
// was started at the register or on the guest's own phone. Read-only.

export interface RecentDecline extends DeclineInfo {
  who: string | null; // the member, by their Stripe customer (staff only, not printed)
}

const TZ = "America/Chicago";
const MAX_PAGES = 5;

// Midnight in Chicago today, or 2 hours ago if that's earlier.
function since(now: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const intoDay = ((parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000;
  return Math.floor(Math.min(now.getTime() - intoDay, now.getTime() - 2 * 3600_000) / 1000);
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

function toDecline(c: Stripe.Charge, tappedOk: boolean, who: string | null): RecentDecline {
  const d = c.payment_method_details;
  const card = d?.card ?? null;
  const present = d?.card_present ?? d?.interac_present ?? null;
  const online = !present;
  const desc = c.description ?? "";
  const membership = /subscription|insiders/i.test(desc) || c.metadata?.source === "pos-unlimited";
  return {
    chargeId: c.id,
    at: new Date(c.created * 1000).toISOString(),
    amountCents: c.amount,
    purpose: membership ? "Insiders+ membership" : present ? "Purchase at the register" : desc && !/^pi_|^ch_/.test(desc) ? desc.slice(0, 60) : "Online purchase",
    membership,
    brand: card?.brand ?? present?.brand ?? null,
    last4: card?.last4 ?? present?.last4 ?? null,
    funding: card?.funding ?? present?.funding ?? null,
    online,
    failureCode: c.failure_code ?? null,
    declineCode: c.outcome?.reason ?? null,
    networkCode: c.outcome?.network_decline_code ?? null,
    declinedBy: c.outcome?.type === "blocked" ? "stripe" : "bank",
    tappedOk,
    who,
  };
}

export async function getRecentDeclines(): Promise<{ ok: true; declines: RecentDecline[] } | { ok: false; error: string }> {
  await assertStaff();
  const stripe = getStripe();
  const failed: Stripe.Charge[] = [];
  try {
    let startingAfter: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await stripe.charges.list({ created: { gte: since(new Date()) }, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      failed.push(...page.data.filter((c) => c.status === "failed"));
      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  } catch {
    return { ok: false, error: "Couldn't load declines from Stripe. Check the connection and try again." };
  }

  // Who it was: members by their Stripe customer.
  const customers = [...new Set(failed.map((c) => idOf(c.customer)).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (customers.length) {
    const { data } = await createAdminClient().from("members").select("name, phone, stripe_customer_id").in("stripe_customer_id", customers);
    for (const m of (data ?? []) as { name: string | null; phone: string | null; stripe_customer_id: string | null }[]) {
      if (m.stripe_customer_id) names.set(m.stripe_customer_id, memberLabel(m.name, m.phone));
    }
  }

  // An online charge on a card saved from a tap here (the register's
  // Insiders+ signup): the tap itself worked.
  const declines = await Promise.all(
    failed.map(async (c) => {
      const pmId = idOf(c.payment_method);
      let tapped = false;
      if (c.payment_method_details?.card && pmId) {
        const pm = await stripe.paymentMethods.retrieve(pmId).catch(() => null);
        tapped = !!pm?.card?.generated_from;
      }
      const cust = idOf(c.customer);
      return toDecline(c, tapped, cust ? (names.get(cust) ?? null) : null);
    }),
  );
  return { ok: true, declines };
}
