// Email 2: "Come in" (reasons to visit). From the canvas design
// ComeIn-Desktop / -Phone, cut down (staff, 10/7): the hero, Insiders+, and
// the account card. One job: "Set my password" for anyone without a login;
// for everyone else, their account.
import { C, DEV, band, bleed, blk, footer, h1, h2, label, mono, pic, red, textLink, txt } from "./kit";
import { claimCard, signoffBand, siteLink, whyOldSite, type Ctx, type DesignOut } from "./shared";
import { FREE_BOOTHS_PER_MONTH } from "@/lib/booth-perk";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const lede = "Movies, a full bar and kitchen, and booths you can reserve.";
  if (dev === "d") {
    out.text.push(`ROYALE CINEMA LOUNGE\nCOME SEE A MOVIE.\n${lede}`);
    out.bodyTexts.push("Come see a movie.", lede);
  }
  return `${bleed(C.ink, "come-in/hero", dev)}
${band(C.ink, `${label("ROYALE CINEMA LOUNGE", C.gold, dev)}${h1(`Come see<br>a ${red("movie")}.`, dev)}${txt(lede, d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `4px ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function insiders(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const plus = siteLink(ctx, "/membership", "insiders-plus", "See Insiders+");
  const perks = `Unlimited movies, 10% off at the register, a free coffee or tea every day, and ${FREE_BOOTHS_PER_MONTH} free booth reservations a month.`;
  if (dev === "d") out.text.push(`INSIDERS+\nInsiders+ is $15 a month.\n${perks}\nSee Insiders+: ${plus}`);
  const price = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td style="border:2px solid ${C.gold};border-radius:6px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td height="52" valign="middle" style="height:52px;padding:0 ${m ? 12 : 16}px;">${blk("$15", 28, 32, C.gold)}</td>
<td valign="middle" style="padding:8px 0;"><div style="height:36px;border-left:2px dashed ${C.gold};font-size:0;line-height:0;">&nbsp;</div></td>
<td valign="middle" style="padding:0 ${m ? 12 : 16}px;">${mono("A MONTH", { size: 11, lh: 14, ls: 1.5, color: C.cream })}</td>
</tr></table></td></tr></table>`;
  return band(
    C.ink,
    `${label("INSIDERS+", C.gold, dev)}${h2(m ? "Unlimited movies<br>for $15 a month." : "Unlimited movies for $15 a month.", C.cream, dev)}
<div style="margin-top:${m ? 20 : 24}px;">${pic("come-in/plus-perks", dev)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${m ? 20 : 24}px;"><tr><td valign="middle">${price}</td><td valign="middle" style="padding-left:${m ? 16 : 24}px;">${textLink(plus, "See Insiders+", C.cream)}</td></tr></table>`,
    `0 ${d.G}px ${d.pt}px`,
  );
}

export function comeIn(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      bleed(C.ink, "common/header", dev),
      hero(c, out),
      insiders(c, out),
      claimCard(c, out),
      signoffBand("See you at the movies,", dev, out),
      footer(dev, whyOldSite(ctx.r, true), ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}
