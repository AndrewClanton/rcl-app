import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { drawerXml } from "@/lib/print/receipt";
import { EXPIRY_MINUTES, hasDrawer, isOnline, seenLabel, STATION_LABEL, withoutDrawer, type PrintJobKind, type PrinterKind, type RegisterStation } from "@/lib/print/stations";

// The print queue's server side: which printer does what, and putting jobs
// in line for it. Printers collect their jobs from /api/print/poll.

export interface PrinterRow {
  id: string;
  name: string;
  location: string | null;
  kind: PrinterKind;
  login_id: string;
  receipt_station: RegisterStation | null;
  order_tickets: boolean;
  active: boolean;
  poll_interval_seconds: number;
  last_seen_at: string | null;
}

export const PRINTER_COLUMNS = "id, name, location, kind, login_id, receipt_station, order_tickets, active, poll_interval_seconds, last_seen_at";

export async function stationPrinter(station: RegisterStation): Promise<PrinterRow | null> {
  const { data } = await createAdminClient().from("printers").select(PRINTER_COLUMNS).eq("active", true).eq("receipt_station", station).maybeSingle();
  return (data as PrinterRow | null) ?? null;
}

export async function kitchenPrinter(): Promise<PrinterRow | null> {
  const { data } = await createAdminClient().from("printers").select(PRINTER_COLUMNS).eq("active", true).eq("order_tickets", true).maybeSingle();
  return (data as PrinterRow | null) ?? null;
}

export const printerOnline = (p: Pick<PrinterRow, "last_seen_at" | "poll_interval_seconds">) => isOnline(p.last_seen_at, p.poll_interval_seconds);

// Why a register can't print to its station right now, in words for the
// person at it; null when it can.
export function stationProblem(station: RegisterStation, p: PrinterRow | null): string | null {
  const label = STATION_LABEL[station];
  if (!p) return `No ${label} printer is set up yet. A manager can add one under Back office → Printers. Until then, switch this register to "Print straight to a printer IP" under Devices.`;
  if (!p.last_seen_at) return `The ${label} printer (${p.name}) hasn't connected to the website yet. Check its Server Direct Print settings (Back office → Printers).`;
  if (!printerOnline(p)) return `The ${label} printer (${p.name}) is offline: ${seenLabel(p.last_seen_at, p.poll_interval_seconds).toLowerCase()}. Check that it's on and connected.`;
  return null;
}

export interface NewJob {
  kind: PrintJobKind;
  xml: string;
  label?: string | null;
  orderId?: string | null;
  notBefore?: Date; // held until then (a tab's kitchen ticket, while it's still being rung)
}

// A receipt that opens the drawer goes in as two jobs: the drawer kick
// first, on its own short clock, then the receipt with no kick in it. So a
// receipt retried or reprinted later never pops the drawer.
export function splitDrawer(job: NewJob): NewJob[] {
  if (job.kind !== "receipt" || !hasDrawer(job.xml)) return [job];
  return [
    { ...job, kind: "drawer", xml: drawerXml(), label: job.label ? `Drawer (${job.label})` : "Drawer" },
    { ...job, xml: withoutDrawer(job.xml) },
  ];
}

// In line for `printerId`, in this order. Returns the new job ids.
export async function enqueueJobs(printerId: string, jobs: NewJob[], createdBy: string | null = null): Promise<string[]> {
  if (!jobs.length) return [];
  const now = Date.now();
  const rows = jobs.map((j) => {
    // Ready now means a few seconds ago, so this server's clock running a
    // little ahead of the database's can't hold a job back.
    const start = j.notBefore && j.notBefore.getTime() > now ? j.notBefore.getTime() : now - 5000;
    return {
      printer_id: printerId,
      kind: j.kind,
      label: j.label ?? null,
      xml: j.xml,
      order_id: j.orderId ?? null,
      not_before: new Date(start).toISOString(),
      expires_at: new Date(Math.max(start, now) + EXPIRY_MINUTES[j.kind] * 60_000).toISOString(),
      created_by: createdBy,
    };
  });
  // One insert keeps them in order (seq) and all-or-nothing.
  const { data, error } = await createAdminClient().from("print_jobs").insert(rows).select("id, seq");
  if (error) throw new Error(`print jobs not queued: ${error.message}`);
  return ((data ?? []) as { id: string; seq: number }[]).sort((a, b) => a.seq - b.seq).map((r) => r.id);
}
