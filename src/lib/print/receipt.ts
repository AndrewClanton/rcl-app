// Receipt layout for the Epson TM-m30 at the bar, as ePOS-Print XML -- the
// printer's own web language (see epos-client.ts for how it's sent).
// Pure string building, no browser or server APIs, so it can be tested
// directly with node.
import { SITE_NAME, THEATER_ADDRESS } from "@/lib/site";
import type { Raster } from "./raster";

// 80mm paper, Font A: 48 characters per line (24 at double width).
const COLS = 48;

export interface ReceiptLine {
  name: string;
  qty: number;
  unit: number;
  mods: string[];
}

export interface ReceiptData {
  orderNumber: number;
  at: string; // ISO time the sale completed
  cashier: string | null;
  member: string | null;
  orderName: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  discounts: { label: string; amount: number }[];
  tax: number;
  tip: number;
  total: number; // includes tip
  payments: { label: string; amount: number }[];
}

const money = (n: number) => `$${n.toFixed(2)}`;

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The printer only has Latin fonts; curly quotes, emoji and the like would
// print as garbage, so fold them to plain ASCII.
function plain(s: string) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "");
}

// Left text and right text on one line. If the left side is too long for
// both to fit, it wraps onto indented lines and the right side goes on the
// last one.
export function columns(left: string, right: string, width = COLS): string[] {
  const indent = "  ";
  const room = width - right.length - 1;
  const words = plain(left).split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : rows.length ? indent + w : w;
    if (next.length <= room) cur = next;
    else {
      if (cur) rows.push(cur);
      cur = (rows.length ? indent + w : w).slice(0, room);
    }
  }
  rows.push(cur);
  return rows.map((r, i) => (i === rows.length - 1 ? r.padEnd(width - right.length) + right : r));
}

const rule = (ch = "-") => ch.repeat(COLS);

function wrap(text: string, width: number): string[] {
  const rows: string[] = [];
  let cur = "";
  for (const w of plain(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else {
      if (cur) rows.push(cur);
      cur = w.slice(0, width);
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

class Doc {
  private parts: string[] = [];
  raw(xml: string) {
    this.parts.push(xml);
    return this;
  }
  line(s = "") {
    return this.raw(`<text>${escapeXml(plain(s))}&#10;</text>`);
  }
  lines(rows: string[]) {
    rows.forEach((r) => this.line(r));
    return this;
  }
  align(a: "left" | "center" | "right") {
    return this.raw(`<text align="${a}"/>`);
  }
  big(on: boolean) {
    return this.raw(on ? `<text width="2" height="2"/>` : `<text width="1" height="1"/>`);
  }
  bold(on: boolean) {
    return this.raw(`<text em="${on}"/>`);
  }
  drawer() {
    return this.raw(`<pulse drawer="drawer_1" time="pulse_100"/>`);
  }
  reverse(on: boolean) {
    return this.raw(`<text reverse="${on}"/>`);
  }
  feed(lines = 1) {
    return this.raw(`<feed line="${lines}"/>`);
  }
  image(r: Raster) {
    return this.raw(`<image width="${r.width}" height="${r.height}" align="center" color="color_1" mode="mono">${r.data}</image>`);
  }
  qr(data: string) {
    return this.raw(`<symbol type="qrcode_model_2" level="level_m" width="6" align="center">${escapeXml(data)}</symbol>`);
  }
  cut() {
    return this.raw(`<feed line="2"/><cut type="feed"/>`);
  }
  toString() {
    return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><text lang="en"/><text smooth="true"/>${this.parts.join("")}</epos-print>`;
  }
}

function header(d: Doc) {
  d.align("center").big(true).bold(true).line(SITE_NAME.toUpperCase()).big(false).bold(false);
  d.line(`${THEATER_ADDRESS.streetAddress}, ${THEATER_ADDRESS.addressLocality}, ${THEATER_ADDRESS.addressRegion} ${THEATER_ADDRESS.postalCode}`);
  d.line("417-281-4172");
  d.line().align("left");
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export function receiptXml(r: ReceiptData, opts: { openDrawer?: boolean } = {}): string {
  const d = new Doc();
  if (opts.openDrawer) d.drawer();
  header(d);
  d.lines(columns(`Order #${r.orderNumber}`, when(r.at)));
  if (r.orderName) d.line(`Name: ${r.orderName}`);
  if (r.cashier) d.line(`Server: ${r.cashier}`);
  if (r.member) d.line(`Insider: ${r.member}`);
  d.line(rule());
  for (const l of r.lines) {
    d.lines(columns(`${l.qty} x ${l.name}`, money(l.unit * l.qty)));
    for (const m of l.mods) d.line(`    ${m}`);
  }
  d.line(rule());
  d.lines(columns("Subtotal", money(r.subtotal)));
  for (const disc of r.discounts) if (disc.amount > 0) d.lines(columns(disc.label, `-${money(disc.amount)}`));
  d.lines(columns("Tax", money(r.tax)));
  if (r.tip > 0) d.lines(columns("Tip", money(r.tip)));
  d.bold(true).lines(columns("TOTAL", money(r.total))).bold(false);
  d.line();
  for (const p of r.payments) if (p.amount > 0) d.lines(columns(p.label, money(p.amount)));
  d.line().align("center").line("Thank you for coming to the Royale!").line("royalecinemajoplin.com");
  d.cut();
  return d.toString();
}

export function drawerXml(): string {
  return new Doc().drawer().toString();
}

export function testPageXml(atIso: string): string {
  const d = new Doc();
  header(d);
  d.align("center").bold(true).line("PRINTER TEST").bold(false);
  d.line(when(atIso));
  d.line();
  d.line("If you can read this, the register can print.");
  d.cut();
  return d.toString();
}

// ---------- movie tickets ----------
// One per admission, printed after the receipt. It gets people in the door
// and is meant to be kept: logo, the film in big type, the showing, the
// poster, and a code the door can scan later.

export interface TicketPrint {
  title: string;
  startsAt: string; // ISO
  room: string;
  rating: string | null;
  runtime: number | null;
  orderNumber: number;
  code: string; // what the QR code holds
}

export function ticketXml(t: TicketPrint, pics: { logo?: Raster | null; poster?: Raster | null } = {}): string {
  const d = new Doc().align("center");
  if (pics.logo) d.image(pics.logo).feed(1);
  else d.big(true).bold(true).line(SITE_NAME.toUpperCase()).big(false).bold(false);
  d.align("center").big(true).bold(true).reverse(true).line("  ADMIT ONE  ").reverse(false).feed(1);
  d.lines(wrap(t.title.toUpperCase(), 24)).big(false).bold(false).feed(1);
  const day = new Date(t.startsAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const time = new Date(t.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  d.bold(true).line(day.toUpperCase()).bold(false);
  d.big(true).bold(true).line(time).big(false).bold(false);
  d.line([t.room, t.rating, t.runtime ? `${t.runtime} min` : null].filter(Boolean).join("  ·  "));
  if (pics.poster) d.feed(1).image(pics.poster);
  d.feed(1).align("left").line(rule("="));
  d.align("center").line(`Order #${t.orderNumber}`).align("left");
  d.line(rule("=")).feed(1).align("center");
  d.qr(t.code).feed(1);
  d.line("Thanks for spending the night at the Royale.");
  d.line("Keep this ticket as a souvenir.");
  d.bold(true).line("royalecinemajoplin.com").bold(false);
  d.cut();
  return d.toString();
}
