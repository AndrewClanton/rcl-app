"use server";

import { siteOrigin } from "@/lib/site-origin";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff, assertStaff, assertAdmin, assertManager } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import type { MemberPriceTier, MemberTier } from "@/lib/types";
import { applyMemberRate, type RateChangeResult } from "@/lib/member-rate";
import { adjustPoints } from "@/lib/points";
import { getPointsHistory, type PointsHistoryRow } from "@/lib/data/points-history";
import { eraseMember, type EraseResult } from "@/lib/member-erase";
import { createPlusCheckout, plusPaidFor } from "@/lib/plus-checkout";
import { giftActive, giftEndsWithoutRenewal } from "@/lib/plus-status";
import { createGiftCheckout, type GiftCheckoutResult } from "@/lib/gift-membership";
import { seesFullContact } from "@/lib/contact-mask";
import { birthdayFromInput } from "@/lib/visits";
import { MAX_AUTO_LINKED_CARDS, cardLabel, cardOwners, type SaleCard } from "@/lib/card-match";
import { linkCard, loadCardLinks, loadSaleOrder, staffAccount, storedCard } from "@/lib/member-cards";
import { MAX_POINTS_CHANGE, formatPoints, pointsReasonProblem } from "@/lib/points-history";

function revalidate() {
  revalidatePath("/admin/members");
  revalidatePath("/admin/reports");
}

export async function addMember(fields: { name: string; email?: string; phone?: string; tier: MemberTier }) {
  await assertStaff();
  const name = fields.name.trim();
  if (!name) return;
  const supabase = createAdminClient();
  await supabase.from("members").insert({
    name,
    email: fields.email?.trim() || null,
    phone: fields.phone?.trim() || null,
    tier: fields.tier,
  });
  revalidate();
}

export async function updateMember(
  id: string,
  fields: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    tier: MemberTier;
    monthly_member: boolean;
    avatar_url: string | null;
  }>
) {
  const staff = await assertStaff();
  // Only these fields, whatever else the request carries: points, say,
  // change only through the points history (changeMemberPoints).
  const keys = ["name", "email", "phone", "tier", "monthly_member", "avatar_url"] as const;
  const allowed: Record<string, unknown> = {};
  for (const k of keys) if (fields && typeof fields === "object" && k in fields) allowed[k] = fields[k];
  // Contact details are managers-and-up (see saveMemberDetails); a
  // cashier's email or phone change is dropped rather than applied.
  if (!seesFullContact(staff.role)) {
    delete allowed.email;
    delete allowed.phone;
  }
  if (Object.keys(allowed).length === 0) return;
  const supabase = createAdminClient();
  await supabase.from("members").update(allowed).eq("id", id).is("erased_at", null);
  revalidate();
}

export type SaveDetailsResult = { ok: true; message: string } | { ok: false; error: string };

// The Save button on a member's page: name, email, phone and birthday
// together. (Points aren't typed over here: see changeMemberPoints.) A
// changed email or name is copied to their Stripe customer too, since
// that's where Stripe sends receipts and renewal notices.
//
// Email and phone are managers-and-up: a cashier only ever sees them
// shortened (lib/contact-mask.ts), so their page leaves them out, and
// they're refused here too. Left out means "unchanged". The birthday is a
// month and day ("12-30", "" for none; see BirthdayPicker).
export async function saveMemberDetails(
  id: string,
  fields: { name: string; email?: string; phone?: string; birthday?: string },
): Promise<SaveDetailsResult> {
  const staff = await assertStaff();
  if ((fields.email !== undefined || fields.phone !== undefined) && !seesFullContact(staff.role)) {
    return { ok: false, error: "Only a manager can change a member's email or phone." };
  }
  const name = fields.name.trim();
  const email = fields.email?.trim();
  const phone = fields.phone?.trim();
  const birthday = fields.birthday === undefined ? undefined : birthdayFromInput(fields.birthday);
  if (!name) return { ok: false, error: "Name can't be blank." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right. Check for a typo." };
  if (fields.birthday !== undefined && birthday === undefined) return { ok: false, error: "Pick both the month and the day of their birthday (or neither)." };

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("members").select("name, email, phone, birthday, stripe_customer_id").eq("id", id).is("erased_at", null).maybeSingle();
  if (!before) return { ok: false, error: "Member not found." };

  const changes: { name?: string; email?: string | null; phone?: string | null; birthday?: string | null } = {};
  if (name !== before.name) changes.name = name;
  if (email !== undefined && email !== (before.email ?? "")) changes.email = email || null;
  if (phone !== undefined && phone !== (before.phone ?? "")) changes.phone = phone || null;
  if (birthday !== undefined && birthday !== (before.birthday ?? null)) changes.birthday = birthday;
  if (Object.keys(changes).length) {
    const { error } = await supabase.from("members").update(changes).eq("id", id).is("erased_at", null);
    if (error?.code === "23505") return { ok: false, error: "Another member already has that email. Search for them in Members." };
    if (error) return { ok: false, error: "Couldn't save. Try again." };
  }

  let message = "Saved ✓";
  // Keep Stripe's copy in step (receipts and renewal notices go there).
  if (before.stripe_customer_id && (changes.email || changes.name)) {
    try {
      await getStripe().customers.update(before.stripe_customer_id, {
        ...(changes.email ? { email: changes.email } : {}),
        ...(changes.name ? { name: changes.name } : {}),
      });
      message = changes.email ? `Saved ✓ Stripe updated too: receipts now go to ${changes.email}.` : "Saved ✓ Stripe updated too.";
    } catch {
      message = "Saved here, but Stripe couldn't be updated. Change the email on their customer page in Stripe too.";
    }
  }
  revalidate();
  revalidatePath(`/admin/members/${id}`);
  return { ok: true, message };
}

// Senior/student rates are set only after checking an ID in person. For a
// paying Insiders+ member this also changes their Stripe price from their
// next bill (see applyMemberRate).
export async function setMemberRate(id: string, tier: MemberPriceTier): Promise<RateChangeResult> {
  const staff = await assertStaff();
  const result = await applyMemberRate(id, tier, staff.employeeId);
  revalidate();
  revalidatePath(`/admin/members/${id}`);
  return result;
}

// ---------- points: a bank account, not a number to type over ----------

export type PointsChangeResult = { ok: true; balance: number; message: string } | { ok: false; error: string; balance?: number };

// "Add or take away points" on a member's page: any staff member, as
// typing a new balance was before. Writes one 'adjustment' row in their
// points history with the reason (the member sees it) and who did it (they
// don't), and only if the balance is still the one the person confirmed
// ("Balance goes from X to Y"). Never takes a balance below zero.
export async function changeMemberPoints(
  id: string,
  change: { amount: number; reason: string; expectedBalance: number },
): Promise<PointsChangeResult> {
  const staff = await assertStaff();
  const amount = Number(change?.amount);
  const reason = typeof change?.reason === "string" ? change.reason.trim().replace(/\s+/g, " ") : "";
  const expected = Number(change?.expectedBalance);
  if (!Number.isInteger(amount) || amount === 0) return { ok: false, error: "Enter a whole number of points (not zero)." };
  if (Math.abs(amount) > MAX_POINTS_CHANGE) return { ok: false, error: `One change can move at most ${MAX_POINTS_CHANGE.toLocaleString()} points.` };
  const problem = pointsReasonProblem(reason);
  if (problem) return { ok: false, error: problem };
  if (!Number.isFinite(expected)) return { ok: false, error: "Reload the page and try again." };

  const r = await adjustPoints({ memberId: id, delta: amount, note: reason, by: staff.employeeId, expected });
  const balance = r.balance ?? undefined;
  if (r.status === "ok" || r.status === "duplicate") {
    revalidate();
    revalidatePath(`/admin/members/${id}`);
    const now = r.balance ?? expected + amount;
    const n = Math.abs(amount);
    return { ok: true, balance: now, message: `${amount > 0 ? "Added" : "Took away"} ${formatPoints(n)} point${n === 1 ? "" : "s"}. Balance is now ${formatPoints(now)}.` };
  }
  if (r.status === "stale") {
    revalidatePath(`/admin/members/${id}`);
    return { ok: false, balance, error: `Their balance is now ${formatPoints(r.balance ?? 0)}: something changed it since you opened this (a sale or check-in, say), so this wasn't saved. Check the history below, then confirm the new numbers if your change isn't there.` };
  }
  if (r.status === "negative") return { ok: false, balance, error: `They have ${formatPoints(r.balance ?? 0)} points, so that would put them below zero. Nothing was saved.` };
  if (r.status === "not_found") return { ok: false, error: "Member not found." };
  return { ok: false, error: "Couldn't save. Nothing changed. Try again." };
}

// "Show more" on a member's points history.
export async function loadPointsHistory(id: string, offset: number): Promise<{ rows: PointsHistoryRow[]; total: number }> {
  await assertStaff();
  const from = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return getPointsHistory(id, from, 50);
}

// ---------- linked cards (lib/member-cards.ts) ----------

type CardResult = { ok: true; message?: string } | { ok: false; error: string };

// Takes a card off a member: it stops finding them, and isn't linked to
// them again on its own. Any staff.
export async function unlinkMemberCard(memberId: string, cardId: string): Promise<CardResult> {
  const staff = await assertStaff();
  const { data, error } = await createAdminClient()
    .from("member_cards")
    .update({ removed_at: new Date().toISOString(), removed_by: staff.employeeId, brand: null, last4: null, wallet: null })
    .eq("id", cardId)
    .eq("member_id", memberId)
    .is("removed_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't unlink it. Try again." };
  if (!data?.length) return { ok: false, error: "That card was already unlinked." };
  revalidatePath(`/admin/members/${memberId}`);
  return { ok: true };
}

// Whether a manager may link a card to this member by hand: not a removed
// member, not one who turned linking off, not the manager's own account
// (another manager does that), and not past the card limit.
async function mayLinkByHand(supabase: ReturnType<typeof createAdminClient>, memberId: string, staff: { employeeId: string; email: string }, livemode: boolean): Promise<string | null> {
  const { data: member } = await supabase.from("members").select("erased_at, link_cards, email, auth_user_id").eq("id", memberId).maybeSingle();
  if (!member || member.erased_at) return "This member's personal info was removed.";
  if (member.link_cards === false) return "They turned card linking off on their account.";
  if (await staffAccount(supabase, { authUserId: member.auth_user_id, email: member.email }, { ids: [staff.employeeId], emails: [staff.email] })) {
    return "That's your own account. Ask another manager to link your card.";
  }
  const { count } = await supabase.from("member_cards").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("livemode", livemode).is("removed_at", null);
  if ((count ?? 0) >= MAX_AUTO_LINKED_CARDS) return `They already have ${MAX_AUTO_LINKED_CARDS} cards linked. Unlink one first.`;
  return null;
}

async function sharedNote(supabase: ReturnType<typeof createAdminClient>, memberId: string, card: SaleCard): Promise<string> {
  const others = cardOwners(card, await loadCardLinks(supabase, card.fingerprint)).filter((id) => id !== memberId).length;
  return others ? ` It's on ${others} other account${others === 1 ? "" : "s"} too, so a sale on it with nobody attached asks who's paying.` : "";
}

// Puts back a card that was unlinked (by mistake, or the member asks for
// it back). A removed card is never linked again on its own, so this is the
// only way back. Managers and up.
export async function relinkMemberCard(memberId: string, cardId: string): Promise<CardResult> {
  const staff = await assertManager();
  const supabase = createAdminClient();
  const { data: link } = await supabase.from("member_cards").select("fingerprint, livemode, brand, last4, wallet, removed_at").eq("id", cardId).eq("member_id", memberId).maybeSingle();
  if (!link) return { ok: false, error: "That card isn't on this member." };
  if (!link.removed_at) return { ok: false, error: "That card is already linked." };
  const blocked = await mayLinkByHand(supabase, memberId, staff, link.livemode);
  if (blocked) return { ok: false, error: blocked };
  // Its type and last four were deleted when it was removed: back from the
  // last payment made with it, if there is one.
  const { data: paid } = await supabase
    .from("card_payments")
    .select("brand, last4, wallet")
    .eq("fingerprint", link.fingerprint)
    .eq("livemode", link.livemode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("member_cards")
    .update({ removed_at: null, removed_by: null, removed_by_member: false, linked_by: staff.employeeId, ...(paid ? { brand: paid.brand, last4: paid.last4, wallet: paid.wallet } : {}) })
    .eq("id", cardId)
    .eq("member_id", memberId)
    .not("removed_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't link it again. Try again." };
  if (!data?.length) return { ok: false, error: "That card is already linked." };
  revalidatePath(`/admin/members/${memberId}`);
  return { ok: true, message: `Linked again.${await sharedNote(supabase, memberId, { fingerprint: link.fingerprint, livemode: link.livemode, brand: link.brand, last4: link.last4, wallet: link.wallet })}` };
}

// Links the card that paid one of their sales (one they were attached to),
// when they ask: a card that doesn't link on its own (the first day it
// paid for them, their own staff account, or a card already on someone
// else's account). Managers and up.
export async function linkCardFromSale(memberId: string, orderId: string): Promise<CardResult> {
  const staff = await assertManager();
  const supabase = createAdminClient();
  const sale = await loadSaleOrder(supabase, orderId);
  if (!sale?.payment || sale.order.member_id !== memberId || sale.order.member_source || sale.order.status !== "completed") {
    return { ok: false, error: "Only the card on a sale they were attached to can be linked from here." };
  }
  const card = storedCard(sale.payment);
  const { data: existing } = await supabase.from("member_cards").select("removed_at").eq("member_id", memberId).eq("fingerprint", card.fingerprint).eq("livemode", card.livemode).maybeSingle();
  if (existing && !existing.removed_at) return { ok: false, error: "That card is already linked to them." };
  if (existing) return { ok: false, error: "That card was removed from their account before. Use Link again under Linked cards." };
  const blocked = await mayLinkByHand(supabase, memberId, staff, card.livemode);
  if (blocked) return { ok: false, error: blocked };
  try {
    await linkCard(supabase, { memberId, card, source: "staff", orderId, by: staff.employeeId });
  } catch {
    return { ok: false, error: "Couldn't link it. Try again." };
  }
  revalidatePath(`/admin/members/${memberId}`);
  return { ok: true, message: `${cardLabel(card)} is linked.${await sharedNote(supabase, memberId, card)}` };
}

// A sale (or online tickets) whose points the card gave this member, but
// someone else paid. The register can undo it for 2 minutes; after that
// it's here, managers and up. The points come back off through their
// points history, and a register sale goes back to having no member.
// unlink: it isn't their card at all, so it comes off their account too.
export async function undoCardMatchInBackOffice(memberId: string, ref: { orderId?: string; bookingId?: string }, unlink: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const staff = await assertManager();
  const supabase = createAdminClient();
  const gone = "Those points aren't from this member's card anymore.";
  const id = ref.orderId ?? ref.bookingId;
  if (typeof id !== "string" || !id) return { ok: false, error: gone };
  const { data: payment } = await supabase
    .from("card_payments")
    .select("credited_member_id, credited_how, undone_at")
    .eq(ref.orderId ? "order_id" : "booking_id", id)
    .maybeSingle();
  if (!payment || payment.credited_member_id !== memberId || payment.undone_at) return { ok: false, error: gone };
  if (ref.orderId) {
    const { data: order } = await supabase.from("orders").select("member_id, member_source").eq("id", ref.orderId).maybeSingle();
    if (!order || order.member_id !== memberId || order.member_source !== "card") return { ok: false, error: gone };
  }
  // A cashier's pick of a shared card, or points given after an undo, never
  // unlink anyone (the database checks this too).
  const unlinks = unlink === true && payment.credited_how === "card";
  const r = ref.orderId
    ? await supabase.rpc("undo_card_sale", { p_order: id, p_unlink: unlinks, p_by: staff.employeeId })
    : await supabase.rpc("undo_card_booking", { p_booking: id, p_unlink: unlinks, p_by: staff.employeeId });
  if (r.error) {
    console.error("card match undo failed", id, r.error.message);
    return { ok: false, error: "Couldn't undo it. Try again." };
  }
  if (r.data === null || r.data === undefined) return { ok: false, error: gone };
  revalidate();
  revalidatePath(`/admin/members/${memberId}`);
  const n = Math.round(Number(r.data));
  return { ok: true, message: `Undone: ${n} point${n === 1 ? "" : "s"} taken back${unlinks ? ", and the card is unlinked from them" : ""}.` };
}

// Removes a member's personal info on request (see /data-deletion): cancels
// Stripe billing, deletes their login, and clears their details everywhere,
// keeping anonymous purchase records for taxes. Admin only.
//
// `requestedOn` (YYYY-MM-DD) is the day they asked, logged with the
// removal so the 30-day promise can be checked.
export async function eraseMemberPersonalInfo(id: string, requestedOn: string): Promise<EraseResult> {
  const staff = await assertAdmin();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedOn) || requestedOn > today) {
    return { ok: false, error: "Enter the day they asked (today or earlier)." };
  }
  const result = await eraseMember(id, staff.employeeId, requestedOn);
  revalidate();
  revalidatePath(`/admin/members/${id}`);
  return result;
}

// Comps a membership for a community/social program -- upgrades to
// Insiders+ (the tier with free-entry benefits) at no charge, and tags who
// approved it and which program it's attributed to so nonprofit grant
// reporting can tally participation by program (see /admin/reports).
export async function grantFreeMembership(id: string, fields: { communityProgramId: string | null; notes: string }) {
  const staff = await requireStaff();
  const supabase = createAdminClient();
  await supabase
    .from("members")
    .update({
      tier: "Insiders+",
      comped: true,
      community_program_id: fields.communityProgramId,
      comp_notes: fields.notes.trim() || null,
      comped_by: staff.employeeId,
      comped_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("erased_at", null);
  revalidate();
}

// Only reverts tier to plain Insiders if there's no real paid subscription
// behind it -- a comped member who separately started paying via Stripe
// should keep Insiders+ from their subscription, not lose it here.
export async function revokeFreeMembership(id: string) {
  await requireStaff();
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("stripe_subscription_id, plus_gift_until").eq("id", id).maybeSingle();
  await supabase
    .from("members")
    .update({
      // A gifted year still running keeps it on too.
      tier: member?.stripe_subscription_id || (member && giftActive(member)) ? "Insiders+" : "Insiders",
      comped: false,
      community_program_id: null,
      comp_notes: null,
      comped_by: null,
      comped_at: null,
    })
    .eq("id", id);
  revalidate();
}

export async function addCommunityProgram(fields: { name: string; description?: string }) {
  const name = fields.name.trim();
  if (!name) return;
  await requireStaff();
  const supabase = createAdminClient();
  await supabase.from("community_programs").insert({ name, description: fields.description?.trim() || null });
  revalidate();
}

export async function setCommunityProgramActive(id: string, active: boolean) {
  await requireStaff();
  const supabase = createAdminClient();
  await supabase.from("community_programs").update({ active }).eq("id", id);
  revalidate();
}

// Opens Stripe's own hosted billing portal for this member's Stripe
// customer, scoped to update their payment method (or view invoices) --
// staff can hand a tablet to the member and let them enter a new card
// directly into Stripe's PCI-compliant page. We never see or store the
// card number ourselves.
// Stripe's secure card page for putting a member on Insiders+ billing --
// someone set to Insiders+ by hand at the register, or anyone joining in
// person. Staff hand over the device or text the link (good for 24 hours).
// `firstChargeDate` (YYYY-MM-DD, optional) saves the card now but holds the
// first charge until that day, for someone who already paid this month
// another way (cash, or the old site's Fortis billing).
export async function createMemberCardLink(memberId: string, firstChargeDate: string | null, annual = false): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireStaff();
  const { data: m } = await createAdminClient()
    .from("members")
    .select("id, name, email, phone, tier, comped, price_tier, stripe_customer_id, stripe_subscription_id, subscription_status, plus_gift_until, erased_at")
    .eq("id", memberId)
    .maybeSingle();
  if (!m || m.erased_at) return { ok: false, error: "Member not found." };
  if (!m.email) return { ok: false, error: "Add the member's email first. Stripe sends their receipts there." };
  // On a gifted year with nothing after it: the card goes on now and the
  // first charge waits until the gift runs out.
  const giftEnds = giftEndsWithoutRenewal(m);
  if (plusPaidFor(m) && !giftEnds) return { ok: false, error: m.comped ? "This membership is complimentary, so there's nothing to pay." : "This member already has a card and an active membership. Use the card-on-file button to change it." };

  let firstChargeAt: Date | null = giftEnds && new Date(giftEnds).getTime() > Date.now() + 49 * 3_600_000 ? new Date(giftEnds) : null;
  if (firstChargeDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstChargeDate)) return { ok: false, error: "Pick a valid first-charge date." };
    firstChargeAt = new Date(`${firstChargeDate}T12:00:00-05:00`); // noon Central
    // Stripe won't hold a first charge for less than 48 hours.
    if (firstChargeAt.getTime() < Date.now() + 49 * 3_600_000) return { ok: false, error: "The first charge has to be at least 2 days out. Leave the date blank to charge today." };
  }

  const url = await createPlusCheckout({
    memberId: m.id,
    customerId: m.stripe_customer_id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    priceTier: (m.price_tier as MemberPriceTier | null) ?? "adult",
    returnTo: null,
    firstChargeAt,
    interval: annual ? "year" : "month",
    // Staff started it for this member: the card is theirs.
    linkCard: true,
  }).catch(() => null);
  return url ? { ok: true, url } : { ok: false, error: "Couldn't open Stripe's card page. Try again." };
}

export async function createMemberBillingPortalLink(memberId: string): Promise<{ url: string }> {
  await requireStaff();
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("stripe_customer_id").eq("id", memberId).maybeSingle();
  if (!member?.stripe_customer_id) throw new Error("No billing account on file for this member.");
  const origin = await siteOrigin();
  const session = await getStripe().billingPortal.sessions.create({
    customer: member.stripe_customer_id,
    return_url: `${origin}/admin/members/${memberId}`,
  });
  return { url: session.url };
}

// A year of Insiders+ paid for by someone else, one payment, no renewal
// (lib/gift-membership.ts). Opens Stripe's page for the buyer's card; the
// year lands on this member once it's paid.
export async function createGiftLink(memberId: string, fields: { buyerName: string; buyerEmail: string; message: string }): Promise<GiftCheckoutResult> {
  const session = await requireStaff();
  const buyerName = fields.buyerName.trim();
  const buyerEmail = fields.buyerEmail.trim();
  const message = fields.message.trim().slice(0, 300);
  if (!buyerName) return { ok: false, error: "Enter the buyer's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return { ok: false, error: "Enter the buyer's email. Their receipt goes there." };
  return createGiftCheckout({ recipientId: memberId, buyerName, buyerEmail, message: message || null, soldBy: session.employeeId });
}

// ---------- a member's profile line and shared page ----------
// (lib/member-profile.ts) Both are words a member wrote for others to see,
// so any staff member can take one down, and it's recorded who and when.

export type ProfileModerationResult = { ok: true } | { ok: false; error: string };

function moderationError(error: { code?: string } | null): ProfileModerationResult {
  if (!error) return { ok: true };
  const missing = error.code === "42703" || error.code === "PGRST204";
  return { ok: false, error: missing ? "Profile pages aren't switched on yet (the member_profiles migration)." : "Couldn't save. Try again." };
}

// Hide (or show again) their profile line. Hidden, it shows nowhere (their
// shared page, the check-in screen, the register), even after they edit
// it, until staff show it again; they see "hidden by our staff".
export async function setProfileLineHidden(id: string, hidden: boolean): Promise<ProfileModerationResult> {
  const staff = await assertStaff();
  const { error } = await createAdminClient()
    .from("members")
    .update(hidden ? { tagline_hidden_at: new Date().toISOString(), tagline_hidden_by: staff.employeeId } : { tagline_hidden_at: null, tagline_hidden_by: null })
    .eq("id", id)
    .is("erased_at", null);
  revalidate();
  return moderationError(error);
}

// Turn off their shared profile page (a rude display name or link, say),
// or let them share again. Off, they can't turn it back on themselves;
// allowing it again doesn't switch it on (that's theirs to do).
export async function setSharedPageBlocked(id: string, blocked: boolean): Promise<ProfileModerationResult> {
  const staff = await assertStaff();
  const { error } = await createAdminClient()
    .from("members")
    .update(blocked ? { share_profile: false, profile_hidden_at: new Date().toISOString(), profile_hidden_by: staff.employeeId } : { profile_hidden_at: null, profile_hidden_by: null })
    .eq("id", id)
    .is("erased_at", null);
  revalidate();
  return moderationError(error);
}
