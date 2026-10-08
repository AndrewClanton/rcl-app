// Order from your seat, end to end against the live database and Stripe in
// TEST mode (lib/seat-ordering-server.ts, supabase/migrations/
// 20261007020000_seat_ordering.sql): makes a throwaway spot and a made-up
// Insiders+ member (example.com), switches seat ordering on for the length
// of the check (the real setting is put back after), prices a cart, makes
// the Stripe payment the phone would, pays it with Stripe's test card, saves
// the order, and checks the order, its points, the bar and kitchen board
// query, the register's list and Making -> Delivered. Then it refunds the
// test payment and deletes everything it made. The kitchen printer is
// stubbed: nothing prints.
//
//   node scripts/check-seat-ordering-db.mjs
//
// Refuses to run with a live Stripe key.
import { registerHooks } from "node:module";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("STRIPE_SECRET_KEY isn't a test key. This check only runs in Stripe test mode.");
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}

const stubs = `
  export const printed = [];
  export async function sendKitchenTicket(order, when) { printed.push({ order, when }); }
  export function after() {}
  export function revalidatePath() {}
  export async function headers() { return new Headers(); }
  export async function cookies() { return { get() {}, getAll() { return []; }, set() {} }; }
`;
const STUB_URL = "data:text/javascript," + encodeURIComponent(stubs);
const STUBBED = { "server-only": "data:text/javascript,", "next/server": STUB_URL, "next/cache": STUB_URL, "next/headers": STUB_URL, "@/lib/print/kitchen": STUB_URL };
const src = fileURLToPath(new URL("../src/", import.meta.url));
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = withExt(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
      const file = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { printed } = await import(STUB_URL);
const S = await import("../src/lib/seat-ordering.ts");
const Srv = await import("../src/lib/seat-ordering-server.ts");
const { getBarTickets, getKitchenTickets } = await import("../src/lib/data/prepTickets.ts");
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// ---------- the switch and its hours (no database) ----------
{
  const on = { enabled: true, opens: "16:00", closes: "01:00" };
  // 2026-10-07 is a Wednesday. Central is UTC-5 in October.
  const at = (iso) => S.seatOrderingOpen(on, new Date(iso));
  check("open Wednesday 7 PM", at("2026-10-08T00:00:00Z").open);
  check("closed Wednesday 3 PM (before hours)", !at("2026-10-07T20:00:00Z").open);
  check("open Saturday 12:30 AM Sunday (Saturday's late night)", at("2026-10-11T05:30:00Z").open);
  const sun = at("2026-10-11T23:00:00Z");
  check("closed Sunday 6 PM (closed day)", !sun.open && sun.reason === "closed-day");
  check("off when switched off", S.seatOrderingOpen({ ...on, enabled: false }, new Date("2026-10-08T00:00:00Z")).reason === "off");
  check("board label", S.boardLabel("Cinema · Row C") === "CINEMA · ROW C");
  check("spot codes are 10 safe characters", S.isSpotCode(S.newSpotCode()));
  check("paused message", S.PAUSED_MESSAGE === "Ordering from your seat is paused, please order at the box office.");
}

const db = createAdminClient();
const stripe = new Stripe(key);
const tag = Array.from({ length: 6 }, () => String.fromCharCode(97 + randomInt(26))).join("");
let spotId = null;
let memberId = null;
let checkoutId = null;
let orderId = null;
let piId = null;
const { data: before } = await db.from("seat_ordering_settings").select("*").eq("id", 1).maybeSingle();

try {
  // A spot, a member, and the switch on all day for the check.
  const code = S.newSpotCode();
  const { data: spot, error: spotErr } = await db.from("order_spots").insert({ kind: "booth", name: `Check booth ${tag}`, code, sort_order: 999, active: true }).select("id").single();
  if (spotErr) throw spotErr;
  spotId = spot.id;
  const { data: member, error: memErr } = await db.from("members").insert({ name: `Seatcheck ${tag}`, email: `seatcheck-${tag}@example.com`, tier: "Insiders+", points: 0 }).select("id").single();
  if (memErr) throw memErr;
  memberId = member.id;
  await db.from("seat_ordering_settings").update({ enabled: true, opens: "00:00", closes: "23:59" }).eq("id", 1);
  check("spot found by its code", (await Srv.spotByCode(code))?.id === spotId);
  check("a made-up code finds nothing", (await Srv.spotByCode("zzzzzzzzzz")) === null);

  // The menu the phone sees.
  const menu = await Srv.getSeatMenu();
  const items = menu.flatMap((s) => s.items);
  const find = (name) => items.find((i) => i.name === name);
  check("menu has no tickets or merch", !menu.some((s) => s.key === "tickets" || s.key === "merch"));
  check("menu hides ran-out items", items.every((i) => i.id));
  const hotdog = find("Hot dog (regular)");
  const tea = find("Hot tea");
  const beer = find("Canned beer") ?? items.find((i) => i.isAlcohol && !i.groups.some((g) => g.mustChoose));
  const slice = find("Pizza (slice)");
  const candy = menu.find((s) => s.key === "sweet")?.items[0];
  check("test items are on the menu", !!(hotdog && tea && beer && slice && candy));
  check("a drink has its Bar Book icon", items.some((i) => i.isAlcohol && i.icon));

  const sliceGroup = slice.groups.find((g) => g.mustChoose);
  const cart = [
    { itemId: hotdog.id, optionIds: [], qty: 2 },
    { itemId: tea.id, optionIds: [], qty: 1 },
    { itemId: beer.id, optionIds: [], qty: 1 },
    { itemId: slice.id, optionIds: sliceGroup ? [sliceGroup.options[0].id] : [], qty: 1 },
    { itemId: candy.id, optionIds: [], qty: 1 },
  ];
  if (sliceGroup) {
    const unanswered = await Srv.priceCart([{ itemId: slice.id, optionIds: [], qty: 1 }], null, 0);
    check("a pick-one choice has to be answered", !unanswered.ok);
  }
  const bogus = await Srv.priceCart([{ itemId: hotdog.id, optionIds: [tea.id], qty: 1 }], null, 0);
  check("an option from another item is refused", !bogus.ok);

  // Prices the same way the register does.
  const priced = await Srv.priceCart(cart, { id: memberId, tier: "Insiders+", points: 0 }, 20);
  check("cart prices", priced.ok, priced.ok ? "" : priced.error);
  const t = priced.totals;
  check("daily coffee comes off for Insiders+", near(t.dailyPerk, tea.price), `${t.dailyPerk}`);
  const rest = t.subtotal - t.dailyPerk;
  check("Insiders+ 10% off the rest", near(t.memberDiscount, Math.round(rest * 10) / 100), `${t.memberDiscount}`);
  check("tax 8.725%", near(t.tax, Math.round((rest - t.memberDiscount) * 8.725) / 100), `${t.tax}`);
  check("tip 20% before tax", near(t.tip, Math.round((rest - t.memberDiscount) * 20) / 100), `${t.tip}`);
  check("ID check for alcohol", priced.idCheck);

  // Pay it the way the phone does: start, then Stripe's test card.
  const started = await Srv.startSeatCheckout({ code, lines: cart, tip: 20, name: "Check guest", note: "Deliver quietly", memberId });
  check("checkout starts with a Stripe payment", started.ok && !!started.clientSecret, started.ok ? "" : started.error);
  checkoutId = started.checkoutId;
  const { data: co } = await db.from("seat_checkouts").select("stripe_payment_intent_id").eq("id", checkoutId).single();
  piId = co.stripe_payment_intent_id;
  const piBefore = await stripe.paymentIntents.retrieve(piId);
  check("Stripe amount is the total", piBefore.amount === Math.round(started.totals.total * 100), `${piBefore.amount}`);
  check("nothing saved before paying", (await Srv.finishSeatCheckout(checkoutId)).ok === false);
  check("status page: not paid yet", (await Srv.seatCheckoutStatus(checkoutId))?.paid === false);
  const paid = await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
  check("test card paid", paid.status === "succeeded", paid.status);

  const [a, b] = await Promise.all([Srv.finishSeatCheckout(checkoutId), Srv.finishSeatCheckout(checkoutId)]);
  check("order saved", a.ok, a.ok ? "" : a.error);
  check("saving twice at once makes one order", a.ok && b.ok && a.orderId === b.orderId);
  orderId = a.orderId;
  const again = await Srv.finishSeatCheckout(checkoutId);
  check("saving again later gives the same order", again.ok && again.orderId === orderId);

  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  check("source mobile, completed", order.source === "mobile" && order.status === "completed");
  check("spot and note on the order", order.spot_id === spotId && order.spot_name === `Check booth ${tag}` && order.seat_note === "Deliver quietly");
  check("ID check flag", order.id_check === true);
  check("status new", order.seat_status === "new");
  check("totals saved", near(order.total, t.total) && near(order.tip, t.tip) && near(order.tax, t.tax) && near(order.tier_discount, t.memberDiscount));
  check("card amount and payment id", near(order.payment_card_amount, t.total) && order.stripe_payment_intent_id === piId && order.payment_method === "card");
  check("daily coffee recorded as today's", near(order.daily_perk_discount, tea.price) && !!order.daily_perk_date);
  check("member and name on it", order.member_id === memberId && order.order_name === "Check guest");
  const { data: lines } = await db.from("order_items").select("*").eq("order_id", orderId);
  check("five lines saved", lines.length === 5, `${lines.length}`);
  check("pick-one saved as its name", !sliceGroup || lines.some((l) => l.name === slice.name && l.modifiers.includes(sliceGroup.options[0].name)));
  const { data: ledger } = await db.from("points_ledger").select("delta, reason").eq("order_id", orderId);
  check("points earned", ledger?.length === 1 && near(ledger[0].delta, t.points), JSON.stringify(ledger));
  check("kitchen ticket sent with the spot", printed.length === 1 && printed[0].order.name.startsWith(`CHECK BOOTH ${tag.toUpperCase()}`) && printed[0].order.name.includes("ID CHECK"));

  // The boards and the register.
  const [bar, kitchen] = await Promise.all([getBarTickets(), getKitchenTickets()]);
  const onBar = bar.filter((x) => x.order_id === orderId);
  const onKitchen = kitchen.filter((x) => x.order_id === orderId);
  check("bar board: beer, tea and candy", onBar.length === 3 && onBar.every((x) => x.seat?.spot === `Check booth ${tag}` && x.seat.idCheck), `${onBar.length}`);
  check("kitchen board: hot dogs and slice", onKitchen.length === 2 && onKitchen.every((x) => x.seat?.status === "new"), `${onKitchen.length}`);
  check("register list has it", (await Srv.openSeatOrders()).some((o) => o.orderId === orderId));

  check("Making", await Srv.setSeatStatus(orderId, "making"));
  check("guest sees we're making it", (await Srv.seatCheckoutStatus(checkoutId))?.status === "making");
  check("Delivered", await Srv.setSeatStatus(orderId, "delivered"));
  const done = await Srv.seatCheckoutStatus(checkoutId);
  check("guest sees on its way", done?.status === "delivered" && done.orderNumber === order.order_number);
  check("register order can't be stepped", !(await Srv.setSeatStatus("00000000-0000-4000-8000-000000000000", "making")));

  // Paused: the phone is told so.
  await db.from("seat_ordering_settings").update({ enabled: false }).eq("id", 1);
  const paused = await Srv.startSeatCheckout({ code, lines: cart, tip: 0, memberId: null });
  check("paused when switched off", !paused.ok && paused.paused === true);
} catch (e) {
  failures++;
  console.error("FAIL  threw:", e);
} finally {
  if (before) await db.from("seat_ordering_settings").update({ enabled: before.enabled, opens: before.opens, closes: before.closes, updated_at: before.updated_at, updated_by: before.updated_by }).eq("id", 1);
  if (piId) await stripe.refunds.create({ payment_intent: piId }).catch(() => {});
  if (orderId) {
    await db.from("points_ledger").delete().eq("order_id", orderId);
    await db.from("order_items").delete().eq("order_id", orderId);
    await db.from("order_ticket_state").delete().eq("order_id", orderId);
    await db.from("seat_checkouts").delete().eq("order_id", orderId);
    await db.from("orders").delete().eq("id", orderId);
  }
  if (checkoutId) await db.from("seat_checkouts").delete().eq("id", checkoutId);
  if (spotId) {
    await db.from("seat_checkouts").delete().eq("spot_id", spotId);
    await db.from("order_spots").delete().eq("id", spotId);
  }
  if (memberId) await db.from("members").delete().eq("id", memberId);
  const { data: left } = await db.from("orders").select("id").eq("id", orderId ?? "00000000-0000-4000-8000-000000000000");
  check("cleaned up", !left?.length);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
