// Email 3: "Press play" (former unlimited members). From the canvas design
// PressPlay-Desktop / -Phone. One job: "Restart my unlimited" (their own
// Insiders+ link to Stripe's checkout), or tap a card at the register.
import { esc } from "../format";
import { C, DEV, band, blk, button, card, footer, h1, h2, icon, label, mono, pic, red, txt, type Dev } from "./kit";
import { artPic, finishButton, signoff, type Ctx, type DesignOut } from "./shared";
import { FREE_BOOTHS_PER_MONTH } from "@/lib/booth-perk";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  if (dev === "d") {
    out.text.push("UNLIMITED\nYOUR UNLIMITED IS ON PAUSE.\nOur old system isn't charging you, so nothing's owed. That's on us.");
    out.bodyTexts.push("Your unlimited is on pause.", "Our old system isn't charging you, so nothing's owed. That's on us.");
  }
  return `${artPic("tape", ctx, "An old TV paused, and a VHS tape labeled Unlimited, with your name.", C.ink)}
${band(C.ink, `${label("UNLIMITED", C.gold, dev)}${h1(`Your unlimited<br>is on ${red("pause")}.`, dev)}${txt("Our old system isn't charging you, so nothing's owed. That's on us.", d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `0 ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function chip(id: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="18" style="width:18px;">${icon(id, 18)}</td><td valign="middle" style="padding-left:6px;white-space:nowrap;">${mono(text, { size: 11, lh: 14, ls: 1.5, color: C.mute })}</td></tr></table>`;
}

function play(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const href = finishButton(ctx, "top");
  if (dev === "d") {
    out.primaryButtons++;
    out.bodyTexts.push("Restart it today.", "Restart my unlimited");
    out.text.push(`PRESS PLAY\nRestart it today. Nothing owed for the months before: $15 plus tax today, then $15 a month.\nRestart my unlimited: ${href}\nSecure checkout by Stripe. Cancel anytime.`);
  }
  const chips = m
    ? `${chip("press-play/icon-lock", "SECURE CHECKOUT BY STRIPE")}<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>${chip("press-play/icon-check", "CANCEL ANYTIME")}`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>${chip("press-play/icon-lock", "SECURE CHECKOUT BY STRIPE")}</td><td style="padding-left:24px;">${chip("press-play/icon-check", "CANCEL ANYTIME")}</td></tr></table>`;
  return band(
    C.paper,
    `${label("PRESS PLAY", C.redD, dev)}${h2("Restart it today.", C.ink, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${pic("press-play/counter", dev, { dark: false })}</div>
<div style="margin-top:${m ? 24 : 28}px;">${button(href, "Restart my unlimited", dev, m ? d.CW : 360)}</div>
<div style="margin-top:${m ? 14 : 16}px;">${chips}</div>`,
    `${d.pt}px ${d.G}px`,
  );
}

function tile(dev: Dev, id: string, title: string, sub: string): string {
  const m = dev === "m";
  return card(`${pic(id, dev)}${blk(title, m ? 16 : 20, m ? 20 : 24, C.cream, `margin-top:${m ? 10 : 12}px;`)}${mono(esc(sub), { size: m ? 10 : 11, lh: m ? 14 : 16, ls: 1.5, top: 4 })}`, m ? "12px" : "14px", { height: m ? 178 : undefined });
}

function ways(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  if (dev === "d") out.text.push("TWO WAYS\nOnline, any time. Or at the register, next visit: tap your card.");
  const cw = m ? 165 : 254;
  return band(
    C.ink,
    `${label("TWO WAYS", C.gold, dev)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:${m ? 16 : 20}px;"><tr>
<td width="${cw}" valign="top" style="width:${cw}px;">${tile(dev, "press-play/ways-online", "Online", "ANY TIME")}</td>
<td width="12" style="width:12px;font-size:0;">&nbsp;</td>
<td width="${cw}" valign="top" style="width:${cw}px;">${tile(dev, "press-play/ways-register", m ? "At the<br>register" : "At the register", "NEXT VISIT")}</td>
</tr></table>`,
    `${d.pt}px ${d.G}px`,
  );
}

function perks(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  if (dev === "d") out.text.push(`INSIDERS+\nUnlimited, and then some: every movie free, 10% off at the register, ${FREE_BOOTHS_PER_MONTH} free booths a month, and a free black coffee or hot tea every day.`);
  return band(C.paper, `${label("INSIDERS+", C.redD, dev)}${h2(m ? "Unlimited,<br>and then some." : "Unlimited, and then some.", C.ink, dev)}<div style="margin-top:${m ? 20 : 24}px;">${pic("press-play/perks", dev, { dark: false })}</div>`, `${d.pt}px ${d.G}px`);
}

function extras(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  if (dev === "d") out.text.push("ALSO ON THE NEW SITE\nPoints, badges, your color, your page, booking booths and buying tickets.");
  return band(C.ink, `${label("ALSO ON THE NEW SITE", C.gold, dev)}<div style="margin-top:${dev === "m" ? 16 : 20}px;">${pic("press-play/extras", dev)}</div>`, `${d.pt}px ${d.G}px`);
}

function close(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const href = finishButton(ctx, "bottom");
  if (dev === "d") out.text.push(`YOUR MOVE\nReady when you are.\nRestart my unlimited: ${href}\nOr tap your card at the register.\nQuestions? 417-281-4172\n\nSee you at the movies,\nThe RCL crew`);
  const row = (id: string, html: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="24" style="width:24px;">${icon(id, 24)}</td><td valign="middle" style="padding-left:10px;">${txt(html, 17, 24, C.ink)}</td></tr></table>`;
  return band(
    C.paper,
    `${label("YOUR MOVE", C.redD, dev)}${h2("Ready when you are.", C.ink, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${button(href, "Restart my unlimited", dev, m ? d.CW : 360)}</div>
<div style="margin-top:20px;">${row("press-play/icon-tapcard", "Or tap your card at the register.")}<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>${row("press-play/icon-phone", `Questions? <a href="tel:+14172814172" style="color:${C.ink};font-weight:700;text-decoration:none;border-bottom:2px solid ${C.gold};">417-281-4172</a>`)}</div>
${signoff("See you at the movies,", dev).replace(`margin-top:${m ? 36 : 40}px;`, `margin-top:${m ? 32 : 36}px;`)}`,
    `${d.pt}px ${d.G}px`,
  );
}

export function pressPlay(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      `<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:0;font-size:0;line-height:0;">${pic("common/header", dev)}</td></tr>`,
      hero(c, out),
      play(c, out),
      ways(c, out),
      perks(c, out),
      extras(c, out),
      close(c, out),
      footer(dev, "You're getting this because you had unlimited on the old Royale Cinema website.", ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}
