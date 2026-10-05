# Cloud session handoff (Oct 3–5, 2026)

What the cloud agent session (session_01Usg57d7SpVrJRu2Lnx4KqG) knew that isn't
in the code. Everything it built is on GitHub. The live site is at **v1.29.0**.

## What's in this folder
- `bar-book-study.html`: the Bar Book study, the spec for v1.25–v1.29. Published at https://claude.ai/artifact/Hzg2Akx52SoTcmzsHT9F67
- `bar-pricing-review.html`: the team pricing review. Published at https://claude.ai/artifact/EWLsU5zbxcaDjYwin7hbH7
- `badges/badges.html` and `badges/script-v3.js`: the badge system design, v3, approved and then paused. This is the latest copy; the published page at https://claude.ai/artifact/DF13FXRuLPGA3rzkdfHeYM may be older. Open `badges.html` in a browser to view it.
- `screenshots/`: the Bar tab before and after, "What's in it?", and the Prices sheet.

## Shipped this session
- **v1.15.0:** five safe branches landed.
- **v1.16.0 / v1.17.0:** Email Studio redesign, one-minute Undo, a first wave of 25, and only ticked people send (Nathan and Mary).
- **v1.25.0:** the one-screen Bar tab, drawn drink icons, the Bar Book (123 drinks), and recipes on the bar tablet.
- **v1.27.0:** suggested prices on recipe cards, Add to order for every drink, Make this a menu item, the Bar tab layout with paging, and the Booths pop-up fix.
- **v1.28.0:** "What's in it?" (reverse recipe), the automatic Double, and icons that grow on tap.
- **v1.29.0:** Back office → Bar Book → Prices, a single sheet; the Royale rule for off-menu and custom drinks (serve + level + double + mixer); double shots +$4/+6/+8; Neat/Rocks +$2 on shots.

All bar migrations are applied on the live database: `20261004010000_bar_book`, `20261004030000_order_item_recipe`, `20261005010000_order_item_custom_recipe`. The seed has also been run.

## Pricing decisions (Andrew, Oct 5)
- **Beer stays:** draft $5 for 16 oz, $7 for 20 oz; cans $4, Space Dust included.
- **Wine stays** ($5 / $18) until the wine invoices arrive. Then set the price with the review's calculator.
- **Manhattan:** $9 → $10, done in the live menu.
- **Everything else from the review is in the Prices sheet:**
  - serve: shot $5, highball $8, neat/rocks $7, off-menu cocktail $10
  - level: call +$2, premium +$4
  - ginger beer +$1, energy drink +$2
  - double: a second pour at $1 off
  - target pour cost 20%
- The bar manager (ex-Outback bar manager, ex-LA bartender) has the final say on bartending. He still needs to confirm the pour standard: 1.5 oz, neat 2, double 3, wine 5.

## Still open: bar
1. Enter bottle costs (unit_cost) under Back office → Bar Book. None are set, so cost and suggested-price lines say "no costs yet".
2. Get the wine invoices, then price wine.
3. Questions to check, not answered:
   - Missouri and Joplin rules on drink specials and happy hour
   - whether the Insiders+ 10% may apply to alcohol (today it does)
   - whether menu prices should include tax
4. **Small gaps:**
   - Some auto-guessed ingredient colors are odd: salt shows as "soda", tomato as "grapefruit". Fix them in Back office → Bar Book.
   - The Bar Book letter index is small, about 25 px per letter.
   - "Alcohol" is still the name in Back office.
   - A drink made into a menu item reaches the bar tablet only after the tablet reloads.
   - The register's Make-menu-item button needs an owner or admin signed in on the iPad.
5. **Not built:** a call/premium choice on menu cocktails (the level only applies to off-menu drinks today), pitchers, buckets, and above-premium bottles.

## Still open: other work
- **claude/businessday-dst:** not merged. **It must be live before Sun Nov 1** (the DST change).
- **claude/now-playing-rename:** not merged. Waiting on Andrew's OK; it changes the TV display.
- **claude/auth-staff:** not merged. Apply migrations `manager_pins` and `20261003010000_pin_set_at` first.
- **claude/stripe-bookings-forms:** not merged. It needs migration `20261003020000_booking_guards` and a test in Stripe test mode. It overlaps the v1.18 closed-days files (booths/events actions, EventBookingForm).
- **claude/owner-tab** (WIP 316fe48): paused.
  - Andrew's choices: owners pay the at-cost rate, settled on a monthly owner tab, which only the owner can add to, with their own PIN.
  - The review fixes are partly done. Still open: review items 6–8 (reports visibility, the digest average, box office tickets, tax wording, labels) and test updates in check-owner-tab.mjs.
- **claude/land-safe-five:** a duplicate of the v1.15.0 landing. Safe to delete on GitHub.
- **Badges:** paused until the register/bar work was done, which it now is.
  - **Slice 1:**
    - a badge_defs catalog
    - the parts art library ported from `badges/script-v3.js`
    - Annual / Long Haul / Owner rules with a dry-run backfill
    - Back office → Badges, with award-by-hand for one-of-ones like Tyler's "The Usual Spot"
    - a badge case on the member profile and My Account
  - **Later:** auto-made badge batches from the Royale's Facebook event posts. Mary and Nathan are the Facebook admins.
- **Email:**
  - Nathan and Mary still need to tick themselves under Email → Settings → Who sends.
  - Then send a staff-only test wave, to confirm Resend really holds scheduled emails for the Undo minute.
- **Supabase, Oct 30:** new tables, sequences and functions need explicit GRANTs. `scripts/check-grants.mjs` and `apply-sql.mjs` enforce this for migrations from 2026-10-03 on.

## How releases were done
- **Flow:** feature branch → version bump commit ("Version X.Y.0: …") → PR → wait for the Vercel preview → merge to main, which auto-deploys.
- **Timing:** register, tablet and TV changes ship after close, with Andrew's OK.
- **Migrations:** the local agent applies them with `node scripts/apply-sql.mjs <file>`.
- **Offline checks:**
  - stub env vars, then `npx next typegen && npx tsc --noEmit -p .`
  - eslint on changed files
  - `npx next build --experimental-build-mode=compile` (add `--webpack` in worktrees)
  - the DB-free `scripts/check-*.mjs` (check-bar-book, check-receipt, check-order-ticket, check-card-points, check-daily-coffee)
