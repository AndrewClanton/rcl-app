// The one frame every Royale marketing email is drawn in, in the Proof
// Sheet style of the website (src/app/globals.css): a 3px ink border, an
// ink header bar with the wordmark, gold hero panels with an ink rule, ink
// section bars in gold mono capitals, and red buttons.
//
// Email-client-safe on purpose: table layout, inline styles, live text for
// every word (blocked images lose nothing), bulletproof buttons with 44px+
// tap targets, light mode only. Brand fonts load where the client allows
// (Apple Mail, iOS) and fall back to Arial Black / Arial / Courier New
// elsewhere (Gmail, Outlook). Modeled on docs/drafts/invite-email/email.mjs.
//
// No server code, so the composer's live preview uses it too. There is
// deliberately no "view in browser" copy and no forward or share button:
// member emails can carry archive titles (MPLC), which must never end up
// somewhere public.
import { SITE_URL } from "@/lib/site";
import { esc } from "./format";

export const C = {
  ink: "#14110c",
  cream: "#f8f5ec",
  white: "#ffffff",
  red: "#ed1c24",
  gold: "#ffc72c",
  muted: "#6b6455",
  line: "#e3ddc9",
  inkMuted: "#b8b0a0",
};
export const DISPLAY = "'Archivo Black','Arial Black',Arial,Helvetica,sans-serif";
export const BODY = "Archivo,Arial,Helvetica,sans-serif";
export const MONO = "'Space Mono','Courier New',Courier,monospace";

export const THEATER_LINE = "Royale Cinema Lounge · 715 E Broadway · Joplin, MO 64801 · 417-281-4172";
export const STREET_ADDRESS = "715 E Broadway, Joplin, MO 64801";
export const LOGO_URL = `${SITE_URL}/email/logo-600.png`;

export function eyebrow(text: string, color = C.red): string {
  return `<div style="font-family:${MONO};font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color};">${esc(text)}</div>`;
}

// A bulletproof button: a table cell with a background, so it's a button
// even with images off. Primary is red; secondary is an ink outline.
export function button(href: string, label: string, primary = true): string {
  const fill = primary ? C.red : C.white;
  const text = primary ? C.white : C.ink;
  const border = primary ? `border:2px solid ${C.red};` : `border:2px solid ${C.ink};`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn"><tr>
<td align="center" bgcolor="${fill}" style="border-radius:8px;background:${fill};">
<a href="${esc(href)}" style="display:inline-block;${border}padding:14px 30px;min-height:20px;font-family:${BODY};font-size:18px;line-height:22px;font-weight:700;color:${text};text-decoration:none;border-radius:8px;">${esc(label)}&nbsp;&rarr;</a>
</td></tr></table>`;
}

export function sectionBar(label: string): string {
  return `<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:12px 28px;font-family:${MONO};font-size:13px;line-height:16px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">${esc(label)}</td></tr>`;
}

export function row(inner: string, style = "padding:22px 28px;"): string {
  return `<tr><td class="px" style="${style}">${inner}</td></tr>`;
}

export function paragraphsHtml(text: string, opts: { size?: number; color?: string } = {}): string {
  const size = opts.size ?? 16;
  return text
    .trim()
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${opts.color ?? C.ink};">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface FooterInput {
  preferencesUrl: string;
  unsubscribeUrl: string;
  why: string;
  promotional: boolean;
}

export function footerHtml(f: FooterInput): string {
  const link = (href: string, label: string) => `<a href="${esc(href)}" style="color:${C.ink};text-decoration:underline;font-weight:700;">${label}</a>`;
  return `<tr><td class="px" bgcolor="${C.cream}" style="background:${C.cream};padding:26px 28px 30px;border-top:3px solid ${C.ink};">
<div style="font-family:${BODY};font-size:14px;line-height:21px;color:${C.ink};">Questions? Just reply. A real person reads these.</div>
<div style="font-family:${BODY};font-size:14px;line-height:21px;color:${C.ink};padding-top:10px;">${link(f.preferencesUrl, "Email preferences")} &nbsp;&middot;&nbsp; ${link(f.unsubscribeUrl, "Unsubscribe")}</div>
<div style="font-family:${BODY};font-size:12px;line-height:19px;color:${C.muted};padding-top:14px;">${esc(f.why)}${f.promotional ? " A promotional email from Royale Cinema Lounge." : ""}</div>
<div style="font-family:${MONO};font-size:11px;line-height:17px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};padding-top:12px;">${esc(THEATER_LINE)}</div>
</td></tr>`;
}

export function footerText(f: FooterInput): string {
  return [
    "Questions? Just reply. A real person reads these.",
    "",
    `Email preferences: ${f.preferencesUrl}`,
    `Unsubscribe: ${f.unsubscribeUrl}`,
    "",
    `${f.why}${f.promotional ? " A promotional email from Royale Cinema Lounge." : ""}`,
    THEATER_LINE,
  ].join("\n");
}

export function shell({ subject, preheader, rows }: { subject: string; preheader: string; rows: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light only;supported-color-schemes:light only;}
body{margin:0;padding:0;background:${C.cream};-webkit-text-size-adjust:100%;}
a{color:${C.red};}
@media (max-width:620px){
  .outer{padding:0!important;}
  .card{border-left:0!important;border-right:0!important;}
  .px{padding-left:20px!important;padding-right:20px!important;}
  .h1{font-size:30px!important;line-height:34px!important;}
  .poster{width:72px!important;}
  .poster img{width:72px!important;}
  .gift,.stub{display:block!important;width:auto!important;}
  .stub{border-left:0!important;border-top:2px dashed ${C.ink}!important;}
  .btn{width:100%!important;}
  .btn a{display:block!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;color:${C.cream};">${esc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};">
<tr><td class="outer" align="center" style="padding:24px 12px;">
<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.white};border:3px solid ${C.ink};border-collapse:separate;">
<tr><td align="center" bgcolor="${C.ink}" style="background:${C.ink};padding:22px 24px 18px;">
<img src="${esc(LOGO_URL)}" width="230" alt="ROYALE CINEMA LOUNGE" style="display:block;width:230px;max-width:70%;height:auto;border:0;font-family:${DISPLAY};font-size:22px;line-height:28px;color:${C.gold};">
</td></tr>
${rows}
</table>
</td></tr></table>
</body>
</html>`;
}
