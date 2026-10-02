// What the three invite emails share: who they're for (one recipient's
// details), their links, the account card with "Set my password", the
// per-person pictures and the sign-off. No server code.
import { applyFirstName, esc } from "../format";
import { ART } from "./assets";
import { C, DEV, SITE, assetUrl, band, blk, button, label, pic, picWidth, txt, type Dev } from "./kit";
import { PERSONAL_CLAIM, PERSONAL_FINISH } from "./links";
import type { ArtKind, DesignKey } from "./types";

export interface DesignRecipient {
  firstName: string | null;
  hasLogin: boolean;
  // Their own "Set my password" link (a claim link, kind 'email', 30 days),
  // made at send time for someone with no login and a phone on file.
  claimUrl: string | null;
  // Their own "Restart my unlimited" link (an Insiders+ finish link, kind
  // 'campaign', 30 days), made at send time.
  finishUrl: string | null;
  // The sealed first name the per-person pictures are drawn with.
  artToken: string | null;
  fromOldSite: boolean;
  sendId: string | null;
  // A test or a preview: personal links point at the ordinary pages.
  sample?: boolean;
}

export interface DesignLinks {
  preferencesUrl: string;
  unsubscribeUrl: string;
  // A link to our site: tracked through /e/<send>/<i> when sending.
  href: (url: string, label: string) => string;
}

export interface Ctx {
  key: DesignKey;
  dev: Dev;
  r: DesignRecipient;
  L: DesignLinks;
}

// What the plain-text version and the checks (lint.ts) read.
export interface DesignOut {
  desktop: string;
  phone: string;
  text: string[];
  bodyTexts: string[];
  primaryButtons: number;
}

// A secondary link to our site, with the design's tracking tags.
export function siteLink(ctx: Ctx, path: string, term: string, labelText: string, campaign = "claim-invite"): string {
  return ctx.L.href(`${SITE}${path}?utm_source=email&utm_campaign=${campaign}&utm_content=${ctx.key}-secondary&utm_term=${term}`, labelText);
}


function tagged(url: string, campaign: string, content: string, term: string, sendId: string | null): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=email&utm_campaign=${campaign}&utm_content=${content}&utm_term=${term}${sendId ? `&e=${sendId}` : ""}`;
}

export type ClaimState = "claim" | "login" | "account";

// What the account button does for this person: their own claim link
// ("Set my password"), or, with no phone on file to check, the ordinary
// sign-in ("Set up my login": using this address finds their account), or,
// already signed up, their account.
export function claimState(r: DesignRecipient): ClaimState {
  if (r.hasLogin) return "account";
  if (r.claimUrl || r.sample) return "claim";
  return "login";
}

export function claimButton(ctx: Ctx, term: string): { href: string; label: string } {
  const s = claimState(ctx.r);
  ctx.L.href(PERSONAL_CLAIM, "Set my password (their own link)");
  if (s === "claim") {
    const href = ctx.r.claimUrl ? tagged(ctx.r.claimUrl, "claim-invite", ctx.key, term, ctx.r.sendId) : siteLink(ctx, "/account/login", term, "Set my password (sample)");
    return { href, label: "Set my password" };
  }
  if (s === "login") return { href: siteLink(ctx, "/account/login", term, "Set up my login"), label: "Set up my login" };
  return { href: siteLink(ctx, "/account", term, "Open my account"), label: "Open my account" };
}

export function finishButton(ctx: Ctx, term: string): string {
  ctx.L.href(PERSONAL_FINISH, "Restart my unlimited (their own link)");
  if (ctx.r.finishUrl) return tagged(ctx.r.finishUrl, "unlimited-restart", ctx.key, term, ctx.r.sendId);
  return siteLink(ctx, "/membership", term, "Restart my unlimited (sample)", "unlimited-restart");
}

// ---------- the per-person pictures ----------
// Drawn at open time with their first name (src/app/api/email/art); with
// no name, the version with none in it, from the bucket.
export function artUrl(kind: ArtKind, dev: Dev, token: string | null): string {
  const v = ART[kind]?.[dev];
  if (!v) return "";
  if (!token) return assetUrl(v.generic);
  return `${SITE}/api/email/art/${kind}-${dev}.${v.hash}.${v.ext}?n=${token}`;
}

export function artPic(kind: ArtKind, ctx: Ctx, alt: string, bg: string): string {
  const v = ART[kind]?.[ctx.dev];
  if (!v) return "";
  const color = bg === C.paper ? C.ink : C.cream;
  return `<tr><td bgcolor="${bg}" style="background:${bg};padding:0;font-size:0;line-height:0;"><img src="${esc(artUrl(kind, ctx.dev, ctx.r.artToken))}" width="${v.w}" alt="${esc(alt)}" style="display:block;width:100%;max-width:${v.w}px;height:auto;border:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${color};"></td></tr>`;
}

export const nameOr = (r: DesignRecipient, withName: string, without: string) => applyFirstName(r.firstName ? withName : without, r.firstName);

// ---------- 02 · the account card (both invites) ----------
// "Sam, it's already set up." Three steps, the red "Set my password", 30 sec.
export function claimCard(ctx: Ctx, out: DesignOut): string {
  const { dev, r } = ctx;
  const d = DEV[dev];
  const s = claimState(r);
  const b = claimButton(ctx, "top");
  const headD = r.firstName ? `${esc(r.firstName)}, it's already set up.` : "It's already set up.";
  const headM = r.firstName ? `${esc(r.firstName)}, it's<br>already set up.` : "It's already set up.";
  const steps = s === "claim" ? `<div style="margin-top:${dev === "m" ? 18 : 20}px;">${pic("common/claim-steps", dev, { dark: false })}</div>` : "";
  const chip = s === "account" ? "" : pic("common/claim-30sec", dev, { dark: false });
  const chipW = picWidth("common/claim-30sec", dev);
  const note = s === "login" ? txt("Use this email address and it finds your account.", 14, 20, C.mute, "margin-top:12px;") : "";
  const row =
    dev === "m"
      ? `<div style="margin-top:20px;">${button(b.href, b.label, dev, d.CW - 40)}</div>${chip ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 0;"><tr><td width="${chipW}" style="width:${chipW}px;">${chip}</td></tr></table>` : ""}`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td valign="middle">${button(b.href, b.label, dev, 300)}</td>${chip ? `<td valign="middle" style="padding-left:20px;width:${chipW}px;">${chip}</td>` : ""}</tr></table>`;
  if (dev === "d") {
    out.bodyTexts.push(nameOr(r, "{first name}, it's already set up.", "It's already set up."), b.label);
    out.primaryButtons++;
    out.text.push(`YOUR ACCOUNT\n${nameOr(r, "{first name}, it's already set up.", "It's already set up.")}\n${s === "claim" ? "The last 4 of your phone, then a password or Google, and you're in. About 30 seconds.\n" : ""}${b.label}: ${b.href}`);
  }
  const inner = `${label("YOUR ACCOUNT", C.redD, dev)}
${blk(dev === "m" ? headM : headD, dev === "m" ? 24 : 28, dev === "m" ? 30 : 34, C.ink, "margin-top:10px;")}
${steps}
${row}
${note}`;
  const cardHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${C.cream}" style="background:${C.cream};border-radius:6px;padding:${dev === "m" ? "22px 20px" : "28px 32px"};">${inner}</td></tr></table>`;
  return band(C.paper, cardHtml, `${dev === "m" ? 32 : 40}px ${d.G}px`);
}

// The sign-off at the bottom of each close.
export function signoff(line: string, dev: Dev): string {
  return `${txt(esc(line), 17, 26, C.ink, `margin-top:${dev === "m" ? 36 : 40}px;`)}
${blk("The Royale crew", 20, 24, C.ink, "margin-top:4px;")}`;
}

// The footer's "why you're getting this".
export function whyOldSite(r: DesignRecipient, promotional: boolean): string {
  const base = r.fromOldSite ? "You're getting this because you had an account on the old Royale website." : "You're getting this because you're a Royale Insider.";
  return promotional ? `${base} A promotional email from Royale Cinema Lounge.` : base;
}

