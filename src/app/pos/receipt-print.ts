import { customerReceiptXml, type ReceiptOpts } from "@/lib/print/pattern-render";
import type { ReceiptData } from "@/lib/print/receipt";
import type { PatternSettings } from "@/lib/print/receipt-patterns";
import { getReceiptPatterns } from "./print-actions";

// The register's printed customer receipt: patterned or plain, per Back
// office → Printers → Patterned receipts. The setting is fetched when the
// register opens and kept a few minutes, so printing never waits on it for
// long (and a receipt that would has the plain one instead).

const FRESH_MS = 5 * 60_000;
let cache: { s: PatternSettings; at: number } | null = null;
let inflight: Promise<PatternSettings | null> | null = null;

function refresh(): Promise<PatternSettings | null> {
  inflight ??= getReceiptPatterns()
    .then((s) => {
      cache = { s, at: Date.now() };
      return s;
    })
    .catch(() => cache?.s ?? null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function receiptPatterns(): PatternSettings | Promise<PatternSettings | null> {
  if (cache) {
    if (Date.now() - cache.at > FRESH_MS) void refresh();
    return cache.s;
  }
  return refresh();
}

export function customerReceipt(r: ReceiptData, opts: ReceiptOpts = {}): Promise<string> {
  return customerReceiptXml(r, opts, receiptPatterns());
}
