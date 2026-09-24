import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderInviteEmail } from "./email.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const img = JSON.parse(readFileSync(join(here, "images.json"), "utf8"));

const sample = {
  firstName: "Jamie",
  email: "jamie@example.com",
  since: "Aug 2022",
  claimUrl: "https://royalecinemajoplin.com/welcome/sample",
  upgradeUrl: "https://royalecinemajoplin.com/welcome/sample?then=plus",
  unsubscribeUrl: "https://royalecinemajoplin.com/unsubscribe/sample",
  bonusPoints: "100",
  bonusDollars: "$5",
  oldBillingStops: "October 15",
  plusTier: { label: "Adult", price: 15 },
};
const emails = {
  insider: renderInviteEmail({ ...sample, variant: "insider" }),
  plus: renderInviteEmail({ ...sample, variant: "plus" }),
};

// A stand-in member QR code (random modules + the three corner squares).
function qrSvg(size = 25, cell = 4) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const inFinder = (x, y) => [[0, 0], [size - 7, 0], [0, size - 7]].some(([fx, fy]) => x >= fx - 1 && x < fx + 8 && y >= fy - 1 && y < fy + 8);
  let rects = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!inFinder(x, y) && rnd() > 0.52) rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
  for (const [fx, fy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    rects += `<rect x="${fx * cell}" y="${fy * cell}" width="${7 * cell}" height="${7 * cell}"/><rect x="${(fx + 1) * cell}" y="${(fy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/><rect x="${(fx + 2) * cell}" y="${(fy + 2) * cell}" width="${3 * cell}" height="${3 * cell}"/>`;
  }
  return `<svg viewBox="0 0 ${size * cell} ${size * cell}" width="96" height="96" fill="#14110c" aria-hidden="true">${rects}</svg>`;
}

const data = {
  images: img,
  emails,
  notes: {
    insider: [
      ["Who gets it", "About 1,720 people: every approved account without a paid plan on the old site."],
      ["Personal details", "Their first name, their old-site email, and the month they joined (the ticket stub) are filled in for each person."],
      ["Dashed outlines", "The bonus amount. Pick it in your calls at the bottom."],
      ["The Insiders+ button", "It takes them through the same password step, then straight to picking a plan."],
      ["If images are blocked", "Outlook and some work inboxes hide pictures at first. Every word and both buttons are real text, so nothing important goes missing."],
      ["The fine print", "It tells anyone who never had an account to ignore the email. Some old signups used strangers' addresses."],
    ],
    plus: [
      ["Who gets it", "About 290 people who had a subscription, a Plus flag, or a paid plan on the old site."],
      ["Their price", "Carried over from their old plan. Old prices match the new ones: Adult $15, Senior $12, Student $10. Old senior and student rates come across as-is, and staff can change them at the register."],
      ["Dashed outlines", "The bonus amount and the date old billing stops. Both are your calls."],
      ["Why a second step", "Card numbers can't move from Fortis to Stripe, so they re-enter it once. The billing day becomes the day they do."],
      ["Annual plans", "27 of them paid yearly. The new site is monthly only (see your calls)."],
    ],
  },
};

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Insiders Invite</title>
<meta name="description" content="Draft of the email inviting old-site members to the new Royale site, and what happens after they click.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f8f5ec;--surface:#ffffff;--soft:#efe8d3;--ink:#14110c;--muted:#6b6455;--line:#e3ddc9;
  --red:#ed1c24;--gold:#ffc72c;--ok:#1f6b3a;
  --display:'Archivo Black','Arial Black',Arial,sans-serif;
  --body:Archivo,Arial,Helvetica,sans-serif;
  --mono:'Space Mono','Courier New',monospace;
  color-scheme:light;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55}
.wrap{max-width:1140px;margin:0 auto;padding-inline:20px;padding-block:44px 88px}
h1,h2,h3{font-family:var(--display);font-weight:400;text-wrap:balance;margin:0}
p{margin:0}
.kicker{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--red)}
header.top{display:grid;gap:14px;max-width:760px}
header.top h1{font-size:clamp(38px,6vw,60px);line-height:1}
.lead{font-size:18px;max-width:62ch}
.facts{display:flex;flex-wrap:wrap;gap:0;margin:10px 0 0;border:1px solid var(--line);border-radius:10px;background:var(--surface);width:fit-content;max-width:100%}
.facts div{padding:12px 20px;border-right:1px solid var(--line)}
.facts div:last-child{border-right:0}
.facts dt{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:2px 0 0;font-family:var(--display);font-size:20px;font-variant-numeric:tabular-nums}
section{margin-top:64px}
.sec-head{display:grid;gap:6px;margin-bottom:22px;max-width:720px}
.sec-head h2{font-size:30px;line-height:1.1}
.sec-head p{color:var(--muted)}
.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:18px}
.seg{display:inline-flex;border:1.5px solid var(--ink);border-radius:999px;overflow:hidden;background:var(--surface)}
.seg button{font:600 14px/1 var(--body);padding:10px 16px;border:0;background:transparent;color:var(--ink);cursor:pointer}
.seg button+button{border-left:1.5px solid var(--ink)}
.seg button span{font-family:var(--mono);font-size:12px;opacity:.7;margin-left:4px}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.seg button:focus-visible,.check input:focus-visible{outline:3px solid var(--red);outline-offset:2px}
.check{display:inline-flex;gap:8px;align-items:center;font-size:14px;color:var(--muted);cursor:pointer}
.check input{accent-color:var(--red);width:16px;height:16px}
.email-layout{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}
.email-col{flex:0 1 700px;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.inbox{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.avatar{flex:none;width:38px;height:38px;border-radius:50%;background:var(--ink);color:var(--gold);font:18px/38px var(--display);text-align:center}
.inbox-text{min-width:0;font-size:14px;line-height:1.4}
.from{font-weight:700}.from .addr{font-weight:400;color:var(--muted)}
.subj{font-weight:700;margin-top:2px}
.pre{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame-wrap{background:var(--soft);border-radius:12px;padding:24px 16px;overflow-x:auto;display:flex;justify-content:center}
#frame{display:block;border:0;background:#f8f5ec;max-width:100%;height:1400px;box-shadow:0 1px 0 var(--line),0 12px 30px rgba(20,17,12,.12);transition:width .2s ease}
.toast{font-size:13px;color:var(--ok);min-height:20px}
.notes{flex:1 1 280px;display:grid;gap:0;align-content:start;position:sticky;top:20px}
.notes h3{font-size:18px;margin-bottom:6px}
.note{padding:14px 0;border-top:1px solid var(--line)}
.note b{display:block;font-size:14px}
.note span{display:block;font-size:14px;color:var(--muted)}
.phones{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:28px}
.phones li{display:grid;gap:14px;align-content:start}
.phone{width:100%;max-width:250px;height:500px;margin-inline:auto;border:8px solid var(--ink);border-radius:32px;background:var(--bg);overflow:hidden;display:flex;flex-direction:column;font-size:12px;line-height:1.4}
.phone .bar{background:var(--ink);padding:12px 0 10px;text-align:center}
.phone .bar img{width:84px;height:auto;display:inline-block}
.scr{padding:16px 14px;display:flex;flex-direction:column;gap:7px;flex:1}
.eb{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--red)}
.sh{font-family:var(--display);font-size:19px;line-height:1.1;margin-bottom:4px}
.sh2{font-family:var(--display);font-size:15px;line-height:1.15}
.fl{font-size:10.5px;color:var(--muted);margin-top:3px}
.in{background:#fff;border:1px solid var(--line);border-radius:7px;padding:7px 9px;font-size:12px;min-height:30px;display:flex;justify-content:space-between;gap:6px}
.in.locked{background:var(--soft);color:var(--muted)}
.in.locked span{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.1em;align-self:center}
.in.two span{flex:1;color:#a39c8c}.in.ph{color:#a39c8c}
.gbtn{background:#fff;border:1px solid #747775;border-radius:8px;padding:8px;text-align:center;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px}
.gbtn .g{font-weight:800;color:#4285f4}
.or{text-align:center;font-size:10px;color:var(--muted);margin:2px 0}
.pbtn{background:var(--red);color:#fff;font-weight:700;text-align:center;border-radius:8px;padding:10px;margin-top:8px}
.pbtn.dark{background:#30313d}
.tiny{font-size:10.5px;color:var(--muted);line-height:1.4}
.gift{background:var(--gold);font-family:var(--display);font-size:13px;text-align:center;border-radius:8px;padding:9px;border:1.5px dashed var(--ink)}
.card-in{background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:6px}
.opt{border:1px solid var(--line);border-radius:7px;padding:6px 9px;display:flex;justify-content:space-between}
.opt.sel{border:1.5px solid var(--ink);background:var(--soft)}
.lnk{text-align:center;font-size:11px;text-decoration:underline;color:var(--muted)}
.stripe{background:#fff}
.stripe .big{font-size:22px;font-weight:700}.stripe .big span{font-size:11px;font-weight:400;color:var(--muted)}
.acct{display:flex;gap:10px;align-items:center;margin-bottom:4px}
.av{width:40px;height:40px;border-radius:50%;background:var(--ink);color:var(--gold);font:18px/40px var(--display);text-align:center;flex:none}
.bignum{font-family:var(--display);font-size:30px;color:var(--red);line-height:1}
.qr{align-items:center;text-align:center}
.cap{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline}
.cap .n{font-family:var(--display);font-size:22px;color:var(--red);grid-row:span 2}
.cap strong{font-size:16px}
.cap p{font-size:14px;color:var(--muted);grid-column:2}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
table.cases{width:100%;border-collapse:collapse;font-size:15px;min-width:560px}
.cases th,.cases td{text-align:left;vertical-align:top;padding:14px 18px;border-top:1px solid var(--line)}
.cases thead th{border-top:0;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
.cases td:first-child{font-weight:700;width:34%}
.cases td:last-child{color:#3d382e}
.timeline{list-style:none;margin:0;padding:0;display:grid;gap:0;max-width:820px}
.timeline li{display:grid;grid-template-columns:120px 1fr;gap:18px;padding:16px 0;border-top:1px solid var(--line)}
.timeline li:last-child{border-bottom:1px solid var(--line)}
.when{font-family:var(--mono);font-size:13px;font-weight:700;color:var(--red);padding-top:2px}
.timeline b{display:block}
.timeline span{color:var(--muted);font-size:15px}
.who{display:inline-block;margin-left:6px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;background:var(--gold);padding:1px 6px;border-radius:4px;color:var(--ink);vertical-align:2px}
.calls{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.call{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px 22px;display:grid;gap:10px;align-content:start}
.call h3{font-size:19px;line-height:1.15}
.call p{font-size:15px;color:#3d382e}
.call ol{margin:0;padding-left:20px;font-size:15px;display:grid;gap:4px}
.pick{font-size:14px;border-top:1px dashed var(--line);padding-top:10px}
.pick b{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin-right:6px}
footer{margin-top:56px;font-size:13px;color:var(--muted);max-width:70ch}
@media (max-width:720px){
  .timeline li{grid-template-columns:1fr;gap:4px}
  .notes{position:static}
  .facts div{border-right:0;flex:1 1 45%}
}
@media (prefers-reduced-motion:reduce){#frame{transition:none}}
</style>

<div class="wrap">
<header class="top">
  <div class="kicker">Draft · nothing has been sent</div>
  <h1>The Insiders invite</h1>
  <p class="lead">This is the email the approved members from the old site will get, and what happens after they tap the button. Nothing goes out until you make the calls at the bottom and sign off on a test send.</p>
  <dl class="facts">
    <div><dt>Approved so far</dt><dd>2,013</dd></div>
    <div><dt>Versions</dt><dd>2</dd></div>
    <div><dt>Reminders</dt><dd>1, after a week</dd></div>
    <div><dt>Each link lasts</dt><dd>30 days</dd></div>
  </dl>
</header>

<section id="email" aria-labelledby="email-h">
  <div class="sec-head">
    <h2 id="email-h">The email</h2>
    <p>Shown for a sample member, Jamie. Every real email fills in that person's own name, email address and join date. This is the actual email code, not a picture of it.</p>
  </div>
  <div class="controls">
    <div class="seg" role="group" aria-label="Which version">
      <button type="button" id="v-insider" data-variant="insider" aria-pressed="true">Insiders <span>~1,720</span></button>
      <button type="button" id="v-plus" data-variant="plus" aria-pressed="false">Insiders+ moving <span>~290</span></button>
    </div>
    <div class="seg" role="group" aria-label="Screen size">
      <button type="button" id="w-desktop" data-width="desktop" aria-pressed="true">Computer</button>
      <button type="button" id="w-phone" data-width="phone" aria-pressed="false">Phone</button>
    </div>
    <label class="check" for="showph"><input type="checkbox" id="showph" checked> Outline the parts you still pick</label>
  </div>
  <div class="email-layout">
    <div class="email-col">
      <div class="inbox" aria-label="How it looks in the inbox list">
        <div class="avatar" aria-hidden="true">R</div>
        <div class="inbox-text">
          <div class="from">Royale Cinema Lounge <span class="addr">&lt;hello@royalecinemajoplin.com&gt;</span></div>
          <div class="subj" id="subj"></div>
          <div class="pre" id="pre"></div>
        </div>
      </div>
      <div class="frame-wrap"><iframe id="frame" title="Email preview" sandbox="allow-same-origin"></iframe></div>
      <div class="toast" id="toast" role="status"></div>
    </div>
    <aside class="notes" aria-label="Notes on this version">
      <h3 id="notes-h">Notes on this version</h3>
      <div id="notes"></div>
    </aside>
  </div>
</section>

<section id="flow" aria-labelledby="flow-h">
  <div class="sec-head">
    <h2 id="flow-h">After they tap the button</h2>
    <p>The same four screens for everyone. Old Insiders+ members skip the sales pitch on screen 2, because their plan is already picked.</p>
  </div>
  <ol class="phones">
    <li>
      <div class="phone" aria-hidden="true"><div class="bar"><img src="${img.logo}" alt=""></div>
        <div class="scr">
          <div class="eb">Welcome back</div>
          <div class="sh">Hi Jamie, finish setting up.</div>
          <div class="gbtn"><span class="g">G</span> Continue with Google</div>
          <div class="or">or pick a password</div>
          <div class="fl">Email</div><div class="in locked">jamie@example.com <span>locked</span></div>
          <div class="fl">Password</div><div class="in">••••••••••</div>
          <div class="pbtn">Set password &amp; sign in</div>
          <div class="tiny">Not you? Close this page. Nothing happens until someone presses the button.</div>
        </div>
      </div>
      <div class="cap"><span class="n">1</span><strong>Google, or a password</strong>
        <p>One tap with Google (no password to remember), or pick a password. The email is filled in and locked, so the link can only set up that one account. Opening the link does nothing on its own. Gmail's scanner opens links automatically, which is what broke the old one-click sign-in links. Only this button counts.</p></div>
    </li>
    <li>
      <div class="phone" aria-hidden="true"><div class="bar"><img src="${img.logo}" alt=""></div>
        <div class="scr">
          <div class="gift">+100 points added</div>
          <div class="sh" style="margin-top:4px">You're in, Jamie.</div>
          <div class="tiny">Your member QR code is waiting in your account.</div>
          <div class="card-in">
            <div class="eb">Insiders+</div>
            <div class="sh2">Walk in free, every time.</div>
            <div class="opt sel"><span>Free entry, every screening</span><b>$15/mo</b></div>
            <div class="tiny">Senior or student? Show your ID at the box office and we'll switch you to $12 or $10.</div>
            <div class="pbtn" style="margin-top:2px">Continue to checkout</div>
            <div class="lnk">Not now, go to my account</div>
          </div>
        </div>
      </div>
      <div class="cap"><span class="n">2</span><strong>Bonus lands, then the offer</strong>
        <p>Points go into their account right away. "Not now" is always one tap away. Online it's always $15. Senior and student rates are switched at the register after an ID check. Old Insiders+ members keep the rate they had, and see a "Re-add my card" button.</p></div>
    </li>
    <li>
      <div class="phone" aria-hidden="true">
        <div class="scr stripe">
          <div class="tiny">&larr; Royale Cinema Lounge</div>
          <div class="sh2" style="margin-top:6px">Insiders+ Adult</div>
          <div class="big">$15.00 <span>per month</span></div>
          <div class="fl">Email</div><div class="in">jamie@example.com</div>
          <div class="fl">Card information</div><div class="in ph">1234 1234 1234 1234</div><div class="in two"><span>MM / YY</span><span>CVC</span></div>
          <div class="fl">Name on card</div><div class="in"></div>
          <div class="pbtn dark">Subscribe</div>
        </div>
      </div>
      <div class="cap"><span class="n">3</span><strong>Checkout, only if they upgrade</strong>
        <p>Stripe's own secure page (sketched here; Stripe designs it). Card numbers never touch our site. It renews on the same date each month: someone who joins on the 23rd is billed every 23rd.</p></div>
    </li>
    <li>
      <div class="phone" aria-hidden="true"><div class="bar"><img src="${img.logo}" alt=""></div>
        <div class="scr">
          <div class="acct"><div class="av">J</div><div><div class="sh2">Jamie</div><div class="tiny">Insiders+ · active</div></div></div>
          <div class="card-in"><div class="eb">Points balance</div><div class="bignum">100</div><div class="tiny">100 pts = $5 off at the register.</div></div>
          <div class="card-in qr">${qrSvg()}<div class="tiny">Show this at the door or register.</div></div>
        </div>
      </div>
      <div class="cap"><span class="n">4</span><strong>Their account</strong>
        <p>The account page that's already live: points, member QR code, billing, and every movie they've seen at the Royale.</p></div>
    </li>
  </ol>
</section>

<section id="cases" aria-labelledby="cases-h">
  <div class="sec-head">
    <h2 id="cases-h">When something goes sideways</h2>
    <p>Two thousand people means every one of these will happen at least once.</p>
  </div>
  <div class="table-wrap">
    <table class="cases">
      <thead><tr><th scope="col">If…</th><th scope="col">What happens</th></tr></thead>
      <tbody>
        <tr><td>They open the link after 30 days</td><td>The page says it expired and offers "Email me a fresh one." The new link only goes to that same address.</td></tr>
        <tr><td>They already set a password</td><td>The link says "You're all set" with Sign in and Forgot password buttons.</td></tr>
        <tr><td>An email scanner opens the link first</td><td>Nothing happens. The link still works when the real person taps it.</td></tr>
        <tr><td>They forward the email to a friend</td><td>The friend could only set a password on the original member's account, never make their own. Nothing gets charged without a card, so the stakes are low.</td></tr>
        <tr><td>The address never belonged to them</td><td>The footer tells them to ignore it. They get one reminder, then no more emails.</td></tr>
        <tr><td>They unsubscribe, or the address bounces</td><td>They're never emailed again, automatically. Anyone who unsubscribed on Mailchimp is removed before the first send.</td></tr>
        <tr><td>They already have an account on the new site</td><td>They don't get this email. The import already connected their old record to the account they have.</td></tr>
        <tr><td>They're a senior or student</td><td>They join at $15 online. Staff check their ID at the register and switch them, and the lower price starts with their next bill. (The register can do this now.)</td></tr>
        <tr><td>They reply with a question</td><td>It lands in a real inbox you choose (see your calls below).</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="send" aria-labelledby="send-h">
  <div class="sec-head">
    <h2 id="send-h">How it goes out</h2>
    <p>Spread over a few days, because a brand-new sending address that blasts 2,000 emails on day one tends to land in spam.</p>
  </div>
  <ol class="timeline">
    <li><div class="when">First</div><div><b>Test send to you and Nathan</b><span>Both versions, on your own phones, in Gmail and iPhone Mail. Nothing else goes out until you say it looks right.</span></div></li>
    <li><div class="when">Day 1</div><div><b>The ~290 Insiders+ members</b><span>They have the most at stake with billing, and they're the most likely to open it, which shows Gmail that people want our emails.</span></div></li>
    <li><div class="when">Days 2–4</div><div><b>The ~1,720 Insiders, in growing batches</b><span>Small first, then larger once the early batches show few bounces and spam reports.</span></div></li>
    <li><div class="when">A week later</div><div><b>One reminder</b><span>Only to people who haven't set a password: "Your Royale account is still waiting." Then we stop.</span></div></li>
    <li><div class="when">Cutover day</div><div><b>Old billing stops<span class="who">you</span></b><span>On the date in the Insiders+ email, recurring billing gets turned off in Fortis. I can't do this part. It's in their dashboard.</span></div></li>
    <li><div class="when">Throughout</div><div><b>A live tracker</b><span>On the Old site members screen: sent, password set, joined Insiders+, bounced, unsubscribed.</span></div></li>
  </ol>
</section>

<section id="calls" aria-labelledby="calls-h">
  <div class="sec-head">
    <h2 id="calls-h">Your calls before I build it</h2>
    <p>Each one has my pick. Tell me which to change and I'll build the rest around them.</p>
  </div>
  <div class="calls">
    <div class="call"><h3>Welcome bonus</h3>
      <p>50, 100 or 200 points. If half the list sets a password and every one of them spends the bonus, 100 points comes to about $5,000 in discounts, and only when they're buying something.</p>
      <div class="pick"><b>My pick</b>100 points ($5), what the email shows.</div></div>
    <div class="call"><h3>Subject line</h3>
      <ol><li>You're already an Insider at the new Royale</li><li>Jamie, your Royale account moved. Set a password.</li><li>We rebuilt the Royale's website (and saved your spot)</li></ol>
      <div class="pick"><b>My pick</b>#1. It says what they get before they open it.</div></div>
    <div class="call"><h3>Who it's from</h3>
      <p>Sending from royalecinemajoplin.com means adding a few DNS records wherever that domain is registered. Who has that login?</p>
      <div class="pick"><b>My pick</b>"Royale Cinema Lounge" &lt;hello@royalecinemajoplin.com&gt;, with replies going to an inbox you actually check.</div></div>
    <div class="call"><h3>Email service</h3>
      <p>Resend plugs straight into the new site. A plan big enough for this list plus the weekly lineup runs roughly $20 a month, compared with $130 for Mailchimp (check the current price when you sign up). You create the account; I connect it.</p>
      <div class="pick"><b>My pick</b>Resend, and move the weekly lineup email there too.</div></div>
    <div class="call"><h3>Old Insiders+ cutover</h3>
      <p>Pick the date Fortis billing stops (the email shows October 15 as a stand-in). Also: should the email acknowledge the old billing problems and offer to fix wrong charges? I left that out. How public to be about it is your call.</p>
      <div class="pick"><b>My pick</b>A date about 3 weeks after the Insiders+ send, so everyone has time to re-add a card.</div></div>
    <div class="call"><h3>Annual plans</h3>
      <p>27 old members paid for a year up front, and the new site is monthly only. Some of them will still have months left when we switch over.</p>
      <div class="pick"><b>My pick</b>Anyone with time left gets free Insiders+ until their year runs out, then it moves to monthly.</div></div>
  </div>
</section>

<footer>Draft built from the real email template, filled with a sample member. Photo: the Royale's own theater shot from the website. No real member's details are on this page.</footer>
</div>

<script>
const DATA = /*DATA*/;
const frame = document.getElementById("frame");
const toast = document.getElementById("toast");
const state = { variant: "insider", width: "desktop", ph: true };
const PH_STYLE = "<style>[data-ph]{outline:2px dashed #ed1c24;outline-offset:1px;border-radius:2px}</style>";

function fit() {
  try { frame.style.height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height) + "px"; } catch (e) {}
}
function render() {
  const e = DATA.emails[state.variant];
  document.getElementById("subj").textContent = e.subject;
  document.getElementById("pre").textContent = e.preheader;
  let html = e.html.split("cid:logo").join(DATA.images.logo).split("cid:hero").join(DATA.images.hero);
  if (state.ph) html = html.replace("</head>", PH_STYLE + "</head>");
  frame.style.width = state.width === "phone" ? "375px" : "640px";
  frame.srcdoc = html;
  document.getElementById("notes").innerHTML = DATA.notes[state.variant]
    .map(([b, t]) => '<div class="note"><b>' + b + "</b><span>" + t + "</span></div>").join("");
  document.querySelectorAll("[data-variant]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.variant === state.variant)));
  document.querySelectorAll("[data-width]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.width === state.width)));
  toast.textContent = "";
}
frame.addEventListener("load", () => {
  fit();
  const doc = frame.contentDocument;
  if (!doc) return;
  if (doc.fonts) doc.fonts.ready.then(fit);
  doc.querySelectorAll("img").forEach((i) => i.addEventListener("load", fit));
  setTimeout(fit, 400);
  doc.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    ev.preventDefault();
    const t = a.textContent.trim().replace(/\\s*→$/, "");
    toast.textContent = t === "Unsubscribe"
      ? "In the real email, this removes them from every future email in one click."
      : "In the real email, \\u201c" + t + "\\u201d opens that person's own password page (screen 1 below).";
  });
});
window.addEventListener("resize", fit);
document.querySelectorAll("[data-variant]").forEach((b) => b.addEventListener("click", () => { state.variant = b.dataset.variant; render(); }));
document.querySelectorAll("[data-width]").forEach((b) => b.addEventListener("click", () => { state.width = b.dataset.width; render(); }));
document.getElementById("showph").addEventListener("change", (ev) => { state.ph = ev.target.checked; render(); });
render();
</script>
`;

const json = JSON.stringify(data).replace(/</g, "\\u003c");
writeFileSync(join(here, "insiders-invite-review.html"), page.replace("/*DATA*/", () => json));
// Standalone copies of each email, as they'd arrive (images inlined for viewing).
for (const [k, e] of Object.entries(emails)) {
  writeFileSync(join(here, `email-${k}.html`), e.html.split("cid:logo").join(img.logo).split("cid:hero").join(img.hero));
}
console.log("ok", Math.round(readFileSync(join(here, "insiders-invite-review.html")).length / 1024) + "KB");
