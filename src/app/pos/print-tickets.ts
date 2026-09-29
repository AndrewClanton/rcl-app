import { ticketXml } from "@/lib/print/receipt";
import { imageToRaster, type Raster } from "@/lib/print/raster";
import { LOGO_RASTER } from "@/lib/print/logo-raster";
import { sendToPrinter, type PrintResult } from "@/lib/print/epos-client";
import { getTicketPrintInfo } from "./ticket-actions";

// Movie tickets on a sale, for printing one keepsake ticket per admission.
export type TicketSale = { screeningId: string; qty: number };

// Poster pictures are converted for the printer once per register session.
const posterCache = new Map<string, Promise<Raster | null>>();
function posterRaster(url: string) {
  if (!posterCache.has(url)) posterCache.set(url, imageToRaster(url, 320, 520));
  return posterCache.get(url)!;
}

// One ticket per admission, sent one at a time so the printer never gets a
// huge job. Returns the first failure, if any. Used after a sale and by
// "Reprint tickets" (Devices, Recent orders).
export async function printTickets(printerAddress: string, orderNumber: number, sales: TicketSale[]): Promise<PrintResult> {
  const info = await getTicketPrintInfo([...new Set(sales.map((t) => t.screeningId))]).catch(() => null);
  if (!info) return { ok: false, error: "Couldn't look up the showings to print tickets. Try again from Recent orders." };
  let index = 0;
  for (const sale of sales) {
    const show = info[sale.screeningId];
    if (!show) continue;
    const poster = show.posterUrl ? await posterRaster(show.posterUrl) : null;
    for (let n = 0; n < sale.qty; n++) {
      index++;
      const xml = ticketXml(
        { title: show.title, startsAt: show.startsAt, room: show.room, rating: show.rating, runtime: show.runtime, orderNumber, code: `RCL-TKT:${orderNumber}:${sale.screeningId.slice(0, 8)}:${index}` },
        { logo: LOGO_RASTER, poster },
      );
      const r = await sendToPrinter(printerAddress, xml);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}
