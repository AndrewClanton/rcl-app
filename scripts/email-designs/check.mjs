// Checks the three ready-made emails as they're built for sending
// (src/lib/email/designs), offline: no database, nothing is sent.
//
//   node scripts/email-designs/check.mjs [screenshot folder]
//
// For each email, a few sample readers (a short name, a long one, none,
// already signed up) are rendered, and each is checked: under Gmail's
// 102 KB cut-off, every picture has alt text, every link is https or a
// phone number, no merge field or placeholder is left, nobody on staff is
// named, the unsubscribe link and street address are there. Then headless
// Chrome (one reused profile, chrome.mjs) opens each at phone width (375)
// and desktop width (600) with the pictures from out/ (the per-person ones
// drawn the way /api/email/art draws them): nothing may spill sideways and
// every picture must load. With a folder, it saves a screenshot of each.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withChrome } from "./chrome.mjs";
import { HERE, ROOT } from "./source.mjs";

const SRC = join(ROOT, "src");
const SHOTS = process.argv[2] ? resolve(process.argv[2]) : null;
const STUB = "data:text/javascript,export default {};";
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: STUB, shortCircuit: true };
    if (specifier === "next/og") return { url: pathToFileURL(join(ROOT, "node_modules/next/og.js")).href, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const f = withExt(join(SRC, specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[a-z]+$/i.test(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(SRC)) {
        const f = withExt(resolve(dirname(parent), specifier));
        if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

// Test-only values in this process: a throwaway key, a made-up bucket host.
process.env.EMAIL_TOKEN_SECRET = randomBytes(32).toString("base64url");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bucket.example";
const BUCKET = "https://bucket.example/storage/v1/object/public/email-assets/";
const SITE = "https://www.royalecinemajoplin.com";

const { renderDesignEmail, DESIGNS, DESIGN_KEYS } = await import(pathToFileURL(join(SRC, "lib/email/designs/index.ts")).href);
const { sealArtName, openArtName } = await import(pathToFileURL(join(SRC, "lib/email/designs/art-token.ts")).href);
const { ART } = await import(pathToFileURL(join(SRC, "lib/email/designs/assets.ts")).href);
let drawArt = null;
try {
  ({ drawArt } = await import(pathToFileURL(join(SRC, "lib/email/designs/art-draw.ts")).href));
} catch (e) {
  console.log(`(the per-person pictures can't be drawn outside Next here: ${e.message.split("\n")[0]})`);
}

let failed = 0;
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
};

const readers = [
  { tag: "sam", r: { firstName: "Sam", hasLogin: false, claimUrl: `${SITE}/account/claim?t=${"A".repeat(58)}`, finishUrl: `${SITE}/membership/finish?t=${"B".repeat(48)}`, fromOldSite: true, sendId: "11111111-2222-3333-4444-555555555555" } },
  { tag: "long", r: { firstName: "Christopher", hasLogin: false, claimUrl: `${SITE}/account/claim?t=${"A".repeat(58)}`, finishUrl: `${SITE}/membership/finish?t=${"B".repeat(48)}`, fromOldSite: false, sendId: "11111111-2222-3333-4444-555555555556" } },
  { tag: "noname", r: { firstName: null, hasLogin: false, claimUrl: null, finishUrl: null, fromOldSite: true, sendId: null } },
  { tag: "login", r: { firstName: "Jo", hasLogin: true, claimUrl: null, finishUrl: null, fromOldSite: false, sendId: null } },
];
const L = { preferencesUrl: `${SITE}/email/preferences?t=x`, unsubscribeUrl: `${SITE}/email/preferences?t=x#all`, href: (u) => u };

const work = mkdtempSync(join(tmpdir(), "rcl-email-check-"));
const pages = [];
try {
  // ---------- the HTML ----------
  for (const key of DESIGN_KEYS) {
    const d = DESIGNS[key];
    for (const { tag, r } of readers) {
      const reader = { ...r, artToken: sealArtName(r.firstName) };
      const out = renderDesignEmail(key, d.subject, d.preheader, reader, L);
      const html = out.html;
      const kb = Buffer.byteLength(html) / 1024;
      const id = `${key}/${tag}`;
      check(`${id}: ${kb.toFixed(0)} KB, under Gmail's 102 KB cut-off (100 KB limit)`, kb < 100, `${kb.toFixed(1)} KB`);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
      check(`${id}: no merge field or placeholder left`, !/\{\s*first|\[CLAIM|\[FINISH|_blob|undefined|NaN|\bnull\b/i.test(visible + out.text), (visible + out.text).match(/\{\s*first|\[CLAIM|\[FINISH|_blob|undefined|NaN|\bnull\b/i)?.[0]);
      check(`${id}: nobody on staff is named`, !/andrew|nathan|mary|caleb/i.test(visible + out.text + out.subject));
      check(`${id}: signed "The RCL crew"`, visible.includes("The RCL crew") && out.text.includes("The RCL crew"));
      check(`${id}: unsubscribe, preferences and street address`, html.includes(L.unsubscribeUrl.replace(/&/g, "&amp;")) && html.includes("Unsubscribe") && html.includes("715 E Broadway"));
      const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
      check(`${id}: every picture has alt text (${imgs.length})`, imgs.length > 10 && imgs.every((t) => /\salt="[^"]*"/.test(t)));
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((h) => !h.startsWith("https://fonts.googleapis.com"));
      check(`${id}: every link is https or a phone number (${hrefs.length})`, hrefs.every((h) => h.startsWith(`${SITE}/`) || h === SITE || h.startsWith("tel:+1")), hrefs.find((h) => !(h.startsWith(`${SITE}/`) || h === SITE || h.startsWith("tel:+1"))));
      const pics = [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
      check(`${id}: pictures only from our bucket or our site`, pics.every((s) => s.startsWith(BUCKET) || s.startsWith(`${SITE}/api/email/art/`)), pics.find((s) => !(s.startsWith(BUCKET) || s.startsWith(`${SITE}/api/email/art/`))));
      if (r.firstName) check(`${id}: says their name`, visible.includes(r.firstName) || visible.includes(r.firstName.toUpperCase()) || key === "press-play");
      if (key !== "press-play") {
        const want = r.hasLogin ? "Open my account" : r.claimUrl ? "Set my password" : "Set up my login";
        check(`${id}: the button reads "${want}"`, visible.includes(want));
        if (r.claimUrl && !r.hasLogin) check(`${id}: the button is their own claim link, tagged with the send`, html.includes(`${r.claimUrl}&amp;utm_source=email`) && html.includes(`e=${r.sendId}`));
      } else if (r.finishUrl) {
        check(`${id}: "Restart my unlimited" is their own link, tagged with the send`, html.includes(`${r.finishUrl}&amp;utm_source=email`) && html.includes(`e=${r.sendId}`));
      }
      check(`${id}: subject ${r.firstName ? "has their name" : "reads fine with no name"}`, r.firstName ? out.subject.startsWith(r.firstName) : /^[A-Z]/.test(out.subject) && !out.subject.includes("{"), out.subject.length > 0 ? "" : "empty");
      pages.push({ id, key, tag, html, reader });
    }
  }
  check("art token: a name seals and opens again, and nothing else opens", openArtName(sealArtName("Sam")) === "Sam" && openArtName("x".repeat(60)) === null && sealArtName(null) === null);
  check("art token: the same name always seals the same way (cacheable, retry-safe)", sealArtName("Sam") === sealArtName("Sam") && sealArtName("Sam") !== sealArtName("Jo"));

  // ---------- in a browser ----------
  const local = (html, drawn) =>
    html
      .replace(new RegExp(BUCKET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), pathToFileURL(join(HERE, "out")).href + "/")
      .replace(/https:\/\/www\.royalecinemajoplin\.com\/api\/email\/art\/([a-z]+-[dm])\.[0-9a-f]+\.(png|jpg)\?n=[A-Za-z0-9_-]+/g, (m, piece) => drawn.get(piece) ?? m);
  for (const p of pages) {
    const drawn = new Map();
    if (drawArt && p.reader.firstName) {
      for (const kind of Object.keys(ART)) {
        for (const dev of ["d", "m"]) {
          const v = ART[kind][dev];
          if (!v) continue;
          const file = join(work, `${p.tag}-${kind}-${dev}.${v.ext}`);
          writeFileSync(file, await drawArt(v, p.reader.firstName));
          drawn.set(`${kind}-${dev}`, pathToFileURL(file).href);
        }
      }
    }
    const file = join(work, `${p.id.replace("/", "-")}.html`);
    writeFileSync(file, local(p.html, drawn));
    p.file = file;
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await withChrome(async (page) => {
    for (const p of pages) {
      for (const width of [375, 600]) {
        await page.open(pathToFileURL(p.file).href, { width, height: 900, mobile: width < 480 });
        const m = await page.eval(`JSON.stringify({ sw: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, broken: [...document.images].filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0)).map((i) => i.src.slice(-60)), phone: getComputedStyle(document.querySelector('.m')).display !== 'none' })`);
        const r = JSON.parse(m);
        check(`${p.id} at ${width}px: nothing spills sideways (${r.sw}px wide)`, r.sw <= width, `${r.sw}px`);
        check(`${p.id} at ${width}px: every picture loads`, r.broken.length === 0, r.broken.join(", "));
        check(`${p.id} at ${width}px: shows the ${width < 480 ? "phone" : "desktop"} design`, r.phone === width < 480);
        if (SHOTS && (p.tag === "sam" || (p.key === "come-in" && p.tag === "login"))) {
          const png = await page.shot({ x: 0, y: 0, width, height: r.h }, 1);
          writeFileSync(join(SHOTS, `${p.id.replace("/", "-")}-${width}.png`), png);
        }
      }
    }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
