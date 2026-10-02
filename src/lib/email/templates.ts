// The first campaigns, ready to start from (the marketing plan, A8). The
// composer fills in the real week's films when it's time to send.
//
// Voice: the crew talking to a regular at the bar. The real film, night and
// price, one job per email, no ALL CAPS, no fake urgency, signed "The
// Royale crew" (no one's name: Andrew, 10/1). Subject lines and preview text only ever name this
// year's titles (MPLC); archive titles live in the members-only section.
// No server code.
import type { CampaignContent } from "./render";
import type { AlertType, Audience, Automation, CampaignKind, Category } from "./types";

export interface Starter {
  key: string;
  label: string;
  about: string;
  kind: CampaignKind;
  category: Category;
  automation?: Automation;
  name: string;
  subject: string;
  subjectB?: string;
  preheader: string;
  content: CampaignContent;
  audience: Audience;
  holdoutPct: number;
}

const SIGNOFF = { t: "signoff" as const, from: "The Royale crew" };

export function lineupStarter(start: string, days = 7): Starter {
  return {
    key: "lineup",
    label: "Weekly lineup",
    about: "Tuesday 10:30 AM, Tuesday to Monday. Every showtime is a button.",
    kind: "lineup",
    category: "lineup",
    name: "Weekly lineup",
    subject: "",
    preheader: "",
    content: {
      lineup: { start, days, skipMovieIds: [], skipHappeningIds: [], featuredMovieId: null },
      blocks: [
        { t: "hero", eyebrow: "The weekly lineup", headline: "This week at the Royale", sub: "37 seats a show, so tap a time early." },
        {
          t: "paragraph",
          text: "Hi {first name},\n\nHere's the week on Broadway. Tap any time to grab a seat. Insiders+ members walk in free, and the $5 Special is still popcorn and a soda for five bucks.",
        },
        { t: "lineup" },
        { t: "barNote", menuItemId: null, line: "" },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "all" }] },
    holdoutPct: 0,
  };
}

// "The invite" and "Insiders+ come-back" were retired (v1.10): they went to
// the same people as the ready-made "The new Royale is here" and "Press
// play" (Ready to send), so anyone could have had two invites.
export const STARTERS: Starter[] = [
  {
    key: "event_horror_trivia",
    label: "Halloween horror trivia",
    about: "Events on. The Thursday before; one reminder only to people who clicked.",
    kind: "event",
    category: "events",
    name: "Halloween horror trivia",
    subject: "Horror trivia, two Tuesdays. Pick a team you'd survive with.",
    subjectB: "Know your final girls? Halloween trivia is Oct 13 and 27",
    preheader: "7 PM at the Royale. Winners take home Royale vouchers. Costumes welcome, screaming tolerated.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Tuesdays at 7", headline: "Halloween horror trivia", sub: "Two nights. Bring a team, bring a costume, bring your worst scream." },
        { t: "paragraph", text: "Hi {first name},\n\nWe're doing horror trivia two Tuesdays this month. Winners take home Royale vouchers. Teams of up to six, and it's free to play." },
        { t: "eventRow", houseEventId: "" },
        { t: "eventRow", houseEventId: "" },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "all" }] },
    holdoutPct: 0,
  },
  {
    key: "tonight",
    label: "\"Tonight\": a members-only show",
    about: "Alerts on, and fans of that kind of show. Only with 10+ seats left.",
    kind: "alert",
    category: "alerts",
    name: "Tonight: members-only midnight show",
    subject: "Tonight at midnight: a members-only horror show",
    subjectB: "Can't sleep? Neither can we. Midnight show tonight.",
    preheader: "One showing, 37 seats, and a title we can only tell members. It's inside.",
    content: {
      alert: "tonight",
      window: { start: "", days: 1 },
      blocks: [
        { t: "hero", eyebrow: "Tonight only", headline: "A members-only midnight show", sub: "One showing, 37 seats." },
        { t: "paragraph", text: "Hi {first name},\n\nWe can't put this one on the website, so you're hearing it here first. Scroll down for the title." },
        { t: "archiveSection", movieIds: [] },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "archive_fans", within: 90, min: 1 }] },
    holdoutPct: 0,
  },
  {
    key: "winback_indy",
    label: "Win-back: \"We saved your seat\"",
    about: "The Indy-era people who said yes and never made an old-site account.",
    kind: "announcement",
    category: "rewards",
    name: "We saved your seat",
    subject: "It's been a minute. Your seat's still here.",
    subjectB: "The Royale got a glow-up (the popcorn didn't need one)",
    preheader: "New website, same 37 seats, same $5 popcorn and a soda. Here's what's on.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "It's been a minute", headline: "We saved your seat.", sub: "New website, same 37 seats." },
        { t: "paragraph", text: "Hi {first name},\n\nYou bought tickets from us a while back, so here's what's new: a new website, your own member account with points on everything, and the same $5 Special (popcorn and a soda)." },
        { t: "button", label: "See what's playing", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "consent", v: ["indy_yes"] }, { r: "old_site", v: false }] },
    holdoutPct: 10,
  },
  {
    key: "announcement",
    label: "Blank announcement",
    about: "Start from nothing.",
    kind: "announcement",
    category: "events",
    name: "Announcement",
    subject: "",
    preheader: "",
    content: { blocks: [{ t: "hero", eyebrow: "", headline: "Headline", sub: "" }, { t: "paragraph", text: "Hi {first name},\n\n" }, SIGNOFF] },
    audience: { include: [{ r: "all" }] },
    holdoutPct: 0,
  },
];

// ---------- automations (one long-lived campaign row each) ----------
export const AUTOMATION_STARTERS: Record<Automation, Omit<Starter, "key" | "label" | "about">> = {
  welcome_1: {
    kind: "automation",
    category: "rewards",
    automation: "welcome_1",
    name: "Welcome #1",
    subject: "Welcome in, {first name}. Here's your member card.",
    subjectB: "You're an Insider now. First stop: 50 points.",
    preheader: "Check in at the door on your first visit for the Welcome badge. 100 points = $5 off.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Welcome to the Royale", headline: "You're an Insider now.", sub: "Here's how it works, in about ten seconds." },
        { t: "memberCard" },
        {
          t: "paragraph",
          text: "Your card is the QR code in your account. Scan it at the door or the register and you earn 1 point for every $1 at the bar, kitchen and box office. Checking in earns 5 points, and your first check-in gets the Welcome badge: 50 more. 100 points = $5 off.",
        },
        { t: "paragraph", text: "While you're here: the $5 Special is popcorn and a soda for five bucks. And if you come twice a month, Insiders+ ($15) is paid for and every screening after that is free." },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "all" }] },
    holdoutPct: 0,
  },
  welcome_2: {
    kind: "automation",
    category: "rewards",
    automation: "welcome_2",
    name: "Welcome #2: walk in free",
    subject: "How to walk in free at the Royale",
    preheader: "Two movies a month and Insiders+ has paid for itself. Here's the math.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Insider tip", headline: "How to walk in free.", sub: "Tickets are $8. Insiders+ is $15 a month." },
        { t: "paragraph", text: "Hi {first name},\n\nSo two movies a month and Insiders+ has paid for itself. After that every screening is free, plus two booth nights a month and money off at the bar." },
        { t: "button", label: "See how Insiders+ works", link: "/membership#join", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "tier", v: "Insiders" }] },
    holdoutPct: 0,
  },
  welcome_3: {
    kind: "automation",
    category: "rewards",
    automation: "welcome_3",
    name: "Welcome #3: here's this week",
    subject: "Here's what's on at the Royale this week",
    preheader: "Your first check-in gets the Welcome badge: 50 points.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Come on in", headline: "Here's this week.", sub: "Your first check-in gets the Welcome badge: 50 points." },
        { t: "paragraph", text: "Hi {first name},\n\nYou haven't made it in yet, so here's what's playing. Tap a time to grab a seat, and scan your member card at the door." },
        { t: "button", label: "See what's playing", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "never_visited" }] },
    holdoutPct: 0,
  },
  birthday: {
    kind: "automation",
    category: "rewards",
    automation: "birthday",
    name: "Birthday week",
    subject: "{first name}, it's your birthday week. We noticed.",
    subjectB: "Happy birthday week from 715 E Broadway",
    preheader: "Check in any day this week and the Birthday badge drops 50 points on your account.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Happy birthday week", headline: "It's your week, {first name}.", sub: "Check in any day this week for the Birthday badge." },
        { t: "ticketStub", label: "Birthday badge", big: "50 points", sub: "Scan your member card at the door any day this week." },
        { t: "button", label: "Pick your birthday movie", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "all" }] },
    holdoutPct: 0,
  },
  plus_upsell: {
    kind: "automation",
    category: "offers",
    automation: "plus_upsell",
    name: "Insiders+, personal",
    subject: "You'd have walked in free this month",
    preheader: "Insiders+ is $15 a month, and every screening after that is free.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "Quick math", headline: "You'd have walked in free.", sub: "Insiders+ is $15 a month." },
        { t: "ticketSpend" },
        { t: "button", label: "Switch to Insiders+", link: "/membership#join", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "tier", v: "Insiders" }, { r: "paid_tickets", within: 30, min: 2 }] },
    holdoutPct: 10,
  },
  winback_45: {
    kind: "automation",
    category: "rewards",
    automation: "winback_45",
    name: "Win-back, 45 days",
    subject: "It's been a minute. Your seat's still here.",
    preheader: "Here's what's on this week at the Royale.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "We miss you", headline: "Your seat's still here.", sub: "Here's what's on this week." },
        { t: "paragraph", text: "Hi {first name},\n\nIt's been a few weeks. Come see what's new on the screen, and scan in at the door for your points." },
        { t: "button", label: "See what's playing", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "lapsed", days: 45 }] },
    holdoutPct: 10,
  },
  winback_90: {
    kind: "automation",
    category: "rewards",
    automation: "winback_90",
    name: "Win-back, 90 days",
    subject: "The Royale misses you (the popcorn does too)",
    preheader: "Same 37 seats, same $5 popcorn and a soda. Here's what's on.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "It's been a while", headline: "Come back to Broadway.", sub: "Same 37 seats, same $5 Special." },
        { t: "paragraph", text: "Hi {first name},\n\nIt's been about three months. No pitch, just the showtimes: tap one and we'll save you a seat." },
        { t: "button", label: "See what's playing", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "lapsed", days: 90 }] },
    holdoutPct: 10,
  },
  reconfirm: {
    // An automation like the others (kind 'automation'), so it's run the
    // same way: queued once a day, sent while 'active'.
    kind: "automation",
    category: "account",
    automation: "reconfirm",
    name: "Still want these?",
    subject: "Still want the Royale's weekly lineup?",
    preheader: "One tap keeps you on. Otherwise we'll stop sending, no hard feelings.",
    content: {
      blocks: [
        { t: "hero", eyebrow: "A quick question", headline: "Still want these?", sub: "One tap keeps you on the list." },
        { t: "paragraph", text: "Hi {first name},\n\nWe haven't seen you click or come in for a while, and we'd rather not fill your inbox with things you don't want. If you'd like the lineup, tap below. If not, do nothing: in two weeks we'll stop sending (receipts and tickets still come)." },
        { t: "button", label: "Keep me on", link: "/showtimes", primary: true },
        SIGNOFF,
      ],
    },
    audience: { include: [{ r: "sunset_due" }] },
    holdoutPct: 0,
  },
};

export function alertLabel(a: AlertType | undefined): string {
  return a === "tonight" ? "Tonight" : a === "weekend" ? "This weekend" : a === "last_chance" ? "Last chance" : a === "just_added" ? "Just added" : "Alert";
}
