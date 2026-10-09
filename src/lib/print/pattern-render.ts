// Browser only: a patterned receipt (lib/print/receipt-patterns.ts) drawn on
// a canvas and turned into the printer's 1-bit picture, threshold not
// dither, so the text stays crisp. Anything that goes wrong, or takes over
// two seconds, gives the plain text receipt instead: a receipt is never lost.
import { thresholdToRaster, type Raster } from "./raster";
import { patternedReceiptXml, receiptXml, type ReceiptData } from "./receipt";
import { patternReceiptSvg, pickDesign, type PatternDesign, type PatternSettings } from "./receipt-patterns";

const BUDGET_MS = 2000;
// The website takes print jobs up to 300 KB (pos/print-actions.ts); a very
// long order's picture past this prints as text instead.
const MAX_XML = 290_000;

export async function svgToRaster(svg: string, width: number, height: number): Promise<Raster> {
  const img = new Image();
  img.width = width;
  img.height = height;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("pattern image didn't load"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return thresholdToRaster(data, width, height);
}

export type ReceiptOpts = { openDrawer?: boolean; flourish?: string[] | null; claimUrl?: string | null };

// One design's receipt as ePOS-Print XML. Throws if it can't be drawn.
export async function patternXml(design: PatternDesign, r: ReceiptData, opts: ReceiptOpts = {}): Promise<string> {
  const { svg, width, height } = patternReceiptSvg(design, r, { flourish: opts.flourish });
  const xml = patternedReceiptXml(await svgToRaster(svg, width, height), { openDrawer: opts.openDrawer, claimUrl: opts.claimUrl });
  if (xml.length > MAX_XML) throw new Error("pattern too big");
  return xml;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("pattern took too long")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

// The customer receipt to print: a random patterned design when they're on
// (Back office → Printers), the plain text one otherwise or on any trouble.
// `settings` may be a promise: waiting for it counts against the budget.
export async function customerReceiptXml(r: ReceiptData, opts: ReceiptOpts, settings: PatternSettings | Promise<PatternSettings | null> | null): Promise<string> {
  const plainXml = () => receiptXml(r, opts);
  if (typeof window === "undefined" || !settings) return plainXml();
  try {
    return await within(
      (async () => {
        const s = await settings;
        const design = s ? pickDesign(s) : null;
        return design ? await patternXml(design, r, opts) : plainXml();
      })(),
      BUDGET_MS,
    );
  } catch (e) {
    console.warn("patterned receipt fell back to text", e);
    return plainXml();
  }
}
