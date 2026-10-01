// Fills What's new (roadmap_items) the first time, from the work queue as it
// stood on 10/1 (Andrew's picks and order) plus what shipped that day.
// Every public line is written for customers. Technical and security work,
// and things that need Andrew's own accounts or decisions, start private.
// No credits: these were all the owners' ideas.
//
// Safe to re-run: an item whose slug is already there is left alone, so
// edits made since (in Back office or with scripts/roadmap.mjs) are kept.
//
// Usage (from the main checkout): node scripts/seed-roadmap.mjs [--apply]
//   Dry run by default (counts only). --apply writes.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const SHIPPED = "2026-10-01T17:00:00.000Z"; // noon in Joplin, 10/1
const VERSION = "1.0.0";

// [slug, title, public summary, status, is_public, rank, internal notes]
const ITEMS = [
  // ---- Just shipped (10/1) ----
  ["whats-new", "What's new (you're looking at it)", "This page! See what just shipped, what the crew is building right now and what's next in line. Suggest ideas, vote for the ones you want, and follow them all the way to live.", "live", true, 1, null],
  ["rewind", "Rewind: points for your visits before our new system", "Been coming in since before our new register? Ask at the bar: we can look up your past visits and add the points you missed.", "live", true, 2, "Fortis card lookup + backfill grants."],
  ["most-regular-regulars", "Most regular regulars", "An all-time tally of our most loyal regulars: who's been in on the most days, and the most weeks in a row. Expect some friendly competition.", "live", true, 3, null],
  ["points-history", "Points history on your account", "See every point you've earned and spent, visit by visit, right on your account page.", "live", true, 4, "Points ledger; no more typing a balance by hand."],
  ["help-signing-in", "Help signing in", "First time signing in, or forgot your password? One button sends you a link to get in, and the crew can send you one from the bar too.", "live", true, 5, null],
  ["vhs-tapes-and-stickers", "VHS tapes & stickers at the bar", "Take home a piece of the video lounge: VHS tapes and Royale stickers are now for sale at the bar.", "live", true, 6, null],
  ["latte-flavors", "Latte flavors & free alt milks", "Vanilla, caramel or mocha in any latte, an extra-sweet option, and alternative milks at no extra charge.", "live", true, 7, null],
  ["member-profiles", "Shareable profiles & check-in flair", "Turn on a profile page to share your badges and this year's movies, pick a favorite color, and choose an entrance (a unicorn run, confetti, fireworks) for when you check in.", "live", true, 8, "Queue: member-profiles. Profile page, favorite color, entrances."],
  ["sharper-register-pictures", "Sharper pictures at the register", "Crisper food and drink pictures on the register screen, plus glowing neon signs like the red \"$5\" on the $5 Special.", "live", true, 9, "Queue: menu-art-2. Pixabay/Pexels keys in Vercel switch on those two photo sources."],
  ["membership-payments", "Membership payments, squared away", "Insiders+ monthly and yearly payments, gifts and refunds now flow straight into our books, so your membership is always tracked right.", "live", true, 10, "Queue: member-payments. In Reports (day, week, month), the nightly email and tax totals."],
  ["email-from-the-royale", "Email from the Royale", "Password resets and sign-in links now come from the Royale's own address, so they're easy to spot and stay out of spam.", "live", true, 11, "Resend domain verified."],
  ["weekly-lineup-email", "The weekly lineup by email", "Our new email system is ready: the week's lineup and member news, with one tap to unsubscribe any time. The first ones go out soon.", "live", true, 12, "Queue: marketing. LIVE with sending off: set EMAIL_SENDING_ENABLED when ready."],
  ["tablet-login", "Customer tablet login", "The lobby tablet runs on its own login.", "live", false, 13, "Queue: tablet-login. Display login instead of a staff login. Andrew (not picked): \"lets talk about how this works and what it looks like.\""],
  ["resend-email-setup", "Resend email setup", "", "live", false, 14, "Needs-you item. Done: the domain is verified and password resets come from the Royale."],
  ["google-sign-in-name", "Google sign-in shows our name", "", "live", false, 15, "Needs-you item. Done: Google now shows Royale Cinema Lounge."],

  // ---- Building now ----
  ["now-playing", "Now Playing on the lobby TV", "The ramp TV's big poster and countdown to the next film gets its proper name: Now Playing. Its old link keeps working.", "building", true, 12, "Queue: now-playing (picked #12). Half done."],

  // ---- Final checks (built, being reviewed) ----
  ["points-by-card", "Points when you pay by card", "Forgot to check in? Pay with a card you've used here before and your points still find their way to your account.", "reviewing", true, 1, "Queue: card-points (picked #1). Built and approved; waiting on Andrew's OK of its privacy wording. Card fingerprint match, Undo on the register."],
  ["indy-import", "Bringing over our Indy customers", "", "reviewing", false, 6, "Queue: indy-import (picked #6). 1,533 Indy customers via a review screen. Reviewed and fixed; waiting on Andrew's call about who gets email (marketing off for now)."],
  ["rock-solid-payments", "Rock-solid payments at the register", "Behind-the-scenes fixes to keep payments rock solid.", "reviewing", true, 7, "Queue: security-register (picked #7). Register money fixes from the code review. Ready to ship after close, with Andrew's OK."],
  ["private-live-channels", "Private live channels", "", "reviewing", false, 8, "Queue: private-channels (picked #8). Register-to-tablet updates only to signed-in screens; then switch off Supabase's public setting. Review left."],
  ["ready-for-the-time-change", "Ready for the time change", "Making sure everything rolls over at the right moment when daylight saving time ends on November 1.", "reviewing", true, 9, "Queue: dst-fix (picked #9). Business day at 4 AM across the change. Must ship before Sun Nov 1. Review left."],
  ["clearer-privacy-policy", "A clearer privacy policy", "An updated privacy policy, in plain words, covering check-ins, emails and points.", "reviewing", true, 10, "Queue: privacy-text (picked #10). Partly live (past-visits paragraph). The rest needs Andrew's read-through."],
  ["tidier-register", "A tidier register", "A cleaner register screen for the crew, so ringing you up is quicker.", "reviewing", true, 11, "Queue: register-tidy (picked #11). Par count name, reminders, reprint, one-row shift bar, Ran out color. Review left."],
  ["code-review-fixes", "Remaining code-review fixes", "", "reviewing", false, 20, "Queue: code-review-rest (not picked). Tabs, staff privacy, member accounts, reports, bookings and forms, staff sign-in, showtimes admin, error pages. Built in pieces; reviews left."],

  // ---- Up next (Andrew's picks, in his order) ----
  ["profile-at-check-in", "See your profile at check-in", "Type your number on the lobby tablet and, if your profile is shared, it pops right up.", "queued", true, 13, "Queue: phone-preview (picked #13). Others show after staff confirm."],
  ["complete-profile-bonus", "Bonus points for a complete profile", "Fill in your name, phone, birthday, photo and profile line for a one-time points bonus, with a progress bar to show how close you are.", "queued", true, 14, "Queue: profile-points (picked #14). 25 points suggested."],
  ["easier-to-read-screens", "Easier-to-read screens", "No more white text on yellow, starting with \"Up next\" on the lobby TV.", "queued", true, 15, "Queue: yellow-contrast (picked #15). Sweep the app for light text on yellow."],
  ["report-a-problem", "Report a problem", "A \"Report a problem\" link so you can tell us when something on the site isn't working, plus alerts that reach the crew on their own.", "queued", true, 16, "Queue: error-reports (picked #16). Website errors land in Dev notes automatically."],

  // ---- Ideas we're considering ----
  ["easter-eggs", "Easter eggs", "Little surprises hidden around the Royale's screens, switched on for special days.", "idea", true, 1, "Queue: easter-eggs. On/off switch, optional dates. Espresso's cover art becomes the first one."],
  ["check-in-trading-card", "Check-in trading card", "When you check in, the lobby tablet deals you a trading card in your color, with your photo, profile line, badges and rank.", "idea", true, 2, "Queue: checkin-card."],
  ["your-night", "Your night, at a glance", "Right after you check in: the points you just earned, any new badges, your collection, and what it takes to pass the person ahead of you.", "idea", true, 3, "Queue: your-night."],
  ["order-status-screen", "Know what's happening at the register", "The screen facing you follows your order: being rung up, ready to pay, then approved. No more wondering whose turn it is.", "idea", true, 4, "Queue: order-status (Andrew's idea 10/1)."],
  ["silly-ways-to-spend-points", "Silly ways to spend points", "Spend points on just-for-fun things like badges, titles, flair or a custom check-in entrance. Your lifetime points (and bragging rights) never go down.", "idea", true, 5, "Queue: points-fun (Andrew's idea 10/1). Lifetime points separate from the spendable balance."],
  ["make-it-rain", "Make it rain on check-in", "Coins rain down the lobby tablet when you check in, piling up to match your points. Big point totals get a big storm (and maybe a surprise).", "idea", true, 6, "Queue: make-it-rain (Andrew's idea 10/1). Past a big number it pretends to break, then recovers (staged gag)."],
  ["monogram-receipts", "RCL monogram receipts", "Receipts covered edge to edge in our own RCL pattern, with Route 66 stars, film sprockets and ticket stubs.", "idea", true, 7, "Queue: rcl-monogram (Andrew's idea 10/1). Our own design, not a copy of any brand's pattern. Easiest on digital receipts."],
  ["vouchers-out-of-sales", "Vouchers kept out of sales", "", "idea", false, 8, "Queue: vouchers. Trivia voucher redemptions on their own line, not in money taken, averages or tax. Builds on membership payments."],
  ["tablet-full-screen", "Tablet full-screen install", "", "idea", false, 9, "Queue: tablet-fullscreen. Add to Home screen on the Samsung opens the customer screen full screen (free option next to Fully Kiosk)."],
  ["stop-old-fortis-billing", "Stop the old Fortis billing", "", "idea", false, 10, "Needs-you item. End the 7 recurring billings in Fortis before Friday 10/2's run, then move the 3 payers to Stripe."],
  ["managers-set-pins", "Managers set their own PINs", "", "idea", false, 11, "Needs-you item. 7 of 8 logins still use the starting PIN."],
  ["shared-ipad-login", "The shared iPad login", "", "idea", false, 12, "Needs-you item. The shared register iPad login is admin: keep it, or drop it to cashier?"],
  ["showings-and-org-memberships", "Member Showings and Organization memberships", "", "idea", false, 13, "Needs-you item. Both decision pages are waiting on Andrew's picks."],
];

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const slugs = new Set();
for (const [slug, title, summary, , isPublic] of ITEMS) {
  if (slugs.has(slug)) throw new Error(`duplicate slug ${slug}`);
  slugs.add(slug);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`bad slug ${slug}`);
  if (isPublic && !summary) throw new Error(`public item without a summary: ${slug}`);
  if (title.length > 120 || summary.length > 1000) throw new Error(`too long: ${slug}`);
}

const { data: existing, error } = await db.from("roadmap_items").select("slug").in("slug", [...slugs]);
if (error) {
  console.error(`Couldn't read roadmap_items (is the migration applied?): ${error.message}`);
  process.exit(1);
}
const have = new Set((existing ?? []).map((r) => r.slug));
const now = new Date().toISOString();
// Every row has the same columns (a bulk insert fills a missing one with
// null, not its default).
const rows = ITEMS.filter(([slug]) => !have.has(slug)).map(([slug, title, summary, status, isPublic, rank, notes]) => ({
  slug,
  title,
  public_summary: summary,
  internal_notes: notes,
  status,
  is_public: isPublic,
  rank,
  credit_ok: false,
  status_changed_at: status === "live" ? SHIPPED : now,
  shipped_at: status === "live" ? SHIPPED : null,
  shipped_in_version: status === "live" ? VERSION : null,
}));

const count = (list, f) => list.filter(f).length;
const byStatus = (list) => ["live", "building", "reviewing", "queued", "idea"].map((s) => `${s} ${count(list, (r) => r[3] === s || r.status === s)}`).join(", ");
console.log(`${ITEMS.length} items in the seed (${byStatus(ITEMS)}); ${count(ITEMS, (r) => r[4])} public.`);
console.log(`${have.size} already there, ${rows.length} to add (${byStatus(rows)}).`);
// No process.exit() once the client has been used: on Windows it can trip
// over a connection that's still closing.
if (!apply) {
  console.log("Dry run. Pass --apply to write.");
} else if (rows.length) {
  const { error: insErr } = await db.from("roadmap_items").upsert(rows, { onConflict: "slug", ignoreDuplicates: true });
  if (insErr) {
    console.error(`Didn't save: ${insErr.message}`);
    process.exitCode = 1;
  } else console.log(`Done: added ${rows.length}.`);
} else console.log("Done: nothing to add.");
