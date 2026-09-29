// Sends ePOS-Print XML (see receipt.ts) to the Epson TM-m30 on the bar's
// network. The original TM-m30 can't fetch jobs from a website on its own,
// so the register's browser posts each receipt straight to the printer's
// built-in web service, the same way the old register did.
//
// The register page is https, so the printer has to be reached over https
// too (browsers block plain-http requests from a secure page). The printer
// uses a self-signed certificate: the register's browser has to accept it
// once, by opening https://<printer address> and choosing to continue.

// This is the "Print straight to a printer IP (old way)" choice under
// Devices. The other choice sends jobs through the website's print queue
// (app/pos/printing.ts), with no certificate to accept.

import { printerErrorMessage } from "./printer-errors";

// Through the website's print queue: pending means the printer hadn't
// confirmed it yet when the register stopped waiting; an error with queued
// means it failed once (paper out, say) and is still in line to try again.
export type PrintResult = { ok: true; pending?: boolean } | { ok: false; error: string; certUrl?: string; queued?: boolean };

// "192.168.1.50" -> "https://192.168.1.50". A full URL (http://localhost:...)
// is used as-is, which is how local testing reaches a fake printer.
export function printerBaseUrl(address: string): string {
  const a = address.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(a) ? a : `https://${a}`;
}

export async function sendToPrinter(address: string, eposXml: string): Promise<PrintResult> {
  if (!address.trim()) return { ok: false, error: "No printer address is set. Add it under Printer." };
  const base = printerBaseUrl(address);
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${eposXml}</s:Body></s:Envelope>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let text: string;
  try {
    const res = await fetch(`${base}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
        SOAPAction: '""',
      },
      body,
      signal: controller.signal,
    });
    text = await res.text();
    if (!res.ok && !/<response/.test(text)) return { ok: false, error: `The printer answered with an error (HTTP ${res.status}).` };
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false,
      error: timedOut
        ? "The printer didn't answer. Check that it's on and connected to the network."
        : "Couldn't reach the printer. Check the address, that this device is on the theater's network, and that the printer's certificate has been accepted.",
      certUrl: base.startsWith("https://") ? base : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
  const success = /<response[^>]*\bsuccess="true"/.test(text);
  if (success) return { ok: true };
  const code = text.match(/<response[^>]*\bcode="([^"]*)"/)?.[1] ?? "";
  return { ok: false, error: printerErrorMessage(code) };
}
