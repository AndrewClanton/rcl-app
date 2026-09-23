import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { LOGO_PNG_BASE64 } from "./logo-data";
import type { MembershipInvoice } from "@/lib/data/member-billing";
import { yearOf, type Receipt, type YearStatement } from "@/lib/data/member-account";

// Receipts and yearly statements members download from their account.
// Letter size, brand ink header, everything a receipt is expected to carry:
// business name and address, date and number, itemized lines, discounts,
// tax, tip, total, payment method, and refund status.

const INK = rgb(0.078, 0.067, 0.047);
const CREAM = rgb(0.973, 0.961, 0.925);
const MUTED = rgb(0.42, 0.392, 0.333);
const LINE = rgb(0.89, 0.867, 0.788);
const RED = rgb(0.929, 0.11, 0.141);
const GOLD = rgb(1, 0.78, 0.173);

const W = 612;
const H = 792;
const M = 54;
const TZ = "America/Chicago";
const BUSINESS = "Royale Cinema Lounge  ·  715 E Broadway, Joplin, MO 64801  ·  417-281-4172  ·  info@royalecinemajoplin.com";

// Standard PDF fonts only cover Windows-1252. Swap anything else for a
// close ASCII stand-in instead of failing the whole document.
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function safe(s: string) {
  return s
    .replace(/[→⟶]/g, "->")
    .replace(/[✓✔]/g, "v")
    .split("")
    .map((c) => (c.charCodeAt(0) < 256 || WIN_ANSI_EXTRA.includes(c) ? c : "?"))
    .join("");
}

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const dateLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TZ });
const dateShort = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  logo: PDFImage;
}

async function setup(title: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Royale Cinema Lounge");
  doc.setCreator("royalecinemajoplin.com");
  const [font, bold, logo] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64")),
  ]);
  return { doc, font, bold, logo };
}

function text(page: PDFPage, s: string, x: number, y: number, size: number, f: PDFFont, color = INK) {
  page.drawText(safe(s), { x, y, size, font: f, color });
}
function textRight(page: PDFPage, s: string, right: number, y: number, size: number, f: PDFFont, color = INK) {
  const t = safe(s);
  page.drawText(t, { x: right - f.widthOfTextAtSize(t, size), y, size, font: f, color });
}
function wrap(s: string, f: PDFFont, size: number, width: number): string[] {
  const words = safe(s).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
function rule(page: PDFPage, y: number, color = LINE, thickness = 0.75) {
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });
}

// Ink band with the logo and the document title. Returns the y to continue from.
function header(ctx: Ctx, page: PDFPage, title: string, subtitle: string, compact = false) {
  const band = compact ? 64 : 104;
  page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: INK });
  const logoW = compact ? 96 : 150;
  const logoH = (logoW * ctx.logo.height) / ctx.logo.width;
  page.drawImage(ctx.logo, { x: M, y: H - band + (band - logoH) / 2, width: logoW, height: logoH });
  textRight(page, title, W - M, H - band / 2 + (compact ? 0 : 4), compact ? 13 : 20, ctx.bold, CREAM);
  textRight(page, subtitle, W - M, H - band / 2 - (compact ? 14 : 16), 9.5, ctx.font, GOLD);
  page.drawRectangle({ x: 0, y: H - band - 4, width: W, height: 4, color: RED });
  if (compact) return H - band - 36;
  text(page, BUSINESS, M, H - band - 26, 8, ctx.font, MUTED);
  return H - band - 58;
}

function footer(ctx: Ctx, page: PDFPage, lines: string[], pageNo?: string) {
  let y = 58;
  rule(page, y + 14);
  const width = W - 2 * M - (pageNo ? 70 : 0);
  for (const l of lines.flatMap((l) => wrap(l, ctx.font, 8, width))) {
    text(page, l, M, y, 8, ctx.font, MUTED);
    y -= 11;
  }
  if (pageNo) textRight(page, pageNo, W - M, 58, 8, ctx.font, MUTED);
}

function labelValue(ctx: Ctx, page: PDFPage, label: string, value: string, x: number, y: number) {
  text(page, label.toUpperCase(), x, y, 7.5, ctx.bold, MUTED);
  text(page, value, x, y - 14, 10.5, ctx.font);
}

// ---------- receipt ----------

export async function renderReceiptPdf(r: Receipt): Promise<Uint8Array> {
  const ctx = await setup(`Royale Cinema Lounge receipt ${r.number}`);
  let page = ctx.doc.addPage([W, H]);
  let y = header(ctx, page, "RECEIPT", `${r.number}  ·  ${dateLong(r.date)}`);

  labelValue(ctx, page, "Billed to", r.memberName, M, y);
  if (r.memberEmail) text(page, r.memberEmail, M, y - 28, 9, ctx.font, MUTED);
  labelValue(ctx, page, "Date", `${dateLong(r.date)}, ${time(r.date)}`, 250, y);
  labelValue(ctx, page, "Receipt no.", r.number, 250, y - 36);
  labelValue(ctx, page, "Payment", r.payment, 420, y);
  if (r.status === "refunded") {
    page.drawRectangle({ x: 420, y: y - 52, width: 104, height: 24, borderColor: RED, borderWidth: 1.5 });
    text(page, "REFUNDED", 434, y - 44, 12, ctx.bold, RED);
  }
  y -= 70;

  if (r.screening) {
    const when = `${new Date(r.screening.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: TZ })}, ${time(r.screening.startsAt)}`;
    page.drawRectangle({ x: M, y: y - 30, width: W - 2 * M, height: 38, color: CREAM });
    text(page, "SCREENING", M + 12, y - 4, 7.5, ctx.bold, MUTED);
    text(page, `${r.screening.title}  ·  ${when}  ·  ${r.screening.room}`, M + 12, y - 19, 10.5, ctx.bold);
    y -= 52;
  }

  // Line items
  const cQty = 360;
  const cUnit = 450;
  const cAmt = W - M;
  const itemHead = () => {
    text(page, "ITEM", M, y, 7.5, ctx.bold, MUTED);
    textRight(page, "QTY", cQty, y, 7.5, ctx.bold, MUTED);
    textRight(page, "PRICE", cUnit, y, 7.5, ctx.bold, MUTED);
    textRight(page, "AMOUNT", cAmt, y, 7.5, ctx.bold, MUTED);
    y -= 8;
    rule(page, y, INK, 1);
    y -= 16;
  };
  const continuePage = () => {
    footer(ctx, page, [`Receipt ${r.number} continues on the next page.`]);
    page = ctx.doc.addPage([W, H]);
    y = header(ctx, page, "RECEIPT", `${r.number}  ·  continued`, true);
  };
  itemHead();
  for (const l of r.lines) {
    if (y < 120) {
      continuePage();
      itemHead();
    }
    const nameLines = wrap(l.name, ctx.font, 10.5, cQty - M - 40);
    text(page, nameLines[0], M, y, 10.5, ctx.font);
    textRight(page, String(l.quantity), cQty, y, 10.5, ctx.font);
    textRight(page, money(l.unitPrice), cUnit, y, 10.5, ctx.font);
    textRight(page, money(l.unitPrice * l.quantity), cAmt, y, 10.5, ctx.font);
    for (const extra of nameLines.slice(1)) {
      y -= 13;
      text(page, extra, M, y, 10.5, ctx.font);
    }
    if (l.modifiers.length) {
      for (const m of wrap(l.modifiers.join(", "), ctx.font, 8.5, cQty - M - 40)) {
        y -= 12;
        text(page, m, M + 10, y, 8.5, ctx.font, MUTED);
      }
    }
    y -= 10;
    rule(page, y);
    y -= 16;
  }
  if (y < 200) continuePage();

  // Totals
  const label = 400;
  const row = (l: string, v: string, f = ctx.font, size = 10.5, color = INK) => {
    text(page, l, label, y, size, f, color);
    textRight(page, v, cAmt, y, size, f, color);
    y -= size + 7;
  };
  y -= 2;
  row("Subtotal", money(r.subtotal));
  for (const d of r.discounts) row(d.label, money(-d.amount), ctx.font, 10.5, MUTED);
  if (r.kind === "order") row(r.taxFree ? "Sales tax (exempt)" : "Sales tax", money(r.tax));
  if (r.tip > 0) row("Tip", money(r.tip));
  y -= 2;
  page.drawLine({ start: { x: label, y: y + 10 }, end: { x: cAmt, y: y + 10 }, thickness: 1, color: INK });
  y -= 6;
  row("Total", money(r.total), ctx.bold, 14);

  if (r.pointsEarned || r.pointsRedeemed) {
    y -= 10;
    const parts = [];
    if (r.pointsEarned) parts.push(`Points earned: ${r.pointsEarned > 0 ? "+" : ""}${pts(r.pointsEarned)}`);
    if (r.pointsRedeemed) parts.push(`Points used: ${pts(r.pointsRedeemed)}`);
    text(page, parts.join("   ·   "), label, y, 9, ctx.font, MUTED);
  }

  footer(ctx, page, [
    "Thank you for coming to the Royale.",
    "Questions about this receipt? info@royalecinemajoplin.com  ·  417-281-4172",
    `Downloaded ${dateShort(new Date().toISOString())} from your Royale Cinema Lounge account.`,
  ]);
  return ctx.doc.save();
}

// ---------- yearly statement ----------

export async function renderStatementPdf(args: {
  statement: YearStatement;
  member: { name: string; email: string | null; tier: string; since: string };
  invoices: MembershipInvoice[];
}): Promise<Uint8Array> {
  const { statement: s, member, invoices } = args;
  const ctx = await setup(`Royale Cinema Lounge ${s.year} statement`);
  const nowYear = Number(new Date().toLocaleDateString("en-US", { year: "numeric", timeZone: TZ }));
  const range = s.year === nowYear ? `January 1 – ${dateLong(new Date().toISOString())}` : `January 1 – December 31, ${s.year}`;
  const yearInvoices = invoices.filter((i) => yearOf(i.date) === s.year && i.status === "paid");
  const membershipTotal = yearInvoices.reduce((t, i) => t + i.amount, 0);

  const pages: PDFPage[] = [];
  let page = ctx.doc.addPage([W, H]);
  pages.push(page);
  let y = header(ctx, page, `${s.year} STATEMENT`, range);

  labelValue(ctx, page, "Member", member.name, M, y);
  if (member.email) text(page, member.email, M, y - 28, 9, ctx.font, MUTED);
  labelValue(ctx, page, "Membership", member.tier, 250, y);
  labelValue(ctx, page, "Member since", dateLong(member.since), 420, y);
  y -= 58;

  // Summary tiles
  const tiles: [string, string][] = [
    ["Purchases", money(s.spent)],
    ["Sales tax paid", money(s.tax)],
    ["Insiders+ billing", money(membershipTotal)],
    ["Points earned / used", `${pts(s.points.earned)} / ${pts(s.points.redeemed)}`],
  ];
  const tileW = (W - 2 * M - 3 * 10) / 4;
  tiles.forEach(([l, v], i) => {
    const x = M + i * (tileW + 10);
    page.drawRectangle({ x, y: y - 44, width: tileW, height: 52, color: CREAM });
    text(page, l.toUpperCase(), x + 10, y - 8, 7, ctx.bold, MUTED);
    text(page, v, x + 10, y - 30, 15, ctx.bold);
  });
  y -= 70;
  if (s.refunded > 0) {
    text(page, `Refunded this year: ${money(s.refunded)} (not included in Purchases).`, M, y, 9, ctx.font, MUTED);
    y -= 30;
  }

  const newPage = () => {
    page = ctx.doc.addPage([W, H]);
    pages.push(page);
    y = header(ctx, page, `${s.year} STATEMENT`, `${member.name}  ·  continued`, true);
  };
  const tableHead = (cols: [string, number, "l" | "r"][]) => {
    for (const [l, x, a] of cols) (a === "l" ? text : textRight)(page, l, x, y, 7.5, ctx.bold, MUTED);
    y -= 8;
    rule(page, y, INK, 1);
    y -= 15;
  };

  // Purchases
  text(page, "Purchases", M, y, 13, ctx.bold);
  y -= 22;
  const cols: [string, number, "l" | "r"][] = [
    ["DATE", M, "l"],
    ["DESCRIPTION", M + 78, "l"],
    ["STATUS", 470, "r"],
    ["AMOUNT", W - M, "r"],
  ];
  tableHead(cols);
  if (s.purchases.length === 0) {
    text(page, "No purchases linked to your account this year.", M, y, 10, ctx.font, MUTED);
    y -= 20;
  }
  for (const p of [...s.purchases].reverse()) {
    if (y < 100) {
      newPage();
      tableHead(cols);
    }
    text(page, dateShort(p.date), M, y, 9.5, ctx.font);
    const desc = wrap(`${p.label}: ${p.detail}`, ctx.font, 9.5, 470 - (M + 78) - 60)[0];
    text(page, desc, M + 78, y, 9.5, ctx.font);
    textRight(page, p.status === "refunded" ? "Refunded" : "Paid", 470, y, 9.5, ctx.font, p.status === "refunded" ? RED : MUTED);
    textRight(page, money(p.amount), W - M, y, 9.5, ctx.font);
    y -= 8;
    rule(page, y);
    y -= 14;
  }

  // Insiders+ membership
  if (yearInvoices.length) {
    if (y < 160) newPage();
    y -= 10;
    text(page, "Insiders+ membership", M, y, 13, ctx.bold);
    y -= 22;
    const icols: [string, number, "l" | "r"][] = [
      ["DATE", M, "l"],
      ["INVOICE", M + 78, "l"],
      ["STATUS", 470, "r"],
      ["AMOUNT", W - M, "r"],
    ];
    tableHead(icols);
    for (const i of [...yearInvoices].reverse()) {
      if (y < 100) {
        newPage();
        tableHead(icols);
      }
      text(page, dateShort(i.date), M, y, 9.5, ctx.font);
      text(page, i.number ?? "Insiders+ monthly membership", M + 78, y, 9.5, ctx.font);
      textRight(page, "Paid", 470, y, 9.5, ctx.font, MUTED);
      textRight(page, money(i.amount), W - M, y, 9.5, ctx.font);
      y -= 8;
      rule(page, y);
      y -= 14;
    }
  }

  // Points
  if (y < 150) newPage();
  y -= 10;
  text(page, "Points", M, y, 13, ctx.bold);
  y -= 18;
  const pointsLines = [
    `Earned: ${pts(s.points.earned)}   ·   Used: ${pts(s.points.redeemed)}${s.points.other ? `   ·   Adjustments and refunds: ${s.points.other > 0 ? "+" : ""}${pts(s.points.other)}` : ""}`,
    s.points.endBalance !== null ? `Balance after your last ${s.year} activity: ${pts(s.points.endBalance)} points` : "No points activity this year.",
  ];
  for (const l of pointsLines) {
    text(page, l, M, y, 10, ctx.font);
    y -= 15;
  }

  const total = pages.length;
  pages.forEach((p, i) =>
    footer(
      ctx,
      p,
      [
        "Lists purchases made with your member account attached. Visits where your account wasn't attached won't appear.",
        "Questions? info@royalecinemajoplin.com  ·  417-281-4172",
      ],
      `Page ${i + 1} of ${total}`
    )
  );
  return ctx.doc.save();
}
