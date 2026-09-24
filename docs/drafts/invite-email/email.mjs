// The old-site invite email, as it will be sent. Email-client-safe markup:
// table layout, inline styles, live text for every word (nothing important
// lives inside an image, so blocked images lose nothing), bulletproof
// buttons. Brand fonts load where the client allows it (Apple Mail, iOS)
// and fall back to Arial Black / Arial everywhere else (Gmail, Outlook).
//
// Placeholders Andrew still has to pick carry data-ph so the review page can
// outline them; they're harmless in a real send.

const C = {
  ink: "#14110c",
  cream: "#f8f5ec",
  white: "#ffffff",
  red: "#ed1c24",
  gold: "#ffc72c",
  muted: "#6b6455",
  line: "#e3ddc9",
  inkMuted: "#b8b0a0",
};
const DISPLAY = "'Archivo Black','Arial Black',Arial,Helvetica,sans-serif";
const BODY = "Archivo,Arial,Helvetica,sans-serif";
const MONO = "'Space Mono','Courier New',Courier,monospace";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ph = (s) => `<span data-ph>${s}</span>`;

function button(href, label, { fill = C.red, text = C.white, outline = null } = {}) {
  const border = outline ? `border:2px solid ${outline};` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn"><tr>
<td align="center" bgcolor="${fill === "transparent" ? "" : fill}" style="border-radius:8px;${fill === "transparent" ? "" : `background:${fill};`}">
<a href="${esc(href)}" style="display:inline-block;${border}padding:${outline ? "15px 28px" : "18px 34px"};font-family:${BODY};font-size:18px;line-height:22px;font-weight:700;color:${text};text-decoration:none;border-radius:8px;">${label}&nbsp;&rarr;</a>
</td></tr></table>`;
}

function eyebrow(text, color = C.red) {
  return `<div style="font-family:${MONO};font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color};">${text}</div>`;
}

function ticket({ bonusPoints, bonusDollars, since }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.gold};border-radius:12px;">
<tr>
<td class="gift" valign="middle" style="padding:22px 24px;">
${eyebrow("Welcome gift", C.ink)}
<div class="pts" style="font-family:${DISPLAY};font-size:44px;line-height:48px;color:${C.ink};padding-top:6px;">${ph(bonusPoints)} points</div>
<div style="font-family:${BODY};font-size:15px;line-height:22px;color:${C.ink};padding-top:4px;">On us when you set your password. That&rsquo;s ${ph(bonusDollars)} off at the bar, kitchen or box office.</div>
</td>
<td class="stub" valign="middle" width="140" style="width:140px;border-left:2px dashed ${C.ink};padding:22px 20px;">
${eyebrow("Insider since", C.ink)}
<div style="font-family:${DISPLAY};font-size:22px;line-height:26px;color:${C.ink};padding-top:6px;text-transform:uppercase;">${since}</div>
</td>
</tr></table>`;
}

function perkRows(rows, { labelColor, textColor, rule }) {
  return rows
    .map(
      ([label, text], i) => `<tr><td style="padding:14px 0;${i ? `border-top:1px solid ${rule};` : ""}">
<div style="font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${labelColor};">${label}</div>
<div style="font-family:${BODY};font-size:15px;line-height:22px;color:${textColor};padding-top:2px;">${text}</div>
</td></tr>`
    )
    .join("");
}

function shell({ subject, preheader, body }) {
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
body{margin:0;padding:0;background:${C.cream};-webkit-text-size-adjust:100%;}
a{color:${C.red};}
@media (max-width:620px){
  .outer{padding:0!important;}
  .px{padding-left:22px!important;padding-right:22px!important;}
  .h1{font-size:31px!important;line-height:35px!important;}
  .h2{font-size:25px!important;line-height:29px!important;}
  .gift,.stub{display:block!important;width:auto!important;}
  .stub{border-left:0!important;border-top:2px dashed ${C.ink}!important;padding-top:16px!important;padding-bottom:18px!important;padding-left:24px!important;}
  .pts{font-size:38px!important;line-height:42px!important;}
  .btn{width:100%!important;}
  .btn a{display:block!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};">
<tr><td class="outer" align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.white};">
<tr><td align="center" bgcolor="${C.ink}" style="background:${C.ink};padding:30px 24px 26px;">
<img src="cid:logo" width="230" alt="Royale Cinema Lounge" style="display:block;width:230px;max-width:70%;height:auto;border:0;font-family:${DISPLAY};font-size:22px;color:${C.cream};">
</td></tr>
<tr><td style="background:${C.ink};line-height:0;font-size:0;">
<img src="cid:hero" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</td></tr>
${body}
</table>
</td></tr></table>
</body>
</html>`;
}

function footer({ unsubscribeUrl }) {
  return `<tr><td class="px" style="background:${C.cream};padding:30px 40px 34px;border-top:1px solid ${C.line};">
<div style="font-family:${BODY};font-size:14px;line-height:21px;color:${C.ink};">Questions? Just reply. A real person at the Royale reads these.</div>
<div style="font-family:${BODY};font-size:13px;line-height:20px;color:${C.muted};padding-top:12px;">Never had an account with us? Someone may have signed up with your address. Ignore this email and nothing happens.</div>
<div style="font-family:${BODY};font-size:12px;line-height:19px;color:${C.muted};padding-top:18px;">Royale Cinema Lounge &middot; 715 E Broadway &middot; Joplin, MO 64801<br>
You&rsquo;re getting this because you had an account at royalecinemajoplin.com. <a href="${esc(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a></div>
</td></tr>`;
}

export function renderInviteEmail(p) {
  const name = p.firstName ? `${esc(p.firstName)}, ` : "";
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  if (p.variant === "insider") {
    const subject = "You're already an Insider at the new Royale";
    const preheader = `Pick a password and ${p.bonusPoints} bonus points are yours. Takes about 30 seconds.`;
    const body = `
<tr><td class="px" style="padding:40px 40px 8px;">
${eyebrow("Our new website is open")}
<h1 class="h1" style="margin:0;padding-top:12px;font-family:${DISPLAY};font-size:38px;line-height:42px;font-weight:400;color:${C.ink};">${cap(name + "you&rsquo;re already an Insider.")}</h1>
<p style="margin:0;padding-top:16px;font-family:${BODY};font-size:17px;line-height:26px;color:${C.ink};">We rebuilt our website from the ground up and brought your membership along. Your account is set up under <strong>${esc(p.email)}</strong>. All that&rsquo;s left is a password.</p>
<div style="padding-top:26px;">${button(p.claimUrl, "Set my password")}</div>
<p style="margin:0;padding-top:12px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.muted};">Takes about 30 seconds. This link is just for you and works for 30 days.</p>
</td></tr>
<tr><td class="px" style="padding:28px 40px 12px;">${ticket(p)}</td></tr>
<tr><td class="px" style="padding:22px 40px 30px;">
${eyebrow("What Insiders get", C.muted)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
${perkRows(
  [
    ["Points on everything", "1 point for every $1 at the bar, kitchen and box office. 100 points = $5 off."],
    ["The weekly lineup", "Every week&rsquo;s films in your inbox, including the Film Archive classics we only share with members."],
    ["Your member card", "A QR code in your account. Scan in at the door and the register."],
  ],
  { labelColor: C.ink, textColor: C.muted, rule: C.line }
)}
</table>
</td></tr>
<tr><td class="px" bgcolor="${C.ink}" style="background:${C.ink};padding:36px 40px 38px;">
${eyebrow("Insiders+", C.gold)}
<h2 class="h2" style="margin:0;padding-top:10px;font-family:${DISPLAY};font-size:29px;line-height:33px;font-weight:400;color:${C.cream};">Stop buying tickets. Walk in free, every time.</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
${["Free entry to every screening", "2 free booth reservations a month", "Concession &amp; merch discounts", "First access to special events"]
  .map((t) => `<tr><td width="22" valign="top" style="width:22px;padding:5px 0;font-family:${BODY};font-size:16px;line-height:22px;color:${C.gold};font-weight:700;">&#10003;</td><td style="padding:5px 0;font-family:${BODY};font-size:16px;line-height:22px;color:${C.cream};">${t}</td></tr>`)
  .join("")}
</table>
<div style="padding-top:18px;font-family:${MONO};font-size:14px;line-height:20px;font-weight:700;color:${C.gold};letter-spacing:1px;">ADULTS $15/MO &middot; SENIORS $12 &middot; STUDENTS $10</div>
<div style="padding-top:6px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.inkMuted};">Senior or student? Show your ID at the box office and we&rsquo;ll switch your rate. Billed monthly on the day you join, not the 1st. Cancel anytime from your account.</div>
<div style="padding-top:22px;">${button(p.upgradeUrl, "Upgrade to Insiders+", { fill: "transparent", text: C.gold, outline: C.gold })}</div>
</td></tr>
${footer(p)}`;
    return { subject, preheader, html: shell({ subject, preheader, body }) };
  }

  // Old paying / Plus members: their free entry is moving to new billing.
  const subject = "Your Insiders+ is moving: 2 quick steps";
  const preheader = "Set a password and re-add your card to keep walking in free.";
  const step = (n, title, text) => `<tr>
<td width="44" valign="top" style="width:44px;padding:12px 0;"><div style="width:32px;height:32px;border-radius:16px;background:${C.red};color:${C.white};font-family:${DISPLAY};font-size:16px;line-height:32px;text-align:center;">${n}</div></td>
<td valign="top" style="padding:12px 0;"><div style="font-family:${BODY};font-size:17px;line-height:24px;font-weight:700;color:${C.ink};">${title}</div><div style="font-family:${BODY};font-size:15px;line-height:22px;color:${C.muted};padding-top:2px;">${text}</div></td>
</tr>`;
  const body = `
<tr><td class="px" style="padding:40px 40px 8px;">
${eyebrow("Your Insiders+ is moving")}
<h1 class="h1" style="margin:0;padding-top:12px;font-family:${DISPLAY};font-size:38px;line-height:42px;font-weight:400;color:${C.ink};">${cap(name + "let&rsquo;s keep you walking in free.")}</h1>
<p style="margin:0;padding-top:16px;font-family:${BODY};font-size:17px;line-height:26px;color:${C.ink};">We rebuilt our website and moved memberships to a new, more reliable payment system. Your account is already set up under <strong>${esc(p.email)}</strong>. Two quick steps:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
${step(1, "Pick a password", "Your email&rsquo;s already filled in.")}
${step(2, "Re-add your card", "Card numbers can&rsquo;t be copied between payment systems. That&rsquo;s a security rule, not our choice.")}
</table>
<div style="padding-top:18px;">${button(p.claimUrl, "Keep my Insiders+")}</div>
<p style="margin:0;padding-top:12px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.muted};">About two minutes. This link is just for you and works for 30 days.</p>
</td></tr>
<tr><td class="px" style="padding:30px 40px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" style="background:${C.ink};border-radius:12px;">
<tr><td style="padding:26px 26px 14px;">${eyebrow("What changes for you", C.gold)}</td></tr>
<tr><td style="padding:0 26px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${perkRows(
  [
    ["Your price", `Same as before: $${p.plusTier.price} a month (${p.plusTier.label}).`],
    ["Your billing day", "The day you re-add your card becomes your monthly billing day."],
    ["Your old billing", `Stops on ${ph(p.oldBillingStops)}. You won&rsquo;t be charged by both systems.`],
  ],
  { labelColor: C.cream, textColor: C.inkMuted, rule: "#3a342a" }
)}
</table>
</td></tr>
</table>
</td></tr>
<tr><td class="px" style="padding:0 40px 36px;">${ticket(p)}</td></tr>
${footer(p)}`;
  return { subject, preheader, html: shell({ subject, preheader, body }) };
}
