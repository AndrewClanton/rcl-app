// Shared between the POS (sender) and the customer-facing kiosk display
// (receiver): a Supabase Realtime broadcast channel, deliberately NOT
// backed by a database table. An in-progress cart isn't persisted anywhere
// until it's held, tabbed, or completed, so mirroring it live has to be
// pure pub/sub rather than routing through payment-critical order rows.
// The channel's name is a server-side secret -- see lib/register-topic.ts.

export interface RegisterCartSnapshot {
  orderName: string;
  // lineTotal: the line's price (unit x quantity). Optional fields let an
  // older screen or register keep working mid-update.
  items: { name: string; quantity: number; modifiers: string[]; lineTotal?: number }[];
  subtotal: number;
  tax: number;
  // The tax is inside the prices (an organization's supported guest,
  // lib/orgs.ts): "Tax included", and the total is the listed prices.
  taxIncluded?: boolean;
  total: number;
  discounts?: { label: string; amount: number }[];
  // Who's on this order, for the live tally, their account panel and their
  // card (the customer screen's MemberCards.tsx). Only what the screen
  // shows: never an email, phone, full name or member id.
  // plus: Insiders+ that's paid for (pos/member-signal.ts): the gold badge.
  // unlimited: a former unlimited member with nothing paying for it
  // (lib/legacy-plus.ts). noCard: Insiders+ set by hand with nothing paying
  // for it. Either keeps a red "add your card" card up beside the order
  // until it's set up or they're taken off the order.
  // coffee: an Insiders+ member's free coffee today (lib/daily-perk.ts),
  // missing while it's unknown. discountPct: their member discount on this
  // order (10 for Insiders+, 0 for plain Insiders: points only).
  // profile: their card, while nothing's rung up yet (missing until it's
  // looked up, or if it couldn't be).
  // Everything after `plus` is optional, so an older screen or register
  // keeps working mid-update.
  member?: {
    firstName: string;
    points: number;
    plus: boolean;
    unlimited?: boolean;
    noCard?: boolean;
    coffee?: "ready" | "on-order" | "used" | null;
    discountPct?: number;
    profile?: TabletProfile | null;
    // Points this order already spends (its reward lines and any $5 off),
    // taken when the sale is saved: Spend points counts them as gone.
    rewardPoints?: number;
    // Those reward lines, by reward, so the screen counts them against the limits.
    rewards?: { id: string; qty: number }[];
  } | null;
  pointsToEarn?: number;
  // The register's payment screen is open: the customer screen plays its
  // "ready to pay" sound. (A sale that saved sends "paid" on its own.)
  paying?: boolean;
  // A card charge couldn't start because the reader is offline: the screen
  // says "Card reader is waking up, one moment" (never an error to guests).
  readerWaking?: boolean;
  // A card payment is waiting on the card reader: the customer screen
  // takes over with "Finish on the card reader" (PayOnReader.tsx), so
  // guests stop tapping their card on the tablet. Missing otherwise (cash,
  // a voucher, a card on file charged without asking).
  reader?: ReaderPrompt | null;
}

// What the guest does on the card reader, and where it sits.
// tip: the reader asks for a tip first (off when the tip was already
// taken on the register, or a tab asked for it when it closed).
// card: they tap, insert or swipe there (false: a tab's card on file, where
// the reader only asks for the tip).
// step: "card" once the register can tell they're past the tip (a card was
// tried); missing while it can't, so both steps stay up.
export interface ReaderPrompt {
  tip: boolean;
  card: boolean;
  step?: "card";
}

// Checked, since it comes off the channel: null for anything else.
export function parseReaderPrompt(p: unknown): ReaderPrompt | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Partial<ReaderPrompt>;
  const tip = r.tip === true;
  const card = r.card !== false;
  if (!tip && !card) return null;
  return { tip, card, step: card && r.step === "card" ? "card" : undefined };
}

// The customer screen's sound effects (display/customer/sounds.ts): on or
// off, and how loud (0 to 100). Set on the register under Devices, sent as
// "sound", and remembered on both. A register only sends it once someone
// has set it there, so two registers never argue over the default.
export interface TabletSound {
  on: boolean;
  volume: number;
}

// Modest by default: the 37-seat cinema is next door.
export const TABLET_SOUND_DEFAULT: TabletSound = { on: true, volume: 40 };

export function parseTabletSound(p: unknown): TabletSound | null {
  if (!p || typeof p !== "object") return null;
  const { on, volume } = p as Partial<TabletSound>;
  if (typeof on !== "boolean" || typeof volume !== "number" || !Number.isFinite(volume)) return null;
  return { on, volume: Math.min(100, Math.max(0, Math.round(volume))) };
}

// The outward-facing side of a member's profile (lib/member-profile.ts), as
// the customer screen shows it to them while they're at the bar. Keys into
// the screen's own catalogs (lib/flair.ts, lib/visits.ts) rather than
// anything to draw as-is; the screen checks every one.
export interface TabletProfile {
  // Their display name: first name and last initial unless they chose one.
  name: string;
  // A sealed reference to their photo (lib/tablet-photo.ts), served by
  // /display/customer/photo/<ref>. Never the photo's stored address: that
  // holds the member id, which works like a password at the door.
  photo: string | null;
  // Their profile line; null while staff have it hidden.
  line: string | null;
  color: string | null; // flair color key, null: not picked
  entrance: string | null; // entrance effect key, null: classic
  badges: string[]; // earned badge keys, in the cabinet's order
  // What's still to do on their account's Profile tab ("Make it yours").
  // A line staff hid isn't asked for again.
  todo: { photo: boolean; line: boolean; flair: boolean };
  // "Spend points" (display/customer/SpendPoints.tsx): a sealed reference
  // to their account (lib/tablet-wallet.ts) the screen's reward actions
  // open, never the member id. Missing from an older register.
  wallet?: string;
  // What they show, of the perks they've unlocked (lib/rewards.ts): keys
  // into the screen's own lists.
  look?: { frame: string | null; nameColor: string | null; title: string | null; sound: string | null };
  // Every point they've ever earned: spending never lowers it.
  earned?: number;
}

// "reward-add" (tablet -> register) and "reward-added" (back): see
// lib/rewards.ts RewardAdd. "rewards-changed" (tablet -> register,
// { firstName }): a perk was unlocked, so the register looks their points
// and card up again.

export const EMPTY_CART_SNAPSHOT: RegisterCartSnapshot = { orderName: "", items: [], subtotal: 0, tax: 0, total: 0 };

// Staff setting up a guest's account on the register, for a guest who'd
// rather just tell them: the "New phone account" form (MemberFinder.tsx),
// or "+ Add name" / "+ Add email" on the member box (PosMemberPanel.tsx).
// The customer screen mirrors it as they type ("We're setting up your
// account"), so the guest can check it and tap "✓ That's right"
// ("staff-setup-ok" { id }, back to the register, which saves it). Only
// what's being typed, and only so much of it: the phone number, a first
// name and last initial, an email masked (maskEmail). Never a member id,
// never anything already on the account.
// "staff-setup": this, as they type (debounced) and once it's saved;
// "staff-setup-end" ({ id }): Cancel, the screen goes back to normal.
export interface StaffSetup {
  id: string; // this form, opened once
  stage: "typing" | "saved";
  what: "phone" | "name" | "email";
  phone?: string; // "(417) 555-01", as typed so far
  name?: string; // "Sarah M."
  email?: string; // "s•••@gmail.com"
  ready?: boolean; // what's typed could be saved: "✓ That's right" works
  hold?: boolean; // the register couldn't save it: staff are on it
}

// "Done" or "That's not me" under the member's card on the customer
// screen: off the order ("member-off", to the register). firstName: the
// one the screen shows (the cart's member.firstName), so a register that's
// moved on to someone else leaves them be.
export interface MemberOff {
  firstName: string;
  why: "done" | "not-me";
}

// Register → ✨ → Rickroll (pos/EasterEggs.tsx, display/customer/Rickroll.tsx):
// "rickroll" ({ play: true }) puts it on the customer screen and
// "rickroll-stop" takes it off. The screen answers every one with
// "rickroll-state" (this), and says so again when the clip ends by itself or
// someone taps ✕. The register's button changes only on this answer, from
// any screen that's listening.
export interface RickrollState {
  playing: boolean;
}

// "Charge card on file" (pos/PaymentModal.tsx): the guest says yes on the
// customer screen (display/customer/CardOnFileAsk.tsx) before their saved
// card is charged. "cof-ask" (this) puts the question up; the screen answers
// "cof-seen" ({ id }) at once, so the register knows it's there, and then
// "cof-answer" (CardOnFileAnswer). "cof-end" ({ id }): it's over (charged,
// declined, or staff cancelled), the question comes down.
// tipBaseCents: the reader's tip suggestions are figured on this; missing
// when the register isn't asking for a tip (already taken, or tips off).
export interface CardOnFileAsk {
  id: string;
  amountCents: number; // before any tip
  label: string; // "Visa ••4242"
  tipBaseCents?: number | null;
}

export interface CardOnFileAnswer {
  id: string;
  yes: boolean;
  tipCents: number;
}

// The reader's tip choices (pos/terminal-actions.ts askTipOnReader), so the
// customer screen offers the same ones.
export const TIP_PERCENTS = [15, 20, 25] as const;

export function parseCardOnFileAsk(p: unknown): CardOnFileAsk | null {
  if (!p || typeof p !== "object") return null;
  const a = p as Partial<CardOnFileAsk>;
  if (typeof a.id !== "string" || !a.id || a.id.length > 80) return null;
  if (typeof a.amountCents !== "number" || !Number.isInteger(a.amountCents) || a.amountCents <= 0) return null;
  const label = typeof a.label === "string" ? a.label.replace(/[^A-Za-z0-9 •.-]/g, "").slice(0, 40) : "";
  const base = typeof a.tipBaseCents === "number" && Number.isInteger(a.tipBaseCents) && a.tipBaseCents > 0 ? a.tipBaseCents : null;
  return { id: a.id, amountCents: a.amountCents, label: label || "your card", tipBaseCents: base };
}

export function parseCardOnFileAnswer(p: unknown): CardOnFileAnswer | null {
  if (!p || typeof p !== "object") return null;
  const a = p as Partial<CardOnFileAnswer>;
  if (typeof a.id !== "string" || !a.id || typeof a.yes !== "boolean") return null;
  const tip = typeof a.tipCents === "number" && Number.isInteger(a.tipCents) && a.tipCents >= 0 && a.tipCents <= 100_000 ? a.tipCents : 0;
  return { id: a.id, yes: a.yes, tipCents: a.yes ? tip : 0 };
}

// Mail providers shown whole; any other domain is masked like the name.
const COMMON_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "att.net",
  "sbcglobal.net",
  "comcast.net",
  "proton.me",
  "protonmail.com",
]);

// "sarah.miller@gmail.com" -> "s•••@gmail.com"; "sam@millerlaw.com" ->
// "s•••@m•••.com". As much as is typed so far: "sar" -> "s•••".
export function maskEmail(input: string): string {
  const t = input.trim().toLowerCase().slice(0, 254);
  if (!t) return "";
  const at = t.indexOf("@");
  const local = at < 0 ? t : t.slice(0, at);
  const head = local ? `${local[0]}•••` : "";
  if (at < 0) return head;
  const domain = t.slice(at + 1);
  if (!domain || COMMON_MAIL.has(domain)) return `${head}@${domain}`;
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot, dot + 8) : "";
  return `${head}@${domain[0]}•••${tld}`;
}

// "Sarah" and "Miller" -> "Sarah M.": a first name and last initial only.
export function setupName(first: string, last = ""): string {
  const f = first.trim().replace(/\s+/g, " ").slice(0, 40);
  const l = last.trim().charAt(0).toLocaleUpperCase();
  return f && l ? `${f} ${l}.` : f;
}
