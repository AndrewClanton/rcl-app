// Email 2: "Come in" (reasons to visit). From the canvas design
// ComeIn-Desktop / -Phone. One job: "Set my password" for anyone without a
// login; for everyone else, their account.
import { esc } from "../format";
import { C, DEV, FB, FM, assetUrl, band, bleed, blk, button, footer, h1, h2, label, mono, pic, red, textLink, txt, type Dev } from "./kit";
import { PIECES } from "./assets";
import { claimButton, claimCard, claimState, signoff, siteLink, whyOldSite, type Ctx, type DesignOut } from "./shared";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  if (dev === "d") {
    out.text.push("COME ON IN\nCOME IN. STAY A WHILE.\nMovies, a full bar and booths for your crew.");
    out.bodyTexts.push("Come in. Stay a while.", "Movies, a full bar and booths for your crew.");
  }
  return `${bleed(C.ink, "come-in/hero", dev)}
${band(C.ink, `${label("COME ON IN", C.gold, dev)}${h1(`Come in.<br>Stay a ${red("while")}.`, dev)}${txt("Movies, a full bar and booths for your crew.", d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `4px ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function insiders(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const plus = siteLink(ctx, "/membership", "insiders-plus", "See Insiders+");
  if (dev === "d") out.text.push(`INSIDERS+\nEvery movie, free. Four movies a month: $32 paying as you go, or $15 with Insiders+.\nPlus 10% off at the register, 2 free booths a month, and a free black coffee or hot tea every day.\n$15 a month. See Insiders+: ${plus}`);
  const price = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td style="border:2px solid ${C.gold};border-radius:6px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td height="52" valign="middle" style="height:52px;padding:0 ${m ? 12 : 16}px;">${blk("$15", 28, 32, C.gold)}</td>
<td valign="middle" style="padding:8px 0;"><div style="height:36px;border-left:2px dashed ${C.gold};font-size:0;line-height:0;">&nbsp;</div></td>
<td valign="middle" style="padding:0 ${m ? 12 : 16}px;">${mono("A MONTH", { size: 11, lh: 14, ls: 1.5, color: C.cream })}</td>
</tr></table></td></tr></table>`;
  return band(
    C.ink,
    `${label("INSIDERS+", C.gold, dev)}${h2("Every movie, free.", C.cream, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${pic("come-in/plus-math", dev)}</div>
<div style="margin-top:${m ? 24 : 28}px;">${pic("come-in/plus-perks", dev)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${m ? 20 : 24}px;"><tr><td valign="middle">${price}</td><td valign="middle" style="padding-left:${m ? 16 : 24}px;">${textLink(plus, "See Insiders+", C.cream)}</td></tr></table>`,
    `${d.pt}px ${d.G}px`,
  );
}

const DRINKS: [string, string][] = [
  ["CITY OF STARS", "$6"],
  ["FIVE FAMILIES", "$7"],
  ["JACKIE BROWN", "$6"],
  ["TITANIC", "$6"],
];

// The coffee-bar marquee: the bulb frame is a picture behind live words.
// Where background pictures don't show (Outlook on Windows), it's a plain
// brown frame with the same words.
function marquee(dev: Dev): string {
  const m = dev === "m";
  const f = PIECES["come-in/marquee"]?.[dev];
  const url = f ? assetUrl(f.file) : "";
  const w = f?.w ?? DEV[dev].CW;
  const rows = DRINKS.map(
    ([n, p], i) =>
      `<tr><td height="${m ? 30 : 34}" valign="middle" style="height:${m ? 30 : 34}px;${i < 3 ? "border-bottom:2px solid #ddd6c4;" : ""}font-family:${FB};font-size:${m ? 14 : 18}px;letter-spacing:${m ? 1 : 1.5}px;color:${C.ink};">${n}</td><td align="right" valign="middle" style="${i < 3 ? "border-bottom:2px solid #ddd6c4;" : ""}font-family:${FB};font-size:${m ? 14 : 18}px;letter-spacing:${m ? 1 : 1.5}px;color:${C.ink};">${p}</td></tr>`,
  ).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="width:100%;max-width:${w}px;border-collapse:separate;"><tr>
<td background="${esc(url)}" bgcolor="#241d14" style="background-color:#241d14;background-image:url('${esc(url)}');background-size:100% 100%;background-repeat:no-repeat;border-radius:8px;padding:${m ? 10 : 14}px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td bgcolor="${C.ink}" height="${m ? 34 : 40}" align="center" valign="middle" style="background:${C.ink};height:${m ? 34 : 40}px;font-family:${FB};font-size:${m ? 16 : 20}px;letter-spacing:${m ? 3 : 5}px;color:${C.red};"><span style="font-size:12px;letter-spacing:0;">&#9733;</span>&nbsp;NOW POURING&nbsp;<span style="font-size:12px;letter-spacing:0;">&#9733;</span></td></tr>
<tr><td bgcolor="${C.cream}" style="background:${C.cream};padding:${m ? "8px 14px" : "10px 24px"};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr>
<tr><td bgcolor="${C.ink}" height="${m ? 22 : 26}" align="center" valign="middle" style="background:${C.ink};height:${m ? 22 : 26}px;font-family:${FM};font-weight:700;font-size:${m ? 10 : 11}px;letter-spacing:2px;color:${C.gold};">&#9733; THE COFFEE BAR &#9733;</td></tr>
</table>
</td></tr></table>`;
}

function bar(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const menu = siteLink(ctx, "/menu", "menu", "See the menu");
  if (dev === "d") out.text.push(`THE BAR & KITCHEN\nOrder like a regular. $5 popcorn and a soda, $8 to $10 cocktails, a $4 slice, a $5 hot dog.\nNow pouring at the coffee bar: ${DRINKS.map(([n, p]) => `${n.charAt(0)}${n.slice(1).toLowerCase()} ${p}`).join(", ")}.\n$1 = 1 point. See the menu: ${menu}`);
  const pill = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="${C.ink}" height="40" valign="middle" style="background:${C.ink};height:40px;border-radius:20px;padding:0 ${m ? 12 : 16}px;white-space:nowrap;"><span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${C.gold};">&#9733;</span>&nbsp;<span style="font-family:${FM};font-weight:700;font-size:11px;line-height:14px;letter-spacing:1px;color:${C.cream};">$1 = 1 POINT</span></td></tr></table>`;
  return band(
    C.paper,
    `${label("THE BAR & KITCHEN", C.redD, dev)}${h2(m ? "Order like<br>a regular." : "Order like a regular.", C.ink, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${pic("come-in/bar-grid", dev, { dark: false })}</div>
<div style="margin-top:${m ? 20 : 24}px;">${marquee(dev)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:${m ? 16 : 20}px;"><tr><td valign="middle">${pill}</td><td valign="middle" align="right">${textLink(menu, "See the menu", C.ink)}</td></tr></table>`,
    `${d.pt}px ${d.G}px`,
  );
}

// ADMIT [NAME] | ADMIT ____ PLUS ONE: live words on the ticket shape. The
// name never goes over the tear line: shorter names are bigger, and a long
// or missing one reads ADMIT / YOU (the design's rule).
function stubs(ctx: Ctx): string {
  const { dev, r } = ctx;
  const m = dev === "m";
  const f = PIECES["come-in/stub"]?.[dev];
  const url = f ? assetUrl(f.file) : "";
  const w = f?.w ?? DEV[dev].CW;
  const h = f?.h ?? (m ? 140 : 190);
  const raw = (r.firstName ?? "").toUpperCase();
  const name = raw && raw.length <= 10 ? raw : "YOU";
  const size = name.length <= 4 ? (m ? 44 : 64) : name.length <= 7 ? (m ? 32 : 46) : m ? 24 : 36;
  const admit = blk("ADMIT", m ? 15 : 20, m ? 16 : 22, C.ink, `letter-spacing:${m ? 2 : 3}px;`);
  const big = m ? 44 : 64;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="width:100%;max-width:${w}px;"><tr>
<td background="${esc(url)}" bgcolor="${C.cream}" height="${h}" valign="middle" style="background-color:${C.cream};background-image:url('${esc(url)}');background-size:100% 100%;background-repeat:no-repeat;height:${h}px;padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td width="50%" valign="middle" style="width:50%;padding:${m ? "0 14px 0 26px" : "0 24px 0 40px"};">${admit}${blk(esc(name), size, size, C.ink, `margin-top:4px;letter-spacing:-1px;white-space:nowrap;`)}</td>
<td width="50%" valign="middle" style="width:50%;padding:${m ? "0 26px 0 20px" : "0 40px 0 32px"};">${admit}<div style="margin-top:4px;height:${big}px;font-size:0;line-height:0;"><div style="height:${big - 3}px;font-size:0;line-height:0;">&nbsp;</div><div style="width:${m ? 112 : 176}px;max-width:100%;border-bottom:3px solid ${C.ink};font-size:0;line-height:0;">&nbsp;</div></div>${mono("PLUS ONE", { size: m ? 9 : 10, lh: 12, ls: 1.5, color: C.mute, top: 6 })}</td>
</tr></table>
</td></tr></table>`;
}

function bring(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const booths = siteLink(ctx, "/booths", "booths", "Book a booth");
  if (dev === "d") out.text.push(`BRING SOMEONE\n37 seats. Sit with your people.\nBook a booth (8 of them): ${booths}\nRent the whole place: 417-281-4172`);
  const cw = m ? 165 : 254;
  // The call card stands as tall as the booth card beside it (the design: 206, phone 164).
  const callH = (m ? 164 : 206) - 2 * (m ? 14 : 18) - 2;
  const tel = "tel:+14172814172";
  const booth = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${C.ink2}" valign="top" style="background:${C.ink2};border:1px solid ${C.line};border-radius:8px;padding:0;">
${pic("come-in/booth-photo", dev, { href: booths })}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:${m ? "10px 12px 12px" : "14px 16px 16px"};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td valign="middle"><a href="${esc(booths)}" style="text-decoration:none;">${blk("Book a booth", m ? 16 : 20, m ? 22 : 24, C.cream, "white-space:nowrap;")}</a></td><td valign="middle" align="right"><a href="${esc(booths)}" style="text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:${m ? 14 : 18}px;color:${C.gold};">&rarr;</a></td></tr></table>
${mono("8 BOOTHS", { size: m ? 10 : 11, lh: m ? 14 : 16, ls: 1, top: 4 })}
</td></tr></table>
</td></tr></table>`;
  const handset = PIECES["come-in/handset"]?.[dev];
  const hs = handset?.w ?? (m ? 40 : 52);
  const call = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${C.ink2}" height="${callH}" valign="top" style="background:${C.ink2};border:1px solid ${C.line};border-radius:8px;padding:${m ? 14 : 18}px;height:${callH}px;">
<a href="${tel}" style="text-decoration:none;"><img src="${esc(assetUrl(handset?.file ?? ""))}" width="${hs}" alt="" style="display:block;width:${hs}px;height:auto;border:0;"></a>
<a href="${tel}" style="text-decoration:none;">${blk("Rent the<br>whole place", m ? 15 : 18, m ? 19 : 22, C.cream, `margin-top:${m ? 10 : 14}px;`)}</a>
<a href="${tel}" style="text-decoration:none;">${blk("417-281-4172", m ? 15 : 20, m ? 19 : 24, C.gold, `margin-top:${m ? 6 : 8}px;white-space:nowrap;`)}</a>
</td></tr></table>`;
  return band(
    C.ink,
    `${label("BRING SOMEONE", C.gold, dev)}
<div style="margin-top:${m ? 16 : 20}px;">${stubs(ctx)}</div>
<div style="margin-top:${m ? 20 : 24}px;">${pic("come-in/room", dev)}</div>
${blk(m ? "37 seats.<br>Sit with your people." : "37 seats. Sit with your people.", m ? 18 : 22, m ? 24 : 28, C.cream, `margin-top:${m ? 10 : 12}px;`)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:${m ? 20 : 24}px;"><tr>
<td width="${cw}" valign="top" style="width:${cw}px;">${booth}</td>
<td width="12" style="width:12px;font-size:0;">&nbsp;</td>
<td width="${cw}" valign="top" style="width:${cw}px;">${call}</td>
</tr></table>`,
    `${d.pt}px ${d.G}px`,
  );
}

function close(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const b = claimButton(ctx, "bottom");
  // Already signed up: the same close, pointed at their account.
  const done = claimState(ctx.r) === "account";
  const lab = done ? "YOUR ACCOUNT" : "30 SECONDS";
  const head = done ? (m ? "You're set.<br>Come in." : "You're set. Come in.") : m ? "Set it up.<br>Then come in." : "Set it up. Then come in.";
  if (dev === "d") out.text.push(`${lab}\n${head.replace("<br>", " ")}\n${b.label}: ${b.href}\n\nSee you in the dark,\nThe RCL crew`);
  return band(
    C.paper,
    `${label(lab, C.redD, dev)}${h2(head, C.ink, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${button(b.href, b.label, dev, m ? d.CW : 320)}</div>
${signoff("See you in the dark,", dev)}`,
    `${d.pt}px ${d.G}px`,
  );
}

export function comeIn(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      bleed(C.ink, "common/header", dev),
      hero(c, out),
      claimCard(c, out),
      insiders(c, out),
      bar(c, out),
      bring(c, out),
      close(c, out),
      footer(dev, whyOldSite(ctx.r, true), ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}

