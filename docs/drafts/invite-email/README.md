# Old-site member invite (draft)

Draft of the email that invites approved old-site members to claim their
account on the new site, reviewed with Andrew on 2026-09-23/24.
Nothing has been sent, and none of this is wired into the app yet.

- `email.mjs`: the email itself (email-client-safe HTML), in two versions:
  `insider` (free Insiders) and `plus` (old paying/Plus members moving to
  Stripe). Built to be ported into the app when the claim page and sending
  are built.
- `build.mjs`: builds the review page from `email.mjs` plus sample data.
  It expects an `images.json` next to it, with the logo and hero photo as
  data URIs.
- `insiders-invite-review.html`: the built review page, with both versions,
  the four screens after the button, edge cases, send plan and open
  decisions. Open it in a browser.

Decided since this draft was made:
- Senior and student rates are set in person at the register only; online
  is always $15.
- The claim page offers "Continue with Google" or a password.

Still open: welcome bonus amount, subject line, sender address, Fortis stop
date, and whether to mention the old billing problems.
