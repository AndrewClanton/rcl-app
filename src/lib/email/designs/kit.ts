// The pieces the three ready-made invite emails are built from, in email
// HTML: the design's colors, fonts and sizes (from the canvas), live text
// for every headline, key line, button and link, and the pictures made by
// scripts/email-designs/render.mjs.
//
// Each email is drawn twice, once from the 600-wide desktop design and once
// from the 390-wide phone design; a media query shows the phone one on
// screens under 480px (Gmail, Apple Mail, iOS, Outlook.com, Yahoo). Mail
// apps that ignore media queries show the desktop one, which still fits a
// phone because every picture shrinks to the width.
//
// No server code: the Back office preview uses the same code as the sender.
import { SITE_URL } from "@/lib/site";
import { esc } from "../format";
import { PIECES } from "./assets";

export type Dev = "d" | "m";

export const C = {
  ink: "#14110c",
  cream: "#f3ecd9",
  paper: "#f8f5ec",
  red: "#ed1c24",
  redD: "#d4141b",
  gold: "#ffc72c",
  mute: "#5a5246",
  inkMute: "#b9b09c",
  ink2: "#1f1b15",
  line: "#3b352b",
  pink: "#ff6fb5",
};
export const FB = "'Archivo Black','Arial Black',Arial,sans-serif";
export const FA = "Archivo,Arial,Helvetica,sans-serif";
export const FM = "'Space Mono','Courier New',monospace";

// The two designs' measurements (scratchpad tools/lib.js on the canvas).
export const DEV = {
  d: { W: 600, G: 40, CW: 520, h1: 56, h1lh: 56, h2: 32, h2lh: 36, lede: 20, ledelh: 28, label: 12, pt: 48 },
  m: { W: 390, G: 24, CW: 342, h1: 36, h1lh: 38, h2: 28, h2lh: 32, lede: 17, ledelh: 25, label: 11, pt: 40 },
} as const;

// Where the pictures live: our own public Supabase Storage bucket
// (email-assets), never anyone else's host. scripts/email-designs/upload.mjs
// puts them there.
export const ASSET_BUCKET = "email-assets";
export function assetBase(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${url}/storage/v1/object/public/${ASSET_BUCKET}`;
}
export function assetUrl(file: string): string {
  return `${assetBase()}/${file}`;
}

export const SITE = SITE_URL;

// ---------- text ----------
export function label(text: string, color: string, dev: Dev, top = 0): string {
  return `<div style="${top ? `margin-top:${top}px;` : ""}font-family:${FM};font-weight:700;font-size:${DEV[dev].label}px;line-height:16px;letter-spacing:2px;color:${color};">&#9733; ${esc(text)}</div>`;
}

export function mono(text: string, o: { size?: number; lh?: number; ls?: number; color?: string; top?: number; weight?: number } = {}): string {
  return `<div style="${o.top ? `margin-top:${o.top}px;` : ""}font-family:${FM};font-weight:${o.weight ?? 700};font-size:${o.size ?? 12}px;line-height:${o.lh ?? 16}px;letter-spacing:${o.ls ?? 2}px;color:${o.color ?? C.gold};">${text}</div>`;
}

// `html` may hold <br> and the red word; everything else is escaped by the caller.
export function h1(html: string, dev: Dev): string {
  const d = DEV[dev];
  return `<h1 style="margin:12px 0 0 0;font-family:${FB};font-weight:400;font-size:${d.h1}px;line-height:${d.h1lh}px;letter-spacing:-1px;color:${C.cream};">${html}</h1>`;
}

export const red = (word: string) => `<span style="color:${C.red};">${esc(word)}</span>`;

export function h2(html: string, color: string, dev: Dev, top = 12): string {
  const d = DEV[dev];
  return `<div style="margin-top:${top}px;font-family:${FB};font-size:${d.h2}px;line-height:${d.h2lh}px;color:${color};">${html}</div>`;
}

export function blk(html: string, size: number, lh: number, color: string, extra = ""): string {
  return `<div style="font-family:${FB};font-size:${size}px;line-height:${lh}px;color:${color};${extra}">${html}</div>`;
}

export function txt(html: string, size: number, lh: number, color: string, extra = ""): string {
  return `<div style="font-family:${FA};font-size:${size}px;line-height:${lh}px;color:${color};${extra}">${html}</div>`;
}

export const lines = (...parts: string[]) => parts.map(esc).join("<br>");

// ---------- pictures ----------
// A picture from the manifest, `width` CSS pixels wide (it shrinks with the
// screen). On a dark section its alt text is cream, on a light one ink, so
// it still reads with pictures off.
export function pic(id: string, dev: Dev, o: { href?: string | null; alt?: string; dark?: boolean; center?: boolean; title?: string } = {}): string {
  const p = PIECES[id];
  const f = p?.[dev] ?? p?.d;
  if (!p || !f) return "";
  const alt = o.alt ?? (dev === "m" && p.altPhone ? p.altPhone : p.alt);
  const color = o.dark === false ? C.ink : C.cream;
  const tag = `<img src="${esc(assetUrl(f.file))}" width="${f.w}" alt="${esc(alt)}" style="display:block;width:100%;max-width:${f.w}px;height:auto;border:0;outline:none;text-decoration:none;${o.center ? "margin:0 auto;" : ""}font-family:${FA};font-size:14px;line-height:20px;color:${color};">`;
  return o.href ? `<a href="${esc(o.href)}" style="text-decoration:none;color:${color};"${o.title ? ` title="${esc(o.title)}"` : ""}>${tag}</a>` : tag;
}

export function picWidth(id: string, dev: Dev): number {
  const p = PIECES[id];
  return (p?.[dev] ?? p?.d)?.w ?? 0;
}

// A small icon picture at its own size (no shrinking).
export function icon(id: string, size: number): string {
  const p = PIECES[id];
  const f = p?.d;
  if (!f) return "";
  return `<img src="${esc(assetUrl(f.file))}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0;">`;
}

// ---------- the red ticket-stub button ----------
// The design's button: red, the words, a dashed tear line and a gold star.
// Bulletproof: table cells with a background color, so it's a button with
// pictures off. On phones it fills the width.
export function button(href: string, text: string, dev: Dev, width: number): string {
  const h = dev === "m" ? 56 : 60;
  const pad = dev === "m" ? 22 : 28;
  const size = dev === "m" ? 17 : 18;
  const link = (inner: string, style: string) => `<a href="${esc(href)}" style="display:block;text-decoration:none;${style}">${inner}</a>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${width}" style="width:100%;max-width:${width}px;border-collapse:separate;"><tr>
<td bgcolor="${C.redD}" height="${h}" style="background:${C.redD};height:${h}px;border-radius:6px 0 0 6px;">${link(esc(text), `padding:0 ${pad}px;line-height:${h}px;font-family:${FB};font-size:${size}px;letter-spacing:0.3px;color:#ffffff;white-space:nowrap;`)}</td>
<td bgcolor="${C.redD}" width="52" height="${h}" style="width:52px;background:${C.redD};height:${h}px;border-left:1px dashed #ec8d90;border-radius:0 6px 6px 0;text-align:center;">${link("&#9733;", `line-height:${h}px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:${C.gold};`)}</td>
</tr></table>`;
}

// The gold-underlined text link ("See it →").
export function textLink(href: string, text: string, color: string, size = 17): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:${size < 17 ? "6px 0 3px" : "11px 0 6px"};font-family:${FA};font-weight:700;font-size:${size}px;line-height:26px;color:${color};text-decoration:none;border-bottom:3px solid ${C.gold};white-space:nowrap;">${esc(text)}&nbsp;&rarr;</a>`;
}

// ---------- layout ----------
// One section: its own background, and either padded content or a picture
// edge to edge.
export function band(bg: string, inner: string, pad: string): string {
  return `<tr><td bgcolor="${bg}" style="background:${bg};padding:${pad};">${inner}</td></tr>`;
}

export function bleed(bg: string, id: string, dev: Dev, o: { href?: string | null; alt?: string } = {}): string {
  return `<tr><td bgcolor="${bg}" style="background:${bg};padding:0;font-size:0;line-height:0;">${pic(id, dev, { ...o, dark: bg !== C.paper })}</td></tr>`;
}

// Two columns side by side (desktop only).
export function cols(left: string, right: string, o: { leftW: number; gap: number; valign?: "top" | "middle" }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td width="${o.leftW}" valign="${o.valign ?? "top"}" style="width:${o.leftW}px;">${left}</td>
<td width="${o.gap}" style="width:${o.gap}px;font-size:0;line-height:0;">&nbsp;</td>
<td valign="${o.valign ?? "top"}">${right}</td>
</tr></table>`;
}

// A dark card (the design's #1f1b15 tiles with a hairline border).
export function card(inner: string, pad: string, o: { bg?: string; border?: string; height?: number } = {}): string {
  const bg = o.bg ?? C.ink2;
  const h = o.height ? ` height="${o.height}"` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${bg}"${h} valign="top" style="background:${bg};border:1px solid ${o.border ?? C.line};border-radius:8px;padding:${pad};${o.height ? `height:${o.height}px;` : ""}">${inner}</td></tr></table>`;
}

export const spacer = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;

// ---------- the footer (the same in all three) ----------
export interface FooterLinks {
  unsubscribeUrl: string;
}

export function footer(dev: Dev, why: string, f: FooterLinks): string {
  const d = DEV[dev];
  const link = (href: string, t: string) => `<a href="${esc(href)}" style="display:inline-block;padding:12px 0;color:${C.cream};text-decoration:underline;">${t}</a>`;
  return `${bleed(C.ink, "common/sprockets", dev)}
${band(
  C.ink,
  `<img src="${esc(assetUrl(PIECES["common/footer-logo"]?.d?.file ?? ""))}" width="120" alt="Royale Cinema Lounge" style="display:block;width:120px;height:auto;border:0;font-family:${FB};font-size:14px;line-height:18px;color:${C.cream};">
${txt("715 E Broadway, Joplin, MO 64801 &middot; On Route 66", 13, 20, C.cream, "margin-top:20px;")}
${txt(`417-281-4172 &middot; <a href="${esc(SITE)}" style="color:${C.cream};text-decoration:none;">royalecinemajoplin.com</a>`, 13, 20, C.cream)}
${txt(esc(why), 13, 20, C.inkMute, "margin-top:12px;")}
<div style="margin-top:4px;font-family:${FA};font-size:13px;line-height:20px;color:${C.cream};">${link(f.unsubscribeUrl, "Unsubscribe")}</div>`,
  `${dev === "m" ? 32 : 40}px ${d.G}px`,
)}`;
}

// The same footer without the unsubscribe link, for an
// email about the member's own account (the paid-through explainer, the
// renewal notice): it's owed either way.
export function accountFooter(dev: Dev, why: string): string {
  const d = DEV[dev];
  return `${bleed(C.ink, "common/sprockets", dev)}
${band(
  C.ink,
  `${pic("common/footer-logo", dev)}
${txt("715 E Broadway, Joplin, MO 64801 &middot; On Route 66", 13, 20, C.cream, "margin-top:20px;")}
${txt(`417-281-4172 &middot; <a href="${esc(SITE)}" style="color:${C.cream};text-decoration:none;">royalecinemajoplin.com</a>`, 13, 20, C.cream)}
${txt(esc(why), 13, 20, C.inkMute, "margin-top:12px;")}`,
  `${dev === "m" ? 32 : 40}px ${d.G}px`,
)}`;
}

// ---------- the whole email ----------
export function shell(o: { subject: string; preheader: string; desktop: string; phone: string }): string {
  const table = (rows: string, w: number) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="width:100%;max-width:${w}px;margin:0 auto;border-collapse:collapse;">${rows}</table>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(o.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light only;supported-color-schemes:light only;}
body{margin:0;padding:0;background:${C.ink};-webkit-text-size-adjust:100%;}
img{-ms-interpolation-mode:bicubic;}
.m{display:none;max-height:0;overflow:hidden;mso-hide:all;}
@media (max-width:480px){
.d{display:none!important;max-height:0!important;overflow:hidden!important;}
.m{display:block!important;max-height:none!important;overflow:visible!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.ink};">${esc(o.preheader)}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" style="background:${C.ink};"><tr><td align="center" style="padding:0;">
<div class="d">${table(o.desktop, DEV.d.W)}</div>
<!--[if !mso]><!--><div class="m" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${table(o.phone, DEV.m.W)}</div><!--<![endif]-->
</td></tr></table>
</body>
</html>`;
}
