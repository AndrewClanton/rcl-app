// Shared words for the print queue (see supabase/migrations/
// 20260930010000_print_queue.sql). Plain values, safe on the server, in the
// register's browser and in node test scripts.

// Which register a device is: the bar, or the outdoor concessions stand.
// Each has its own receipt printer; both send order tickets to the kitchen.
export type RegisterStation = "bar" | "outdoor";
export const STATIONS: RegisterStation[] = ["bar", "outdoor"];
export const STATION_LABEL: Record<RegisterStation, string> = { bar: "Bar", outdoor: "Outdoor stand" };

export function asStation(v: unknown): RegisterStation | null {
  return v === "bar" || v === "outdoor" ? v : null;
}

export type PrintJobKind = "receipt" | "tickets" | "order_ticket" | "test" | "drawer" | "card";
export type PrintJobStatus = "queued" | "sent" | "printed" | "failed" | "expired" | "cancelled";

// What a register may send to its station printer (order tickets are only
// ever made on the server).
export const REGISTER_KINDS: PrintJobKind[] = ["receipt", "tickets", "test", "drawer", "card"];

// How long a job waits for its printer before it's given up on. A drawer
// that pops minutes after the sale is worse than one that doesn't, and a
// receipt for someone long gone is waste; the kitchen can still use a
// ticket for a while.
export const EXPIRY_MINUTES: Record<PrintJobKind, number> = {
  receipt: 10,
  tickets: 10,
  card: 10,
  test: 10,
  drawer: 2,
  order_ticket: 60,
};

export type PrinterKind = "sdp" | "relay";

// A printer counts as online if it asked for work recently: a few of its
// own intervals, and never less than a minute.
export function onlineWindowMs(pollIntervalSeconds: number): number {
  return Math.max(60, pollIntervalSeconds * 4) * 1000;
}

export function isOnline(lastSeenAt: string | null, pollIntervalSeconds: number, now = Date.now()): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() <= onlineWindowMs(pollIntervalSeconds);
}

// "Online", "Last seen 3 min ago", "Never connected".
export function seenLabel(lastSeenAt: string | null, pollIntervalSeconds: number, now = Date.now()): string {
  if (!lastSeenAt) return "Never connected";
  if (isOnline(lastSeenAt, pollIntervalSeconds, now)) return "Online";
  const min = Math.floor((now - new Date(lastSeenAt).getTime()) / 60000);
  if (min < 60) return `Last seen ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Last seen ${h} hr ago`;
  return `Last seen ${Math.floor(h / 24)} days ago`;
}

// The ePOS-Print documents the app builds (lib/print/receipt.ts), and
// nothing else: one <epos-print> element, no XML declaration, DOCTYPE or
// processing instruction, and nothing that could close the Server Direct
// Print envelope it gets wrapped in.
const EPOS_OPEN = '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">';
export function isEposDocument(xml: string): boolean {
  if (!xml.startsWith(EPOS_OPEN) || !xml.endsWith("</epos-print>")) return false;
  if (xml.indexOf("<epos-print", 1) !== -1) return false;
  return !/<[!?]|PrintData|ePOSPrint|PrintRequestInfo|Parameter>/.test(xml);
}

// A receipt's cash-drawer kick (<pulse>) is split into its own short-lived
// job, and a reprint never opens the drawer.
export function withoutDrawer(xml: string): string {
  return xml.replace(/<pulse\b[^>]*\/>/g, "");
}
export function hasDrawer(xml: string): boolean {
  return /<pulse\b[^>]*\/>/.test(xml);
}
