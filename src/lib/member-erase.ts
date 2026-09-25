import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

// Removing a member's personal info on request, as promised on /data-deletion.
//
// Steps run in an order that is safe to retry from the top if anything
// fails partway:
//   1. Stripe: delete the customer. That cancels any Insiders+ right away
//      and removes the saved card; Stripe keeps its own payment records.
//   2. Login: delete their auth user (password, Google, Facebook).
//   3. Database: erase_member_personal_info() clears everything that
//      identifies them, everywhere it was copied, in one transaction.
//   4. Photos: delete their uploaded photo files.
// Steps 1 and 2 come first because once step 3 clears the member row, it
// no longer records which Stripe customer or login was theirs.

export interface EraseSummary {
  orders: number;
  bookings: number;
  booth_reservations: number;
  events: number;
  old_site_rows: number;
  points_entries: number;
  stripe: "deleted" | "none";
  login: "deleted" | "none";
  photos: number;
  warning: string | null;
}

export type EraseResult = { ok: true; summary: EraseSummary } | { ok: false; error: string };

export async function eraseMember(memberId: string, byEmployeeId: string): Promise<EraseResult> {
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

  // 1. Stripe
  let stripe: EraseSummary["stripe"] = "none";
  if (m.stripe_customer_id) {
    try {
      await getStripe().customers.del(m.stripe_customer_id);
      stripe = "deleted";
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "resource_missing") {
        return { ok: false, error: "Stripe didn't accept the cancellation, so nothing was changed. Try again in a minute." };
      }
    }
  }

  // 2. Login
  let login: EraseSummary["login"] = "none";
  if (m.auth_user_id) {
    const { error: authErr } = await admin.auth.admin.deleteUser(m.auth_user_id);
    if (authErr && !/not.?found/i.test(authErr.message)) {
      return {
        ok: false,
        error: `Couldn't delete their login, so their personal info wasn't removed yet.${stripe === "deleted" ? " Their Insiders+ is already canceled." : ""} Try again.`,
      };
    }
    login = "deleted";
  }

  // 3. Database
  const { data: counts, error: rpcErr } = await admin.rpc("erase_member_personal_info", { p_member: memberId, p_by: byEmployeeId });
  if (rpcErr) {
    return { ok: false, error: "Their login and billing were removed, but clearing their details failed. Press Remove again to finish." };
  }

  // 4. Photos (not fatal: the member no longer points at them)
  let photos = 0;
  let warning: string | null = null;
  const bucket = admin.storage.from("member-avatars");
  const { data: files } = await bucket.list("", { search: memberId, limit: 100 });
  const names = (files ?? []).map((f) => f.name).filter((n) => n.startsWith(memberId));
  if (names.length) {
    const { error: rmErr } = await bucket.remove(names);
    if (rmErr) warning = "Their photo files couldn't be deleted from storage. Ask Claude to clean them up.";
    else photos = names.length;
  }

  const c = (counts ?? {}) as Record<string, number>;
  return {
    ok: true,
    summary: {
      orders: c.orders ?? 0,
      bookings: c.bookings ?? 0,
      booth_reservations: c.booth_reservations ?? 0,
      events: c.events ?? 0,
      old_site_rows: c.old_site_rows ?? 0,
      points_entries: c.points_entries ?? 0,
      stripe,
      login,
      photos,
      warning,
    },
  };
}
