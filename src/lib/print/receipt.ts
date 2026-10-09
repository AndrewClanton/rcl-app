// Receipt layout for the Epson TM-m30 at the bar, as ePOS-Print XML -- the
// printer's own web language (see epos-client.ts for how it's sent).
// Pure string building, no browser or server APIs, so it can be tested
// directly with node.
import { SITE_NAME, THEATER_ADDRESS } from "@/lib/site";
import { isClaimUrl } from "@/lib/claim-link";
import { STATION_LABEL, type RegisterStation } from "@/lib/print/stations";
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
  // The tax is inside the prices (an organization's supported guest,
  // lib/orgs.ts): printed as "Tax included", not added.
  taxIncluded?: boolean;
  tip: number;
  total: number; // includes tip
  payments: { label: string; amount: number }[];
  reprint?: boolean; // printed again later (Recent orders): marked REPRINT
  // For the customer screen's points, not printed: what completeOrder
  // credits (pointsEarned in lib/register-totals.ts) and whether a reward
  // was used and the points it took (rewardPoints: only what it took off,
  // lib/loyalty.ts rewardPointsFor; older receipts have just rewardUsed).
  points?: { earned: number; rewardUsed: boolean; rewardPoints?: number };
}

const money = (n: number) => `$${n.toFixed(2)}`;

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The printer only has Latin fonts; curly quotes, emoji and the like would
// print as garbage, so fold them to plain ASCII.
export function plain(s: string) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // A phone account's "Guest ·· 0199" (lib/member-name.ts).
    .replace(/··/g, "..")
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
  // The printer's own character scaling, 1-8 each way: width w means
  // 48 / w characters to a line.
  size(w: number, h: number) {
    return this.raw(`<text width="${w}" height="${h}"/>`);
  }
  // A little space, in dots (8 to a mm).
  gap(dots: number) {
    return this.raw(`<feed unit="${dots}"/>`);
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
  // The printer's own QR command. width: dots per module, at 8 dots a mm
  // (a claim link is a 41-module code, so 5 prints it about an inch wide).
  qr(data: string, width = 6) {
    return this.raw(`<symbol type="qrcode_model_2" level="level_m" width="${width}" align="center">${escapeXml(data)}</symbol>`);
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

export const receiptWhen = (iso: string) => when(iso);

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

// flourish: an Easter egg from the register's ✨ panel (lib/print/flourishes.ts),
// printed at the very bottom with no explanation.
// claimUrl: for a member on the sale with no website login, a small QR code
// to set one up (lib/member-claim.ts). Only ever a claim link on this site.
export function receiptXml(r: ReceiptData, opts: { openDrawer?: boolean; flourish?: string[] | null; claimUrl?: string | null } = {}): string {
  const d = new Doc();
  if (opts.openDrawer) d.drawer();
  header(d);
  if (r.reprint) d.align("center").bold(true).line("** REPRINT **").bold(false).align("left");
  d.lines(columns(`Order #${r.orderNumber}`, when(r.at)));
  if (r.orderName) d.line(`Name: ${r.orderName}`);
  // No staff names on customer receipts (Andrew, 10/9).
  if (r.member) d.line(`Insider: ${r.member}`);
  d.line(rule());
  for (const l of r.lines) {
    d.lines(columns(`${l.qty} x ${l.name}`, money(l.unit * l.qty)));
    for (const m of l.mods) d.line(`    ${m}`);
  }
  d.line(rule());
  d.lines(columns("Subtotal", money(r.subtotal)));
  for (const disc of r.discounts) if (disc.amount > 0) d.lines(columns(disc.label, `-${money(disc.amount)}`));
  d.lines(columns(r.taxIncluded ? "Tax (included in prices)" : "Tax", money(r.tax)));
  if (r.tip > 0) d.lines(columns("Tip", money(r.tip)));
  d.bold(true).lines(columns("TOTAL", money(r.total))).bold(false);
  d.line();
  for (const p of r.payments) if (p.amount > 0) d.lines(columns(p.label, money(p.amount)));
  d.line().align("center").line("Thank you for coming to Royale Cinema!").line("royalecinemajoplin.com");
  if (isClaimUrl(opts.claimUrl)) {
    d.feed(1).bold(true).line("Scan to see your points online").bold(false);
    d.qr(opts.claimUrl, 5);
  }
  if (opts.flourish?.length) {
    d.feed(1);
    for (const l of opts.flourish) d.line(l);
  }
  d.cut();
  return d.toString();
}

// A patterned receipt (lib/print/receipt-patterns.ts): the whole receipt
// as one picture, then the claim QR code as the printer's own QR (it scans
// better than a drawn one), then the cut. The drawer kick still goes first.
export function patternedReceiptXml(picture: Raster, opts: { openDrawer?: boolean; claimUrl?: string | null } = {}): string {
  const d = new Doc();
  if (opts.openDrawer) d.drawer();
  d.image(picture);
  if (isClaimUrl(opts.claimUrl)) {
    d.feed(1).align("center").bold(true).line("Scan to see your points online").bold(false);
    d.qr(opts.claimUrl, 5);
  }
  d.cut();
  return d.toString();
}

// An Insiders+ membership set up at the register with their card on the
// reader (pos/legacy-plus-actions.ts): Stripe only emails a receipt to a
// customer with an email, and a phone account (lib/member-name.ts) has
// none, so the register prints this one. Amounts in dollars.
export interface MembershipReceipt {
  member: string;
  plan: string; // "Insiders+ Standard, monthly"
  subtotal: number;
  tax: number;
  total: number;
  card: string | null; // "Visa ·· 4242"
  at: string; // ISO, when it was charged
  invoice: string | null; // Stripe's invoice number
  next: string | null; // ISO, the next charge
}

export function membershipReceiptXml(r: MembershipReceipt): string {
  const d = new Doc();
  header(d);
  d.lines(columns("Insiders+ membership", when(r.at)));
  if (r.invoice) d.line(`Invoice ${r.invoice}`);
  d.line(`Insider: ${r.member}`);
  d.line(rule());
  d.lines(columns(r.plan, money(r.subtotal)));
  d.line(rule());
  d.lines(columns("Subtotal", money(r.subtotal)));
  d.lines(columns("Tax", money(r.tax)));
  d.bold(true).lines(columns("TOTAL", money(r.total))).bold(false);
  d.line();
  if (r.card) d.lines(columns(r.card, money(r.total)));
  if (r.next) {
    const next = new Date(r.next).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    d.line(`Renews ${next}: charged to the same card.`);
  }
  d.line().align("center").line("Welcome to Insiders+!").line("To change or cancel, ask at the box office.").line("royalecinemajoplin.com");
  d.cut();
  return d.toString();
}

// ---------- organization visit slip ----------
// An organization group's visit with nothing to pay (Organization guests,
// lib/orgs.ts): a record for the group's helper, not a receipt. No prices,
// no staff names, and never a drawer pulse.
export interface VisitSlip {
  orderNumber: number;
  at: string; // ISO, when it was recorded
  orgName: string;
  supported: number;
  helpers: number;
  used: number; // the organization's comps today, this group included
  limit: number;
  movies: string[]; // movies covered, if any tickets
  reprint?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function visitSlipLines(v: VisitSlip): { guests: string; comps: string; footer: string } {
  return {
    guests: `${plural(v.supported, "supported guest", "supported guests")} + ${plural(v.helpers, "helper", "helpers")}`,
    comps: `Comps used today: ${v.used} of ${v.limit}`,
    footer: `No charge. Counted on ${v.orgName}'s monthly statement.`,
  };
}

export function visitSlipXml(v: VisitSlip): string {
  const t = visitSlipLines(v);
  const d = new Doc();
  d.align("center").big(true).bold(true).line("ROYALE CINEMA").big(false);
  d.line("Visit record - not a receipt").bold(false);
  if (v.reprint) d.bold(true).line("** REPRINT **").bold(false);
  d.line().align("left");
  d.bold(true).lines(wrap(v.orgName, COLS)).bold(false);
  d.line(when(v.at));
  d.line(rule());
  d.lines(wrap(t.guests, COLS));
  d.line(t.comps);
  if (v.movies.length) {
    d.line().line("Movies covered:");
    for (const m of v.movies) d.lines(wrap(`- ${m}`, COLS));
  }
  d.line(rule());
  d.line(`Order #${v.orderNumber}`);
  d.line().align("center").lines(wrap(t.footer, COLS));
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
  // A register sale's order number, or an online booking's number
  // ("T-1A2B3C4D") when its tickets print at the door.
  orderNumber: number | string;
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
  d.align("center").line(typeof t.orderNumber === "number" ? `Order #${t.orderNumber}` : `Order ${t.orderNumber}`).align("left");
  d.line(rule("=")).feed(1).align("center");
  d.qr(t.code).feed(1);
  d.line("Thanks for spending the night at Royale Cinema.");
  d.line("Keep this ticket as a souvenir.");
  d.bold(true).line("royalecinemajoplin.com").bold(false);
  d.cut();
  return d.toString();
}

// ---------- reserved card ----------
// Set on a booth that's held for a party, printed from the register's shift
// bar. Big enough to read from across the lounge; the guest's first name
// and last initial only, since it sits out in the open.

export interface ReservedCard {
  booth: string;
  dateLabel: string; // "Tuesday, September 29"
  window: string; // "7:00–9:00 PM"
  name: string; // "Andrew C."
  party: number;
}

export function reservedCardXml(c: ReservedCard, pics: { logo?: Raster | null } = {}): string {
  const d = new Doc().align("center");
  if (pics.logo) d.image(pics.logo).feed(1);
  else d.big(true).bold(true).line(SITE_NAME.toUpperCase()).big(false).bold(false);
  d.big(true).bold(true).reverse(true).line("  RESERVED  ").reverse(false).feed(1);
  d.lines(wrap(c.booth.toUpperCase(), 24)).big(false).bold(false).feed(1);
  d.bold(true).line(c.dateLabel.toUpperCase()).bold(false);
  d.big(true).bold(true).line(c.window).big(false).bold(false).feed(1);
  d.align("left").line(rule("=")).align("center");
  d.big(true).bold(true).lines(wrap(c.name, 24)).big(false).bold(false);
  d.line(`Party of ${c.party}`);
  d.align("left").line(rule("=")).align("center").feed(1);
  d.lines(wrap("This booth is held for this party. Please check with a staff member before sitting here.", COLS));
  d.feed(1).bold(true).line("royalecinemajoplin.com").bold(false);
  d.cut();
  return d.toString();
}

// ---------- kitchen order ticket ----------
// One per order, printed in the kitchen, and it travels with the food. Made
// to be read from across the kitchen: a huge order number, the name, which
// register it came from and when, then every item big and bold with its
// modifiers indented under it. No prices. A tab's later tickets carry only
// what was added, under an ADD-ON banner (lib/print/kitchen.ts).

export interface OrderTicket {
  orderNumber: number;
  name: string | null; // the tab or order name
  tab: boolean;
  station: RegisterStation | null; // which register rang it
  at: string; // ISO: when it was rung (a reprint keeps the order's time)
  kind: "order" | "addon" | "reprint";
  lines: { name: string; qty: number; mods: string[] }[];
  notes?: string | null;
  printedAt?: string | null; // a reprint says when it was reprinted
}

// Words wrapped to `width`: the first line starts `first` spaces in, the
// rest `rest` spaces in, so they sit under the text rather than under the
// quantity or bullet.
function hang(text: string, width: number, first: number, rest: number): string[] {
  const rows: string[] = [];
  let cur = "";
  for (const w of plain(text).split(/\s+/).filter(Boolean)) {
    const lead = " ".repeat(rows.length ? rest : first);
    const next = cur ? `${cur} ${w}` : lead + w;
    if (next.length <= width) cur = next;
    else {
      if (cur) rows.push(cur);
      cur = (" ".repeat(rest) + w).slice(0, width);
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

export function orderTicketXml(t: OrderTicket): string {
  const d = new Doc().align("center");
  if (t.kind === "addon") d.size(2, 2).bold(true).reverse(true).line("  ADD-ON  ").reverse(false).bold(false).gap(12);
  if (t.kind === "reprint") d.size(2, 1).bold(true).line("** REPRINT **").bold(false);
  // 4x: 12 characters to the line, about a centimeter tall.
  d.size(4, 4).bold(true).line(`#${t.orderNumber}`).bold(false);
  const name = t.name?.trim() ? `${t.tab ? "Tab: " : ""}${t.name.trim()}` : t.tab ? "Tab" : "";
  if (name) d.size(2, 2).bold(true).lines(wrap(name, 24)).bold(false);
  const where = t.station ? STATION_LABEL[t.station] : "Register";
  d.size(1, 2).bold(true).line(`${where.toUpperCase()}  |  ${clock(t.at)}`).bold(false);
  d.size(1, 1).align("left").line(rule("="));
  for (const l of t.lines) {
    const qty = `${l.qty} x `;
    d.size(2, 2).bold(true).lines(hang(`${qty}${l.name}`, 24, 0, qty.length)).bold(false);
    if (l.mods.length) {
      d.size(1, 2);
      for (const m of l.mods) {
        // A double (lib/bar/double.ts) prints big and dark, so it's poured right.
        if (m === "Double") d.size(2, 2).bold(true).reverse(true).line("  DOUBLE  ").reverse(false).bold(false).size(1, 2);
        else d.lines(hang(`- ${m}`, COLS, 6, 8));
      }
    }
    d.size(1, 1).gap(14);
  }
  d.line(rule("-"));
  if (t.notes?.trim()) {
    d.size(1, 2).bold(true).lines(wrap(`NOTE: ${t.notes.trim()}`, COLS)).bold(false).size(1, 1).line(rule("-"));
  }
  const count = t.lines.reduce((n, l) => n + l.qty, 0);
  d.lines(columns(`${count} item${count === 1 ? "" : "s"}${t.kind === "addon" ? " added" : ""}`, t.printedAt ? `reprinted ${clock(t.printedAt)}` : `Order #${t.orderNumber}`));
  d.cut();
  return d.toString();
}
