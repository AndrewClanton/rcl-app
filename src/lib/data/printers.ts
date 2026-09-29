import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOnline, seenLabel, type PrintJobKind, type PrintJobStatus, type PrinterKind, type RegisterStation } from "@/lib/print/stations";

// Back office -> Printers: every printer with how it's doing, and the
// latest print jobs. Never includes a job's XML (it has customers' names)
// or a printer's password hashes.

export interface PrinterOverview {
  id: string;
  name: string;
  location: string | null;
  kind: PrinterKind;
  loginId: string;
  receiptStation: RegisterStation | null;
  orderTickets: boolean;
  active: boolean;
  pollInterval: number;
  online: boolean;
  seen: string; // "Online", "Last seen 3 min ago", "Never connected"
  reportedName: string | null;
  queued: number;
  failed: number; // last 24 hours
  expired: number; // last 24 hours
}

export interface PrintJobRow {
  id: string;
  printerId: string;
  printerName: string;
  kind: PrintJobKind;
  label: string | null;
  status: PrintJobStatus;
  attempts: number;
  createdAt: string;
  doneAt: string | null;
  error: string | null;
}

export async function getPrintersOverview(): Promise<{ printers: PrinterOverview[]; jobs: PrintJobRow[] }> {
  const db = createAdminClient();
  // Expire what's overdue first, so the counts are true right now.
  await db.rpc("sweep_print_jobs");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: printers, error }, { data: counts }, { data: jobs }] = await Promise.all([
    db.from("printers").select("id, name, location, kind, login_id, receipt_station, order_tickets, active, poll_interval_seconds, last_seen_at, reported_name").order("created_at"),
    db.from("print_jobs").select("printer_id, status").or(`status.in.(queued,sent),and(status.in.(failed,expired),created_at.gte."${since}")`).limit(5000),
    db.from("print_jobs").select("id, printer_id, kind, label, status, attempts, created_at, done_at, error").order("created_at", { ascending: false }).limit(60),
  ]);
  if (error) throw error;

  const tally = new Map<string, { queued: number; failed: number; expired: number }>();
  for (const c of (counts ?? []) as { printer_id: string; status: string }[]) {
    const t = tally.get(c.printer_id) ?? { queued: 0, failed: 0, expired: 0 };
    if (c.status === "queued" || c.status === "sent") t.queued++;
    else if (c.status === "failed") t.failed++;
    else if (c.status === "expired") t.expired++;
    tally.set(c.printer_id, t);
  }

  type P = {
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
    reported_name: string | null;
  };
  const list = ((printers ?? []) as P[]).map((p) => ({
    id: p.id,
    name: p.name,
    location: p.location,
    kind: p.kind,
    loginId: p.login_id,
    receiptStation: p.receipt_station,
    orderTickets: p.order_tickets,
    active: p.active,
    pollInterval: p.poll_interval_seconds,
    online: isOnline(p.last_seen_at, p.poll_interval_seconds),
    seen: seenLabel(p.last_seen_at, p.poll_interval_seconds),
    reportedName: p.reported_name,
    ...(tally.get(p.id) ?? { queued: 0, failed: 0, expired: 0 }),
  }));
  const names = new Map(list.map((p) => [p.id, p.name]));

  type J = { id: string; printer_id: string; kind: PrintJobKind; label: string | null; status: PrintJobStatus; attempts: number; created_at: string; done_at: string | null; error: string | null };
  return {
    printers: list,
    jobs: ((jobs ?? []) as J[]).map((j) => ({
      id: j.id,
      printerId: j.printer_id,
      printerName: names.get(j.printer_id) ?? "Removed printer",
      kind: j.kind,
      label: j.label,
      status: j.status,
      attempts: j.attempts,
      createdAt: j.created_at,
      doneAt: j.done_at,
      error: j.error,
    })),
  };
}
