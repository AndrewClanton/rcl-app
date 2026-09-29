"use server";

import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { enqueueJobs, printerOnline, splitDrawer, stationPrinter, stationProblem, type NewJob } from "@/lib/print/queue";
import { asStation, isEposDocument, REGISTER_KINDS, seenLabel, type PrintJobKind, type PrintJobStatus } from "@/lib/print/stations";

// The register's side of the print queue, for a device set to "Print through
// the website": the register builds a receipt or tickets exactly as before
// (lib/print/receipt.ts) and hands the finished ePOS-Print XML here; it goes
// in line for this register's station printer (Bar or Outdoor stand), which
// collects it from /api/print/poll.

export type QueueResult = { ok: true; jobIds: string[]; printer: string } | { ok: false; error: string };

const MAX_DOC = 300_000; // one ticket with its poster is about 40 KB
const MAX_TOTAL = 2_000_000;

export async function queueStationPrint(input: { station: string; kind: string; xmls: string[]; label?: string | null }): Promise<QueueResult> {
  const staff = await assertStaff();
  const station = asStation(input.station);
  const kind = input.kind as PrintJobKind;
  if (!station || !REGISTER_KINDS.includes(kind)) return { ok: false, error: "That isn't something the register can print." };
  const xmls = Array.isArray(input.xmls) ? input.xmls : [];
  if (!xmls.length || xmls.length > 20) return { ok: false, error: "Nothing to print." };
  let total = 0;
  for (const x of xmls) {
    if (typeof x !== "string" || x.length > MAX_DOC || !isEposDocument(x)) return { ok: false, error: "That print job doesn't look right." };
    total += x.length;
  }
  if (total > MAX_TOTAL) return { ok: false, error: "That's too much to print at once." };
  if (!(await allowAttempt(`print-queue:${staff.employeeId}`, 40, 60))) return { ok: false, error: "Too many prints in a minute. Wait a moment and try again." };

  const printer = await stationPrinter(station);
  const problem = stationProblem(station, printer);
  if (problem || !printer) return { ok: false, error: problem ?? "No printer." };

  const label = typeof input.label === "string" ? input.label.slice(0, 80) : null;
  const jobs: NewJob[] = xmls.flatMap((xml) => splitDrawer({ kind, xml, label }));
  try {
    const jobIds = await enqueueJobs(printer.id, jobs, staff.employeeId);
    return { ok: true, jobIds, printer: printer.name };
  } catch (e) {
    console.error("station print not queued", e);
    return { ok: false, error: "Couldn't send that to the printer. Check the connection and try again." };
  }
}

export interface JobStatus {
  id: string;
  status: PrintJobStatus;
  error: string | null;
  attempts: number;
}

// Where the register's own jobs are up to, while it waits to say "printed".
export async function getPrintJobStatus(ids: string[]): Promise<JobStatus[]> {
  await assertStaff();
  const clean = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  if (!clean.length) return [];
  const { data } = await createAdminClient().from("print_jobs").select("id, status, error, attempts").in("id", clean);
  return (data ?? []) as JobStatus[];
}

export type StationPrinterStatus = { set: false } | { set: true; name: string; online: boolean; seen: string };

// For the Devices panel: is there a printer for this station, and is it on?
export async function getStationPrinterStatus(stationInput: string): Promise<StationPrinterStatus> {
  await assertStaff();
  const station = asStation(stationInput);
  const p = station ? await stationPrinter(station) : null;
  if (!p) return { set: false };
  return { set: true, name: p.name, online: printerOnline(p), seen: seenLabel(p.last_seen_at, p.poll_interval_seconds) };
}
