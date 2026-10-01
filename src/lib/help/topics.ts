// The help library: one short entry per topic, used two ways. The little
// "i" bubbles (src/components/help/InfoTip.tsx) show one entry next to the
// thing it explains, and /help lists them all as the staff FAQ. Depth goes
// in the trainings (src/training/), which an entry links to by slug.
//
// Plain values only (no server imports): the bubbles run in the browser.
//
// Writing an entry: say what it is AND why it works that way, in two to
// five short sentences, the way you'd explain it to someone new on their
// first shift. Steps are optional and short. The key is the /help anchor
// (/help#printers-add), so don't rename one that's already placed.

export type HelpArea =
  | "Printers"
  | "Register: devices"
  | "Register: payments"
  | "Register: members and the door"
  | "Register: shift tools"
  | "Members and memberships"
  | "Menu and inventory"
  | "Showtimes, events and booths"
  | "Reports and money"
  | "Team and staff";

// The order areas are listed in on /help.
export const HELP_AREAS: HelpArea[] = [
  "Printers",
  "Register: devices",
  "Register: payments",
  "Register: members and the door",
  "Register: shift tools",
  "Members and memberships",
  "Menu and inventory",
  "Showtimes, events and booths",
  "Reports and money",
  "Team and staff",
];

export interface HelpLink {
  label: string;
  href: string;
}

export interface HelpTopic {
  title: string;
  area: HelpArea;
  // Two to five short sentences: the what and the why.
  body: string;
  steps?: string[];
  // Other pages in the site. The training (trainingSlug) and this topic's
  // place on /help are added automatically.
  links?: HelpLink[];
  // A training in src/lib/training/catalog.ts.
  trainingSlug?: string;
}

export const HELP_TOPICS = {
  // ---------- printers ----------
  "printers-how-it-works": {
    title: "How the printers get their jobs",
    area: "Printers",
    body:
      "Our receipt and kitchen printers don't wait for the iPad to send them anything. Every few seconds each printer asks the website \"anything for me?\" and prints whatever is waiting. Because the iPad only ever talks to the website, it never has to trust the printer's security certificate, which is what used to break printing after an update or a restart. A printer that was off for a minute picks up what's still waiting when it's back.",
    links: [{ label: "Printers", href: "/admin/printers" }],
    trainingSlug: "receipt-printer-setup",
  },
  "printers-add": {
    title: "Adding a printer",
    area: "Printers",
    body:
      "Add printer makes a login for one printer: an ID and a password it uses to ask the website for its jobs. The password is shown only once, right after you save, so have the printer's settings page (or the Pi) ready before you start. Pick the kind: a new Epson that collects its own jobs, or the bar's old TM-m30 through the Raspberry Pi.",
    steps: [
      "Back office → Printers → Add printer.",
      "Name it, say where it is, pick the kind and what it prints, then Save.",
      "Type the settings shown into the printer (or the Pi) before you close that panel.",
      "Wait for it to say Online, then press Test print.",
    ],
    trainingSlug: "receipt-printer-setup",
  },
  "printers-sdp-settings": {
    title: "The Server Direct Print settings",
    area: "Printers",
    body:
      "Server Direct Print is the Epson feature that makes a printer check a web address for work. You type our address, the printer's ID and its password into the printer's own settings page, which you open by typing the printer's IP address into a browser on the theater's network. Access Test checks that the printer can reach the website and log in before you save.",
    steps: [
      "On a phone or computer on the theater's network, open http:// and the printer's IP. Log in: the password is the serial number on the label underneath, unless someone changed it.",
      "TM-Intelligent: check that ePOS-Print is Enabled.",
      "Server Direct Print: Enable, then fill in Server 1 exactly as shown here. Leave Server 2 and 3 off.",
      "Press Access Test next to Server 1, then Set. The printer may restart.",
    ],
    trainingSlug: "receipt-printer-setup",
  },
  "printers-online": {
    title: "Online and \"Last seen\"",
    area: "Printers",
    body:
      "Online means the printer asked the website for work in the last minute or so. \"Last seen 12 min ago\" means it stopped asking: it's off, unplugged, off the network, or its password changed. \"Never connected\" means it has never logged in, so the settings typed into it are probably wrong. This page refreshes itself every 20 seconds.",
    steps: [
      "Check the printer is on, has paper, and its network cable is in.",
      "Print its status sheet to see whether it still has an IP address.",
      "Still offline? Press New password and type the new one into the printer.",
    ],
    trainingSlug: "receipt-printer-setup",
  },
  "printers-station": {
    title: "What each printer prints",
    area: "Printers",
    body:
      "Each job belongs to exactly one printer: the Bar's receipts, the Outdoor stand's receipts, or the kitchen's order tickets. Giving a job to this printer takes it off whichever printer had it, so two printers never print the same receipt. Each register chooses which station it is under Devices, and its receipts, tickets and cash drawer go to that station's printer.",
    trainingSlug: "receipt-printer-setup",
  },
  "printers-pi-relay": {
    title: "The Pi relay for the bar's old printer",
    area: "Printers",
    body:
      "The bar's original TM-m30 is too old to check the website for jobs itself. A small Raspberry Pi on the same network does it for the printer: every few seconds it asks the website for the bar's jobs and hands them to the TM-m30. To the website it's just another printer, with its own ID and password. If the bar printer shows offline, check that both the Pi and the printer are on.",
    steps: [
      "Add printer, kind: \"The old TM-m30 at the bar, through the Raspberry Pi relay\", printing Bar receipts.",
      "Put the settings block it shows into /etc/rcl-print-relay.conf on the Pi.",
      "Restart the relay (sudo systemctl restart rcl-print-relay) and wait for Online.",
    ],
    trainingSlug: "receipt-printer-setup",
  },
  "printers-kitchen-tickets": {
    title: "Kitchen order tickets",
    area: "Printers",
    body:
      "Once a kitchen printer is set up, every order from either register prints one ticket there with the whole order on it; movie tickets are left off. A tab prints its first ticket like any order, then ADD-ON tickets under the same number with only what was added. A tab's ticket waits about 30 seconds after the last change, so a round rung up one tap at a time prints as one ticket. It prints right away when the tab is put away or paid.",
  },
  "printers-job-expiry": {
    title: "Why some print jobs expire",
    area: "Printers",
    body:
      "A job that waits too long for its printer is dropped on purpose: receipts and tickets after 10 minutes, a cash-drawer kick after 2, a kitchen ticket after an hour. That way a printer coming back online never prints a receipt for someone long gone, or pops the drawer out of nowhere. A failed or expired receipt can be sent again with Reprint under Recent print jobs.",
  },

  // ---------- register: devices ----------
  "devices-station": {
    title: "Which register is this?",
    area: "Register: devices",
    body:
      "Bar or Outdoor stand. It decides which receipt printer this register uses when it prints through the website, and it's printed on the kitchen's tickets so they know where the food goes. It's saved on this iPad only, so set it once on each register.",
    trainingSlug: "receipt-printer-setup",
  },
  "devices-reader": {
    title: "The card reader for this register",
    area: "Register: devices",
    body:
      "The register never connects to the card reader directly. It tells Stripe which reader to wake up, and the reader takes the payment over the internet, so the two only need to be online, not connected to each other. There's more than one reader, so each register picks the one sitting next to it; the choice is saved on this iPad. \"Offline\" means Stripe can't reach that reader: check that it's on and connected.",
    steps: ["A brand-new reader is registered first in the Stripe dashboard (Terminal → Readers), then picked here."],
  },
  "devices-print-via": {
    title: "Print through the website",
    area: "Register: devices",
    body:
      "Through the website, this register sends receipts, tickets and the drawer kick to the website, and the station's printer collects them. There's nothing to accept on the iPad, and it keeps working after updates and restarts. \"Straight to a printer IP\" is the old way: the iPad talks to the printer itself and has to trust its certificate first, which breaks now and then. Use the website unless this station has no printer set up yet.",
    links: [{ label: "Printers (managers)", href: "/admin/printers" }],
    trainingSlug: "receipt-printer-setup",
  },

  // ---------- register: payments ----------
  "card-on-file-tip": {
    title: "The tip on a card on file",
    area: "Register: payments",
    body:
      "A card on file is charged without a tap, so the reader never shows its usual tip screen. Instead the register asks on the reader: 15%, 20% or 25% of the pre-tax total, Other amount (whole dollars), or No tip. Then the card is charged the total plus their tip. No reader here, or they'd rather tell you? Tap \"Enter the tip here instead\".",
  },
  "tab-card-on-file": {
    title: "A card on file for a tab",
    area: "Register: payments",
    body:
      "When a tab opens, the customer can tap their card on the reader and Stripe saves it. Nothing is charged then. When the tab closes, \"Charge card on file\" charges the final total and tip to that card with no second tap, then takes the card off file. It's there for the person who wanders off without closing out.",
  },
  "manager-pin": {
    title: "Why this needs a manager PIN",
    area: "Register: payments",
    body:
      "Refunds, cancelling a tab and cancelling a booth booking give money back or wipe out a sale, so a manager approves them with their own PIN, and the approval records whose PIN it was. Five wrong PINs within 10 minutes locks approvals for 10 minutes, for the whole building. Managers still on 9999 should pick their own under My PIN: until they do, anyone who knows 9999 can approve.",
    links: [{ label: "My PIN", href: "/admin/my-pin" }],
  },
  refunds: {
    title: "Refunding a sale",
    area: "Register: payments",
    body:
      "Refund from Recent orders on the register, or from a member's Purchase history in the back office. A manager enters their PIN to approve it. The card part goes back to the card through Stripe on its own; you hand back any cash part from the drawer. A refunded sale's tickets stop counting in the box office report.",
  },
  vouchers: {
    title: "Paper vouchers",
    area: "Register: payments",
    body:
      "Vouchers are the paper prizes, like the ones from trivia. Tap $5, $10 or $20 once for each voucher handed over, or type an odd amount. Vouchers never give change: if they cover the order it's paid, and if not, cash or card pays the rest.",
  },

  // ---------- register: members and the door ----------
  "door-checkin": {
    title: "Check-in for points",
    area: "Register: members and the door",
    body:
      "Regulars check in on the customer screen with their phone number. A card pops up here with their photo, full name and the last four digits of their phone, so you can say \"yes, that's them\" before anything is saved. That stops anyone checking in as somebody else. A new customer can be set up right there with a first name and phone. Once you confirm, the screen plays the entrance they picked on their account (a unicorn, confetti, fireworks or floating stickers, in their color) with their profile line; it never gets in the way of the keypad. If a profile line is rude, hide it from their page in Members.",
    links: [{ label: "Top regulars (managers)", href: "/admin/members/regulars" }],
  },
  "points-and-badges": {
    title: "Points, visits and badges",
    area: "Register: members and the door",
    body:
      "Members earn 1 point per $1 spent, and 100 points take $5 off. Each visit (a confirmed check-in, or a member card or online ticket scanned at the door) adds 5 points, once per business day. Badges pay extra points once each: the first visit, early and late check-ins, weeks in a row, the 10th, 50th and 100th visit, and a birthday-week visit every year. 13 weeks in a row also earns a free popcorn and 26 weeks a free pizza, redeemed here on the register.",
  },
  "door-scanner": {
    title: "Scanning tickets and member cards",
    area: "Register: members and the door",
    body:
      "The scanner acts like a keyboard: it types the QR code and presses Enter, and the register recognizes it. An online ticket is marked used and its keepsake tickets print at once, so each ticket gets in only once. It's only used up where it can print: on a register with no printer nothing is claimed, and if the printer fails the ticket is given back to scan again. A member card puts the member on the order and counts as their visit.",
  },
  "claim-account-qr": {
    title: "Claim-your-account QR codes",
    area: "Register: members and the door",
    body:
      "Some members have points but no website login: old-site accounts, and regulars set up at the check-in tablet. The QR code, on the tablet after they check in or on their receipt, lets them add a login and see their points online. The code alone isn't enough: they also type the last four digits of the phone on the account. Each code works once; the tablet's lasts 30 minutes and the receipt's two weeks.",
  },
  "easter-eggs": {
    title: "Just for fun (the ✨ button)",
    area: "Register: members and the door",
    body:
      "The ✨ button is for fun. Throw streamers and sparkles across the customer screen to get people's attention, or pick a little picture or joke to print at the bottom of the next receipt, no explanation. The receipt surprise turns itself off once it prints, and needs a printer that prints receipts after every sale.",
  },
  "senior-student-rates": {
    title: "Senior and student rates",
    area: "Register: members and the door",
    body:
      "Insiders+ is $15 a month, $12 for seniors and $10 for students. Those rates are never chosen online: staff switch them, at the register (Member → Change rate) or on the member's page, only after checking an ID in person. For someone already paying, the new price starts with their next bill; nothing is charged today. Paying yearly is 15% off any rate.",
  },

  // ---------- register: shift tools ----------
  "ran-out": {
    title: "Ran out (86 it)",
    area: "Register: shift tools",
    body:
      "Ran out is for something that runs out mid-shift. Pick what ran out and save: the menu items that need it (by recipe, or plainly by name) start ticked, and their buttons show OUT. That's all the cashier does. The managers get a to-do to buy more (\"Buy Hot dog buns at Walmart\"), with a nudge to raise the par if it keeps happening, and when one marks it Bought it, everything it stopped goes back on sale. Tap an OUT button to sell it anyway or mark it back.",
    trainingSlug: "par-count-and-shopping-list",
  },
  "par-count": {
    title: "The par count",
    area: "Register: shift tools",
    body:
      "Par is how much of each thing we keep on hand. On the register's Par sheet, count what's on the shelf in the unit shown (bottles, bags, boxes), not in servings, and tap = par when it's fully stocked. You can save part of the sheet at a time, the candy now and the bar later: the shopping list uses each item's latest count from today. Numbers you haven't saved stay on this iPad, so stepping away doesn't lose them.",
    trainingSlug: "par-count-and-shopping-list",
  },
  "par-quarters": {
    title: "Counting in quarters",
    area: "Register: shift tools",
    body:
      "Bottles, kegs, jugs and other things that get opened count to the quarter. Count the full ones, then tap ¼, ½ or ¾ for the open one: two full bottles and one three-quarters full is 2¾. The shopping list rounds up to whole units, since you can't buy ¾ of a bottle.",
    trainingSlug: "par-count-and-shopping-list",
  },
  "shopping-list": {
    title: "The shopping list",
    area: "Register: shift tools",
    body:
      "The shopping list builds itself from the latest counts: everything under par, grouped by the store it's bought at. Nobody types it up. A manager also sees what ran out mid-shift at the top, and \"Raise par?\" for anything that's run out twice in 30 days. Bought it (here, or on the manager's to-do) clears a Ran out report and puts its menu items back on sale; Found some or False alarm clears it without buying anything.",
    trainingSlug: "par-count-and-shopping-list",
  },
  "business-day": {
    title: "The business day (4 AM to 4 AM)",
    area: "Register: shift tools",
    body:
      "The Royale's day runs from 4 AM to 4 AM Central, not midnight to midnight. A closing shift that runs past 12, a 12:30 AM show and a late check-in all belong to the night they started. That keeps reports, the closing checklist, the box office and check-in points lined up with how the night actually went.",
  },

  // ---------- members and memberships ----------
  "insiders-vs-plus": {
    title: "Insiders vs Insiders+",
    area: "Members and memberships",
    body:
      "Insiders is free: members earn points on everything and get the weekly lineup. Insiders+ is the paid membership, $15 a month or $153 a year: free entry to every screening, 2 free booth reservations a month, and concession and merch discounts. Setting someone to Insiders+ by hand gives the perks but bills nothing, which is what the \"No card on file\" badge warns about. To bill them, use Billing → Open card page.",
    links: [{ label: "Members", href: "/admin/members" }],
  },
  "gift-membership": {
    title: "Gifting a year of Insiders+",
    area: "Members and memberships",
    body:
      "Someone pays once, on their own card, for a year of Insiders+ for a friend: $153 plus tax. Nothing renews and no card goes on the friend's account. The friend needs an email on their account first, since that's how they sign in to use it. Two weeks before the year ends the friend gets an email, and the perks stop after it unless they sign up to keep going.",
    steps: [
      "Members → find the friend (or add them, with their email) → open their page.",
      "Gift a year of Insiders+: type the buyer's name and email.",
      "Open payment page and hand the device to the buyer, or Get a link to text the buyer.",
    ],
    links: [{ label: "Members", href: "/admin/members" }],
  },
  "member-billing": {
    title: "Putting a card on a membership",
    area: "Members and memberships",
    body:
      "Open card page opens Stripe's own secure page in a new tab: hand the device to the member to type their card. We never see or store the card number. Pick Monthly or Yearly first. Set a later first charge for someone who already paid this month another way; blank means charge today. \"Get a link to text them\" makes a link that works for 24 hours.",
  },
  "free-membership": {
    title: "Free (community) memberships",
    area: "Members and memberships",
    body:
      "Community programs give free Insiders+ to people referred by our outreach partners. Grant it from the member's page and pick the program: no card, no billing. The counts show up in Reports for nonprofit reporting.",
  },

  // ---------- menu and inventory ----------
  "menu-must-pick": {
    title: "Staff must pick",
    area: "Menu and inventory",
    body:
      "For a choose-one option group, like a size or a flavor. With \"Staff must pick\" on, nothing is chosen ahead of time, and the register won't add the item until the cashier taps an option. Use it wherever a wrong default costs money, so nobody rings up the small by accident.",
    links: [{ label: "Menu", href: "/admin/menu" }],
  },
  "recipes-par-link": {
    title: "Recipes and the par sheet",
    area: "Menu and inventory",
    body:
      "A menu item's recipe lists the ingredients it uses, and each ingredient can be linked to the par sheet line it's bought as. With those links in place, reporting that a par item ran out pre-ticks every menu item whose recipe uses it, so the register stops selling all of them in one go. Recipes also feed the pour-cost reports.",
    links: [
      { label: "Ingredients", href: "/admin/ingredients" },
      { label: "Menu", href: "/admin/menu" },
    ],
  },

  // ---------- showtimes, events and booths ----------
  "screenings-schedule": {
    title: "Scheduling a screening",
    area: "Showtimes, events and booths",
    body:
      "Pick the movie, room, date and time (Central). Picking a room fills in its capacity, and the outdoor screen is always free. Changing the price later only affects tickets sold from then on. Our movie license only lets us advertise this year's releases, so the website and lobby TV leave older titles off automatically: those are announced to members by email.",
    trainingSlug: "what-we-can-post",
  },
  "house-events": {
    title: "House events",
    area: "Showtimes, events and booths",
    body:
      "Trivia, comedy, the book swap and the like. They count down on the ramp TV next to the films, but aren't on the public website. Add them with a date and start time; the end time and note are optional.",
  },
  "private-events": {
    title: "Private event bookings",
    area: "Showtimes, events and booths",
    body:
      "Private events booked on the website land here with their total, what's been paid and the balance. \"Mark paid manually\" is for a balance paid another way, like cash or a check at the box office. Private-event clients' names never go on public posts, signs or pages.",
  },
  booths: {
    title: "Booth reservations",
    area: "Showtimes, events and booths",
    body:
      "The 8 lounge booths are booked online, two hours at a time, from tomorrow on. A booking shows Pending payment while the customer pays, and the booth frees up again if they don't finish within 30 minutes. Insiders+ members get 2 free reservations a month when they book signed in as themselves. Cancel & refund needs a manager PIN and returns the fee.",
  },

  // ---------- reports and money ----------
  "membership-payments": {
    title: "Memberships in Reports",
    area: "Reports and money",
    body:
      "Insiders+ is charged by Stripe on its own (a new member's first charge, each monthly or yearly renewal, a switch to yearly), and gift memberships are paid on Stripe's page, so none of it goes through the register. Reports read those charges from Stripe every 10 minutes while they're open and each morning before the daily email, and count each one once, on the business day it was charged. They're in Collected and net sales as their own line, with their tax on the Sales tax tab. A refund comes off the day of the charge, like a register refund. Insiders+ paid in cash or set by hand isn't here: Stripe never sees it.",
    links: [{ label: "Reports → Members", href: "/admin/reports/members" }],
  },
  "box-office-csv": {
    title: "The box office report for distributors",
    area: "Reports and money",
    body:
      "Film distributors want tickets and money per movie and per showing. Reports → Box office adds up online and register tickets by when the show is (its business day), not when the ticket was sold. Refunded tickets aren't counted, and free seats (Insiders+ entry, free screenings) are listed as free. \"CSV by movie\" and \"CSV by showing\" download a spreadsheet you can send as is.",
    links: [{ label: "Reports", href: "/admin/reports" }],
  },
  "tip-split": {
    title: "Splitting the day's tips",
    area: "Reports and money",
    body:
      "Reports → Day → Tips shows the day's tips split three ways, side by side. Even gives the same to everyone who worked, By hours goes by hours worked that day, and By who rang it gives each tip to the cashier on that sale. Card and cash tips are kept apart, and every split adds up to the cent. Sales rung under the shared register login have no one to credit, so By who rang it leaves those unassigned.",
    links: [{ label: "Reports", href: "/admin/reports" }],
  },

  // ---------- team and staff ----------
  "fix-clock-out": {
    title: "Fixing a forgotten clock-out",
    area: "Team and staff",
    body:
      "If someone forgets End shift, that shift stays open and counts as 0 hours until it's fixed. The register stops showing them as on shift at 4 AM, and their next Start shift begins a new shift instead of carrying on the old one. A manager fixes the old one in Team → Timesheets: set the real end (or start) time and say why. Every fix is kept with the times before and after, and the shift is marked edited.",
  },
  "staff-roles": {
    title: "Staff roles",
    area: "Team and staff",
    body:
      "Cashiers run the register and see members' emails and phones shortened. Managers also change the menu, run the schedule, training and printers, and their PIN approves refunds and cancelled tabs. Admins get everything in the back office except the Staff page, where only the owner changes roles. A Display screen login can only open the signage screens, so a TV left signed in can't reach anything else.",
  },
  training: {
    title: "Trainings and sign-offs",
    area: "Team and staff",
    body:
      "Trainings are short picture-by-picture how-tos. Managers assign them with a due date; you work through each one and sign off at the end, and the key ones end with a quiz you have to get fully right. When a training changes, everyone who signed the old version is asked to review it and sign again.",
    links: [{ label: "Your training", href: "/training" }],
  },
} satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof HELP_TOPICS;

export function getHelpTopic(key: HelpTopicKey): HelpTopic {
  return HELP_TOPICS[key];
}

// Where a topic lives on the Help & FAQ page.
export function helpHref(key: HelpTopicKey): string {
  return `/help#${key}`;
}

export function trainingHref(slug: string): string {
  return `/training/${slug}`;
}

// Every topic, in /help order: by area, then as written above.
export function helpTopicsByArea(): { area: HelpArea; topics: { key: HelpTopicKey; topic: HelpTopic }[] }[] {
  const entries = (Object.keys(HELP_TOPICS) as HelpTopicKey[]).map((key) => ({ key, topic: HELP_TOPICS[key] as HelpTopic }));
  return HELP_AREAS.map((area) => ({ area, topics: entries.filter((e) => e.topic.area === area) })).filter((g) => g.topics.length > 0);
}
