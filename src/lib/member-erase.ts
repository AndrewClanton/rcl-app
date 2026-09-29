import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

// Removing a member's personal info on request, as promised on /data-deletion.
//
// Steps run in an order that is safe to retry from the top if anything
// fails partway:
//   1. Stripe: cancel any Insiders+ right away, take the saved card off,
//      and blank the name, email, phone and address on their Stripe
//      customer. The customer itself is NOT deleted: its payments are part
//      of the tax records we keep.
//   2. Login: delete their auth user (password, Google, Facebook).
//   3. Database: erase_member_personal_info() clears everything that
//      identifies them, everywhere it was copied, in one transaction, and
//      logs the removal with the day they asked (for the 30-day promise).
//   4. Bar-tab cards: blank the name on the Stripe customers behind any
//      card they kept on a tab ("Tab: Sarah").
//   5. Photos: delete their uploaded photo files.
// Steps 1 and 2 come first because once step 3 clears the member row, it
// no longer records which Stripe customer or login was theirs. Steps 4 and
// 5 aren't fatal: the member no longer points at those, so a failure is a
// warning to clean up by hand.

export interface EraseSummary {
  orders: number;
  custom_items: number;
  bookings: number;
  booth_reservations: number;
  events: number;
  gifts_bought: number;
  gift_notes: number;
  visits: number;
  rewards: number;
  old_site_rows: number;
  points_entries: number;
  stripe: "cleared" | "none";
  tab_cards: number;
  login: "deleted" | "none";
  photos: number;
  warning: string | null;
}

export type EraseResult = { ok: true; summary: EraseSummary } | { ok: false; error: string };

// Stripe treats an empty string as "remove this".
const BLANK_CUSTOMER: Stripe.CustomerUpdateParams = { name: "", email: "", phone: "", description: "", address: "", shipping: "" };

// Billing that's still live on a customer, which removing someone ends now.
const LIVE_SUBSCRIPTION = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

function isMissing(e: unknown) {
  return (e as { code?: string }).code === "resource_missing";
}

// Step 1 for the member's own Stripe customer. Returns false if it's already
// gone from Stripe (nothing to clear).
async function scrubMemberCustomer(stripe: Stripe, customerId: string): Promise<boolean> {
  try {
    for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
      if (LIVE_SUBSCRIPTION.has(sub.status)) await stripe.subscriptions.cancel(sub.id);
    }
    for await (const pm of stripe.customers.listPaymentMethods(customerId, { limit: 100 })) {
      await stripe.paymentMethods.detach(pm.id);
    }
    await stripe.customers.update(customerId, BLANK_CUSTOMER);
    return true;
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}

export async function eraseMember(memberId: string, byEmployeeId: string, requestedOn: string | null): Promise<EraseResult> {
  const admin = createAdminClient();
  const { data: m, error } = await admin
    .from("members")
    .select("id, auth_user_id, stripe_customer_id, erased_at")
    .eq("id", memberId)
    .maybeSingle();
  if (error || !m) return { ok: false, error: "Couldn't find that member." };
  if (m.erased_at) return { ok: false, error: "This member's personal info was already removed." };

  // A staff login and a member account share one auth user; deleting it
  // would lock a staff member out of the register.
  if (m.auth_user_id) {
    const { data: staff } = await admin.from("employees").select("id").eq("auth_user_id", m.auth_user_id).eq("active", true).maybeSingle();
    if (staff) return { ok: false, error: "This member is also an active staff login. Remove their staff access in Admin → Staff first." };
  }

  const stripe = getStripe();

  // 1. Stripe
  let stripeResult: EraseSummary["stripe"] = "none";
  if (m.stripe_customer_id) {
    try {
      if (await scrubMemberCustomer(stripe, m.stripe_customer_id)) stripeResult = "cleared";
    } catch {
      return { ok: false, error: "Stripe didn't accept the change, so nothing here was removed yet. Try again in a minute." };
    }
  }

  // 2. Login
  let login: EraseSummary["login"] = "none";
  if (m.auth_user_id) {
    const { error: authErr } = await admin.auth.admin.deleteUser(m.auth_user_id);
    if (authErr && !/not.?found/i.test(authErr.message)) {
      return {
        ok: false,
        error: `Couldn't delete their login, so their personal info wasn't removed yet.${stripeResult === "cleared" ? " Their Insiders+ is already canceled." : ""} Try again.`,
      };
    }
    login = "deleted";
  }

  // 3. Database. The three-argument form logs the day they asked; until
  // its migration (20260929220000) is applied, fall back to the original.
  let rpc = await admin.rpc("erase_member_personal_info", { p_member: memberId, p_by: byEmployeeId, p_requested_on: requestedOn });
  if (rpc.error?.code === "PGRST202") rpc = await admin.rpc("erase_member_personal_info", { p_member: memberId, p_by: byEmployeeId });
  if (rpc.error) {
    return { ok: false, error: "Their login and billing were removed, but clearing their details failed. Press Remove again to finish." };
  }
  const counts = (rpc.data ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof counts[k] === "number" ? (counts[k] as number) : 0);

  const warnings: string[] = [];

  // 4. Bar-tab cards (their Stripe customers were named after the tab).
  let tabCards = 0;
  const tabCustomers = Array.isArray(counts.tab_card_customers) ? (counts.tab_card_customers as string[]) : [];
  for (const id of tabCustomers) {
    try {
      await stripe.customers.update(id, { ...BLANK_CUSTOMER, name: "Bar tab" });
      tabCards++;
    } catch (e) {
      if (!isMissing(e)) {
        warnings.push("The name on a bar-tab card in Stripe couldn't be cleared. Ask Claude to clean it up.");
        break;
      }
    }
  }

  // 5. Photos
  let photos = 0;
  const bucket = admin.storage.from("member-avatars");
  const { data: files } = await bucket.list("", { search: memberId, limit: 100 });
  const names = (files ?? []).map((f) => f.name).filter((name) => name.startsWith(memberId));
  if (names.length) {
    const { error: rmErr } = await bucket.remove(names);
    if (rmErr) warnings.push("Their photo files couldn't be deleted from storage. Ask Claude to clean them up.");
    else photos = names.length;
  }

  return {
    ok: true,
    summary: {
      orders: n("orders"),
      custom_items: n("custom_items"),
      bookings: n("bookings"),
      booth_reservations: n("booth_reservations"),
      events: n("events"),
      gifts_bought: n("gifts_bought"),
      gift_notes: n("gift_notes"),
      visits: n("visits"),
      rewards: n("rewards"),
      old_site_rows: n("old_site_rows"),
      points_entries: n("points_entries"),
      stripe: stripeResult,
      tab_cards: tabCards,
      login,
      photos,
      warning: warnings.length ? warnings.join(" ") : null,
    },
  };
}
