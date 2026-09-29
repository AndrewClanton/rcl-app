import { useMemo } from "react";
import { sendToPrinter, type PrintResult } from "@/lib/print/epos-client";
import { STATION_LABEL, type PrintJobKind, type RegisterStation } from "@/lib/print/stations";
import { getPrintJobStatus, queueStationPrint } from "./print-actions";
import { useDeviceSettings, type DeviceSettings } from "./devices/settings";

// Where this register's prints go, per its Devices settings: through the
// website to its station's printer, or straight to a printer's IP from this
// browser (the old way). Everything that prints on the register (receipts,
// tickets, door tickets, the drawer, Reserved cards) goes through
// sendPrint, so the choice is made in one place.

export type PrintTarget = { via: "direct"; address: string } | { via: "station"; station: RegisterStation };

// null: nothing set up to print to.
export function printTargetOf(s: Pick<DeviceSettings, "printVia" | "station" | "printerAddress">): PrintTarget | null {
  if (s.printVia === "station") return { via: "station", station: s.station };
  return s.printerAddress.trim() ? { via: "direct", address: s.printerAddress.trim() } : null;
}

export function usePrintTarget(): PrintTarget | null {
  const s = useDeviceSettings();
  return useMemo(() => printTargetOf(s), [s]);
}

export function targetName(t: PrintTarget): string {
  return t.via === "station" ? `the ${STATION_LABEL[t.station]} printer` : "the printer";
}

// How long the register waits to hear "printed" before calling it sent. The
// printer collects jobs every few seconds; if it's slow, the job still
// prints (or shows as failed under Back office -> Printers).
const WAIT_MS = 25_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForJobs(ids: string[]): Promise<PrintResult> {
  const until = Date.now() + WAIT_MS;
  let lastError: string | null = null;
  while (Date.now() < until) {
    await sleep(1500);
    const jobs = await getPrintJobStatus(ids).catch(() => null);
    if (!jobs) continue;
    const bad = jobs.find((j) => j.status === "failed" || j.status === "expired" || j.status === "cancelled");
    if (bad) return { ok: false, error: bad.error || "The printer couldn't print it." };
    if (jobs.length === ids.length && jobs.every((j) => j.status === "printed")) return { ok: true };
    lastError = jobs.find((j) => j.error && j.status === "queued")?.error ?? lastError;
  }
  // Still going: a retry after an error (paper out, cover open) is the one
  // worth telling someone about.
  if (lastError) return { ok: false, error: `${lastError} It will try again for a few minutes.`, queued: true };
  return { ok: true, pending: true };
}

// One or more ePOS-Print documents to this register's printer, in order.
// Straight to a printer: one at a time, stopping at the first failure (as
// always). Through the website: all queued at once, then waits to hear
// they printed.
export async function sendPrint(target: PrintTarget, kind: PrintJobKind, xml: string | string[], label?: string): Promise<PrintResult> {
  const xmls = Array.isArray(xml) ? xml : [xml];
  if (!xmls.length) return { ok: true };
  if (target.via === "direct") {
    for (const x of xmls) {
      const r = await sendToPrinter(target.address, x);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  const jobIds: string[] = [];
  for (let i = 0; i < xmls.length; i += 15) {
    const q = await queueStationPrint({ station: target.station, kind, xmls: xmls.slice(i, i + 15), label }).catch(() => null);
    if (!q) return { ok: false, error: "Couldn't reach the website to print. Check the connection and try again." };
    if (!q.ok) return jobIds.length ? { ok: false, error: `Some went to the printer, the rest didn't: ${q.error}`, queued: true } : q;
    jobIds.push(...q.jobIds);
  }
  return waitForJobs(jobIds);
}
