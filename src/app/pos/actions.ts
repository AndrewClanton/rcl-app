"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManagerPin } from "@/lib/manager-pin";
import type { Approval, ApprovalResult } from "@/lib/pin-rules";
import { assertStaff } from "@/lib/auth";
import { getPosMember, type PosMember } from "./member-actions";
import { applyPoints, POINTS_PER_REWARD } from "@/lib/points";
import { releaseTabCard } from "@/lib/tab-card";
import { refundOrder } from "@/app/admin/reports/actions";
import { sendKitchenTicket } from "@/lib/print/kitchen";
import { asStation, type RegisterStation } from "@/lib/print/stations";
import { readRegisterCard, settleSaleCard } from "@/lib/member-cards";
import { cardLabel, type CardNotice } from "@/lib/card-match";
import { schemaMissing } from "@/lib/schema-missing";
import { cents, ENFORCE_REGISTER_TOTALS, isRewardLine, pointsEarned } from "@/lib/register-totals";
import { checkDailyCoffee, checkSaleTotals, flagSale, verifyCardPayment, type CoffeeCheck, type TotalsCheck } from "@/lib/register-sale-checks";
import { currentMemberId } from "@/lib/member-forward";
import { coffeeDay } from "@/lib/daily-perk-server";
import { DAILY_COFFEE_LINE, type DailyCoffeeState } from "@/lib/daily-perk";
import { ownerOrderExtras, ownerSaleProblems, type OwnerPricing } from "@/lib/register-totals";
import { firstName as firstNameOf, ownerForMember, priceOwnerSale, type OwnerMember, type OwnerPricedLine } from "@/lib/owner-rate-server";
import { bookRecipesFor, customIngredientsFor } from "@/lib/data/barBook";
import { bookRecipeIdOf, drinkCost, isBelowCost, money as barMoney } from "@/lib/bar/pricing";
import { cleanCustomRecipe, customIsAlcohol, customRecipeText, type CustomRecipeLine } from "@/lib/bar/match";
import { logOrderComps, openOverLimit, orgSaleTerms, termsOrg, type OrgSaleTerms } from "@/lib/orgs-server";
import { isUuid } from "@/lib/rewards";
import { redeemOrderPoints, type RedeemShort } from "@/lib/rewards-server";
import type { OrgGroupInput } from "@/lib/orgs";
import { awardEventBadges } from "@/lib/badges/events";
import { isTaxExemptReason, TAX_EXEMPT_NOTE_MAX, type TaxExemptMark, type TaxExemptReason } from "@/lib/tax-exempt";

export interface CheckoutLine {
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
  screening_id?: string | null; // a movie ticket for this screening
  // An owner-rate line (completeOrder with ownerRate): the menu price the
  // owner rate replaced, and how it was priced. Set by the server, never
  // taken from the register.
  menu_unit_price?: number;
  owner_pricing?: OwnerPricing;
  // A Bar Book drink rung up off the menu (register → Bar Book → Add to
  // order): a one-off line like "+ Custom item" that says which recipe it
  // was. The server keeps it only for a real off-menu recipe on a one-off
  // line (bookRecipeOf); anything else is dropped.
  recipe_id?: string | null;
  // A custom drink from "What's in it?": a one-off line carrying what's in
  // it ([{ ingredient_id, quantity }]). The server keeps it only on a
  // one-off line with no Bar Book recipe, checks every ingredient, and
  // writes the names itself (cleanCustomRecipe); anything else is dropped.
  custom_recipe?: CustomRecipeLine[] | null;
  // A reward picked on the customer screen (Spend points): a $0 line with
  // no menu item. Its points come off when the sale is saved
  // (redeem_order_rewards), at the catalog's price, not the line's name.
  reward_id?: string | null;
}

export interface CheckoutTotals {
  subtotal: number;
  // The Insiders+ daily coffee (lib/daily-perk.ts). Optional: a sale kept
  // in a register's browser from before it existed has none.
  daily_perk_discount?: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  tax: number;
  total: number;
  // An organization member's comps (a day pass, movies) and a supported
  // guest's tax-included prices (lib/orgs.ts). Optional: none.
  org_comp_discount?: number;
  tax_included?: boolean;
}

export interface CheckoutPayment {
  // 'voucher' when paper vouchers covered it all; otherwise how the rest was paid.
  method: "cash" | "card" | "split" | "voucher";
  cash: number;
  card: number;
  stripePaymentIntentId?: string | null;
  tip?: number; // tip the customer chose on the card reader, already inside `card`
  tendered?: number; // cash handed over, for the change shown and printed (not stored)
  voucher?: number; // paper vouchers (trivia prizes) applied; not cash, not card
}

export interface DraftFields {
  employeeId: string;
  memberId: string | null;
  orderName: string;
  taxFree: boolean;
  // Why it's tax-free, who marked it and which manager approved it
  // (approveTaxExempt). Saved on the order only when taxFree.
  taxExempt?: TaxExemptMark | null;
  monthlyMember: boolean;
  pointsRedeemed: boolean;
  lines: CheckoutLine[];
  // Which register (Devices): printed on the kitchen's order ticket.
  station?: RegisterStation | null;
  // Organization guests with no account on the order (lib/orgs.ts): the
  // group by count, or today's group. Checked by the server; not kept on a
  // held order or tab.
  orgGroup?: OrgGroupInput | null;
  // The register's "Owner rate" tick (checkOwnerSale): the lines stay as
  // rung (menu prices) and the totals are the owner rate's. Not kept on a
  // held order or tab.
  ownerRate?: boolean;
}

export interface DraftOrderSummary {
  id: string;
  order_name: string | null;
  item_count: number;
  total: number;
  card_label: string | null; // a tab's card on file, e.g. "Visa ••4242"
}

export interface DraftOrderFull {
  id: string;
  order_name: string | null;
  member_id: string | null;
  member: PosMember | null;
  tax_free: boolean;
  tax_exempt: TaxExemptMark | null;
  monthly_member: boolean;
  points_redeemed: boolean;
  lines: (CheckoutLine & { unit: number })[];
}

// The order's tax-exempt columns (migration 20261003200000): only on a
// tax-free order, so every other sale saves the same as before (and keeps
// saving if the migration isn't in yet).
function taxExemptColumns(taxFree: boolean, mark: TaxExemptMark | null | undefined) {
  if (!taxFree || !mark || !isTaxExemptReason(mark.reason)) return {};
  return {
    tax_exempt_reason: mark.reason,
    tax_exempt_note: mark.note?.trim().slice(0, TAX_EXEMPT_NOTE_MAX) || null,
    tax_exempt_marked_by: mark.markedBy || null,
    tax_exempt_approved_by: mark.approvedBy || null,
    tax_exempt_at: mark.at || new Date().toISOString(),
  };
}

function revalidate() {
  revalidatePath("/pos");
}

type BookRecipes = Awaited<ReturnType<typeof bookRecipesFor>>;

// What the server found for an order's Bar Book drinks and custom drinks,
// looked up once per save.
type LineExtras = { book: BookRecipes; ingredients: Awaited<ReturnType<typeof customIngredientsFor>> };

async function lineExtrasFor(lines: CheckoutLine[]): Promise<LineExtras> {
  const [book, ingredients] = await Promise.all([bookRecipesFor(lines), customIngredientsFor(lines)]);
  return { book, ingredients };
}

// The recipe a line may keep: a one-off line (no menu item, not a ticket)
// naming an off-menu Bar Book drink the server found (bookRecipesFor).
function bookRecipeOf(l: CheckoutLine, book: BookRecipes): string | null {
  return bookRecipeIdOf(l, book);
}

// A Spend points reward a line carries: only a $0 line with no menu item
// or showing, and only a well-formed id (the catalog is checked when it's paid).
// One reward a sale couldn't take, in a manager's words.
function shortText(s: RedeemShort): string {
  const what = s.name ?? "a reward";
  if (s.why === "limit") return `${what} (${s.problem ?? "past its limit"})`;
  if (s.why === "stock") return `${what} (none left in stock)`;
  if (s.why === "not_found") return "a reward that's no longer in the catalog";
  return `${what} (not enough points${typeof s.balance === "number" ? `: ${Math.floor(s.balance)} of ${s.points}` : ""})`;
}

function rewardIdOf(l: CheckoutLine): string | null {
  return l.reward_id && isUuid(l.reward_id) && !l.menu_item_id && !l.screening_id && Number(l.unit_price) === 0 ? l.reward_id : null;
}

// The ingredient list a custom drink may keep (cleanCustomRecipe).
function customRecipeOf(l: CheckoutLine, extras: LineExtras): CustomRecipeLine[] | null {
  return cleanCustomRecipe(l, extras.ingredients);
}

// Swaps an order's items for `lines`. The new rows go in first and the old
// ones come out after, by id, so a save that fails part-way leaves the order
// with its old items instead of none (deleting first, then failing to
// insert, used to empty a tab). Two saves from one register never overlap:
// Next.js sends a page's Server Actions one at a time.
async function replaceOrderItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  lines: CheckoutLine[],
  given?: LineExtras,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: old, error: readErr } = await supabase.from("order_items").select("id").eq("order_id", orderId);
  if (readErr) return { ok: false, error: readErr.message };
  let addedIds: string[] = [];
  if (lines.length) {
    // Bar Book drinks keep their recipe and custom drinks their list (both
    // count as alcohol when they are); a line without either saves exactly
    // as it always has.
    const extras = given ?? (await lineExtrasFor(lines));
    const recipeIds = lines.map((l) => bookRecipeOf(l, extras.book));
    const customs = lines.map((l) => customRecipeOf(l, extras));
    const rows = lines.map((l, i) => ({
      order_id: orderId,
      menu_item_id: l.menu_item_id,
      name: l.name,
      unit_price: l.unit_price,
      quantity: l.quantity,
      modifiers: l.modifiers,
      is_alcohol: recipeIds[i] ? true : l.is_alcohol || (customs[i] ? customIsAlcohol(customs[i]!.map((c) => ({ name: c.name ?? "", kind: c.kind }))) : false),
      screening_id: l.screening_id ?? null,
      // Tickets aren't made by the kitchen or bar, so keep them off the prep screens.
      is_event: !!l.screening_id,
      // Only on an owner-rate line, so every other sale saves exactly as before.
      ...(l.owner_pricing ? { menu_unit_price: l.menu_unit_price ?? null, owner_pricing: l.owner_pricing } : {}),
      // Only on a $0 line with no menu item: a reward from Spend points.
      ...(rewardIdOf(l) ? { reward_id: rewardIdOf(l) } : {}),
    }));
    type Row = (typeof rows)[number] & { recipe_id?: string; custom_recipe?: CustomRecipeLine[] };
    const withRecipes: Row[] = recipeIds.some(Boolean) ? rows.map((r, i) => (recipeIds[i] ? { ...r, recipe_id: recipeIds[i]! } : r)) : rows;
    const withCustoms: Row[] = customs.some(Boolean) ? withRecipes.map((r, i) => (customs[i] ? { ...r, custom_recipe: customs[i]! } : r)) : withRecipes;
    const insert = (r: Row[]) => supabase.from("order_items").insert(r).select("id");
    let { data: added, error: insertErr } = await insert(withCustoms);
    // Before migration 20261005010000 adds order_items.custom_recipe, or
    // 20261004030000 adds recipe_id: saved without them, like any custom line.
    if (insertErr && schemaMissing(insertErr) && withCustoms !== withRecipes) ({ data: added, error: insertErr } = await insert(withRecipes));
    if (insertErr && schemaMissing(insertErr) && withRecipes !== rows) ({ data: added, error: insertErr } = await insert(rows));
    if (insertErr) return { ok: false, error: insertErr.message };
    addedIds = (added ?? []).map((r) => r.id);
  }
  const oldIds = (old ?? []).map((r) => r.id);
  if (oldIds.length) {
    const { error: deleteErr } = await supabase.from("order_items").delete().in("id", oldIds);
    if (deleteErr) {
      // Take the new rows back out so the order isn't left with every item
      // twice. Best effort: the caller reports the failure either way.
      if (addedIds.length) await supabase.from("order_items").delete().in("id", addedIds);
      return { ok: false, error: deleteErr.message };
    }
  }
  return { ok: true };
}

// A register ticket sale also books the seats (bookings.order_id = the
// order), so they count against capacity and show in attendance, box-office
// numbers and the member's movies. Rewritten whole on each save so a
// re-saved order never double-books. Never throws: the customer has already
// paid by the time this runs, so a failure here must not look like a failed
// sale.
async function syncTicketBookings(
  supabase: ReturnType<typeof createAdminClient>,
  order: { id: string; memberId: string | null; name: string | null },
  lines: CheckoutLine[],
) {
  try {
    await supabase.from("bookings").delete().eq("order_id", order.id);
    const byKey = new Map<string, { screening_id: string; unit_price: number; quantity: number }>();
    for (const l of lines) {
      if (!l.screening_id) continue;
      const key = `${l.screening_id}|${l.unit_price}`;
      const cur = byKey.get(key) ?? { screening_id: l.screening_id, unit_price: l.unit_price, quantity: 0 };
      cur.quantity += l.quantity;
      byKey.set(key, cur);
    }
    if (!byKey.size) return;
    const { error } = await supabase.from("bookings").insert(
      [...byKey.values()].map((b) => ({
        screening_id: b.screening_id,
        order_id: order.id,
        member_id: order.memberId,
        customer_name: order.name,
        quantity: b.quantity,
        unit_price: b.unit_price,
        status: "confirmed",
      })),
    );
    if (error) console.error("register ticket bookings failed", order.id, error.message);
    // A ticket for tonight on a member's order: its event badges
    // (lib/badges/events.ts), after the answer, so the sale never waits.
    const memberId = order.memberId;
    if (!error && memberId) after(() => awardEventBadges({ memberIds: [memberId] }).then(() => undefined, (e) => console.error("event badges at sale", e)));
  } catch (e) {
    console.error("register ticket bookings failed", order.id, e);
  }
}

// A paid sale's items. By now the order row is saved as paid, so a failure
// here is flagged for a manager (Reports -> Register checks), not thrown:
// throwing would show a paid sale as failed, and a retry finds the order by
// its payment and stops before reaching this.
async function saveSaleItems(
  supabase: ReturnType<typeof createAdminClient>,
  sale: { orderId: string; orderNumber: number; employeeId: string; paymentIntentId: string | null },
  lines: CheckoutLine[],
  extras: LineExtras,
) {
  const r = await replaceOrderItems(supabase, sale.orderId, lines, extras);
  if (r.ok) return;
  console.error("sale items not saved", sale.orderId, r.error);
  const items = lines.slice(0, 50).map((l) => `${l.quantity} x ${String(l.name).slice(0, 80)}`);
  const summary = `Order #${sale.orderNumber} saved as paid, but its items didn't. Put them back by hand: ${items.join(", ")}${lines.length > items.length ? ", ..." : ""}.`;
  after(() => flagSale("items_not_saved", { ...sale, details: { summary, items, error: r.error } }));
}

// A custom item usually means the menu couldn't describe the sale, so each
// one becomes a dev note to review. Best-effort: never blocks the sale. A
// badge reward's $0 line isn't one.
// Nor is a Bar Book drink: the book described it.
async function noteCustomItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderNumber: number,
  lines: CheckoutLine[],
  employeeId: string,
  extras: LineExtras,
) {
  const customLines = lines.filter((l) => !l.menu_item_id && !l.screening_id && !isRewardLine(l) && !bookRecipeOf(l, extras.book));
  if (!customLines.length) return;
  // A custom drink says what was in it.
  const items = customLines
    .map((l) => {
      const list = customRecipeText(customRecipeOf(l, extras));
      return `"${l.name}"${list ? ` (${list})` : ""} $${(l.unit_price * l.quantity).toFixed(2)}`;
    })
    .join(", ");
  await supabase
    .from("dev_notes")
    .insert({
      page_path: "/pos",
      page_title: "Register: custom item used",
      message: `Custom item rung up on order #${orderNumber}: ${items}. Should the register have a proper button or menu item for this?`,
      submitted_by: employeeId || null,
    })
    .then(() => {}, () => {});
}

export type CompleteOrderInput = DraftFields & {
  totals: CheckoutTotals;
  payment: CheckoutPayment;
  ageVerified: boolean;
  tip?: number;
  draftOrderId?: string | null;
  // A manager's OK to comp past the organization's daily limit
  // (org-actions.ts approveOrgOverLimit).
  orgApproval?: string | null;
};

// A card sale's card, once the sale is saved: linked to the member on it,
// or finding the member for the sale's points (lib/member-cards.ts).
// Best-effort and quick: the Stripe read starts as soon as the sale comes
// in (so it's usually back by now), it never fails the sale, and if it's
// slow the register moves on after 2.5 seconds while the rest finishes in
// the background (the points still land; the register just doesn't show
// them).
const CARD_WAIT_MS = 2500;

async function settleCard(args: Parameters<typeof settleSaleCard>[0]): Promise<CardNotice | null> {
  const work = settleSaleCard(args).catch((e) => {
    console.error("card points failed", args.orderId, e);
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), CARD_WAIT_MS);
  });
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first !== "late") return first;
  try {
    after(() => work.then(() => undefined));
  } catch {
    // Not inside a request: the work carries on by itself.
  }
  return null;
}

// A member's points balance: null if there's no such member, undefined if
// it couldn't be read.
async function memberPoints(supabase: ReturnType<typeof createAdminClient>, memberId: string): Promise<number | null | undefined> {
  const { data, error } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
  if (error) return undefined;
  return data ? Number(data.points) : null;
}

// Checked right before the payment screen opens, so a problem is caught
// before anyone pays instead of after. A check that can't run lets the sale
// through (completeOrder looks again).
// dropDailyCoffee: the Insiders+ daily coffee has to come off the order,
// with the member's coffee today when that's why (already used: the
// register shows when).
// orgFull: the organization's comps for today are used up (the register
// looks again and offers the manager override).
export type PaymentCheck = { ok: true } | { ok: false; error: string; points?: number; dropDailyCoffee?: DailyCoffeeState | null; orgFull?: boolean };

export async function checkBeforePayment(fields: DraftFields, totals: CheckoutTotals, orgApproval: string | null = null): Promise<PaymentCheck> {
  const staff = await assertStaff();
  // The owner rate: the owner's own account, nothing else off, and the
  // server's prices (no member perks to check: they're off with it).
  if (fields.ownerRate) {
    const owner = await checkOwnerSale(await currentMemberId(fields.memberId), fields, totals);
    return owner.ok ? { ok: true } : { ok: false, error: owner.error };
  }
  // An organization's comps: today's limit, looked at again (the other
  // register may have used the last one). A manager can go past it.
  if (Number(totals.org_comp_discount ?? 0) > 0 && (fields.memberId || fields.orgGroup)) {
    try {
      const memberNow = fields.memberId ? await currentMemberId(fields.memberId) : null;
      const terms = await orgSaleTerms(memberNow, fields.lines, false, undefined, fields.orgGroup);
      const org = termsOrg(terms);
      if (terms.plan.blocked && !(org && openOverLimit(orgApproval, org.orgId, staff.employeeId))) {
        return {
          ok: false,
          orgFull: true,
          error: `${org?.orgName ?? "This organization"} has used ${org?.used ?? ""} of its ${org?.limit ?? ""} comps today, not enough for this. A manager can approve going over, or ring the day pass and tickets at their price.`,
        };
      }
    } catch (e) {
      console.warn("org comp check skipped", e);
    }
  }
  const supabase = createAdminClient();
  const coffeeOn = Number(totals.daily_perk_discount ?? 0) > 0;
  // The account a merged-away member became (lib/member-forward.ts), so the
  // points and the totals check read the account completeOrder will pay.
  const needsMember = !!fields.memberId && ((fields.pointsRedeemed && totals.redemption_discount > 0) || coffeeOn || ENFORCE_REGISTER_TOTALS);
  const memberId = needsMember ? await currentMemberId(fields.memberId) : fields.memberId;
  // A daily coffee the member has already had today (on the other
  // register, say), or can't have, comes off before anyone pays. Checked
  // whether or not totals are enforced. If the check can't run, the sale
  // goes ahead (completeOrder looks again).
  let dailyCoffee: CoffeeCheck | undefined;
  if (coffeeOn) {
    dailyCoffee = await checkDailyCoffee({ memberId, lines: fields.lines });
    if (!dailyCoffee.ok) {
      return {
        ok: false,
        error: `${dailyCoffee.reason} The free coffee has been taken off the order. Check the new total, then take payment.`,
        dropDailyCoffee: dailyCoffee.used ? { usedAt: dailyCoffee.used.usedAt, orderNumber: dailyCoffee.used.orderNumber } : null,
      };
    }
  }
  if (fields.pointsRedeemed && totals.redemption_discount > 0) {
    if (!memberId) return { ok: false, error: "A points reward needs a member on the order. Attach the member, or uncheck the reward." };
    const points = await memberPoints(supabase, memberId);
    if (points !== undefined && (points ?? 0) < POINTS_PER_REWARD) {
      return {
        ok: false,
        points: points ?? 0,
        error: `This member has ${Math.floor(points ?? 0)} points now, and a reward takes ${POINTS_PER_REWARD}, so it's been taken off the order. Check the new total, then take payment.`,
      };
    }
  }
  if (ENFORCE_REGISTER_TOTALS) {
    const check = await checkSaleTotals({ ...fields, memberId, totals, dailyCoffee });
    if (check.problems.length) return { ok: false, error: `This order doesn't add up, so it can't be paid yet: ${check.problems[0]} Clear it and ring it up again, or get a manager.` };
  }
  return { ok: true };
}

// cardCharged: the card was charged for this sale even though it wasn't
// saved, so the register keeps its "card WAS charged" warning up.
// warning: saved, but staff need to know something (shown with the sale).
// card: what the card that paid did (linked to the member, or found the
// member for the points), for the register's card notice; null for nothing
// to show.
export type CompleteOrderResult = { ok: true; orderNumber: number; warning?: string; card: CardNotice | null } | { ok: false; error: string; cardCharged: boolean };

// How a paid sale can be paid here. ('owner_tab', the monthly owner tab
// before 10/5, is gone: an owner-rate order is paid like any other.)
const PAID_METHODS = ["cash", "card", "split", "voucher"];

export async function completeOrder(params: CompleteOrderInput): Promise<CompleteOrderResult> {
  const staff = await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");
  if (!PAID_METHODS.includes(params.payment?.method)) {
    return { ok: false, error: "That isn't a way to pay on the register. Take payment again.", cardCharged: false };
  }

  const supabase = createAdminClient();
  // To the cent, like everything the card is charged for.
  const tip = cents(params.tip ?? 0);
  const paymentIntentId = params.payment.stripePaymentIntentId ?? null;
  // The card that paid, read from Stripe while the sale is checked and saved
  // (it's checked against the saved sale before it's used). Never throws.
  // Only a well-formed payment id: verifyCardPayment refuses anything else.
  const cardRead = paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ? readRegisterCard(paymentIntentId) : Promise.resolve(null);
  // The member on the sale, or the account they were merged into while the
  // sale was open (lib/member-forward.ts): the old id would fail after
  // they've paid.
  const memberId = await currentMemberId(params.memberId);

  // An organization member's comps and tax-included prices (lib/orgs.ts),
  // judged before this sale's own comps are logged. The register checked
  // the daily limit before payment; a comp past it without a manager's OK
  // is still saved (they've paid what they were asked) and flagged.
  // Comps are logged only when the register took them off (a sale rung
  // while the day's comps were used up was charged, so logs none).
  const compsClaimed = Number(params.totals.org_comp_discount ?? 0) > 0;
  const orgClaimed = compsClaimed || !!params.totals.tax_included;
  let orgTerms: OrgSaleTerms | undefined;
  let overLimitBy: string | null = null;
  let overLimitUnapproved = false;
  if ((memberId || params.orgGroup) && orgClaimed) {
    try {
      // A charged sale (no comps) is judged against the limit; a comped one
      // is let past it here and flagged below if no manager approved.
      orgTerms = await orgSaleTerms(memberId, params.lines, compsClaimed, undefined, params.orgGroup);
      const org = termsOrg(orgTerms);
      if (compsClaimed && orgTerms.plan.overLimit && org) {
        const ok = openOverLimit(params.orgApproval, org.orgId, staff.employeeId);
        overLimitBy = ok?.approverId ?? null;
        overLimitUnapproved = !ok;
      }
    } catch (e) {
      console.error("org terms not read", e);
    }
  }
  const orgFields = orgClaimed
    ? { organization_id: termsOrg(orgTerms)?.orgId ?? null, org_comp_discount: cents(Number(params.totals.org_comp_discount ?? 0)), tax_included: !!params.totals.tax_included }
    : {};

  // The owner rate (checkOwnerSale): saved at the server's prices, with
  // the menu value it replaced. Refused before anyone pays (the register
  // checked before payment too); a card already charged is saved as rung
  // instead, and a manager sees it in Register checks.
  let ownerSale: Extract<OwnerSale, { ok: true }> | null = null;
  let ownerRefused: string | null = null;
  if (params.ownerRate) {
    const o = await checkOwnerSale(memberId, params, params.totals);
    if (o.ok) ownerSale = o;
    else if (!paymentIntentId) return { ok: false, error: o.error, cardCharged: false };
    else ownerRefused = o.error;
  }
  const saleLines: CheckoutLine[] = ownerSale ? ownerSale.lines : params.lines;

  const orderFields = {
    ...orgFields,
    ...(ownerSale ? { owner_menu_value: ownerSale.menuValue } : {}),
    source: "pos" as const,
    status: "completed" as const,
    employee_id: params.employeeId,
    member_id: memberId,
    order_name: params.orderName || null,
    subtotal: params.totals.subtotal,
    tier_discount: params.totals.tier_discount,
    monthly_discount: params.totals.monthly_discount,
    redemption_discount: params.totals.redemption_discount,
    tax_free: params.taxFree,
    ...taxExemptColumns(params.taxFree, params.taxExempt),
    monthly_member: params.monthlyMember,
    tax: params.totals.tax,
    tip,
    total: cents(params.totals.total + tip),
    payment_method: params.payment.method,
    payment_cash_amount: params.payment.cash,
    payment_voucher_amount: params.payment.voucher ?? 0,
    payment_card_amount: params.payment.card,
    stripe_payment_intent_id: params.payment.stripePaymentIntentId ?? null,
    points_redeemed: params.pointsRedeemed,
    age_verified: params.ageVerified,
    completed_at: new Date().toISOString(),
  };

  // One card payment is one sale. If this payment already has its order
  // (the register asked twice), hand back that order instead of a copy.
  const orderForPayment = async () => {
    if (!paymentIntentId) return null;
    const { data } = await supabase.from("orders").select("id, order_number, employee_id").eq("stripe_payment_intent_id", paymentIntentId).neq("status", "voided").limit(1);
    return data?.[0] ? { id: data[0].id as string, orderNumber: Number(data[0].order_number), employeeId: (data[0].employee_id as string | null) ?? null } : null;
  };
  // The card step, also for a sale saved on an earlier try whose answer
  // never reached the register: it's safe to repeat (nothing is linked or
  // paid twice), and shows the register what it missed. mayAct: the
  // notice's buttons, only for the cashier who rang the sale.
  const cardFor = (orderId: string, mayAct: boolean) =>
    paymentIntentId
      ? settleCard({ orderId, paymentIntentId, cardRead, cashierId: params.employeeId || null, staff: { employeeId: staff.employeeId, email: staff.email || null }, mayAct })
      : Promise.resolve(null);
  const sameCashier = (saved: { employeeId: string | null }) => !!saved.employeeId && saved.employeeId === params.employeeId;
  const already = await orderForPayment();
  if (already !== null) return { ok: true, orderNumber: already.orderNumber, card: await cardFor(already.id, sameCashier(already)) };

  // The card payment, confirmed with Stripe before the sale is saved.
  const flagBase = { employeeId: params.employeeId, paymentIntentId };
  const card = await verifyCardPayment(params.payment, params.draftOrderId ?? null);
  if (!card.ok) {
    // No order or tab name here: the flags keep no customer details (a tab
    // is found by its id, a sale by its payment).
    after(() => flagSale("card_refused", { ...flagBase, details: { reason: card.reason, payment: params.payment, totals: params.totals, tip, tabId: params.draftOrderId ?? null } }));
    return { ok: false, error: card.error, cardCharged: card.charged };
  }

  const saleForCheck = { ...params, memberId, tip, org: orgTerms };
  let totalsCheck: TotalsCheck | null = null;
  // The Bar Book drinks on it (off-menu, rung up from the book), looked up
  // once: only those keep their recipe, and they aren't custom items.
  const extras = await lineExtrasFor(params.lines);
  const book = extras.book;

  // The Insiders+ daily coffee (lib/daily-perk.ts): checked again here
  // (Insiders+, a daily coffee item on the order, not had today), then
  // recorded as today's on the order. The register checked before payment;
  // one that gets through anyway is still saved (the customer has paid by
  // now) but doesn't count as today's, and the totals check flags it for a
  // manager with the reason.
  const coffeeAmount = cents(Number(params.totals.daily_perk_discount ?? 0));
  const coffeeDate = coffeeDay();
  let dailyCoffee: CoffeeCheck | undefined = coffeeAmount > 0 ? await checkDailyCoffee({ memberId, lines: params.lines }, coffeeDate) : undefined;
  // The coffee's columns go on a sale only when it has one, so the register
  // keeps saving every other sale before migration
  // 20261001230000_plus_daily_coffee.sql adds them.
  let saleFields: typeof orderFields & { daily_perk_discount?: number; daily_perk_date?: string | null } =
    coffeeAmount > 0 ? { ...orderFields, daily_perk_discount: coffeeAmount, daily_perk_date: dailyCoffee?.ok ? coffeeDate : null } : orderFields;
  // The database keeps one coffee per member and day: two registers using it
  // at the same moment get here. The later sale is saved without it counting.
  const coffeeTaken = (e: { code?: string; message?: string } | null) => !!e && e.code === "23505" && (e.message ?? "").includes("orders_daily_perk_once");
  const coffeeRace = () => {
    saleFields = { ...saleFields, daily_perk_date: null };
    dailyCoffee = { ok: false, reason: "This member's free coffee for today went on another order at the same moment." };
    totalsCheck = null; // figured with the coffee allowed: look again
  };

  // The order's math, redone from the menu. Log-only unless enforcing; when
  // enforcing, a sale whose card is already charged is still saved (and
  // flagged): the register checked before payment, and losing the record
  // of a charged card is worse.
  // (An owner-rate sale was checked against the server's prices above.)
  if (ENFORCE_REGISTER_TOTALS && !ownerSale) {
    totalsCheck = await checkSaleTotals({ ...saleForCheck, dailyCoffee });
    if (totalsCheck.problems.length && !paymentIntentId) {
      const refused = totalsCheck;
      after(() => flagSale("totals_refused", { ...flagBase, details: { problems: refused.problems, sent: params.totals, server: refused.server, lines: refused.lines, member: refused.member, payment: params.payment, tip } }));
      return { ok: false, error: `This order doesn't add up, so it wasn't saved: ${refused.problems[0]} Clear it and ring it up again, or get a manager.`, cardCharged: false };
    }
  }

  let orderId = "";
  let orderNumber = 0;
  let wasTab = false;
  // A tab paid by card here after it was closed (paid or cancelled) on
  // another register: the card is charged, so the sale is kept as a new
  // walk-up order and flagged, instead of an error Retry saving could never
  // get past.
  let closedElsewhere: { tabId: string; orderNumber: number | null; status: string } | null = null;

  if (params.draftOrderId) {
    const { data: existing, error: fetchErr } = await supabase.from("orders").select("order_number, status").eq("id", params.draftOrderId).maybeSingle();
    if (fetchErr) throw fetchErr;
    let closedNow = false;
    if (existing) {
      // Only an open tab or held order can be closed, so two closes racing
      // can't both award points and write items.
      const draftId = params.draftOrderId;
      const close = () => supabase.from("orders").update(saleFields).eq("id", draftId).in("status", ["draft", "held", "tab"]).select("id");
      let { data: closed, error: updateErr } = await close();
      if (coffeeTaken(updateErr)) {
        coffeeRace();
        ({ data: closed, error: updateErr } = await close());
      }
      if (updateErr) throw updateErr;
      closedNow = !!closed?.length;
    }
    if (closedNow && existing) {
      orderId = params.draftOrderId;
      orderNumber = Number(existing.order_number);
      wasTab = existing.status === "tab";
      await saveSaleItems(supabase, { orderId, orderNumber, ...flagBase }, saleLines, extras);
    } else {
      // This payment's own close may have landed a moment ago (a retry).
      const saved = await orderForPayment();
      if (saved !== null) return { ok: true, orderNumber: saved.orderNumber, card: await cardFor(saved.id, sameCashier(saved)) };
      if (!paymentIntentId) {
        return { ok: false, error: "This tab was already closed on another register, so this sale wasn't saved. Hand back any cash taken for it, and check Recent orders.", cardCharged: false };
      }
      closedElsewhere = { tabId: params.draftOrderId, orderNumber: existing ? Number(existing.order_number) : null, status: existing?.status ?? "deleted" };
    }
  }

  if (!params.draftOrderId || closedElsewhere) {
    const { data: newNumber, error: numberErr } = await supabase.rpc("next_order_number");
    if (numberErr) throw numberErr;
    orderNumber = Number(newNumber);
    const insert = () =>
      supabase
        .from("orders")
        .insert({ order_number: orderNumber, ...saleFields })
        .select("id")
        .single();
    let { data: order, error: orderErr } = await insert();
    if (coffeeTaken(orderErr)) {
      coffeeRace();
      ({ data: order, error: orderErr } = await insert());
    }
    if (orderErr || !order) {
      if (!orderErr) throw new Error("The order didn't save.");
      // Lost a race with a repeat of this same card payment (the database
      // allows one order per payment): the other call saved it.
      const saved = orderErr.code === "23505" ? await orderForPayment() : null;
      if (saved !== null) return { ok: true, orderNumber: saved.orderNumber, card: await cardFor(saved.id, sameCashier(saved)) };
      throw orderErr;
    }
    orderId = order.id;
    await saveSaleItems(supabase, { orderId, orderNumber, ...flagBase }, saleLines, extras);
  }

  // The organization's comps on this sale, logged now so the next count
  // (the other register, the chip) includes them.
  if (orgTerms && compsClaimed) await logOrderComps({ orderId, memberId, terms: orgTerms, lines: params.lines, overLimitBy });

  // The member's balance before this sale moves it. A reward's points come
  // out below only if it covers them, and the log-only totals check (run
  // after the register has its answer, so after the points have moved)
  // judges the reward on this, not on what's left once it's used.
  const balanceBefore = memberId && params.pointsRedeemed ? await memberPoints(supabase, memberId) : undefined;

  // Anything worth a look is flagged after the register has its answer, so
  // it never slows a sale down.
  const saved = { ...flagBase, orderId, orderNumber };
  after(async () => {
    if (closedElsewhere) {
      await flagSale("tab_closed_elsewhere", {
        ...saved,
        details: {
          summary: `Possible double charge: a tab${closedElsewhere.orderNumber ? ` (#${closedElsewhere.orderNumber})` : ""} was ${closedElsewhere.status === "deleted" ? "cancelled" : "closed"} on another register before this card payment saved, so it was saved as new order #${orderNumber}. Check both and refund one. Until one is refunded in full, the member's points (and any reward used) and any movie seats count twice.`,
          tabId: closedElsewhere.tabId,
          tabOrderNumber: closedElsewhere.orderNumber,
          tabStatus: closedElsewhere.status,
          amount: params.payment.card,
          payment: params.payment,
          tip,
        },
      });
    }
    if (card.flag) await flagSale("card_unchecked", { ...saved, details: { reason: card.flag.reason, detail: card.flag.detail, payment: params.payment } });
    const overOrg = termsOrg(orgTerms);
    if (overLimitUnapproved && overOrg) {
      await flagSale("org_over_limit", {
        ...saved,
        details: { summary: `${overOrg.orgName} was comped past its daily limit (${overOrg.used}/${overOrg.limit}) without a manager's OK.`, organizationId: overOrg.orgId },
      });
    }
    // The coffee as judged before this sale saved (once saved, its own
    // coffee would look like today's already used).
    const check = ownerSale ? null : (totalsCheck ?? (await checkSaleTotals({ ...saleForCheck, dailyCoffee, memberPointsBefore: balanceBefore })));
    if (check?.skipped) console.warn("[register-check] totals not checked", orderNumber, check.skipped);
    if (check?.problems.length) {
      await flagSale("totals_mismatch", { ...saved, details: { problems: check.problems, sent: params.totals, server: check.server, lines: check.lines, member: check.member, payment: params.payment, tip, draft: !!params.draftOrderId } });
    }
    // A Bar Book drink rung up for less than its ingredients cost. The
    // register asks for a manager PIN first (the PIN log has who); this is
    // the server's own record of it, priced like any custom line.
    // A custom drink from "What's in it?" the same way, costed from its list.
    const under = params.lines.flatMap((l) => {
      const id = bookRecipeOf(l, book);
      const found = id ? book.get(id) : undefined;
      if (found) return isBelowCost(Number(l.unit_price), found.cost) ? [{ name: l.name, recipeId: id, price: Number(l.unit_price), cost: found.cost.known, list: null as string | null }] : [];
      const custom = customRecipeOf(l, extras);
      if (!custom) return [];
      const cost = drinkCost(custom.map((c) => ({ name: c.name ?? "?", quantity: c.quantity, unitCost: extras.ingredients.get(c.ingredient_id)?.unitCost ?? null })));
      return isBelowCost(Number(l.unit_price), cost) ? [{ name: l.name, recipeId: null, price: Number(l.unit_price), cost: cost.known, list: customRecipeText(custom) }] : [];
    });
    if (under.length) {
      await flagSale("below_cost", {
        ...saved,
        details: {
          summary: `Rung up below what its ingredients cost: ${under.map((u) => `${u.name}${u.list ? ` (${u.list})` : ""} at ${barMoney(u.price)} (costs ${barMoney(u.cost)})`).join(", ")}. The register asks for a manager PIN for this.`,
          lines: under,
        },
      });
    }
  });

  // (None at the owner rate: it earns no points.)
  // 1 point per $1 of the order after discounts. Each change lands in the
  // member's points history, tied to this order.
  if (memberId && !ownerSale) {
    const earned = pointsEarned(params.totals);
    if (earned > 0) await applyPoints({ memberId, delta: earned, reason: "purchase", orderId, note: `Order #${orderNumber}`, by: params.employeeId || null });
  }
  // What the sale spends: the $5 off's 100 points and the rewards picked on
  // the customer screen (Spend points), at the catalog's price. All in one
  // step with the member locked (redeem_order_points, code review M9, N12):
  // each is taken only if their points cover it (the $5 off against the
  // balance before this sale's own points) and a good only within its
  // limits and stock, so two registers can't spend the same points and the
  // balance never goes below zero. The customer has paid by now, so the
  // sale stands; anything not taken is flagged for a manager. (The register
  // re-checks all of it before payment and asks for a manager PIN when
  // something's short.)
  const discountWanted = memberId && !ownerSale && params.pointsRedeemed && params.totals.redemption_discount > 0 ? POINTS_PER_REWARD : 0;
  const rewardItems = params.lines.flatMap((l) => {
    const id = rewardIdOf(l);
    return id ? [{ rewardId: id, qty: Math.max(1, Math.round(Number(l.quantity) || 1)) }] : [];
  });
  if (memberId && !ownerSale && (rewardItems.length || discountWanted)) {
    const redeemed = await redeemOrderPoints({ memberId, orderId, items: rewardItems, discountPoints: discountWanted, by: params.employeeId || null });
    if (!redeemed) {
      after(() => flagSale("points_short", { ...saved, details: { memberId, summary: "The points for this sale's $5 off or rewards couldn't be taken (the database didn't answer). Take them off by hand in Back office." } }));
    } else if (redeemed.short.length) {
      const short = redeemed.short;
      after(() => flagSale("points_short", { ...saved, details: { memberId, points: balanceBefore, rewards: short, summary: `Not taken: ${short.map(shortText).join("; ")}. It was handed over anyway.` } }));
    }
  } else if (rewardItems.length && !memberId) {
    after(() => flagSale("points_short", { ...saved, details: { summary: "Reward lines were rung with no member on the order, so no points were taken for them." } }));
  }

  await syncTicketBookings(supabase, { id: orderId, memberId, name: params.orderName || null }, params.lines);

  // A closed tab's card on file comes off file, however the tab was paid.
  // (A tab closed elsewhere had its card released there.)
  if (params.draftOrderId && !closedElsewhere) await releaseTabCard(orderId);

  await noteCustomItems(supabase, orderNumber, params.lines, params.employeeId, extras);

  // The kitchen's order ticket: the whole order, or for a tab whatever
  // hadn't gone to the kitchen yet. Never throws; nothing happens without a
  // kitchen printer. A tab closed elsewhere already went to the kitchen as
  // that tab, so its new order doesn't print again.
  if (!closedElsewhere) {
    await sendKitchenTicket(
      { orderId, orderNumber, name: params.orderName || null, tab: wasTab, station: asStation(params.station), lines: params.lines },
      "now",
    );
  }

  // Last, so nothing above waits on it.
  const cardNotice = await cardFor(orderId, true);

  revalidate();
  const warnings: string[] = [];
  if (closedElsewhere) {
    warnings.push(`That tab was already closed on another register, so this card payment was saved as new order #${orderNumber}. The customer may have paid twice: get a manager to check Recent orders and refund one.`);
  }
  if (ownerRefused) warnings.push(`The card was charged, but the owner rate didn't check out (${ownerRefused}), so the sale was saved as rung. A manager will see it in Register checks.`);
  // Saved with the free coffee, but it didn't count as today's.
  const coffee = dailyCoffee as CoffeeCheck | undefined;
  if (coffee && !coffee.ok) warnings.push(`${coffee.reason} The sale was saved with the free coffee anyway, and a manager will see it in Register checks.`);
  return warnings.length ? { ok: true, orderNumber, warning: warnings.join(" "), card: cardNotice } : { ok: true, orderNumber, card: cardNotice };
}

// The order a card payment already saved as, if any: a reader payment found
// after a reload may have saved just before the page went (its sale landed,
// but the register never heard). Undefined if it couldn't be looked up.
export async function savedOrderForPayment(paymentIntentId: string): Promise<number | null | undefined> {
  await assertStaff();
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;
  const { data, error } = await createAdminClient().from("orders").select("order_number").eq("stripe_payment_intent_id", paymentIntentId).neq("status", "voided").limit(1);
  if (error) return undefined;
  return data?.[0] ? Number(data[0].order_number) : null;
}

// "Stop trying" on the register's "card WAS charged" warning: the card
// stays charged and the sale won't be in Reports, so a manager is told
// (Reports -> Register checks). The flag itself is best effort (see
// flagSale); the register tells staff if this call doesn't get through.
export async function logAbandonedSale(order: CompleteOrderInput, tries: number): Promise<void> {
  const staff = await assertStaff();
  const paymentIntentId = order.payment?.stripePaymentIntentId ?? null;
  const amount = cents(Number(order.payment?.card) || 0);
  await flagSale("sale_abandoned", {
    employeeId: order.employeeId,
    paymentIntentId: paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ? paymentIntentId : null,
    details: {
      summary: `The card was charged $${amount.toFixed(2)} but the sale never saved, and someone tapped "Stop trying". The money is in Stripe with no sale in Reports: check with the cashier, and refund it if the customer shouldn't have paid.`,
      amount,
      tip: cents(Number(order.tip) || 0),
      // No order or tab name: the flags keep no customer details.
      tabId: order.draftOrderId ?? null,
      items: (order.lines ?? []).slice(0, 50).map((l) => `${l.quantity} x ${String(l.name).slice(0, 80)}`),
      tries,
      stoppedBy: staff.name,
    },
  });
}

// ---------- the owner rate ----------
// The register's "Owner rate" tick (lib/register-totals.ts says what it
// is): the member on the order is an owner's own account with the owner
// rate on (the only way the tick shows, and checked here again), nothing
// else comes off, and the order priced by the server from today's menu and
// recipes comes to what the register shows. It's then paid like any sale.
// No PIN: the owner's own account has to be on the order; the order keeps
// who rang it (employee_id) and whose account it was (member_id).
type OwnerSale = { ok: true; owner: OwnerMember; lines: OwnerPricedLine[]; menuValue: number } | { ok: false; error: string };

async function checkOwnerSale(memberId: string | null, fields: DraftFields, totals: CheckoutTotals): Promise<OwnerSale> {
  const owner = await ownerForMember(memberId);
  if (owner === undefined) return { ok: false, error: "The owner rate couldn't be checked. Try again." };
  if (!owner) return { ok: false, error: "The owner rate is only for an owner's own account on the order. Untick Owner rate, or attach the owner's account." };
  const extra = ownerOrderExtras({
    monthlyMember: fields.monthlyMember,
    pointsRedeemed: fields.pointsRedeemed,
    taxFree: fields.taxFree,
    orgComps: totals.org_comp_discount,
    taxIncluded: totals.tax_included,
    discounts: Number(totals.tier_discount) + Number(totals.monthly_discount) + Number(totals.redemption_discount) + Number(totals.daily_perk_discount ?? 0),
  });
  if (extra) return { ok: false, error: extra };
  const lines = Array.isArray(fields.lines) ? fields.lines : [];
  const priced = await priceOwnerSale(lines);
  if (!priced.ok) return { ok: false, error: `This can't be rung at the owner rate: ${priced.problems[0]}` };
  const problems = ownerSaleProblems({ lines, totals }, priced);
  if (problems.length) return { ok: false, error: problems[0] };
  return { ok: true, owner, lines: priced.lines, menuValue: priced.menuValue };
}

// ---------- held orders & tabs (persisted drafts, status 'held' | 'tab') ----------
//
// Draft rows must carry a real, current total (not a 0 placeholder) --
// getDraftOrders reads it straight from the row rather than recomputing a
// bare item subtotal, so the held/tabs lists always show the same
// tax-and-discount-inclusive number the cashier sees in the cart. Callers
// pass the totals they already computed for the on-screen cart. An
// Insiders+ daily coffee is in that total but isn't stored on a draft: the
// register works it out again when the order is opened, and completeOrder
// records it when it's paid (so a held order or open tab never uses up the
// day's coffee).

const ZERO_TOTALS: CheckoutTotals = { subtotal: 0, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 0, total: 0 };

export async function saveDraftOrder(status: "held" | "tab", fields: DraftFields, totals: CheckoutTotals = ZERO_TOTALS): Promise<string> {
  await assertStaff();
  const supabase = createAdminClient();
  const memberId = await currentMemberId(fields.memberId);
  const { data: orderNumber, error: numberErr } = await supabase.rpc("next_order_number");
  if (numberErr) throw numberErr;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: "pos",
      status,
      employee_id: fields.employeeId,
      member_id: memberId,
      order_name: fields.orderName || null,
      tab_name: status === "tab" ? fields.orderName || null : null,
      tax_free: fields.taxFree,
      ...taxExemptColumns(fields.taxFree, fields.taxExempt),
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .select("id")
    .single();
  if (error) throw error;

  const items = await replaceOrderItems(supabase, order.id, fields.lines);
  if (!items.ok) {
    // Don't leave an empty held order or tab behind: the register keeps the
    // items on screen, and trying again makes a whole new one.
    console.error("draft items not saved", order.id, items.error);
    await supabase.from("orders").delete().eq("id", order.id);
    throw new Error("Couldn't save the items.");
  }
  // A tab opened with items already rung: the kitchen gets its first
  // ticket after a short pause for more (lib/print/kitchen.ts). A held
  // order isn't an order yet, so it doesn't print.
  if (status === "tab" && fields.lines.length) {
    await sendKitchenTicket({ orderId: order.id, orderNumber: Number(orderNumber), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines }, "hold");
  }
  revalidate();
  return order.id;
}

const OPEN_DRAFT = ["draft", "held", "tab"];

// closed: the order isn't open anymore (paid or cancelled, usually on
// another register), so trying the same save again can't work.
export type DraftSaveResult = { ok: true } | { ok: false; error: string; closed?: boolean };

// opts.kitchen: for a tab, when what's new since the kitchen's last ticket
// prints: "hold" (the default, while it's still being rung) or "now" (the
// tab is being put away).
export async function updateDraftOrder(id: string, fields: DraftFields, totals: CheckoutTotals, opts?: { kitchen?: "hold" | "now" }): Promise<DraftSaveResult> {
  await assertStaff();
  const supabase = createAdminClient();
  const memberId = await currentMemberId(fields.memberId);
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      employee_id: fields.employeeId,
      member_id: memberId,
      order_name: fields.orderName || null,
      tab_name: fields.orderName || null,
      tax_free: fields.taxFree,
      ...taxExemptColumns(fields.taxFree, fields.taxExempt),
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .eq("id", id)
    // Only an order that's still held or an open tab: a register with an
    // out-of-date list must never rewrite a sale that's already been paid.
    .in("status", OPEN_DRAFT)
    .select("id, order_number, status");
  if (error) {
    console.error("draft save failed", id, error.message);
    return { ok: false, error: "Couldn't save the tab." };
  }
  if (!updated?.length) return { ok: false, closed: true, error: "That tab is already closed." };
  const items = await replaceOrderItems(supabase, id, fields.lines);
  if (!items.ok) {
    console.error("draft items not saved", id, items.error);
    return { ok: false, error: "Couldn't save the tab's items." };
  }
  // Anything added to a tab goes to the kitchen as an ADD-ON ticket.
  if (updated[0].status === "tab") {
    await sendKitchenTicket(
      { orderId: id, orderNumber: Number(updated[0].order_number), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines },
      opts?.kitchen === "now" ? "now" : "hold",
    );
  }
  revalidate();
  return { ok: true };
}

export async function getDraftOrders(status: "held" | "tab"): Promise<DraftOrderSummary[]> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_name, total, tab_card_label, items:order_items(quantity)")
    .eq("status", status)
    .order("created_at");
  if (error) throw error;
  return (orders ?? []).map((o) => ({
    id: o.id,
    order_name: o.order_name,
    item_count: (o.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
    total: Number(o.total),
    card_label: o.tab_card_label ?? null,
  }));
}

export async function loadDraftOrder(id: string): Promise<DraftOrderFull> {
  await assertStaff();
  const supabase = createAdminClient();
  // recipe_id: a Bar Book drink's recipe, once migration 20261004030000 is
  // in; read without it before then. The order's own columns are "*": the
  // tax-exempt columns come along once migration 20261003200000 is in.
  type DraftRow = {
    id: string;
    order_name: string | null;
    member_id: string | null;
    tax_free: boolean;
    monthly_member: boolean;
    points_redeemed: boolean;
    items: unknown;
    tax_exempt_reason?: string | null;
    tax_exempt_note?: string | null;
    tax_exempt_marked_by?: string | null;
    tax_exempt_approved_by?: string | null;
    tax_exempt_at?: string | null;
  };
  const read = async (columns: string) => {
    const r = await supabase.from("orders").select(columns).eq("id", id).in("status", OPEN_DRAFT).single();
    return { data: r.data as unknown as DraftRow | null, error: r.error };
  };
  const ORDER_COLUMNS = "*";
  const ITEM_COLUMNS = "menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, screening_id";
  // custom_recipe: a custom drink's list, once migration 20261005010000 is in.
  // reward_id: a reward line (Spend points), once migration 20261007020000 is in.
  let { data: order, error } = await read(`${ORDER_COLUMNS}, items:order_items(${ITEM_COLUMNS}, recipe_id, custom_recipe, reward_id)`);
  if (error && schemaMissing(error)) ({ data: order, error } = await read(`${ORDER_COLUMNS}, items:order_items(${ITEM_COLUMNS}, recipe_id, custom_recipe)`));
  if (error && schemaMissing(error)) ({ data: order, error } = await read(`${ORDER_COLUMNS}, items:order_items(${ITEM_COLUMNS}, recipe_id)`));
  if (error && schemaMissing(error)) ({ data: order, error } = await read(`${ORDER_COLUMNS}, items:order_items(${ITEM_COLUMNS})`));
  if (error || !order) throw new Error("That order was already closed on another register.");
  const items = order.items as { menu_item_id: string | null; name: string; unit_price: number; quantity: number; modifiers: string[]; is_alcohol: boolean; screening_id: string | null; recipe_id?: string | null; custom_recipe?: CustomRecipeLine[] | null; reward_id?: string | null }[];
  return {
    id: order.id,
    order_name: order.order_name,
    member_id: order.member_id,
    member: order.member_id ? await getPosMember(order.member_id) : null,
    tax_free: order.tax_free,
    tax_exempt:
      order.tax_free && isTaxExemptReason(order.tax_exempt_reason)
        ? { reason: order.tax_exempt_reason, note: order.tax_exempt_note ?? null, markedBy: order.tax_exempt_marked_by ?? null, approvedBy: order.tax_exempt_approved_by ?? null, at: order.tax_exempt_at ?? new Date().toISOString() }
        : null,
    monthly_member: order.monthly_member,
    points_redeemed: order.points_redeemed,
    lines: items.map((i) => ({
      menu_item_id: i.menu_item_id,
      name: i.name,
      unit_price: i.unit_price,
      unit: i.unit_price,
      quantity: i.quantity,
      modifiers: i.modifiers,
      is_alcohol: i.is_alcohol,
      screening_id: i.screening_id,
      ...(i.recipe_id ? { recipe_id: i.recipe_id } : {}),
      ...(Array.isArray(i.custom_recipe) && i.custom_recipe.length ? { custom_recipe: i.custom_recipe } : {}),
      ...(i.reward_id ? { reward_id: i.reward_id } : {}),
    })),
  };
}

// Held orders and open tabs only. A completed sale can never be deleted
// from here (refunds go through Recent orders with a manager PIN).
// Whether a tab is still open, checked right before taking payment: a tab
// closed on the other register mustn't be charged again from this one.
export async function isDraftOpen(id: string): Promise<boolean> {
  await assertStaff();
  const { data } = await createAdminClient().from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  return !!data;
}

export async function discardDraftOrder(id: string): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: open } = await supabase.from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  if (!open) return;
  await releaseTabCard(id);
  await supabase.from("orders").delete().eq("id", id).in("status", OPEN_DRAFT);
  revalidate();
}

// Manager PIN (src/lib/manager-pin.ts). Returns the reason on failure and,
// on success, whose PIN approved it.
export async function cancelTab(id: string, pin: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "cancel-tab", staff.employeeId, id);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  // Only a tab that's still open: one paid on another register meanwhile is
  // a sale now, and deleting it would lose it. Its card on file is released
  // first, like any discarded draft.
  const { data: open } = await supabase.from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  if (!open) return { ok: false, error: "That tab isn't open anymore. It may have been paid on another register. Check Recent orders." };
  await releaseTabCard(id);
  await supabase.from("orders").delete().eq("id", id).in("status", OPEN_DRAFT);
  revalidate();
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

// A manager OKs a tax-free sale with their PIN, and the cashier says why
// (lib/tax-exempt.ts), before the register lets the "Tax exempt" box be
// ticked. Everything else is taxed (lib/sales-tax.ts). The answer is the
// mark the register sends with the order, which saves it on the order for
// Reports; the PIN log (pin_attempts, context "tax-exempt") has the
// approval too, with the tab it was for when there is one.
export type TaxExemptApproval = ({ ok: true; mark: TaxExemptMark } & Approval) | { ok: false; error: string };

export async function approveTaxExempt(input: { pin: string; tabId: string | null; cashierId: string | null; reason: TaxExemptReason; note: string }): Promise<TaxExemptApproval> {
  const staff = await assertStaff();
  if (!isTaxExemptReason(input.reason)) return { ok: false, error: "Pick why this order is tax-free." };
  const note = input.note.trim().slice(0, TAX_EXEMPT_NOTE_MAX);
  if (input.reason === "other" && !note) return { ok: false, error: "Add a short note saying why." };
  const approval = await checkManagerPin(input.pin, "tax-exempt", staff.employeeId, input.tabId ?? undefined);
  if (!approval.ok) return approval;
  return {
    ok: true,
    approvedBy: approval.approvedBy,
    defaultPin: approval.defaultPin,
    mark: { reason: input.reason, note: note || null, markedBy: input.cashierId || null, approvedBy: approval.approverId, at: new Date().toISOString() },
  };
}

// ---------- recent orders (reprint, refund, "what did they order?") ----------

export interface RecentOrder {
  id: string;
  orderNumber: number;
  status: string; // completed | refunded | voided
  at: string;
  name: string | null;
  cashier: string | null;
  member: string | null;
  // The member was found by the card that paid, not attached by staff.
  memberByCard: boolean;
  cardLabel: string | null; // the card that paid, e.g. "Visa •••• 4242"
  method: string | null;
  cash: number;
  card: number;
  voucher: number;
  subtotal: number;
  discounts: { label: string; amount: number }[];
  tax: number;
  taxIncluded?: boolean; // the tax is inside the prices (lib/orgs.ts)
  tip: number;
  total: number;
  lines: { name: string; qty: number; unit: number; mods: string[]; screeningId: string | null }[];
  // An owner-tab order: whose tab it went on (first name). Null for any
  // other sale.
  ownerTab: string | null;
}

export async function getRecentRegisterOrders(limit = 20): Promise<RecentOrder[]> {
  await assertStaff();
  const base =
    "id, order_number, status, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, subtotal, tier_discount, monthly_discount, redemption_discount, daily_perk_discount, tax, tip, total, employee:employees!orders_employee_id_fkey(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, screening_id)";
  const recent = (columns: string) =>
    createAdminClient().from("orders").select(columns).in("status", ["completed", "refunded", "voided"]).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(limit);
  // The card that paid and how the member got on the sale (migration
  // 20261001220000); without it, the list as it was.
  let { data, error } = await recent(`${base}, org_comp_discount, tax_included, member_source, card:card_payments(brand, last4, wallet)`);
  if (schemaMissing(error)) ({ data, error } = await recent(`${base}, member_source, card:card_payments(brand, last4, wallet)`));
  if (schemaMissing(error)) ({ data, error } = await recent(base));
  if (error) throw error;
  type Row = {
    id: string;
    order_number: number;
    status: string;
    completed_at: string;
    order_name: string | null;
    tab_name: string | null;
    payment_method: string | null;
    payment_cash_amount: number | null;
    payment_card_amount: number | null;
    payment_voucher_amount: number | null;
    subtotal: number;
    daily_perk_discount?: number | null;
    org_comp_discount?: number | null;
    tax_included?: boolean | null;
    tier_discount: number;
    monthly_discount: number;
    redemption_discount: number;
    tax: number;
    tip: number;
    total: number;
    member_source?: string | null;
    card?: CardParts | CardParts[] | null;
    employee: { name: string } | null;
    member: { name: string } | null;
    items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; screening_id: string | null }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  const owners = await ownerTabNames(rows.filter((o) => o.payment_method === "owner_tab").map((o) => o.id));
  return rows.map((o) => {
    const card = Array.isArray(o.card) ? (o.card[0] ?? null) : (o.card ?? null);
    return {
      id: o.id,
      orderNumber: Number(o.order_number),
      status: o.status,
      at: o.completed_at,
      name: o.tab_name || o.order_name || null,
      cashier: o.employee?.name ?? null,
      member: o.member?.name ?? null,
      memberByCard: !!o.member_source && !!o.member,
      cardLabel: card ? cardLabel(card) : null,
      method: o.payment_method,
      cash: Number(o.payment_cash_amount ?? 0),
      card: Number(o.payment_card_amount ?? 0),
      voucher: Number(o.payment_voucher_amount ?? 0),
      subtotal: Number(o.subtotal),
      discounts: [
        { label: "Organization comp", amount: Number(o.org_comp_discount ?? 0) },
        { label: DAILY_COFFEE_LINE, amount: Number(o.daily_perk_discount ?? 0) },
        { label: "Member discount", amount: Number(o.tier_discount) },
        { label: "Monthly member discount", amount: Number(o.monthly_discount) },
        { label: "Points reward", amount: Number(o.redemption_discount) },
      ].filter((d) => d.amount > 0),
      tax: Number(o.tax),
      taxIncluded: !!o.tax_included,
      tip: Number(o.tip),
      total: Number(o.total),
      lines: o.items.map((i) => ({ name: i.name, qty: i.quantity, unit: Number(i.unit_price), mods: i.modifiers ?? [], screeningId: i.screening_id })),
      ownerTab: o.payment_method === "owner_tab" ? (owners.get(o.id) ?? "owner") : null,
    };
  });
}

// Whose owner tab each of these orders went on, by first name. Best effort:
// an empty map if it can't be read (the order still shows, as "owner").
async function ownerTabNames(orderIds: string[]): Promise<Map<string, string>> {
  if (!orderIds.length) return new Map();
  const db = createAdminClient();
  const { data: rows, error } = await db.from("orders").select("id, owner_tab_employee_id").in("id", orderIds);
  if (error || !rows?.length) return new Map();
  const ids = [...new Set(rows.map((r) => r.owner_tab_employee_id as string | null).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await db.from("employees").select("id, name").in("id", ids) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id as string, firstNameOf(p.name as string)]));
  return new Map(rows.filter((r) => r.owner_tab_employee_id && name.has(r.owner_tab_employee_id)).map((r) => [r.id as string, name.get(r.owner_tab_employee_id)!]));
}

type CardParts = { brand: string | null; last4: string | null; wallet: string | null };

// Refund from the register (manager PIN). Card money goes back to the card
// through Stripe; for cash, staff hand it back. Returns the reason on failure
// (a wrong PIN, say), since a thrown message is hidden in production.
// reason: required for an owner-tab order, which only another owner's PIN
// takes off the tab (refundOrder).
export async function refundRegisterOrder(orderId: string, pin: string, reason?: string): Promise<ApprovalResult> {
  try {
    return await refundOrder(orderId, pin, reason);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refund that order." };
  }
}
