// The three ready-made invite emails (Back office -> Email -> Ready to
// send), designed on the Design canvas (page "The invites") and translated
// to email here: who each is for, its subject and preview text, and how it
// draws for one person. They go out through the ordinary email system
// (campaign-send.ts) as campaigns whose only block is { t: "design" }.
//
// Andrew's rules for these: half the words, picture-led, only live
// features, never a staff or owner name, signed "The Royale crew".
// No server code.
import { applyFirstName } from "../format";
import type { Audience, CampaignKind, Category } from "../types";
import { comeIn } from "./come-in";
import { shell } from "./kit";
import { pressPlay } from "./press-play";
import { royaleIsHere } from "./royale-is-here";
import type { DesignLinks, DesignOut, DesignRecipient } from "./shared";
import type { ArtKind, DesignKey } from "./types";

export { DESIGN_KEYS, isDesignKey, type DesignKey } from "./types";
export type { DesignRecipient } from "./shared";

export interface DesignMeta {
  key: DesignKey;
  title: string; // what staff call it
  about: string; // one line on the card
  name: string; // the campaign's name in the email list
  kind: CampaignKind;
  category: Category;
  subject: string; // {first name} is filled in, or the sentence is tidied without it
  preheader: string;
  audience: Audience;
  who: string; // the audience, in plain words, for the confirm step
  outcome: { key: "signed_in" | "plus"; label: string; about: string };
  needs: { claim: boolean; finish: boolean; art: ArtKind[] };
  draw: (ctx: { key: DesignKey; r: DesignRecipient; L: DesignLinks }) => DesignOut;
}

export const DESIGNS: Record<DesignKey, DesignMeta> = {
  "royale-is-here": {
    key: "royale-is-here",
    title: "The new Royale is here",
    about: "The invite: their account is already set up, with points. One button: Set my password.",
    name: "Ready to send: The new Royale is here",
    // The invite: an account email (no caps, no "kind of email" switch),
    // still only to people who want email from us, with an unsubscribe.
    kind: "invite",
    category: "account",
    subject: "{first name}, the new Royale website is here",
    preheader: "Your account, points and badges are already set up. It takes about 30 seconds.",
    // A phone on file: "Set my password" links are only made for accounts
    // with one (lib/member-claim.ts hasPhoneOnFile).
    audience: { include: [{ r: "has_login", v: false }, { r: "has_phone", v: true }], order: "trust" },
    who: "Members with an email and a phone number on file who haven't set up a website login yet.",
    outcome: { key: "signed_in", label: "Signed in", about: "Set up their website login since the email" },
    needs: { claim: true, finish: false, art: ["door", "profile"] },
    draw: royaleIsHere,
  },
  "come-in": {
    key: "come-in",
    title: "Come in",
    about: "Reasons to visit: Insiders+, the bar and kitchen, bring someone. One button: Set my password (or their account).",
    name: "Ready to send: Come in",
    kind: "offer",
    category: "offers",
    subject: "{first name}, your next night at the Royale",
    preheader: "Insiders+ is $15 a month: every movie free, 10% off, a free coffee or tea every day and 2 free booths.",
    audience: { include: [{ r: "all" }], order: "trust" },
    who: "Everyone with an email who gets offers and Insiders+ news from us (anyone who turned those off, or all email off, is left out).",
    outcome: { key: "signed_in", label: "Signed in", about: "Had no website login when it went, and have one now" },
    needs: { claim: true, finish: false, art: [] },
    draw: comeIn,
  },
  "press-play": {
    key: "press-play",
    title: "Press play",
    about: "For former unlimited members: their unlimited is on pause, nothing's owed, restart today. One button: Restart my unlimited.",
    name: "Ready to send: Press play",
    // About their own membership: an account email like the invite (no
    // caps), still only to people who want email from us, with an
    // unsubscribe.
    kind: "announcement",
    category: "account",
    subject: "{first name}, your unlimited is on pause",
    preheader: "Our old website's billing didn't make the move. Nothing's owed. Restart online or at the register.",
    audience: { include: [{ r: "legacy_needs_setup" }], order: "trust" },
    who: "Former unlimited members (they paid for unlimited on the old website) with nothing paying for their Insiders+ now.",
    outcome: { key: "plus", label: "Set up Insiders+", about: "Paying for Insiders+ now" },
    needs: { claim: false, finish: true, art: ["tape"] },
    draw: pressPlay,
  },
};

export interface DesignRendered {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  bodyTexts: string[];
  primaryButtons: number;
}

export function renderDesignEmail(key: DesignKey, subject: string, preheader: string, r: DesignRecipient, L: DesignLinks): DesignRendered {
  const d = DESIGNS[key];
  const s = applyFirstName(subject.trim() || d.subject, r.firstName);
  const p = applyFirstName((preheader ?? "").trim() || d.preheader, r.firstName);
  const out = d.draw({ key, r, L });
  const text = [
    ...out.text,
    "",
    `Email preferences: ${L.preferencesUrl}`,
    `Unsubscribe: ${L.unsubscribeUrl}`,
    "",
    "Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · On Route 66 · 417-281-4172",
  ]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
  return { subject: s, preheader: p, html: shell({ subject: s, preheader: p, desktop: out.desktop, phone: out.phone }), text, bodyTexts: out.bodyTexts, primaryButtons: out.primaryButtons };
}
