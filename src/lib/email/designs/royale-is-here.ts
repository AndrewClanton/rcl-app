// Email 1: "The new Royale is here" (the invite). From the canvas design
// RoyaleIsHere-Desktop / -Phone. One job: "Set my password".
import { esc } from "../format";
import { C, DEV, band, bleed, blk, button, card, cols, footer, h1, h2, label, mono, pic, picWidth, red, textLink, txt, type Dev } from "./kit";
import { artPic, claimButton, claimCard, nameOr, signoff, siteLink, whyOldSite, type Ctx, type DesignOut } from "./shared";

function hero(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  if (dev === "d") out.text.push("LIVE NOW\nTHE NEW ROYALE IS HERE.\nSame booths, same bar. Brand-new website.");
  if (dev === "d") out.bodyTexts.push("The new Royale is here.", "Same booths, same bar. Brand-new website.");
  return `${bleed(C.ink, "royale-is-here/hero", dev)}
${band(C.ink, `${label("LIVE NOW", C.gold, dev)}${h1(`The new Royale<br>is ${red("here")}.`, dev)}${txt("Same booths, same bar. Brand-new website.", d.lede, d.ledelh, C.cream, `margin-top:${dev === "m" ? 12 : 16}px;`)}`, `0 ${d.G}px ${dev === "m" ? 36 : 44}px`)}`;
}

function rewindBox(dev: Dev): string {
  return card(`${pic("royale-is-here/account-rewind", dev)}${txt("Paid by card before? Ask at the bar.", 15, 21, C.cream, "margin-top:10px;")}`, "14px", { bg: C.ink, border: "#4a463d" });
}

function account(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  // The example phone links to their account button's link (the design's "signature" click).
  const href = claimButton(ctx, "signature").href;
  if (dev === "d") out.text.push("ALREADY INSIDE\nPoints, already counting. $1 earns 1 point, and 100 points = $5 off.\nPaid by card before? Ask at the bar.");
  if (dev === "m") {
    // The phone picture is the band between the headline and the points
    // (the dots behind it fade out as in the design).
    return `${band(C.ink, `${label("ALREADY INSIDE", C.gold, dev)}${h2("Points,<br>already counting.", C.cream, dev)}`, "40px 24px 0")}
${bleed(C.ink, "royale-is-here/account-phone", dev, { href })}
${band(C.ink, `${pic("royale-is-here/account-math", dev)}<div style="margin-top:20px;">${rewindBox(dev)}</div>`, "0 24px 40px")}`;
  }
  const left = `${label("ALREADY INSIDE", C.gold, dev)}${h2("Points,<br>already<br>counting.", C.cream, dev)}
<div style="margin-top:24px;">${pic("royale-is-here/account-math", dev)}</div>
<div style="margin-top:24px;">${rewindBox(dev)}</div>`;
  // The phone's EXAMPLE tag reaches a few pixels into the right margin, as in the design.
  return band(C.ink, cols(left, pic("royale-is-here/account-phone", dev, { href }), { leftW: 252, gap: 12 }), "48px 34px 48px 40px");
}

function door(ctx: Ctx, out: DesignOut): string {
  const { dev, r } = ctx;
  const d = DEV[dev];
  if (dev === "d") out.text.push("AT THE DOOR\nCheck in. Rack up points. Every visit scores, and more visits mean bigger badges.");
  const cheer = nameOr(r, "{first name}, your first check-in!", "Your first check-in!");
  return `${band(C.paper, `${label("AT THE DOOR", C.redD, dev)}${h2(dev === "m" ? "Check in.<br>Rack up points." : "Check in. Rack up points.", C.ink, dev)}`, `${d.pt}px ${d.G}px 0`)}
${artPic("door", ctx, `The door tablet cheering “${cheer}” and +55 points for a first visit, past halfway to $5 off.`, C.paper)}
${bleed(C.paper, "royale-is-here/door-badges", dev)}`;
}

function road(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  if (dev === "d") out.text.push("THE STREAK\nKeep the streak. Collect the snacks. 4 weeks in a row: +25 points. 13 weeks: free popcorn. 26 weeks: free pizza. 52 weeks: +500 points.");
  const head = blk("Keep the streak.<br>Collect the snacks.", DEV[dev].h2, DEV[dev].h2lh, C.cream);
  if (dev === "m") {
    return `${band(C.ink, `${label("THE STREAK", C.gold, dev)}<div style="margin-top:12px;">${head}</div>`, "40px 24px 20px")}
${bleed(C.ink, "royale-is-here/road", dev)}`;
  }
  const pairW = picWidth("royale-is-here/road-pair", "d");
  return `${band(
    C.ink,
    `${label("THE STREAK", C.gold, dev)}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;"><tr><td valign="middle">${head}</td><td valign="middle" align="right" width="${pairW}" style="width:${pairW}px;">${pic("royale-is-here/road-pair", dev)}</td></tr></table>`,
    "48px 40px 14px",
  )}
${bleed(C.ink, "royale-is-here/road", dev)}`;
}

function profile(ctx: Ctx, out: DesignOut): string {
  const { dev, r } = ctx;
  const d = DEV[dev];
  if (dev === "d") out.text.push("YOUR PROFILE\nMake an entrance. Pick a color and an entrance, and the door screen plays it when you walk in.");
  const line = nameOr(r, "{first name}, you're checked in", "You're checked in");
  const alt = dev === "m" ? `The door screen in pink with pink confetti: “${line}”.` : `The door screen in pink with pink confetti: “${line}”. Pick from 10 colors and an entrance: Confetti, Unicorn run, Fireworks or Reactions.`;
  return `${band(C.paper, `${label("YOUR PROFILE", C.redD, dev)}${h2("Make an entrance.", C.ink, dev)}`, `${d.pt}px ${d.G}px 0`)}
${artPic("profile", ctx, alt, C.paper)}
${bleed(C.paper, "royale-is-here/profile-rest", dev)}`;
}

function photoCard(ctx: Ctx, href: string, id: string, title: string, detail: string): string {
  const { dev } = ctx;
  const m = dev === "m";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td bgcolor="${C.ink2}" style="background:${C.ink2};border:1px solid ${C.line};border-radius:8px;padding:0;">
${pic(id, dev, { href })}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:${m ? "10px 12px 12px" : "14px 16px 16px"};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td valign="middle"><a href="${esc(href)}" style="text-decoration:none;">${blk(esc(title), m ? 17 : 20, m ? 22 : 24, C.cream)}</a></td>
<td valign="middle" align="right"><a href="${esc(href)}" style="text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:${m ? 16 : 20}px;line-height:20px;color:${C.gold};">&rarr;</a></td>
</tr></table>
${mono(esc(detail), { size: m ? 10 : 11, lh: m ? 14 : 16, ls: 1, top: 4 })}
</td></tr></table>
</td></tr></table>`;
}

function online(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const m = dev === "m";
  const tickets = siteLink(ctx, "/showtimes", "tickets", "Tickets");
  const booths = siteLink(ctx, "/booths", "booths", "Booths");
  const whatsNew = siteLink(ctx, "/whats-new", "whats-new", "What's new");
  if (dev === "d") out.text.push(`BOOK ONLINE\nTickets, from $5: ${tickets}\nBooths (8 of them): ${booths}\nWHAT'S NEW: suggest, vote, build, ship. Coming soon: order from your booth.\nSee it: ${whatsNew}`);
  const stamp = pic("royale-is-here/coming-soon", dev);
  const stampW = picWidth("royale-is-here/coming-soon", dev);
  const soon = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${stampW}" style="width:${stampW}px;">${stamp}</td><td style="padding-left:6px;">${txt("Order from your booth", 15, 20, C.cream, "white-space:nowrap;")}</td></tr></table>`;
  const bottom = m
    ? `<div style="margin-top:12px;">${soon}</div><div style="margin-top:8px;">${textLink(whatsNew, "See it", C.cream, 15)}</div>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:14px;"><tr><td valign="middle">${soon}</td><td valign="middle" align="right">${textLink(whatsNew, "See it", C.cream, 15)}</td></tr></table>`;
  const box = card(`${label("WHAT'S NEW", C.gold, dev)}<div style="margin-top:12px;">${pic("royale-is-here/whatsnew-stops", dev)}</div>${bottom}`, m ? "14px 16px" : "16px 20px", { bg: C.ink, border: "#4a463d" });
  const cw = m ? 165 : 254;
  return band(
    C.ink,
    `${label("BOOK ONLINE", C.gold, dev)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:${m ? 16 : 20}px;"><tr>
<td width="${cw}" valign="top" style="width:${cw}px;">${photoCard(ctx, tickets, "royale-is-here/online-tickets", "Tickets", "FROM $5")}</td>
<td width="12" style="width:12px;font-size:0;">&nbsp;</td>
<td width="${cw}" valign="top" style="width:${cw}px;">${photoCard(ctx, booths, "royale-is-here/online-booths", "Booths", "8 BOOTHS")}</td>
</tr></table>
<div style="margin-top:${m ? 16 : 20}px;">${box}</div>`,
    `${d.pt}px ${d.G}px`,
  );
}

function close(ctx: Ctx, out: DesignOut): string {
  const { dev } = ctx;
  const d = DEV[dev];
  const b = claimButton(ctx, "bottom");
  if (dev === "d") out.text.push(`30 SECONDS\nClaim it now.\n${b.label}: ${b.href}\n\nSee you soon,\nThe Royale crew`);
  return band(
    C.paper,
    `${pic("royale-is-here/filmstrip", dev, { dark: false })}
${label("30 SECONDS", C.redD, dev, dev === "m" ? 28 : 32)}${h2("Claim it now.", C.ink, dev)}
<div style="margin-top:${dev === "m" ? 20 : 24}px;">${button(b.href, b.label, dev, dev === "m" ? d.CW : 320)}</div>
${signoff("See you soon,", dev)}`,
    `${d.pt}px ${d.G}px`,
  );
}

export function royaleIsHere(ctx: Omit<Ctx, "dev">): DesignOut {
  const out: DesignOut = { desktop: "", phone: "", text: [], bodyTexts: [], primaryButtons: 0 };
  for (const dev of ["d", "m"] as const) {
    const c = { ...ctx, dev };
    const html = [
      bleed(C.ink, "common/header", dev),
      hero(c, out),
      claimCard(c, out),
      account(c, out),
      door(c, out),
      road(c, out),
      profile(c, out),
      online(c, out),
      close(c, out),
      footer(dev, whyOldSite(ctx.r, false), ctx.L),
    ].join("\n");
    if (dev === "d") out.desktop = html;
    else out.phone = html;
  }
  return out;
}

