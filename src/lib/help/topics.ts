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
  "card-reader-status": {
    title: "Card reader",
    area: "Register: devices",
    body:
      "The register asks Stripe about its card reader about once a minute, and again right before every card charge. If Stripe says the reader is offline, or hasn't heard from it for over 2 minutes, a red strip says \"Card reader offline\" above the order and Devices gets a red dot; it clears by itself when the reader is back. Devices shows the reader's name, model, software, IP address, what it's doing, and how many times it went offline today. Stripe doesn't share the battery level, so a reader that keeps dropping off is the sign its battery is low: keep it on its charger or dock (a full battery lasts about 8 hours).",
    steps: [
      "Offline: plug it in or set it on its dock, then check its Wi-Fi (swipe in from the left edge → Settings → Wi-Fi).",
      "Still offline: hold the power button to restart it, then tap Check now in Devices.",
      "To see the battery: swipe in from the left edge → Settings (the passcode is on Stripe's WisePOS E page) → Diagnostics.",
    ],
    links: [{ label: "Stripe's WisePOS E page", href: "https://docs.stripe.com/terminal/payments/setup-reader/bbpos-wisepos-e#settings" }],
  },
  "devices-print-via": {
    title: "Print through the website",
    area: "Register: devices",
    body:
      "Through the website, this register sends receipts, tickets and the drawer kick to the website, and the station's printer collects them. There's nothing to accept on the iPad, and it keeps working after updates and restarts. \"Straight to a printer IP\" is the old way: the iPad talks to the printer itself and has to trust its certificate first, which breaks now and then. Use the website unless this station has no printer set up yet.",
    links: [{ label: "Printers (managers)", href: "/admin/printers" }],
    trainingSlug: "receipt-printer-setup",
  },
  "devices-tablet-sound": {
    title: "Customer screen sounds",
    area: "Register: devices",
    body:
      "The customer screen plays short arcade-style sounds so guests hear what's happening: a coin for checking in (+5), two notes for \"Welcome back\", a blip for each item rung up and a tick when the total changes, a little run when the payment screen opens, a soft chime when it's the card reader's turn and a happy one when the sale goes through, sparkles for streamers and entrances, a tape clunking into the VCR for the Rickroll, and a soft \"hmm\" for a number it doesn't know. Turn them on or off and set the volume under Devices → Customer screen sounds; it's on at 40% to start, and kept low because the cinema is next door. The register sends the setting to the screen, and both remember it. Turning on reduced motion on the screen only calms the animations: sound has its own switch here.",
    steps: [
      "Tap Devices (bottom row of the order), scroll to Customer screen sounds.",
      "Move the volume and let go: the screen plays a sample at that level. Play a test sound does the same.",
      "Silent? Browsers only play sound after the screen has been tapped, so tap the customer screen once. Then check the iPad's own volume and that it isn't on silent.",
    ],
  },

  // ---------- register: payments ----------
  "pay-on-reader": {
    title: "\"Finish on the card reader\" on the customer screen",
    area: "Register: payments",
    body:
      "Guests kept tapping their card on the customer screen, and tapping it on the reader before picking a tip (the reader asks for the tip first, so that tap does nothing). So once a card payment reaches the reader, the customer screen says \"Finish on the card reader\" in big letters, with a drawing of the reader and a soft chime, the order shrunk to a strip below. It shows two steps: pick a tip on the reader, then tap, insert or swipe the card. Stripe doesn't say when the tip is picked, so both stay up; step 2 lights up once a card has been tried. No tip asked (taken on the register already): only the card step. A tab's card on file: only the tip. Cash and vouchers never show it.",
    steps: [
      "Approved: the screen says so, with the usual happy sound. Cancel on the register and it goes back to the order.",
    ],
  },
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
      "Regulars check in on the customer screen with their phone number or email, and that's it: there's nothing to confirm. Their visit and its points go on right away (once a day, with streaks and badges as usual; typing it again just says \"Welcome back\"), the screen plays their reward and shows their card, and they go on the current order by themselves (taking over from whoever was on it, with \"Now on this order\"; to switch back, tap Add to order on the other person; never while a card payment is going through). A pop-up over the order shows their photo and name and the one thing to know: red for no payment on file, a free coffee ready, \"Ask their name?\", their birthday week or first visit, with their points. There's nothing to undo on the register. A guest the screen got wrong (a mistyped number) taps \"That's not me\" under their card on the screen: the visit and its points are taken back and they're off the order. A phone number shared by a few accounts asks \"Which one is you?\" on the screen, with a button for each (first name and last initial only): the one they tap checks in like anyone else, and \"None of these\" lets them sign up. Nothing waits on you. Everyone checked in today is first on the Customers tab: tap a card to put them on the order. Hold for details: press and hold a card there, or the order's Member box, for about half a second to see their tier, points, visits, member since and today's check-in time, with Open in Back office for anything to change. If something looks wrong (someone used another person's number, or checked in without being here), tap Flag suspicious activity at the bottom of that panel, pick a reason and add a short note if you like: an admin or owner looks at it in Back office and can take back the check-in's points. A flagged account shows a 🚩 on its card; it doesn't block anything. Found by email with no phone on file, they can add the number they typed, saved as they check in. New customers sign themselves up on the screen (\"Just use my phone number\", or name and email) and are checked in at once. Guests who'd rather tell you: \"New phone account\" on the Customers tab, or \"+ Add name\" / \"+ Add email\" in the Member box, shows on the screen as you type so they can tap \"✓ That's right\". The screen plays the entrance they picked on their account (a unicorn, confetti, fireworks or floating stickers, in their color); it never gets in the way of the keypad. If a profile line is rude, hide it from their page in Members.",
    links: [{ label: "Top regulars (managers)", href: "/admin/members/regulars" }],
  },
  "member-notes": {
    title: "Account notes and organization",
    area: "Register: members and the door",
    body:
      "Press and hold a customer's card (Checked in today, or the order's Member box) to open their panel. Under Notes, type in \"Add a note\" and tap Save: it records who wrote it and when, and any cashier can do it, no PIN. Tap the \"+ Group / organization\" chip to tag them with a group, like Easter Seals (tap a suggestion or type one), so they can be attached to a corporate account later; the tag shows on their card in Checked in today. Notes and the tag are staff only: customers never see them on the screen, their account or emails. In Back office, the member's page has the same notes, and Members filters by organization to find everyone in a group.",
    links: [{ label: "Members", href: "/admin/members" }],
  },
  organizations: {
    title: "Organization accounts (Easter Seals and others)",
    area: "Register: members and the door",
    body:
      "Groups like Easter Seals pay a monthly fee and get a number of comps a day (20 by default: 10 pairs of a guest and a helper). A comp is one person's day: when an organization's helper or supported guest is on the order, their Day pass and one ticket per movie ring up at $0, and the chip shows \"Easter Seals · comps today 6/20 · 3 pairs\". Each person counts once a day, however many movies they see. When the day's comps are used up the day pass and tickets are charged; a manager PIN can comp one more. Supported guests also pay even dollars: the listed price is the total with the tax inside it (a $4 pizza is $4.00, which is $3.68 plus $0.32 tax), so the order says \"Tax included\" and the books still record the tax. Helpers pay normal prices plus tax. To put someone in an organization, press and hold their card and tap \"Add to organization\".",
    steps: [
      "Back office → Organizations: make the organization, or turn a \"Group / organization\" tag into one (everyone tagged is attached).",
      "Send helpers the sign-up link from the organization's page: they sign up with their work email and join as helpers.",
      "Supported guests without an account: make a phone account at the register, then Add to organization, or skip the account entirely with \"Organization guests\".",
    ],
    links: [
      { label: "Organizations", href: "/admin/organizations" },
      { label: "Organization report", href: "/admin/reports/organizations" },
    ],
  },
  "organization-guests": {
    title: "Organization guests with no account",
    area: "Register: members and the door",
    body:
      "There's always a way to comp an organization's group with no name, phone, email or account: some supported guests can't give details, and helpers change often. When a helper says \"we're with Easter Seals\", tap \"Organization guests\" (on the Customers tab, or beside the order's member). Tap the organization, set the supported guests and helpers with + and −, add a note if it helps (\"red shirt\"), and check the summary: \"Easter Seals · 2 supported guests + 2 helpers · uses 4 comps (6/20 today)\". It adds that many Day passes at $0; each person is one comp, logged to the organization as \"no account\", and their movie tickets today are covered too (one each per showing). Today's limit and the manager PIN to go over it work the same as for members. While the order has supported guests it says \"Tax included (Easter Seals guest)\", so a helper buying a $4 pizza for the guest pays $4.00; untick it for an order that's only the helper's. When the group comes back to the counter later the same day, open Organization guests again and tap \"Easter Seals group (today)\": it uses no new comps, covers their tickets, and gives the same pricing. Statements and Reports count these comps like named ones, marked \"no account\".",
    steps: [
      "Organization guests → tap the organization.",
      "Set supported guests and helpers with + and −, then Add day passes.",
      "Same group later today: Organization guests → the group under \"Same group, later today\".",
    ],
    links: [{ label: "Organization report", href: "/admin/reports/organizations" }],
  },
  "points-and-badges": {
    title: "Points, visits and badges",
    area: "Register: members and the door",
    body:
      "Members earn 1 point per $1 spent, and 100 points take $5 off. Each visit (a check-in on the customer screen, or a member card or online ticket scanned at the door) adds 5 points, once per business day. Badges pay extra points once each: the first visit, early and late check-ins, weeks in a row, the 10th, 50th and 100th visit, and a birthday-week visit every year. 13 weeks in a row also earns a free popcorn and 26 weeks a free pizza, redeemed here on the register.",
  },
  "card-linked-points": {
    title: "Points by card, when nobody's attached",
    area: "Register: members and the door",
    body:
      "Once a card has paid for a member's sales with their account on the order on 2 different days (or they paid with it online, signed in), it's linked to them, so a later card sale with nobody attached still earns them the points. They see only the points, not what was bought, and tickets on that sale stay off their account. The register says so right after the sale (\"23 points to Sarah · Visa •••• 4242\"), with an Undo that asks which it was: someone else paid with Sarah's card (the card stays hers), or it isn't her card at all (it's unlinked). Then you can give the points to whoever paid. Undo works for 2 minutes on that register; after that a manager undoes it on the member's page. A card linked to two accounts (a family card) never picks on its own; the register asks who's paying. A staff member's own card, or a card already on someone else's account, is linked only by a manager, from a sale on the member's page. We keep the card type, its last four digits and Stripe's code for the card, never the number, and members can remove a card on their account.",
  },
  "daily-coffee": {
    title: "Insiders+ free daily coffee",
    area: "Register: members and the door",
    body:
      "Insiders+ members get one free black coffee or hot tea each business day (4 AM to 4 AM). With the member on the order, the register takes a daily coffee item's menu price off by itself; add-ons are still charged, and Remove takes it off if they'd rather save it. It's checked again before they pay, so a second one the same day shows when they had the first, and refunding that order gives the day's coffee back. Which items count is ticked on the Menu page.",
    links: [{ label: "Menu", href: "/admin/menu" }],
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
      "Some members have points but no website login: old-site accounts, and regulars set up at the check-in tablet. The QR code, on the tablet after they check in or on their receipt, or the setup link in their email, lets them add a login and see their points online. Scanning it takes them straight to signing in (Google, or an email and password), and that login is attached to their account, so the code is the key: hand the receipt only to them. Each code works once; the tablet's lasts 30 minutes and the receipt's two weeks.",
  },
  "easter-eggs": {
    title: "Just for fun (the ✨ button)",
    area: "Register: members and the door",
    body:
      "The ✨ button is for fun. Throw streamers and sparkles across the customer screen to get people's attention, Rickroll the customer screen (the chorus of Never Gonna Give You Up, dance and all, from Rick Astley's official video; it closes itself; press the same button again, now “Stop the Rickroll”, or tap ✕ on the tablet to stop it early; the button says Starting… or Stopping… until the tablet confirms, and if it says the tablet didn't answer, refresh the customer screen), or pick a little picture or joke to print at the bottom of the next receipt, no explanation. If the Rickroll shows a play button instead of starting, tap the screen once. The receipt surprise turns itself off once it prints, and needs a printer that prints receipts after every sale.",
  },
  "senior-student-rates": {
    title: "Senior and student rates",
    area: "Register: members and the door",
    body:
      "Insiders+ is $15 a month, $12 for seniors and $10 for students. Those rates are never chosen online: staff switch them at the register (Member → Change rate), or a manager on the member's page, only after checking an ID in person. For someone already paying, the new price starts with their next bill; nothing is charged today. Paying yearly is 15% off any rate.",
  },
  "unlimited-no-payment": {
    title: "No payment on file for unlimited membership",
    area: "Register: members and the door",
    body:
      "They paid for unlimited on our old website, but its billing never charged them and no card came over, so nothing is paying for it now. Set it up while they're here: Card on reader (they tap or insert it; $15 a month plus tax, charged today, then monthly), or On their phone (a QR code on the customer screen, or an emailed link). Not paying today? Ring them up like any guest.",
    links: [{ label: "Former unlimited members", href: "/admin/members/former-unlimited" }],
  },

  // ---------- register: shift tools ----------
  "staff-button": {
    title: "The Staff button",
    area: "Register: shift tools",
    body:
      "Everything about working a shift lives behind one Staff button, next to the cashier at the top of the order, so the order and the menu keep the whole screen. The red number on it counts what needs a look: checklist items left, to-dos and training for whoever's on, anything that's run out, and people on today's schedule who haven't started yet. Tap it for the Staff sheet: who's on shift (tap your name if it's you), Start a shift and End your shift; then Ran out, Checklist, Schedule and My hours; then Needs a look (to-dos with their Done, training to open, what's out, anyone who hasn't started); then Par sheet and Shopping list; then History and Reminders. When nobody's on shift yet, the button says Start shift instead. Booths held today are their own button in the order's bottom row, gold while a Reserved card still needs printing. Reminders that are due still show above the register until you tap Done or Remind me later.",
    steps: [
      "Start of the night: tap Start shift (top of the order) and pick your name. The checklist opens.",
      "Something ran out: Staff → Ran out.",
      "Closing: Staff → End your shift → I'm closing for the night → do the par count.",
    ],
  },
  "staff-schedule": {
    title: "The schedule on the register",
    area: "Register: shift tools",
    body:
      "Staff → Schedule shows who's working today and whether they've started (\"On since 4:02 PM\", \"Due at 8:00 PM\", or \"Not started yet\" once their start time has passed), then the next 7 days. It's the same schedule a manager keeps in Back office → Team; the register only reads it. Someone due in later today, or late, adds to the red number on the Staff button until they start their shift.",
    links: [{ label: "Back office → Team (managers)", href: "/admin/team" }],
  },
  "ran-out": {
    title: "Ran out (86 it)",
    area: "Register: shift tools",
    body:
      "Ran out is for something that runs out mid-shift: Staff → Ran out. Pick what ran out and save: the menu items that need it (by recipe, or plainly by name) start ticked, and their buttons show OUT. That's all the cashier does: nobody on shift is asked to go buy it. The people who buy for the week get an email right away, and the Staff sheet shows a quiet line under Needs a look, like \"Out of Heavy whipping cream · Nathan and Mary have been emailed\" (it counts in the Staff button's red number). When they mark it back in stock in Back office, the line goes away and everything it stopped goes back on sale. Tap an OUT button to sell it anyway or mark it back.",
    links: [{ label: "Back office → Ran out", href: "/admin/ran-out" }],
    trainingSlug: "par-count-and-shopping-list",
  },
  "ran-out-alerts": {
    title: "Ran-out emails and Back in stock",
    area: "Menu and inventory",
    body:
      "Shopping is done at the start of the week, enough for the whole week, so running out is a problem to fix, not a chore for whoever's on shift. When staff tap Ran out, the people picked under \"Ran-out alerts go to\" get one email: what ran out, when, who reported it, the par, this week's counts, and a suggestion to raise the par. Its Back in stock button opens Back office → Ran out (signed in), where marking it back in stock clears the register's line. \"Ran out this week\" lists repeats so the pars that are too low stand out. Owners and admins pick who gets the email.",
    links: [{ label: "Back office → Ran out", href: "/admin/ran-out" }],
    trainingSlug: "par-count-and-shopping-list",
  },
  "par-count": {
    title: "The par count",
    area: "Register: shift tools",
    body:
      "Par is how much of each thing we keep on hand. On the register's Par sheet (Staff → Par sheet, or End your shift → I'm closing for the night), count what's on the shelf in the unit shown (bottles, bags, boxes), not in servings, and tap = par when it's fully stocked. You can save part of the sheet at a time, the candy now and the bar later: the shopping list uses each item's latest count from today. Numbers you haven't saved stay on this iPad, so stepping away doesn't lose them.",
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
      "The shopping list builds itself from the latest counts: everything under par, grouped by the store it's bought at. Nobody types it up, and it isn't on the register all day: it comes up after the closing par count, or under Staff → Shopping list (marked when something's run out). A manager also sees what ran out mid-shift at the top, and \"Raise par?\" for anything that's run out twice in 30 days. The buyers mark a Ran out report back in stock in Back office → Ran out, which puts its menu items back on sale; Found some or False alarm here clears it without buying anything.",
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
      "Insiders is free: members earn points on everything and get the weekly lineup. Insiders+ is the paid membership, $15 a month or $153 a year: free entry to every screening, a free black coffee or hot tea every day, 2 free booth reservations a month, and concession and merch discounts. Setting someone to Insiders+ by hand gives the perks but bills nothing, which is what the \"No card on file\" badge warns about. To bill them, use Billing → Open card page.",
    links: [{ label: "Members", href: "/admin/members" }],
  },
  "points-history": {
    title: "Changing a member's points",
    area: "Members and memberships",
    body:
      "Points work like a bank account: the balance only moves by a line in the member's points history, and every line says why (a check-in, a badge, a purchase, a reward, a refund). To give or take back points by hand, a manager uses Add or take away points on their page, with a reason of a few words like \"Birthday party credit\". You confirm the new balance before it saves, and it can't go below zero. The member sees the reason on their account as \"From the Royale crew\", never your name; the back office keeps who did it.",
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
  "paid-through": {
    title: "Paid-through dates (Insiders+ paid ahead)",
    area: "Members and memberships",
    body:
      "For a member who already paid for Insiders+ another way, like a whole year on the old website. Until the date they count as paid-for Insiders+ everywhere: gold at the register, every perk, no \"no card on file\" warning. When they add a card (My Account → Billing, the card page from their member page, or the register), nothing is charged until the date; then it renews on the plan picked here (yearly for an old-site annual), at that day's price plus tax. If no card is on by the date, the perks stop the next day. Owners and admins set or change the date; the page shows who set it and when. A member already billed by their own card, or complimentary, or on a gifted year can't get one.",
    steps: [
      "Members → find them → open their page.",
      "Paid through → Set a paid-through date: pick the date, Yearly or Monthly, and add a note (e.g. old-site annual, confirmed 10/3). Save.",
      "To tell them how to add their card without being charged early: Send paid-through explainer. It emails just them the 3 steps, with their date.",
    ],
    links: [{ label: "Members", href: "/admin/members" }],
  },
  "renewal-notice": {
    title: "Yearly renewal notices",
    area: "Members and memberships",
    body:
      "A week before a yearly Insiders+ renews, the member gets an email: the date, the exact charge from Stripe (price + tax, like $153 + $13.35 tax = $166.35), the card it goes on, and a Manage or cancel button to My Account → Billing. It's a billing notice, so it goes even to people who turned off our emails, and each renewal gets it only once. That includes paid-through members, a week before their first charge. Their member page shows \"Renewal notice sent\" and the date once it's gone. To cancel, they press Manage or cancel, or you open Stripe's billing page from Billing on their member page with them.",
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
      "Community programs give free Insiders+ to people referred by our outreach partners. A manager grants it from the member's page and picks the program: no card, no billing. The counts show up in Reports for nonprofit reporting.",
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
      "Pick the movie, room, date and time (Central). Picking a room fills in its capacity, and the outdoor screen is always free. Duplicate on a showing copies it here for another date. Repeat adds the same showing at several start times on the days you pick across a date range, listed first so you can check them. Adding, moving or removing a showing takes a manager. Changing the price later only affects tickets sold from then on. Our movie license only lets us advertise this year's releases, so the website and lobby TV leave older titles off automatically: those are announced to members by email.",
    trainingSlug: "what-we-can-post",
  },
  "showing-visibility": {
    title: "Public, Members only or Private",
    area: "Showtimes, events and booths",
    body:
      "Every showing has a \"Who sees it\" choice; new ones start Public. Public: on the website, the lobby TV and the weekly email as usual. Members only: the website shows it only to members signed in to their account, marked Members only; guests don't see it at all. It goes in the members-only part of the weekly email and stays off the lobby TV (the ramp TV still counts it down). Private: a private group's showing, like a school or charity matinee. It's never on the website, TVs, emails or flyers and can't be bought online; it shows here and on the register's Movies tab labelled Private, so ring their tickets up there. Older titles stay off the public website whatever you pick. On the showtimes spreadsheet, add the choice to the title: \"Beetlejuice 2 (member screening)\" or \"(members only)\" for members, \"(private event do not list)\", \"(private)\" or \"(do not list)\" for private. The note comes off the title when it's loaded.",
  },
  "outdoor-screen": {
    title: "The outdoor screen link",
    area: "Showtimes, events and booths",
    body:
      "The website labels every showing with its screen: \"Outdoor screen · weather permitting\" or the indoor cinema, from the room you pick. Showtimes has an \"On the outdoor screen this weekend\" box, and royalecinemajoplin.com/outdoor lists only the outdoor showings: paste that link when someone asks what's on outside. Older titles and members-only showings aren't on it, same as the rest of the public site.",
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
      "Private events booked on the website land here with their total, what's been paid and the balance. The website doesn't take requests for a Sunday, since we're closed; a Sunday event is arranged with staff directly. \"Mark paid manually\" is for a balance paid another way, like cash or a check at the box office. Private-event clients' names never go on public posts, signs or pages.",
  },
  booths: {
    title: "Booth reservations",
    area: "Showtimes, events and booths",
    body:
      "The 8 lounge booths are booked online, two hours at a time, from tomorrow on, and never for a Sunday, since we're closed. A booking shows Pending payment while the customer pays, and the booth frees up again if they don't finish within 30 minutes. Insiders+ members get 2 free reservations a month when they book signed in as themselves. Cancel & refund needs a manager PIN and returns the fee. On the register, the Booths button in the order's bottom row (\"2 booths\") lists today's and tomorrow's: it's gold while a Reserved card still needs printing, with a red dot for a booking made in the last day.",
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
