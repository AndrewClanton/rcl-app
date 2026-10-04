// "Your Insiders+ year is already paid": for a member whose year was paid
// another way (the old website), with a paid-through date on their account
// (lib/paid-through.ts). Shows them how to put a card on without being
// charged before that date. Transactional, to one member, only when staff
// press "Send paid-through explainer" on their Back office page.
//
// The Royale's designed-email look (designs/kit.ts): a picture of a paid
// membership card, three illustrated steps with arrows (pictures from
// scripts/email-designs/source/PaidThrough.dc.html, rendered and uploaded
// like the invites' pictures), and what happens next. Their first name, the
// date and the price are live text, never in a picture. Signed by the crew.
//
// No server code: the preview script (scripts/email-designs/
// preview-paid-through.mjs) renders it offline.
import { ANNUAL_PRICE, RATE_PRICE, dollars, type BillingInterval } from "@/lib/membership-rates";
import type { MemberPriceTier } from "@/lib/types";
import { esc, firstNameOf } from "./format";
import { C, DEV, accountFooter, band, blk, bleed, button, h1, label, mono, pic, red, shell, txt, type Dev } from "./designs/kit";

export interface PaidThroughEmail {
  name: string | null;
  paidThrough: string; // ISO
  renewsAs: BillingInterval;
  rate: MemberPriceTier;
  // Their Billing tab (sign-in first if they're signed out).
  billingUrl: string;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

// "$153 + tax" for the year, "$15/month + tax" monthly.
export function renewalPrice(rate: MemberPriceTier, renewsAs: BillingInterval): string {
  return renewsAs === "year" ? `${dollars(ANNUAL_PRICE[rate])} + tax` : `${dollars(RATE_PRICE[rate])}/month + tax`;
}

export function paidThroughSubject(e: Pick<PaidThroughEmail, "renewsAs">): string {
  return e.renewsAs === "year" ? "Your Insiders+ year is already paid" : "Your Insiders+ is already paid";
}

function parts(e: PaidThroughEmail) {
  const first = firstNameOf(e.name);
  const date = longDate(e.paidThrough);
  const next = e.renewsAs === "year" ? "your next year" : "monthly billing";
  return { first, date, price: renewalPrice(e.rate, e.renewsAs), next };
}

export function paidThroughText(e: PaidThroughEmail): string {
  const p = parts(e);
  return [
    `${p.first ? `Hi ${p.first}. ` : ""}Your Insiders+ is paid through ${p.date}.`,
    "",
    `Add a card now and nothing is charged until then:`,
    "1. Sign in at royalecinemajoplin.com",
    "2. Account > Billing > Add a card",
    `3. See "No charge until ${p.date}"`,
    "",
    `Add my card: ${e.billingUrl}`,
    "",
    `Today: $0. ${p.date}: ${p.next} starts at ${p.price}.`,
    "",
    "Questions? 417-281-4172",
    "",
    "See you at the movies,",
    "The Royale crew",
    "",
    "Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801",
  ].join("\n");
}

// A red numbered circle and the step's words beside it.
function stepHead(n: number, html: string, dev: Dev): string {
  const s = dev === "m" ? 34 : 40;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="${s}" height="${s}" bgcolor="${C.redD}" align="center" valign="middle" style="width:${s}px;height:${s}px;background:${C.redD};border-radius:${s / 2}px;font-family:'Archivo Black','Arial Black',Arial,sans-serif;font-size:${dev === "m" ? 17 : 20}px;line-height:${s}px;color:#ffffff;">${n}</td>
<td valign="middle" style="padding-left:12px;">${blk(html, dev === "m" ? 18 : 22, dev === "m" ? 23 : 27, C.ink)}</td>
</tr></table>`;
}

const center = (html: string) => `<div style="text-align:center;"><div style="display:inline-block;">${html}</div></div>`;

function hero(e: PaidThroughEmail, dev: Dev): string {
  const d = DEV[dev];
  const p = parts(e);
  return `${bleed(C.ink, "paid-through/hero", dev)}
${band(
  C.ink,
  `${label("INSIDERS+", C.gold, dev)}${h1(`Your year is<br>already ${red("paid")}.`, dev)}
${txt(`${p.first ? `Hi ${esc(p.first)}. ` : ""}You're paid through <strong style="color:${C.gold};">${esc(p.date)}</strong>.<br>Add a card now and you won't be charged until then.`, d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`,
  `0 ${d.G}px ${dev === "m" ? 36 : 44}px`,
)}`;
}

function steps(e: PaidThroughEmail, dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  const p = parts(e);
  const gap = m ? 14 : 16;
  const arrow = `<div style="margin:${m ? 14 : 16}px 0;">${center(pic("paid-through/arrow", dev, { dark: false }))}</div>`;
  const step = (n: number, head: string, id: string) => `${stepHead(n, head, dev)}<div style="margin-top:${gap}px;">${pic(id, dev, { dark: false })}</div>`;
  return band(
    C.paper,
    `${label("3 STEPS · 2 MINUTES", C.redD, dev)}
<div style="margin-top:${m ? 18 : 22}px;">${step(1, `Sign in at <a href="${esc(e.billingUrl)}" style="color:${C.ink};text-decoration:none;border-bottom:3px solid ${C.gold};">royalecinemajoplin.com</a>`, "paid-through/step-1")}</div>
${arrow}
${step(2, "Account &rarr; Billing &rarr; Add a card", "paid-through/step-2")}
${arrow}
${step(3, `See &ldquo;No charge until ${esc(p.date)}&rdquo;`, "paid-through/step-3")}
<div style="margin-top:${m ? 28 : 32}px;">${button(e.billingUrl, "Add my card", dev, m ? d.CW : 360)}</div>`,
    `${d.pt}px ${d.G}px`,
  );
}

// Today $0, then the date and the price: two tiles and an arrow.
function next(e: PaidThroughEmail, dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  const p = parts(e);
  const tile = (top: string, big: string, sub: string, bg: string, ink: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${bg}" valign="top" style="background:${bg};border:3px solid ${C.cream};border-radius:8px;padding:${m ? "12px" : "16px"};">
${mono(esc(top), { size: m ? 10 : 11, lh: 14, ls: 1.5, color: ink })}
${blk(big, m ? 26 : 34, m ? 30 : 38, ink, "margin-top:6px;")}
${mono(esc(sub), { size: m ? 10 : 11, lh: 14, ls: 1, color: ink, top: 6, weight: 400 })}
</td></tr></table>`;
  const w = m ? 146 : 224;
  return band(
    C.ink,
    `${label("WHAT HAPPENS NEXT", C.gold, dev)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:${m ? 16 : 20}px;"><tr>
<td width="${w}" valign="middle" style="width:${w}px;">${tile("TODAY", "$0", "card saved, nothing charged", C.ink2, C.cream)}</td>
<td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:${m ? 26 : 34}px;line-height:1;color:${C.gold};">&rarr;</td>
<td width="${w}" valign="middle" style="width:${w}px;">${tile(p.date.toUpperCase(), esc(p.price.replace(" + tax", "")), `${p.next} starts, plus tax`, C.gold, C.ink)}</td>
</tr></table>`,
    `${d.pt}px ${d.G}px`,
  );
}

function close(dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  return band(
    C.paper,
    `${txt(`Questions? Call us at <a href="tel:+14172814172" style="color:${C.ink};font-weight:700;text-decoration:none;border-bottom:2px solid ${C.gold};">417-281-4172</a>.`, 17, 26, C.ink)}
${txt("See you at the movies,", 17, 26, C.ink, `margin-top:${m ? 24 : 28}px;`)}
${blk("The Royale crew", 20, 24, C.ink, "margin-top:4px;")}`,
    `${m ? 32 : 40}px ${d.G}px`,
  );
}

export function paidThroughHtml(e: PaidThroughEmail): string {
  const p = parts(e);
  const build = (dev: Dev) =>
    [
      `<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:0;font-size:0;line-height:0;">${pic("common/header", dev)}</td></tr>`,
      hero(e, dev),
      steps(e, dev),
      next(e, dev),
      close(dev),
      // The invites' footer without the unsubscribe line: this one is about
      // their own membership, sent only when they've asked about it.
      accountFooter(dev, "You're getting this because your Insiders+ was paid ahead on our old website."),
    ].join("\n");
  return shell({
    subject: paidThroughSubject(e),
    preheader: `No charge until ${p.date}. Adding a card takes 2 minutes.`,
    desktop: build("d"),
    phone: build("m"),
  });
}
