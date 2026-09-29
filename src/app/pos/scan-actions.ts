"use server";

import { assertStaff } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { claimBooking, redeemScan as redeem, releaseBooking, ticketsForMemberToday } from "@/lib/ticket-scan";
import type { ClaimResult, DoorTicket, MemberScanned, ScanRefused, TicketScanned } from "@/lib/door-tickets";
import { getPosMember, type PosMember } from "./member-actions";

// The register's side of tickets at the door (lib/ticket-scan.ts): a
// scanned online ticket or member card, a member's tickets for today, and
// the one-tap Print on a check-in card. Staff-only, and each staff login
// gets a limited number of scans a minute: a real night at the door is a
// few a minute, while a script guessing codes would be thousands.
//
// Printing happens in the register's browser (door-print.ts), since that's
// what can reach the printer.

// With `member`, their register account, so the register can put them on
// the order like the member search would.
export type RegisterScan = ((TicketScanned | MemberScanned) & { member: PosMember | null }) | ScanRefused;

const BUSY = "Too many scans at once. Wait a minute, then try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function redeemScan(text: string): Promise<RegisterScan> {
  const staff = await assertStaff();
  if (typeof text !== "string" || text.length > 200) return { ok: false, kind: "unknown", reason: "invalid", error: "That isn't a Royale ticket or member card." };
  if (!(await allowAttempt(`door-scan:${staff.employeeId}`, 60, 60))) return { ok: false, kind: "unknown", reason: "busy", error: BUSY };
  const r = await redeem(text, staff.employeeId);
  if (!r.ok) return r;
  return { ...r, member: r.memberId ? await getPosMember(r.memberId) : null };
}

// For a check-in card's "🎟 2 tickets today · Print" line.
export async function getMemberTicketsToday(memberId: string): Promise<{ ok: true; tickets: DoorTicket[] } | { ok: false; error: string }> {
  await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return { ok: true, tickets: [] };
  try {
    return { ok: true, tickets: await ticketsForMemberToday(memberId) };
  } catch {
    return { ok: false, error: "Couldn't look up their tickets. Check the connection and try again." };
  }
}

// The one-tap Print: claims the booking's tickets (the same one-for-one
// rule as scanning its code), then the register prints the returned job.
export async function markTicketsPrinted(bookingId: string): Promise<ClaimResult> {
  const staff = await assertStaff();
  if (typeof bookingId !== "string" || !UUID.test(bookingId)) return { ok: false, kind: "ticket", reason: "not_found", error: "That booking isn't there anymore." };
  if (!(await allowAttempt(`door-scan:${staff.employeeId}`, 60, 60))) return { ok: false, kind: "ticket", reason: "busy", error: BUSY };
  return claimBooking(bookingId.toLowerCase(), staff.employeeId);
}

// The printer failed after a claim: give the claim back so the code can be
// scanned (or Print tapped) again. `scannedAt` is the claim's ticket.scannedAt;
// only that exact claim is undone.
export async function unmarkTicketsPrinted(bookingId: string, scannedAt: string): Promise<boolean> {
  const staff = await assertStaff();
  if (typeof bookingId !== "string" || !UUID.test(bookingId)) return false;
  if (typeof scannedAt !== "string" || Number.isNaN(Date.parse(scannedAt))) return false;
  return releaseBooking(bookingId.toLowerCase(), new Date(scannedAt).toISOString(), staff.employeeId);
}
