// Tickets at the door: what the register gets back when it scans an online
// ticket's QR (lib/ticket-code.ts) or a member card, and what it can pass on
// to the customer screen. No server imports, so the register and the
// customer screen can use these types and helpers too. The work itself is
// in lib/ticket-scan.ts; the register's actions are in app/pos/scan-actions.ts.

import type { RewardKind, VisitResult } from "@/lib/visits";
import { REWARD_LABEL } from "@/lib/visits";

// The number an online booking goes by: on its receipt in the account, and
// as the order on its printed keepsake tickets. (Register sales use their
// order number instead.)
export function bookingNumber(bookingId: string): string {
  return `T-${bookingId.slice(0, 8).toUpperCase()}`;
}

// One booking's tickets, as the register sees them.
export interface DoorTicket {
  bookingId: string;
  number: string; // "T-1A2B3C4D", see bookingNumber()
  screeningId: string;
  title: string;
  posterUrl: string | null;
  startsAt: string; // ISO
  room: string;
  quantity: number;
  firstName: string | null; // from the name on the booking
  scannedAt: string | null; // when its tickets were printed at the door
  // Bought at the register: its tickets printed with that sale, so there's
  // nothing to print at the door (Recent orders can reprint them).
  atRegister: boolean;
  printable: boolean; // not printed yet, and not a register sale
  code: string; // what its QR code holds (RCLT:...)
}

// Exactly what printTickets() (app/pos/print-tickets.ts) takes after the
// printer address.
export interface TicketPrintJob {
  orderNumber: string;
  sales: { screeningId: string; qty: number }[];
}

export function printJobFor(t: Pick<DoorTicket, "number" | "screeningId" | "quantity">): TicketPrintJob {
  return { orderNumber: t.number, sales: [{ screeningId: t.screeningId, qty: t.quantity }] };
}

export type ScanRefusal =
  | "invalid" // not one of our codes, or its signature is wrong
  | "not_found" // a real code, but the booking is gone
  | "already_scanned" // printed once already (one-for-one)
  | "refunded"
  | "cancelled"
  | "unpaid" // checkout never finished (or its payment hasn't landed yet)
  | "at_register" // bought at the register, printed with that sale
  | "not_today" // for a showing outside today and tomorrow
  | "unknown_member" // a member card for an account that's gone
  | "busy" // rate limit
  | "offline" // the database couldn't be reached
  | "needs_update"; // the door-ticket migration isn't applied yet

export type ScanRefused = {
  ok: false;
  kind: "ticket" | "member" | "unknown";
  reason: ScanRefusal;
  error: string; // for staff, ready to show as is
  ticket?: DoorTicket; // the booking it was about, when there is one
};

// A ticket code scanned and claimed: print `print` now. The claim is
// already saved, so the same code won't print twice.
export type TicketScanned = {
  ok: true;
  kind: "ticket";
  ticket: DoorTicket;
  print: TicketPrintJob;
  memberId: string | null;
  visit: VisitResult | null; // today's check-in, when the booking has a member
};

// A member card scanned: they're checked in for today.
export type MemberScanned = {
  ok: true;
  kind: "member";
  memberId: string;
  firstName: string;
  points: number; // balance after any visit points
  visit: VisitResult | null; // null if the visit couldn't be saved
  tickets: DoorTicket[]; // their tickets for today, see ticketsForMemberToday
};

export type ScanResult = TicketScanned | MemberScanned | ScanRefused;

// A booking's tickets claimed for printing: by a ticket scan, or the one-tap
// Print on a member's check-in card.
export type ClaimResult = { ok: true; ticket: DoorTicket; print: TicketPrintJob; memberId: string | null } | ScanRefused;

// "Sam checked in: +15 points, day 3 in a row. Free popcorn!" for a toast.
export function visitLine(firstName: string, visit: VisitResult | null): string {
  if (!visit) return `${firstName} is here, but the check-in didn't save. Check them in from their card.`;
  if (visit.alreadyToday) return `${firstName} already checked in today.`;
  const reward: RewardKind | null = visit.reward;
  return `${firstName} checked in: +${visit.earned} points, day ${visit.streak} in a row.${reward ? ` ${REWARD_LABEL[reward]}!` : ""}`;
}

// ---------- the customer screen ----------
// What the register can send the customer screen after a check-in, for
// "Your tickets tonight". Never booking ids or codes: the screen's channel
// can be listened to by anyone who learns its name, so a code on it could
// be copied and printed first.

export interface TabletTicket {
  title: string;
  posterUrl: string | null;
  startsAt: string; // ISO
  room: string;
  quantity: number;
  // to_print: the counter can print them now. printed: they have paper
  // tickets already (printed at the door, or with a register sale).
  status: "to_print" | "printed";
}

export interface CheckinTickets {
  id: string; // the check-in request's id, like the other check-in events
  firstName: string;
  tickets: TabletTicket[];
}

export function tabletTickets(tickets: DoorTicket[]): TabletTicket[] {
  return tickets.map((t) => ({
    title: t.title,
    posterUrl: t.posterUrl,
    startsAt: t.startsAt,
    room: t.room,
    quantity: t.quantity,
    status: t.printable ? "to_print" : "printed",
  }));
}
