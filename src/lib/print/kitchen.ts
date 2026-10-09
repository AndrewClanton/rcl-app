import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderTicketXml } from "@/lib/print/receipt";
import { addLines, newLines, readLines, subtractLines, tallyLines, type TicketLine } from "@/lib/print/order-lines";
import { enqueueJobs, kitchenPrinter } from "@/lib/print/queue";
import { asStation, type RegisterStation } from "@/lib/print/stations";
import { isGiftCardLine } from "@/lib/register-totals";

// Kitchen order tickets. Every order prints one ticket with the whole order
// on it; a tab prints its first ticket like any order, then only what's
// added after that, as ADD-ON tickets under the same number. Both registers'
// orders print on the one kitchen printer. With no kitchen printer set up,
// none of this does anything.
//
// Never throws: it runs inside a sale or a tab save, and a printer problem
// must never look like a failed sale.

// A tab's ticket waits this long after the last change before it prints, so
// a bartender ringing a round doesn't print a ticket per tap (each save
// replaces the waiting ticket with one holding everything new). It never
// waits longer than MAX_HOLD in all, and prints at once when the tab is put
// away or paid.
const HOLD_SECONDS = 30;
const MAX_HOLD_SECONDS = 90;

export interface KitchenOrder {
  orderId: string;
  orderNumber: number;
  name: string | null;
  tab: boolean;
  station: RegisterStation | null;
  // The order as it stands now. Movie tickets (screening_id) aren't food
  // and are left off.
  lines: { name: string; quantity: number; modifiers: string[]; screening_id?: string | null }[];
}

type State = {
  register_station: string | null;
  sent: unknown;
  tickets: number;
  pending_job_id: string | null;
  pending: unknown;
  pending_since: string | null;
};

const itemsOf = (lines: KitchenOrder["lines"]): TicketLine[] =>
  // Gift cards sold (isGiftCardLine) aren't food either.
  tallyLines(lines.filter((l) => !l.screening_id && !isGiftCardLine(l)).map((l) => ({ name: l.name, qty: l.quantity, mods: l.modifiers ?? [] })));

// "hold": a tab being rung up (wait a moment for more). "now": the order is
// paid, or the tab was put away.
export async function sendKitchenTicket(order: KitchenOrder, when: "hold" | "now"): Promise<void> {
  try {
    const printer = await kitchenPrinter();
    if (!printer) return;
    const db = createAdminClient();
    const { data: stateRow } = await db
      .from("order_ticket_state")
      .select("register_station, sent, tickets, pending_job_id, pending, pending_since")
      .eq("order_id", order.orderId)
      .maybeSingle();
    const state = stateRow as State | null;

    let sent = readLines(state?.sent);
    let tickets = state?.tickets ?? 0;
    let pendingSince = state?.pending_since ?? null;

    // A ticket still waiting to print is taken back and folded into this
    // one. If the printer already has it, it stays sent.
    let pulledBack = false;
    if (state?.pending_job_id) {
      const { data: pulled } = await db.from("print_jobs").delete().eq("id", state.pending_job_id).eq("status", "queued").select("id");
      if (pulled?.length) {
        pulledBack = true;
        sent = subtractLines(sent, readLines(state.pending));
        tickets = Math.max(0, tickets - 1);
      } else pendingSince = null;
    } else pendingSince = null;

    const added = newLines(itemsOf(order.lines), sent);
    const station = order.station ?? asStation(state?.register_station);
    if (!added.length) {
      // Nothing new. Either the held ticket's items came off again before it
      // printed, or the held ticket has since printed: note that.
      if (pulledBack || state?.pending_job_id) await db.from("order_ticket_state").update({ sent, tickets, pending_job_id: null, pending: [], pending_since: null, updated_at: new Date().toISOString() }).eq("order_id", order.orderId);
      return;
    }

    const now = Date.now();
    const since = pendingSince ? new Date(pendingSince).getTime() : now;
    const notBefore = when === "now" ? new Date(now) : new Date(Math.min(now + HOLD_SECONDS * 1000, since + MAX_HOLD_SECONDS * 1000));
    const kind = tickets === 0 ? "order" : "addon";
    const xml = orderTicketXml({ orderNumber: order.orderNumber, name: order.name, tab: order.tab, station, at: new Date(now).toISOString(), kind, lines: added });
    const [jobId] = await enqueueJobs(printer.id, [
      { kind: "order_ticket", xml, orderId: order.orderId, notBefore, label: `Kitchen #${order.orderNumber}${kind === "addon" ? " add-on" : ""}` },
    ]);

    const held = when === "hold";
    const { error } = await db.from("order_ticket_state").upsert({
      order_id: order.orderId,
      register_station: station,
      sent: addLines(sent, added),
      tickets: tickets + 1,
      pending_job_id: held ? jobId : null,
      pending: held ? added : [],
      pending_since: held ? new Date(since).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    });
    if (error) console.error("kitchen ticket state not saved", order.orderId, error.message);
  } catch (e) {
    console.error("kitchen ticket not queued", order.orderId, e);
  }
}

export type ReprintResult = { ok: true; message: string } | { ok: false; error: string };

// The kitchen board's "Reprint ticket": the whole order as it stands,
// marked REPRINT, right away.
export async function reprintKitchenTicket(orderId: string, createdBy: string | null): Promise<ReprintResult> {
  const printer = await kitchenPrinter();
  if (!printer) return { ok: false, error: "No kitchen printer is set up. A manager can add one under Back office → Printers." };
  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, order_number, order_name, tab_name, status, created_at, completed_at, items:order_items(name, quantity, modifiers, screening_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "That order isn't there anymore." };
  const { data: state } = await db.from("order_ticket_state").select("register_station").eq("order_id", orderId).maybeSingle();
  const items = itemsOf((order.items ?? []) as KitchenOrder["lines"]);
  if (!items.length) return { ok: false, error: "That order has nothing for the kitchen." };
  const xml = orderTicketXml({
    orderNumber: Number(order.order_number),
    name: order.tab_name || order.order_name || null,
    tab: !!order.tab_name,
    station: asStation(state?.register_station),
    at: order.completed_at ?? order.created_at,
    kind: "reprint",
    lines: items,
    printedAt: new Date().toISOString(),
  });
  try {
    await enqueueJobs(printer.id, [{ kind: "order_ticket", xml, orderId, label: `Kitchen #${order.order_number} reprint` }], createdBy);
  } catch (e) {
    console.error("kitchen reprint not queued", orderId, e);
    return { ok: false, error: "Couldn't send the reprint. Try again." };
  }
  return { ok: true, message: `Ticket #${order.order_number} sent to ${printer.name}.` };
}
