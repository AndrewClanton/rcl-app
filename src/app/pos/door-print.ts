import { printTickets } from "./print-tickets";
import { markTicketsPrinted, redeemScan, unmarkTicketsPrinted, type RegisterScan } from "./scan-actions";
import { visitLine, type DoorTicket, type TicketPrintJob } from "@/lib/door-tickets";
import type { PrintTarget } from "./printing";

// Tickets at the door, in the register's browser: a scan (useScanner.ts)
// or a tap goes to the server to claim the tickets (scan-actions.ts), then
// the keepsake tickets print on this register's printer (straight to it, or
// through the website's print queue; see printing.ts). If the printer
// fails, the claim is given back, so scanning again once the printer's
// sorted out still works. A job still in the queue (retrying after, say,
// paper out) keeps its claim: it will print, and a rescan mustn't print it
// twice.

const count = (n: number) => `${n} ticket${n === 1 ? "" : "s"}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

async function printClaimed(target: PrintTarget, ticket: DoorTicket, print: TicketPrintJob): Promise<{ ok: true } | { ok: false; error: string; queued?: boolean }> {
  const r = await printTickets(target, print.orderNumber, print.sales);
  if (r.ok) return { ok: true };
  if (ticket.scannedAt && !r.queued) await unmarkTicketsPrinted(ticket.bookingId, ticket.scannedAt).catch(() => false);
  return { ok: false, error: r.error, queued: r.queued };
}

// The one-tap Print on a check-in card (a ticket from getMemberTicketsToday).
export async function printDoorTickets(target: PrintTarget | null, bookingId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!target) return { ok: false, error: "No printer is set up on this register. Add it under Devices, then tap Print again." };
  const claim = await markTicketsPrinted(bookingId);
  if (!claim.ok) return { ok: false, error: claim.error };
  const printed = await printClaimed(target, claim.ticket, claim.print);
  if (!printed.ok) return { ok: false, error: printed.queued ? `The tickets are waiting at the printer: ${printed.error}` : `The tickets didn't print: ${printed.error} They're still good; tap Print again once the printer's ready.` };
  return { ok: true, message: `Printed ${count(claim.ticket.quantity)} for ${claim.ticket.title}, ${time(claim.ticket.startsAt)}.` };
}

export interface DoorScanOutcome {
  scan: RegisterScan | null; // null: not sent (no printer for a ticket)
  message: string; // one line for a toast
  printed: boolean;
}

// Everything a scan does, for PosApp: redeem it, print a ticket's keepsakes
// right away, and say what happened in one line.
export async function handleDoorScan(text: string, target: PrintTarget | null): Promise<DoorScanOutcome> {
  // A ticket code is only claimed where it can print, so a register with
  // no printer doesn't use up someone's tickets.
  if (/^RCLT:/i.test(text.trim()) && !target) {
    return { scan: null, printed: false, message: "No printer is set up on this register, so the ticket wasn't used. Scan it at the register with the printer." };
  }
  let scan: RegisterScan;
  try {
    scan = await redeemScan(text);
  } catch {
    return { scan: null, printed: false, message: "Couldn't check that code. Check the connection and try again." };
  }
  if (!scan.ok) return { scan, printed: false, message: scan.error };

  if (scan.kind === "member") {
    const ready = scan.tickets.filter((t) => t.printable);
    const tickets = ready.length ? ` ${count(ready.reduce((s, t) => s + t.quantity, 0))} to print for today: tap Print on their card.` : "";
    return { scan, printed: false, message: `${visitLine(scan.firstName, scan.visit)}${tickets}` };
  }

  const t = scan.ticket;
  if (!target) return { scan, printed: false, message: "No printer is set up on this register." };
  const printed = await printClaimed(target, t, scan.print);
  if (!printed.ok) return { scan, printed: false, message: printed.queued ? `The tickets are waiting at the printer: ${printed.error}` : `The tickets didn't print: ${printed.error} They're still good; scan again once the printer's ready.` };
  const who = t.firstName ? ` for ${t.firstName}` : "";
  const visit = scan.visit && scan.member ? ` ${visitLine(t.firstName ?? scan.member.name.split(" ")[0], scan.visit)}` : "";
  return { scan, printed: true, message: `🎟 Printed ${count(t.quantity)}${who}: ${t.title}, ${time(t.startsAt)}, ${t.room}.${visit}` };
}
