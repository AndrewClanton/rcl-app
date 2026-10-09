"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPrinterPassword, newLoginId, newPrinterPassword } from "@/lib/print/printer-auth";
import { enqueueJobs, stationPrinter, stationProblem } from "@/lib/print/queue";
import { savePatternSettings } from "@/lib/print/pattern-settings";
import { testPageXml } from "@/lib/print/receipt";
import { parsePatternSettings, PATTERN_DESIGNS, type PatternSettings } from "@/lib/print/receipt-patterns";
import { asStation, hasDrawer, isEposDocument, withoutDrawer, type PrintJobKind, type RegisterStation } from "@/lib/print/stations";

// Back office -> Printers (managers and up): add a printer and get the
// settings to type into it, say what each printer prints, test it, and
// reprint jobs that didn't make it.

type Result = { ok: true } | { ok: false; error: string };
export type Credentials = { ok: true; id: string; loginId: string; password: string } | { ok: false; error: string };

export interface PrinterFields {
  name: string;
  location: string;
  receiptStation: string | null; // "bar" | "outdoor" | null
  orderTickets: boolean;
  pollInterval: number;
}

function clean(f: PrinterFields): { ok: true; row: { name: string; location: string | null; receipt_station: RegisterStation | null; order_tickets: boolean; poll_interval_seconds: number } } | { ok: false; error: string } {
  const name = (f.name ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the printer a name, like \"Kitchen printer\"." };
  const interval = Math.round(Number(f.pollInterval));
  if (!Number.isFinite(interval) || interval < 2 || interval > 60) return { ok: false, error: "The interval should be between 2 and 60 seconds." };
  return {
    ok: true,
    row: { name, location: (f.location ?? "").trim().slice(0, 80) || null, receipt_station: asStation(f.receiptStation), order_tickets: !!f.orderTickets, poll_interval_seconds: interval },
  };
}

// One printer per job: giving this printer the Bar receipts (say) takes
// them off whichever printer had them.
async function claimRoles(id: string, row: { receipt_station: RegisterStation | null; order_tickets: boolean }) {
  const db = createAdminClient();
  if (row.receipt_station) await db.from("printers").update({ receipt_station: null }).eq("receipt_station", row.receipt_station).neq("id", id);
  if (row.order_tickets) await db.from("printers").update({ order_tickets: false }).eq("order_tickets", true).neq("id", id);
}

function revalidate() {
  revalidatePath("/admin/printers");
}

export async function createPrinter(input: PrinterFields & { kind: string }): Promise<Credentials> {
  const staff = await assertManager();
  const c = clean(input);
  if (!c.ok) return c;
  const kind = input.kind === "relay" ? "relay" : "sdp";
  const loginId = newLoginId();
  const password = newPrinterPassword();
  const db = createAdminClient();
  const { data, error } = await db
    .from("printers")
    .insert({ ...c.row, receipt_station: null, order_tickets: false, kind, login_id: loginId, ...hashPrinterPassword(loginId, password), created_by: staff.employeeId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("printer not added", error?.message);
    return { ok: false, error: "Couldn't add the printer. Try again." };
  }
  await claimRoles(data.id, c.row);
  await db.from("printers").update({ receipt_station: c.row.receipt_station, order_tickets: c.row.order_tickets }).eq("id", data.id);
  revalidate();
  return { ok: true, id: data.id, loginId, password };
}

export async function updatePrinter(id: string, input: PrinterFields & { active: boolean }): Promise<Result> {
  await assertManager();
  const c = clean(input);
  if (!c.ok) return c;
  const active = !!input.active;
  const row = active ? c.row : { ...c.row, receipt_station: null, order_tickets: false };
  if (active) await claimRoles(id, row);
  const { error } = await createAdminClient().from("printers").update({ ...row, active }).eq("id", id);
  if (error) {
    console.error("printer not saved", error.message);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidate();
  return { ok: true };
}

// A new password (the old one stops working at once), shown once.
export async function resetPrinterPassword(id: string): Promise<Credentials> {
  await assertManager();
  const db = createAdminClient();
  const { data: p } = await db.from("printers").select("id, login_id").eq("id", id).maybeSingle();
  if (!p) return { ok: false, error: "That printer isn't there anymore." };
  const password = newPrinterPassword();
  const { error } = await db.from("printers").update(hashPrinterPassword(p.login_id, password)).eq("id", id);
  if (error) return { ok: false, error: "Couldn't change the password. Try again." };
  revalidate();
  return { ok: true, id, loginId: p.login_id, password };
}

// Gone for good, with its print jobs.
export async function removePrinter(id: string): Promise<Result> {
  await assertManager();
  const { error } = await createAdminClient().from("printers").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  revalidate();
  return { ok: true };
}

export async function testPrinter(id: string): Promise<Result> {
  const staff = await assertManager();
  const { data: p } = await createAdminClient().from("printers").select("id, active").eq("id", id).maybeSingle();
  if (!p?.active) return { ok: false, error: "That printer is turned off here. Turn it on first." };
  try {
    await enqueueJobs(id, [{ kind: "test", xml: testPageXml(new Date().toISOString()), label: "Test page (Printers)" }], staff.employeeId);
  } catch {
    return { ok: false, error: "Couldn't send the test page. Try again." };
  }
  revalidate();
  return { ok: true };
}

// A failed or expired job, again, on the same printer. Never a drawer kick
// (and a reprinted receipt never opens the drawer).
export async function reprintJob(jobId: string): Promise<Result> {
  const staff = await assertManager();
  const db = createAdminClient();
  const { data: j } = await db.from("print_jobs").select("printer_id, kind, label, xml, status, order_id").eq("id", jobId).maybeSingle();
  if (!j) return { ok: false, error: "That job isn't there anymore." };
  if (j.status !== "failed" && j.status !== "expired") return { ok: false, error: "Only a failed or expired job can be reprinted." };
  if (j.kind === "drawer") return { ok: false, error: "A drawer kick isn't sent again later." };
  const { data: p } = await db.from("printers").select("active").eq("id", j.printer_id).maybeSingle();
  if (!p?.active) return { ok: false, error: "That printer is turned off here." };
  try {
    await enqueueJobs(
      j.printer_id,
      [{ kind: j.kind as PrintJobKind, xml: withoutDrawer(j.xml), orderId: j.order_id, label: `${(j.label ?? j.kind).replace(/ \(reprint\)$/, "")} (reprint)` }],
      staff.employeeId,
    );
  } catch {
    return { ok: false, error: "Couldn't send the reprint. Try again." };
  }
  revalidate();
  return { ok: true };
}

// ---------- patterned receipts ----------

export async function saveReceiptPatterns(input: PatternSettings): Promise<Result> {
  const staff = await assertManager();
  try {
    await savePatternSettings(parsePatternSettings(input), staff.employeeId);
  } catch (e) {
    console.error("receipt patterns not saved", e);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidate();
  return { ok: true };
}

// "Print a sample of each": the pictures are drawn in the manager's browser
// (lib/print/pattern-render.ts) and come here to go to the Bar printer.
export async function printPatternSamples(xmls: string[]): Promise<Result> {
  const staff = await assertManager();
  const list = Array.isArray(xmls) ? xmls.slice(0, PATTERN_DESIGNS.length) : [];
  if (!list.length || list.some((x) => typeof x !== "string" || x.length > 300_000 || !isEposDocument(x) || hasDrawer(x)))
    return { ok: false, error: "Those samples didn't come out right. Try again." };
  const printer = await stationPrinter("bar");
  const problem = stationProblem("bar", printer);
  if (problem || !printer) return { ok: false, error: problem ?? "No Bar printer is set up." };
  try {
    await enqueueJobs(printer.id, list.map((xml, i) => ({ kind: "test" as const, xml, label: `Receipt pattern sample ${i + 1}` })), staff.employeeId);
  } catch {
    return { ok: false, error: "Couldn't send the samples. Try again." };
  }
  revalidate();
  return { ok: true };
}
