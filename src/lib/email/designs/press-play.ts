// Email 3: "Press play" (former unlimited members). From the canvas design
// PressPlay-Desktop / -Phone, cut down (staff, 10/7): the hero, Insiders+
// with the price and the button. One job: "Restart my unlimited" (their own
// Insiders+ link to Stripe's checkout), or tap a card at the register.
import { C, DEV, band, button, footer, h1, h2, icon, label, mono, pic, red, txt } from "./kit";
import { artPic, finishButton, signoffBand, type Ctx, type DesignOut } from "./shared";
import { FREE_BOOTHS_PER_MONTH } from "@/lib/booth-perk";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const lede = "Our old system isn't charging you, so you don't owe anything.";
  if (dev === "d") {
    out.text.push(`UNLIMITED\nYOUR UNLIMITED IS ON PAUSE.\n${lede}`);
    out.bodyTexts.push("Your unlimited is on pause.", lede);
  }
  return `${artPic("tape", ctx, "An old TV paused, and a VHS tape labeled Unlimited, with your name.", C.ink)}
${band(C.ink, `${label("UNLIMITED", C.gold, dev)}${h1(`Your unlimited<br>is on ${red("pause")}.`, dev)}${txt(lede, d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `0 ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function chip(id: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="18" style="width:18px;">${icon(id, 18)}</td><td valign="middle" style="padding-left:6px;white-space:nowrap;">${mono(text, { size: 11, lh: 14, ls: 1.5, color: C.mute })}</td></tr></table>`;
}

function restart(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const href = finishButton(ctx, "top");
  const price = "$15 plus tax today, then $15 a month. Nothing is owed for the months before.";
  const perks = `Unlimited movies, 10% off at the register, a free coffee or tea every day, and ${FREE_BOOTHS_PER_MONTH} free booth reservations a month.`;
  const other = "You can also restart at the register on your next visit. Questions? Call 417-281-4172.";
  if (dev === "d") {
    out.primaryButtons++;
    out.bodyTexts.push("Restart it as Insiders+.", "Restart my unlimited");
    out.text.push(`INSIDERS+\nRestart it as Insiders+.\n${perks}\n${price}\nRestart my unlimited: ${href}\nSecure checkout by Stripe. Cancel anytime.\n${other}`);
  }
  const chips = m
    ? `${chip("press-play/icon-lock", "SECURE CHECKOUT BY STRIPE")}<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>${chip("press-play/icon-check", "CANCEL ANYTIME")}`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>${chip("press-play/icon-lock", "SECURE CHECKOUT BY STRIPE")}</td><td style="padding-left:24px;">${chip("press-play/icon-check", "CANCEL ANYTIME")}</td></tr></table>`;
  return band(
    C.paper,
    `${label("INSIDERS+", C.redD, dev)}${h2(m ? "Restart it as<br>Insiders+." : "Restart it as Insiders+.", C.ink, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${pic("press-play/perks", dev, { dark: false })}</div>
${txt(price, 17, 25, C.ink, `margin-top:${m ? 20 : 24}px;`)}
<div style="margin-top:${m ? 20 : 24}px;">${button(href, "Restart my unlimited", dev, m ? d.CW : 360)}</div>
<div style="margin-top:${m ? 14 : 16}px;">${chips}</div>
${txt(`You can also restart at the register on your next visit. Questions? Call <a href="tel:+14172814172" style="color:${C.ink};font-weight:700;text-decoration:none;border-bottom:2px solid ${C.gold};">417-281-4172</a>.`, 17, 25, C.ink, `margin-top:${m ? 24 : 28}px;`)}`,
    `${d.pt}px ${d.G}px ${m ? 32 : 36}px`,
  );
}

export function pressPlay(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      `<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:0;font-size:0;line-height:0;">${pic("common/header", dev)}</td></tr>`,
      hero(c, out),
      restart(c, out),
      signoffBand("See you at the movies,", dev, out),
      footer(dev, "You're getting this because you had unlimited on the old Royale Cinema website.", ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}
