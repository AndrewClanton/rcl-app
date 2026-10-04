// "Your Insiders+ year renews on March 13": a billing notice a week before
// a yearly membership renews (lib/renewal-notice.ts), so the charge is no
// surprise. Transactional: it goes whatever their email preferences say.
//
// The Royale's designed-email look (designs/kit.ts), picture first: a
// calendar page with the date beside a receipt with the amount and the
// card, then the perks picture for what another year gets them. Every
// figure is live text from Stripe's upcoming invoice, never in a picture.
// Signed by the crew.
//
// No server code: the preview script (scripts/email-designs/
// preview-renewal-notice.mjs) renders it offline.
import { esc, firstNameOf } from "./format";
import { PLUS_PERKS } from "./render";
import { C, DEV, FB, FM, accountFooter, band, blk, button, cols, h1, h2, label, mono, pic, red, shell, txt, type Dev } from "./designs/kit";

export interface RenewalNoticeEmail {
  name: string | null;
  chargeAt: string; // ISO
  // From the upcoming invoice, in cents: the price, the tax, the total.
  priceCents: number;
  taxCents: number;
  totalCents: number;
  // "Visa ending 4242", or null when Stripe has no card to show.
  card: string | null;
  // Their Billing tab (sign-in first if they're signed out).
  billingUrl: string;
}

const TZ = "America/Chicago";
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TZ });
const monthDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: TZ });

// "$153", "$13.35".
function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// "$153 + $13.35 tax = $166.35", or just "$153" with no tax on it.
export function renewalAmount(e: Pick<RenewalNoticeEmail, "priceCents" | "taxCents" | "totalCents">): string {
  return e.taxCents ? `${money(e.priceCents)} + ${money(e.taxCents)} tax = ${money(e.totalCents)}` : money(e.totalCents);
}

export function renewalNoticeSubject(e: Pick<RenewalNoticeEmail, "chargeAt">): string {
  return `Your Insiders+ year renews on ${monthDay(e.chargeAt)}`;
}

function parts(e: RenewalNoticeEmail) {
  return { first: firstNameOf(e.name), date: longDate(e.chargeAt), amount: renewalAmount(e) };
}

export function renewalNoticeText(e: RenewalNoticeEmail): string {
  const p = parts(e);
  return [
    `${p.first ? `Hi ${p.first}. ` : ""}Your Insiders+ year renews on ${p.date}.`,
    "",
    `${p.date}: ${p.amount}${e.card ? `, on your ${e.card}` : ""}.`,
    "Staying? Nothing to do.",
    "",
    `Manage or cancel: ${e.billingUrl}`,
    "",
    "Another year of:",
    ...PLUS_PERKS.map((t) => `- ${t}`),
    "",
    "Questions? Ask us at the box office or reply to this email.",
    "",
    "See you at the movies,",
    "The Royale crew",
    "",
    "Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801",
  ].join("\n");
}

function hero(e: RenewalNoticeEmail, dev: Dev): string {
  const d = DEV[dev];
  const p = parts(e);
  return band(
    C.ink,
    `${label("INSIDERS+ · ONE WEEK NOTICE", C.gold, dev)}${h1(`Your year renews<br>on ${red(monthDay(e.chargeAt))}.`, dev)}
${txt(`${p.first ? `Hi ${esc(p.first)}. ` : ""}Here's the charge a week ahead, so it's no surprise. Staying? Nothing to do.`, d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`,
    `${dev === "m" ? 28 : 36}px ${d.G}px ${dev === "m" ? 36 : 44}px`,
  );
}

// A torn-off calendar page: the month in red, the day big.
function calendar(iso: string, dev: Dev): string {
  const m = dev === "m";
  const at = new Date(iso);
  const month = at.toLocaleDateString("en-US", { month: "short", timeZone: TZ }).toUpperCase();
  const day = at.toLocaleDateString("en-US", { day: "numeric", timeZone: TZ });
  const year = at.toLocaleDateString("en-US", { year: "numeric", timeZone: TZ });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
<tr><td bgcolor="${C.redD}" align="center" style="background:${C.redD};border:3px solid ${C.ink};border-bottom:0;border-radius:8px 8px 0 0;padding:${m ? 7 : 9}px 0;font-family:${FM};font-weight:700;font-size:${m ? 13 : 15}px;line-height:18px;letter-spacing:3px;color:#ffffff;">${esc(month)}</td></tr>
<tr><td bgcolor="#ffffff" align="center" style="background:#ffffff;border:3px solid ${C.ink};border-top:0;border-radius:0 0 8px 8px;padding:${m ? "6px 0 10px" : "8px 0 14px"};">
<div style="font-family:${FB};font-size:${m ? 48 : 64}px;line-height:${m ? 52 : 68}px;color:${C.ink};">${esc(day)}</div>
${mono(esc(year), { size: m ? 11 : 12, lh: 14, ls: 2, color: C.mute })}
</td></tr></table>`;
}

// The receipt: the total big, then price + tax, then the card.
function receipt(e: RenewalNoticeEmail, dev: Dev): string {
  const m = dev === "m";
  const line = (html: string, top: number) => mono(html, { size: m ? 11 : 13, lh: m ? 16 : 18, ls: 1, color: C.ink, top, weight: 700 });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${C.gold}" valign="top" style="background:${C.gold};border:3px solid ${C.ink};border-radius:8px;padding:${m ? "12px 14px" : "16px 20px"};">
${mono("1 YEAR OF INSIDERS+", { size: m ? 10 : 11, lh: 14, ls: 1.5, color: C.ink })}
${blk(esc(money(e.totalCents)), m ? 34 : 46, m ? 38 : 50, C.ink, "margin-top:6px;")}
${line(e.taxCents ? `${esc(money(e.priceCents))} + ${esc(money(e.taxCents))} TAX` : "NO TAX", 4)}
${e.card ? line(esc(e.card.toUpperCase()), m ? 10 : 12) : ""}
</td></tr></table>`;
}

function charge(e: RenewalNoticeEmail, dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  const p = parts(e);
  return band(
    C.paper,
    `${label("THE CHARGE", C.redD, dev)}
<div style="margin-top:${m ? 16 : 20}px;">${cols(calendar(e.chargeAt, dev), receipt(e, dev), { leftW: m ? 104 : 150, gap: m ? 12 : 20, valign: "middle" })}</div>
${txt(`${esc(p.date)}: <strong>${esc(p.amount)}</strong>${e.card ? `, on your ${esc(e.card)}` : ""}.`, m ? 16 : 17, m ? 24 : 26, C.ink, `margin-top:${m ? 18 : 22}px;`)}
<div style="margin-top:${m ? 22 : 26}px;">${button(e.billingUrl, "Manage or cancel", dev, m ? d.CW : 340)}</div>
${txt("My Account &rarr; Billing", 13, 20, C.mute, "margin-top:8px;")}`,
    `${d.pt}px ${d.G}px`,
  );
}

// What another year gets them: the invites' perks picture, which says it
// on its own (its alt text lists them with pictures off).
function perks(dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  return band(
    C.paper,
    `${label("ANOTHER YEAR OF", C.redD, dev)}${h2(m ? "Free movies,<br>and then some." : "Free movies, and then some.", C.ink, dev)}<div style="margin-top:${m ? 20 : 24}px;">${pic("press-play/perks", dev, { dark: false })}</div>`,
    `0 ${d.G}px ${d.pt}px`,
  );
}

function close(dev: Dev): string {
  const d = DEV[dev];
  const m = dev === "m";
  return band(
    C.cream,
    `${txt("Questions? Ask us at the box office or reply to this email.", 17, 26, C.ink)}
${txt("See you at the movies,", 17, 26, C.ink, `margin-top:${m ? 24 : 28}px;`)}
${blk("The Royale crew", 20, 24, C.ink, "margin-top:4px;")}`,
    `${m ? 32 : 40}px ${d.G}px`,
  );
}

export function renewalNoticeHtml(e: RenewalNoticeEmail): string {
  const p = parts(e);
  const build = (dev: Dev) =>
    [
      `<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:0;font-size:0;line-height:0;">${pic("common/header", dev)}</td></tr>`,
      hero(e, dev),
      charge(e, dev),
      perks(dev),
      close(dev),
      accountFooter(dev, "You're getting this because your Insiders+ renews yearly. It's a billing notice, so it comes whatever your email settings."),
    ].join("\n");
  return shell({
    subject: renewalNoticeSubject(e),
    preheader: `${p.date}: ${p.amount}. Staying? Nothing to do.`,
    desktop: build("d"),
    phone: build("m"),
  });
}
