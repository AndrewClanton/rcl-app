// Email 1: "The new RCL is here" (the invite). From the canvas design
// RoyaleIsHere-Desktop / -Phone, cut down (staff, 10/7): the hero, points,
// and the account card. One job: "Set my password".
import { C, DEV, band, bleed, footer, h1, h2, label, pic, red, txt } from "./kit";
import { claimCard, signoffBand, whyOldSite, type Ctx, type DesignOut } from "./shared";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const lede = "Book tickets and booths online, and see your points.";
  if (dev === "d") {
    out.text.push(`NEW WEBSITE\nROYALE CINEMA HAS A NEW WEBSITE.\n${lede}`);
    out.bodyTexts.push("Royale Cinema has a new website.", lede);
  }
  return `${bleed(C.ink, "royale-is-here/hero", dev)}
${band(C.ink, `${label("NEW WEBSITE", C.gold, dev)}${h1(`Royale Cinema has a new ${red("website")}.`, dev)}${txt(lede, d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `0 ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function points(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const line = "You earn 1 point for every $1 you spend. 100 points is $5 off.";
  if (dev === "d") out.text.push(`POINTS\nYour points are already counting.\n${line}`);
  return band(
    C.ink,
    `${label("POINTS", C.gold, dev)}${h2(dev === "m" ? "Your points are<br>already counting." : "Your points are already counting.", C.cream, dev)}
<div style="margin-top:${dev === "m" ? 20 : 24}px;">${pic("royale-is-here/account-math", dev)}</div>`,
    `0 ${d.G}px ${d.pt}px`,
  );
}

export function royaleIsHere(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      bleed(C.ink, "common/header", dev),
      hero(c, out),
      points(c, out),
      claimCard(c, out),
      signoffBand("See you soon,", dev, out),
      footer(dev, whyOldSite(ctx.r, false), ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}
