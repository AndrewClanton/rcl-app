// Gift membership emails: the friend's "you've been given Insiders+" note,
// and the reminder two weeks before the gift runs out. Plain tables and
// inline styles (what Gmail and phone mail apps render), in Royale Cinema
// print palette, like the booth emails.

import { DAILY_COFFEE_PERK } from "@/lib/daily-perk";
import { FREE_BOOTHS_PER_MONTH } from "@/lib/booth-perk";

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export interface GiftEmailData {
  recipientName: string;
  buyerName: string;
  message: string | null;
  endsLong: string; // "Wednesday, September 29, 2027"
  siteUrl: string;
}

function frame(inner: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      ${inner}
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · 417-281-4172</div>
  </td></tr></table>
</body></html>`;
}

function perks() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${["Free entry to every screening, unlimited", DAILY_COFFEE_PERK, `${FREE_BOOTHS_PER_MONTH} free booth reservations every month`, "Concession and merch discounts", "First access to weekly titles and member events"]
      .map((p) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${RULE};font:700 15px/1.4 Arial,Helvetica,sans-serif;color:${INK}">✓&nbsp; ${esc(p)}</td></tr>`)
      .join("")}
  </table>`;
}

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">${esc(label)}</a>`;
}

// ---------- to the friend, once the gift is paid ----------

export function giftReceivedSubject(g: GiftEmailData) {
  return `${first(g.buyerName)} gave you a year of Insiders+ at Royale Cinema`;
}

export function giftReceivedHtml(g: GiftEmailData) {
  const note = g.message
    ? `<tr><td style="padding:18px 22px 0"><div style="border-left:4px solid ${GOLD};padding:4px 0 4px 14px;font:italic 16px/1.5 Georgia,serif;color:${INK}">“${esc(g.message)}”<div style="margin-top:6px;font:700 12px/1.4 'Courier New',monospace;font-style:normal;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">— ${esc(g.buyerName)}</div></div></td></tr>`
    : "";
  return frame(`
    <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">A gift for you</td></tr>
    <tr><td style="background:${GOLD};padding:22px;border-bottom:3px solid ${INK}">
      <div style="font:900 30px/1.05 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">A year of Insiders+</div>
      <div style="margin-top:8px;font:700 17px/1.4 Arial,Helvetica,sans-serif;color:${INK}">From ${esc(g.buyerName)} · good through ${esc(g.endsLong)}</div>
    </td></tr>
    ${note}
    <tr><td style="padding:18px 22px 6px">
      <p style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Hi ${esc(first(g.recipientName))}, it's all paid for, so there's nothing to set up and no card needed. Here's what you get:</p>
      ${perks()}
    </td></tr>
    <tr><td style="padding:14px 22px 22px">
      <p style="margin:0 0 14px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Sign in on our website with this email address to see your membership and reserve your free seats and booths. Or just tell us your name at the box office.</p>
      ${button(`${g.siteUrl}/account`, "Go to my account")}
    </td></tr>`);
}

// ---------- to the friend, two weeks before it ends ----------

export function giftEndingSubject(g: GiftEmailData) {
  return `Your gifted Insiders+ ends ${g.endsLong}`;
}

export function giftEndingHtml(g: GiftEmailData) {
  return frame(`
    <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Insiders+</td></tr>
    <tr><td style="padding:22px 22px 6px">
      <p style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Hi ${esc(first(g.recipientName))}, the year of Insiders+ ${esc(first(g.buyerName))} gave you ends on <strong>${esc(g.endsLong)}</strong>. We hope you've enjoyed it.</p>
      <p style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">To keep your free screenings and booths, join Insiders+ yourself: $15 a month, or $153 a year (15% off), plus tax. Nothing happens if you don't; your account and points stay.</p>
    </td></tr>
    <tr><td style="padding:8px 22px 22px">${button(`${g.siteUrl}/membership/join`, "Keep Insiders+")}</td></tr>`);
}
