// Patterned paper receipts: the customer receipt drawn as a picture on one
// of three designs, picked at random per receipt so guests get a surprise
// (Back office → Printers → Patterned receipts). Pure string building, no
// browser or server APIs: the register turns the SVG into a 1-bit raster
// (lib/print/pattern-render.ts) and scripts can render it with sharp.
//
// The designs are the ones Andrew approved on paper (Oct 2026):
//   monogram  the A5 monogram grid: interlocked italic RCL (never "RC"),
//             film reel, admit-one ticket, clapperboard
//   route66   the C2 Route 66 shields: RCL in the band, 66, JOPLIN, sparkles
//   frames    the B4 movie frames: one wide film strip, the receipt split
//             across frames, edge lettering between them
// The pattern stays thin (2px strokes, about 10% ink) so the text reads.
import { SITE_NAME, THEATER_ADDRESS } from "@/lib/site";
import { plain, receiptWhen, type ReceiptData } from "./receipt";

export type PatternDesign = "monogram" | "route66" | "frames";
export const PATTERN_DESIGNS: { key: PatternDesign; label: string; hint: string }[] = [
  { key: "monogram", label: "Monogram grid", hint: "RCL monograms, film reels, tickets and clapperboards" },
  { key: "route66", label: "Route 66", hint: "Route 66 shields with RCL and JOPLIN" },
  { key: "frames", label: "Movie frames", hint: "A film strip, the receipt split across its frames" },
];

export interface PatternSettings {
  on: boolean;
  designs: Record<PatternDesign, boolean>;
}
export const PATTERN_SETTING = "receipt_patterns";
export const DEFAULT_PATTERN_SETTINGS: PatternSettings = { on: true, designs: { monogram: true, route66: true, frames: true } };

// Whatever is stored, as settings: anything missing counts as on.
export function parsePatternSettings(v: unknown): PatternSettings {
  const o = (v && typeof v === "object" ? v : {}) as { on?: unknown; designs?: Record<string, unknown> };
  const d = o.designs && typeof o.designs === "object" ? o.designs : {};
  return {
    on: o.on !== false,
    designs: { monogram: d.monogram !== false, route66: d.route66 !== false, frames: d.frames !== false },
  };
}

// The design for this receipt, or null for a plain text one.
export function pickDesign(s: PatternSettings, rand = Math.random): PatternDesign | null {
  if (!s.on) return null;
  const on = PATTERN_DESIGNS.map((d) => d.key).filter((k) => s.designs[k]);
  return on.length ? on[Math.floor(rand() * on.length) % on.length] : null;
}

export const PATTERN_WIDTH = 576; // TM-m30: 576 dots at about 203 dpi

// ---------- the drawn shapes (ported from the approved samples) ----------

const W = PATTERN_WIDTH;

const star = (x: number, y: number, r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2,
      rr = i % 2 ? r * 0.45 : r;
    p.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${p.join(" ")}" fill="none" stroke="#000" stroke-width="2"/>`;
};
const spark = (x: number, y: number, r: number) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="none" stroke="#000" stroke-width="2"/>`;

const reel = (x: number, y: number, r: number) => {
  let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#000" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${r * 0.18}" fill="none" stroke="#000" stroke-width="2"/>`;
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    s += `<circle cx="${(x + r * 0.58 * Math.cos(a)).toFixed(1)}" cy="${(y + r * 0.58 * Math.sin(a)).toFixed(1)}" r="${(r * 0.2).toFixed(1)}" fill="none" stroke="#000" stroke-width="2"/>`;
  }
  return s;
};

// Interlocked RCL (not RC: that's RC Cola).
const rclMark = (x: number, y: number, k: number) =>
  `<g transform="translate(${x} ${y}) scale(${k})" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-style="italic" fill="none" stroke="#000" stroke-width="1.7" text-anchor="middle"><text x="-16" y="8">R</text><text x="1" y="12">C</text><text x="17" y="6">L</text></g>`;
// An admit-one ticket: notched ends, a perforation line, a star.
const ticket = (x: number, y: number, k: number) =>
  `<g transform="translate(${x} ${y}) scale(${k}) rotate(-14)"><path d="M-24 -13 H24 V-5 A5 5 0 0 0 24 5 V13 H-24 V5 A5 5 0 0 0 -24 -5 Z" fill="none" stroke="#000" stroke-width="1.8"/><line x1="-10" y1="-13" x2="-10" y2="13" stroke="#000" stroke-width="1.6" stroke-dasharray="3 3"/></g>` +
  star(x + 6 * k, y - 1.5 * k, 6 * k);
// A clapperboard.
const clapper = (x: number, y: number, k: number) =>
  `<g transform="translate(${x} ${y}) scale(${k})"><rect x="-18" y="-6" width="36" height="22" fill="none" stroke="#000" stroke-width="1.8"/><path d="M-18 -6 L-16 -17 L19 -12 L18 -6" fill="none" stroke="#000" stroke-width="1.8"/><path d="M-9 -15.5 L-13 -6 M1 -14 L-3 -6 M11 -13 L7 -6" stroke="#000" stroke-width="1.8"/><line x1="-18" y1="2" x2="18" y2="2" stroke="#000" stroke-width="1.4"/></g>`;

// A5: a staggered grid of separate symbols, each in its own cell.
function monoGrid2(H: number, step: number, k: number, fourth: (x: number, y: number) => string) {
  let s = "";
  const motifs = [(x: number, y: number) => rclMark(x, y, k), fourth, (x: number, y: number) => reel(x, y, 16 * k), (x: number, y: number) => ticket(x, y, k)];
  for (let row = -1; row < H / (step / 2) + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0),
        y = row * (step / 2);
      s += motifs[((((col * 2 + row) % 4) + 4) % 4)](x, y);
    }
  return s;
}

// C2: a fuller Route 66 shield: the two-bump top, a band with RCL, a big
// 66, and JOPLIN along the bottom, with a double outline.
const shield2 = (x: number, y: number, k: number) => {
  const path = "M-30 -34 Q-24 -40 -15 -38 Q-6 -36 0 -40 Q6 -36 15 -38 Q24 -40 30 -34 Q36 -6 22 18 Q12 32 0 38 Q-12 32 -22 18 Q-36 -6 -30 -34 Z";
  return `<g transform="translate(${x} ${y}) scale(${k})"><path d="${path}" fill="none" stroke="#000" stroke-width="2.2"/><path d="${path}" transform="scale(0.86)" fill="none" stroke="#000" stroke-width="1.2"/><line x1="-27" y1="-20" x2="27" y2="-20" stroke="#000" stroke-width="1.6"/><text x="0" y="-24" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="1">RCL</text><text x="0" y="12" font-family="'Arial Black', Arial, Helvetica, sans-serif" font-size="27" font-weight="bold" text-anchor="middle" fill="none" stroke="#000" stroke-width="1.6">66</text><text x="0" y="22" font-family="Arial, Helvetica, sans-serif" font-size="6" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="0.4">JOPLIN</text></g>`;
};
function route66b(H: number, step: number, k: number) {
  let s = "";
  for (let row = -1; row < H / (step / 2) + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0),
        y = row * (step / 2);
      if (row % 2) continue;
      const sx = x + ((row / 2) % 2 ? step / 2 : 0);
      s += shield2(sx, y, k) + spark(sx + step / 2, y, 11) + star(sx + step / 2, y, 4);
    }
  return s;
}

// ---------- the receipt's content, as blocks of text ----------

type Block =
  | { t: "c"; text: string; size: number; bold?: boolean; mono?: boolean; fit?: boolean } // centered
  | { t: "r"; left: string; right: string; size: number; bold?: boolean } // left and right
  | { t: "m"; text: string } // an item's modifier, indented
  | { t: "rule" }
  | { t: "gap"; h: number }
  | { t: "end" }; // a reel, a clapper and THE END

const SANS = "Arial, Helvetica, sans-serif";
const MONO ="'Courier New', Courier, monospace";
const money = (n: number) => `$${n.toFixed(2)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface PatternOpts {
  flourish?: string[] | null;
}

// The same lines the text receipt has (lib/print/receipt.ts receiptXml), in
// four parts: the header, the items, the totals, and the sign-off. The claim
// QR code isn't drawn: it prints after the picture as the printer's own QR.
function sections(r: ReceiptData, o: PatternOpts) {
  const head: Block[] = [
    { t: "c", text: SITE_NAME.toUpperCase(), size: 30, bold: true, fit: true },
    { t: "c", text: `${THEATER_ADDRESS.streetAddress}, ${THEATER_ADDRESS.addressLocality}, ${THEATER_ADDRESS.addressRegion} ${THEATER_ADDRESS.postalCode}`, size: 18 },
    { t: "c", text: "417-281-4172", size: 18 },
    { t: "gap", h: 6 },
  ];
  if (r.reprint) head.push({ t: "c", text: "** REPRINT **", size: 22, bold: true });
  if (r.orderName) head.push({ t: "c", text: r.orderName, size: 24, bold: true });
  head.push({ t: "c", text: receiptWhen(r.at), size: 20 }, { t: "c", text: `Order #${r.orderNumber}`, size: 20 });
  if (r.cashier) head.push({ t: "c", text: `Server: ${r.cashier}`, size: 18 });
  if (r.member) head.push({ t: "c", text: `Insider: ${r.member}`, size: 18 });

  const items: Block[] = [];
  for (const l of r.lines) {
    items.push({ t: "r", left: `${l.qty} x ${l.name}`, right: money(l.unit * l.qty), size: 22 });
    for (const m of l.mods) items.push({ t: "m", text: m });
  }

  const totals: Block[] = [{ t: "r", left: "Subtotal", right: money(r.subtotal), size: 22 }];
  for (const d of r.discounts) if (d.amount > 0) totals.push({ t: "r", left: d.label, right: `-${money(d.amount)}`, size: 22 });
  totals.push({ t: "r", left: r.taxIncluded ? "Tax (included in prices)" : "Tax", right: money(r.tax), size: 22 });
  if (r.tip > 0) totals.push({ t: "r", left: "Tip", right: money(r.tip), size: 22 });
  totals.push({ t: "r", left: "TOTAL", right: money(r.total), size: 28, bold: true });
  const paid = r.payments.filter((p) => p.amount > 0);
  if (paid.length) {
    totals.push({ t: "gap", h: 6 });
    for (const p of paid) totals.push({ t: "r", left: p.label, right: money(p.amount), size: 20 });
  }

  const foot: Block[] = [
    { t: "c", text: "Thanks for coming in.", size: 20 },
    { t: "c", text: "The RCL crew", size: 20, bold: true },
    { t: "c", text: "royalecinemajoplin.com", size: 18 },
  ];
  if (o.flourish?.length) {
    foot.push({ t: "gap", h: 10 });
    for (const l of o.flourish) foot.push({ t: "c", text: l, size: 16, bold: true, mono: true });
  }
  return { head, items, totals, foot };
}

// Roughly how wide Arial sets `s` at `size` (a little generous, so nothing
// runs off the edge): there's no measuring without a browser.
function textWidth(s: string, size: number, bold: boolean): number {
  let em = 0;
  for (const ch of s) em += ch === " " ? 0.28 : /[iljtf.,:;'!|()[\]]/.test(ch) ? 0.3 : /[A-Z0-9$#%&@mwMW]/.test(ch) ? (/[mwMW]/.test(ch) ? 0.86 : 0.68) : 0.54;
  return em * size * (bold ? 1.08 : 1);
}

// Words wrapped to fit `px`.
function wrapPx(text: string, size: number, bold: boolean, px: number): string[] {
  const rows: string[] = [];
  let cur = "";
  const cut = (w: string) => {
    let t = w;
    while (t.length > 1 && textWidth(t, size, bold) > px) t = t.slice(0, -1);
    return t;
  };
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, bold) <= px) cur = next;
    else {
      if (cur) rows.push(cur);
      cur = cut(w);
    }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [""];
}

const txt = (x: number, y: number, size: number, s: string, o: { bold?: boolean; anchor?: string; mono?: boolean } = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${size}"${o.bold ? ' font-weight="bold"' : ""} text-anchor="${o.anchor ?? "middle"}" fill="#000"${o.mono ? ' xml:space="preserve" style="white-space:pre"' : ""}>${esc(s)}</text>`;

// Lays blocks out between x and x + w, first line's top at y. Returns the
// SVG and the height used.
function layout(blocks: Block[], x: number, w: number, y: number): { svg: string; h: number } {
  const pad = 28; // text inset from the panel's edge
  const inner = w - 2 * pad;
  let s = "";
  let cy = y;
  for (const b of blocks) {
    if (b.t === "gap") {
      cy += b.h;
    } else if (b.t === "rule") {
      s += `<line x1="${x + pad}" y1="${cy + 9}" x2="${x + w - pad}" y2="${cy + 9}" stroke="#000" stroke-width="2" stroke-dasharray="6 5"/>`;
      cy += 22;
    } else if (b.t === "c") {
      // The name at the top stays on one line, a little smaller if need be.
      const size = b.fit ? Math.max(20, Math.min(b.size, Math.floor((b.size * (inner + 20)) / textWidth(b.text, b.size, !!b.bold)))) : b.size;
      const lines = b.mono || b.fit ? [plain(b.text)] : wrapPx(plain(b.text), size, !!b.bold, inner);
      for (const l of lines) {
        cy += size;
        s += txt(x + w / 2, cy, size, l, { bold: b.bold, mono: b.mono });
        cy += b.mono ? 4 : 10;
      }
    } else if (b.t === "m") {
      for (const l of wrapPx(plain(b.text), 18, false, inner - 30)) {
        cy += 18;
        s += txt(x + pad + 30, cy, 18, l, { anchor: "start" });
        cy += 8;
      }
    } else if (b.t === "r") {
      const right = plain(b.right);
      const rw = textWidth(right, b.size, !!b.bold) + 14;
      const lines = wrapPx(plain(b.left), b.size, !!b.bold, inner - rw);
      lines.forEach((l, i) => {
        cy += b.size;
        s += txt(x + pad + (i ? 18 : 0), cy, b.size, l, { anchor: "start", bold: b.bold });
        if (i === lines.length - 1) s += txt(x + w - pad, cy, b.size, right, { anchor: "end", bold: b.bold });
        cy += i === lines.length - 1 ? (b.bold ? 14 : 12) : 6;
      });
    } else if (b.t === "end") {
      const mid = x + w / 2;
      s += reel(mid - 70, cy + 34, 20) + clapper(mid + 70, cy + 34, 1.2) + txt(mid, cy + 42, 16, "THE END", { bold: true });
      cy += 66;
    }
  }
  return { svg: s, h: cy - y };
}

// ---------- the three designs ----------

const PANEL_TOP = 150;
const PANEL_BOTTOM = 140;

// The receipt on a white, double-bordered panel in the middle of a pattern.
function onPanel(pattern: (H: number) => string, r: ReceiptData, o: PatternOpts) {
  const x = 70,
    w = W - 140;
  const { head, items, totals, foot } = sections(r, o);
  const body = layout([...head, { t: "rule" }, ...items, { t: "rule" }, ...totals, { t: "rule" }, ...foot], x, w, PANEL_TOP + 30);
  const h = body.h + 30 + 30;
  const H = Math.ceil(PANEL_TOP + h + PANEL_BOTTOM);
  const panel = `<rect x="${x}" y="${PANEL_TOP}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="3"/><rect x="${x + 7}" y="${PANEL_TOP + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="#000" stroke-width="1.5"/>`;
  return { H, inner: pattern(H) + panel + body.svg };
}

// B4: one wide film strip, sprockets down both edges, the receipt split
// across frames like stills from a film. The items' frame grows for a long
// order; the other three stay equal.
function filmFrames(r: ReceiptData, o: PatternOpts) {
  const pw = 30,
    fx = pw + 8,
    fw = W - 2 * fx,
    gap = 14,
    minFrame = 228,
    vpad = 34;
  const { head, items, totals, foot } = sections(r, o);
  const parts = [head, items, totals, [...foot, { t: "gap", h: 4 } as Block, { t: "end" } as Block]].map((b) => layout(b, fx, fw, 0));
  const fh = Math.ceil(Math.max(minFrame, ...[0, 2, 3].map((i) => parts[i].h + 2 * vpad)));
  const heights = parts.map((p, i) => (i === 1 ? Math.ceil(Math.max(fh, p.h + 2 * vpad)) : fh));
  const H = gap * 5 + heights.reduce((a, b) => a + b, 0);
  let s = `<rect x="1" y="-2" width="${W - 2}" height="${H + 4}" fill="none" stroke="#000" stroke-width="2.5"/>`;
  for (let y = 4; y < H; y += 16) for (const px of [9, W - 9 - 13]) s += `<rect x="${px}" y="${y}" width="13" height="9" rx="2.5" fill="none" stroke="#000" stroke-width="1.6"/>`;
  let y = gap;
  parts.forEach((p, i) => {
    const fhI = heights[i];
    s += `<rect x="${fx}" y="${y}" width="${fw}" height="${fhI}" rx="12" fill="#fff" stroke="#000" stroke-width="2.2"/>`;
    s += `<text x="${fx + 10}" y="${y + 18}" font-family="${MONO}" font-size="11" font-weight="bold" fill="#000">${i + 1}</text>`;
    const top = y + Math.round((fhI - p.h) / 2);
    s += `<g transform="translate(0 ${top})">${p.svg}</g>`;
    // Edge lettering in the gap below each frame but the last.
    if (i < parts.length - 1)
      s += `<text x="${W / 2}" y="${y + fhI + gap / 2 + 4}" font-family="${MONO}" font-size="10" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="2">RCL 70MM ▸ ${i + 1}A  ★  JOPLIN MO</text>`;
    y += fhI + gap;
  });
  return { H, inner: s };
}

export interface PatternSvg {
  svg: string;
  width: number;
  height: number;
}

export function patternReceiptSvg(design: PatternDesign, r: ReceiptData, o: PatternOpts = {}): PatternSvg {
  const { H, inner } =
    design === "frames"
      ? filmFrames(r, o)
      : design === "route66"
        ? onPanel((h) => route66b(h, 124, 1.25), r, o)
        : onPanel((h) => monoGrid2(h, 124, 1.35, (x, y) => clapper(x, y, 1.35)), r, o);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/>${inner}</svg>`;
  return { svg, width: W, height: H };
}

// The short order a "Print a sample of each" sends (Back office → Printers).
export function sampleReceipt(design: PatternDesign): ReceiptData {
  const label = PATTERN_DESIGNS.find((d) => d.key === design)?.label ?? design;
  return {
    orderNumber: 1048,
    at: new Date().toISOString(),
    cashier: null,
    member: null,
    orderName: `Sample: ${label}`,
    lines: [
      { name: "Popcorn (large)", qty: 1, unit: 7, mods: ["Extra butter"] },
      { name: "Manhattan", qty: 1, unit: 10, mods: [] },
      { name: "Day pass", qty: 1, unit: 5, mods: [] },
    ],
    subtotal: 22,
    discounts: [],
    tax: 1.92,
    tip: 0,
    total: 23.92,
    payments: [{ label: "Card", amount: 23.92 }],
  };
}
