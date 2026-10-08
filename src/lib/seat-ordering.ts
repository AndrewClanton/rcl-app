import { CLOSED_WEEKDAYS } from "@/lib/closed-days";

// Order from your seat: guests scan the QR card at their spot, order on
// their phone and pay there; the order lands on the bar and kitchen boards
// with the spot in big letters. Plain values only (no server imports): the
// phone page, the boards, the register and Back office all use these.
// The server side is lib/seat-ordering-server.ts.

export type SpotKind = "booth" | "cinema" | "patio" | "table";
export const SPOT_KINDS: SpotKind[] = ["booth", "cinema", "patio", "table"];
export const SPOT_KIND_LABEL: Record<SpotKind, string> = { booth: "Booth", cinema: "Cinema", patio: "Patio", table: "Table" };

export interface OrderSpot {
  id: string;
  kind: SpotKind;
  name: string;
  code: string;
  dark: boolean;
  active: boolean;
  sort_order: number;
  code_rotated_at: string | null;
}

export interface SeatSettings {
  enabled: boolean;
  opens: string; // "16:00", Central
  closes: string; // "23:30"; earlier than opens means after midnight
}

export type SeatStatus = "new" | "making" | "delivered";

// What the guest's page says for each step.
export const GUEST_STATUS: Record<SeatStatus, { title: string; sub: string }> = {
  new: { title: "Order received", sub: "We've got it. It's next up." },
  making: { title: "We're making it", sub: "Sit tight." },
  delivered: { title: "Delivered — enjoy", sub: "Want anything else? Order more any time." },
};

export const PAUSED_MESSAGE = "Ordering from your seat is paused. Please order at the counter.";

// The big line on a board ticket: "BOOTH 3", "CINEMA · ROW C".
export function boardLabel(spotName: string | null | undefined): string {
  return (spotName ?? "Seat order").toUpperCase();
}

// A board ticket's seat-order part (lib/data/prepTickets.ts): read from the
// order's columns. Null for a register order.
export interface SeatTicket {
  spot: string;
  status: SeatStatus;
  idCheck: boolean;
  note: string | null;
}
export type SeatOrderCols = { source?: string | null; spot_name?: string | null; seat_status?: string | null; id_check?: boolean | null; seat_note?: string | null };
export function seatTicketOf(o: SeatOrderCols | null | undefined): SeatTicket | null {
  if (!o || o.source !== "mobile") return null;
  const status: SeatStatus = o.seat_status === "making" || o.seat_status === "delivered" ? o.seat_status : "new";
  return { spot: o.spot_name ?? "Seat order", status, idCheck: !!o.id_check, note: o.seat_note ?? null };
}

// Tips, as a share of what the order comes to before tax.
export const TIP_CHOICES = [0, 15, 20, 25] as const;
export type TipChoice = (typeof TIP_CHOICES)[number];
export const isTipChoice = (v: unknown): v is TipChoice => TIP_CHOICES.includes(v as TipChoice);

// What a guest can order from a seat: food and drinks, not tickets, VHS
// rentals or merch.
export const SEAT_CATEGORY_KEYS = new Set(["grub", "rad", "sweet", "caffe", "spirits", "beer", "wine", "cocktails", "shots"]);

export const MAX_LINES = 30;
export const MAX_QTY = 20;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (v: unknown): v is string => typeof v === "string" && HHMM.test(v);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// "4:00 PM"
export function clockLabel(hhmm: string): string {
  const m = minutesOf(hhmm);
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function central(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { minutes: Number(p.hour) * 60 + Number(p.minute), dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday as string) };
}

// Whether a phone can order right now, and why not. Off by the switch,
// outside the hours, or on a closed day. A night that runs past midnight
// (closes earlier than it opens) belongs to the day it started, so
// Saturday's late hours still count and Sunday's don't start.
export type OpenState = { open: true } | { open: false; reason: "off" | "hours" | "closed-day" };
export function seatOrderingOpen(s: SeatSettings, now = new Date()): OpenState {
  if (!s.enabled) return { open: false, reason: "off" };
  if (!isClock(s.opens) || !isClock(s.closes)) return { open: false, reason: "hours" };
  const c = central(now);
  const opens = minutesOf(s.opens);
  const closes = minutesOf(s.closes);
  let day = c.dow;
  let inside: boolean;
  if (closes > opens) inside = c.minutes >= opens && c.minutes < closes;
  else if (c.minutes >= opens) inside = true;
  else if (c.minutes < closes) {
    inside = true;
    day = (day + 6) % 7; // after midnight: the night before
  } else inside = false;
  if (!inside) return { open: false, reason: "hours" };
  if (CLOSED_WEEKDAYS.includes(day)) return { open: false, reason: "closed-day" };
  return { open: true };
}

// For staff: why it's off right now, in a few words.
export function openStateLabel(s: SeatSettings, state: OpenState): string {
  if (state.open) return `On until ${clockLabel(s.closes)}`;
  if (state.reason === "off") return "Off";
  if (state.reason === "closed-day") return "Off: closed today";
  return `Switched on, but outside ${clockLabel(s.opens)} to ${clockLabel(s.closes)}`;
}

// A new random code for a spot's link: 10 lowercase letters and digits.
export function newSpotCode(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const isSpotCode = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{8,16}$/.test(v);

// ---------- the phone's cart, as sent to the server ----------
// Ids only: the server prices everything from the menu.
export interface CartLineInput {
  itemId: string;
  optionIds: string[];
  qty: number;
}

export interface SeatTotals {
  subtotal: number;
  dailyPerk: number;
  memberDiscount: number;
  tax: number;
  tip: number;
  total: number; // with tax and tip
  points: number; // what it earns a signed-in member
}
