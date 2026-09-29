import { reservedCardXml } from "@/lib/print/receipt";
import { LOGO_RASTER } from "@/lib/print/logo-raster";
import { sendToPrinter, type PrintResult } from "@/lib/print/epos-client";
import type { BoothHold } from "@/lib/ops/shared";

// First name and last initial: the card sits out on the table.
export function cardName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function printReservedCard(printerAddress: string, h: BoothHold): Promise<PrintResult> {
  const dateLabel = new Date(`${h.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return sendToPrinter(printerAddress, reservedCardXml({ booth: h.booth, dateLabel, window: h.window, name: cardName(h.name), party: h.party }, { logo: LOGO_RASTER }));
}
