// Turns the three invite designs (source/*.dc.html, from the Design canvas)
// into email-safe pictures: every picture listed in pieces.mjs, from the
// Desktop design (600 wide) and the Phone design (390 wide), at 2x for
// retina screens.
//
//   node scripts/email-designs/render.mjs
//
// Writes:
//   scripts/email-designs/out/designs/...   the pictures, named by content
//                                           hash (upload.mjs puts them in
//                                           the email-assets bucket)
//   src/lib/email/designs/art/...           the bases of the per-person
//                                           pictures (bundled with the app)
//   src/lib/email/designs/assets.ts         the list the emails are built from
//
// Re-run it whenever the canvas designs change, then upload.mjs. Old
// pictures stay in the bucket, so emails already sent keep working.
//
// Uses headless Chrome with one reused profile folder (chrome.mjs) and
// sharp for compression. Needs network for the Google fonts the canvas uses.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { withChrome } from "./chrome.mjs";
import { ART, COMMON, DESIGN_PIECES } from "./pieces.mjs";
import { HERE, ROOT, designUrl } from "./source.mjs";

const OUT = join(HERE, "out", "designs");
const ART_DIR = join(ROOT, "src/lib/email/designs/art");
const MANIFEST = join(ROOT, "src/lib/email/designs/assets.ts");
const SCALE = 2;
const DEVICES = [
  { key: "d", name: "Desktop", width: 600 },
  { key: "m", name: "Phone", width: 390 },
];

const HELPERS = `window.R = {
  sec: (n) => document.querySelector('[data-sec="' + n + '"]'),
  box: (el) => { if (!el) throw new Error('missing element'); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; },
  kids: (el, ...path) => { let e = el; for (const i of path) { if (!e || !e.children[i]) throw new Error('no child ' + i + ' in path ' + path.join('/')); e = e.children[i]; } return e; },
  pad: (b, n) => ({ x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n }),
  full: (top, bottom) => { const r = document.getElementById('root').getBoundingClientRect(); return { x: r.left + scrollX, y: top, w: r.width, h: bottom - top }; },
}; true`;

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

async function encode(png, fmt) {
  if (fmt === "jpg") return { ext: "jpg", buf: await sharp(png).flatten({ background: "#14110c" }).jpeg({ quality: 80, mozjpeg: true, progressive: true }).toBuffer() };
  return { ext: "png", buf: await sharp(png).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9, dither: 1 }).toBuffer() };
}

async function snap(page, piece, dev) {
  await page.eval(HELPERS);
  const rect = await page.eval(`(${piece.rect.toString()})(window.R, ${JSON.stringify(dev)})`);
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  let hidden = 0;
  if (piece.hide) hidden = await page.eval(`(() => { const els = (${piece.hide.toString()})(window.R, ${JSON.stringify(dev)}); window.__hidden = els; els.forEach((e) => e.style.visibility = 'hidden'); return els.length; })()`);
  // Shadows that would end in a hard edge at the crop.
  let flat = 0;
  if (piece.noShadow) flat = await page.eval(`(() => { const els = (${piece.noShadow.toString()})(window.R, ${JSON.stringify(dev)}); window.__flat = els.map((e) => [e, e.style.boxShadow]); els.forEach((e) => e.style.boxShadow = 'none'); return els.length; })()`);
  const png = await page.shot({ x: r.x, y: r.y, width: r.w, height: r.h }, 1);
  if (hidden) await page.eval(`(() => { window.__hidden.forEach((e) => e.style.visibility = ''); return true; })()`);
  if (flat) await page.eval(`(() => { window.__flat.forEach(([e, v]) => e.style.boxShadow = v); return true; })()`);
  return { rect: r, png };
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  rmSync(ART_DIR, { recursive: true, force: true });
  mkdirSync(ART_DIR, { recursive: true });
  const pieces = {}; // "design/name" -> { alt, d, m }
  const art = {}; // kind -> { d, m }
  let total = 0;

  const save = async (id, dev, png, fmt, alt, rect) => {
    const { ext, buf } = await encode(png, fmt);
    const file = `designs/${id}-${dev.key}.${hash(buf)}.${ext}`;
    mkdirSync(dirname(join(HERE, "out", file)), { recursive: true });
    writeFileSync(join(HERE, "out", file), buf);
    total += buf.length;
    pieces[id] = pieces[id] ?? { alt };
    pieces[id][dev.key] = { file, w: rect.w, h: rect.h, bytes: buf.length };
    return file;
  };

  await withChrome(async (page) => {
    for (const dev of DEVICES) {
      // Shared pieces, from the first design.
      await page.open(designUrl("RoyaleIsHere", dev.name), { width: dev.width, height: 900, scale: SCALE });
      for (const p of COMMON) {
        const { rect, png } = await snap(page, p, dev.name);
        await save(`common/${p.name}`, dev, png, p.fmt, p.alt, rect);
      }
      for (const [key, d] of Object.entries(DESIGN_PIECES)) {
        await page.open(designUrl(d.stem, dev.name), { width: dev.width, height: 900, scale: SCALE });
        for (const p of d.pieces) {
          if (p.only && p.only !== dev.name) continue;
          const alt = dev.key === "m" && p.altPhone ? p.altPhone : p.alt;
          if (!p.art) {
            const { rect, png } = await snap(page, p, dev.name);
            const id = `${key}/${p.name}`;
            await save(id, dev, png, p.fmt, p.alt, rect);
            if (alt !== p.alt) pieces[id].altPhone = alt;
            continue;
          }
          // A per-person picture: the base without the words (bundled with
          // the app), the version with no name in it (in the bucket, for
          // anyone we have no first name for), and where the words go.
          const a = ART[p.art];
          await page.eval(HELPERS);
          const crop = await page.eval(`(${p.rect.toString()})(window.R, ${JSON.stringify(dev.name)})`);
          const spec = await page.eval(`(${a.measure.toString()})(window.R, ${JSON.stringify(crop)})`);
          const base = await snap(page, { ...p, hide: a.hide }, dev.name);
          const enc = await encode(base.png, p.fmt);
          const baseFile = `${p.art}-${dev.key}.${enc.ext}`;
          writeFileSync(join(ART_DIR, baseFile), enc.buf);
          let generic;
          if (spec.kind === "tablet") {
            const text = await page.eval(`(() => { const els = (${a.hide.toString()})(window.R); const t = els[1]; window.__was = t.innerHTML; t.innerHTML = ${JSON.stringify(spec.none.join("<br>"))}; return true; })()`);
            generic = (await snap(page, p, dev.name)).png;
            if (text) await page.eval(`(() => { const els = (${a.hide.toString()})(window.R); els[1].innerHTML = window.__was; return true; })()`);
          } else {
            generic = base.png;
          }
          const genericFile = await save(`art/${p.art}`, dev, generic, p.fmt, p.alt, base.rect);
          if (alt !== p.alt) pieces[`art/${p.art}`].altPhone = alt;
          art[p.art] = art[p.art] ?? {};
          art[p.art][dev.key] = { base: baseFile, hash: hash(enc.buf), w: base.rect.w, h: base.rect.h, ext: enc.ext, generic: genericFile, spec };
          console.log(`art ${p.art}-${dev.key}: base ${(enc.buf.length / 1024).toFixed(0)} KB`);
        }
      }
    }
  });

  // The list the emails are built from.
  const lines = Object.entries(pieces)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)},`);
  const artLines = Object.entries(art).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`);
  writeFileSync(
    MANIFEST,
    `// Made by scripts/email-designs/render.mjs from the canvas designs. Don't edit by hand:
// change the design (or pieces.mjs) and run it again.
//
// Each picture in the three invite emails, for desktop (d, from the 600-wide
// design) and phone (m, from the 390-wide design): its file in the
// email-assets bucket, its size in CSS pixels (the file is 2x), and its alt
// text. "art/..." are the per-person pictures' versions with no name in
// them; ART is how the name goes on (src/app/api/email/art).
import type { ArtSpec, Piece } from "./types";

export const PIECES: Record<string, Piece> = {
${lines.join("\n")}
};

export const ART: Record<string, ArtSpec> = {
${artLines.join("\n")}
};
`,
  );
  const files = readdirSync(OUT, { recursive: true }).filter((f) => /\.(png|jpg)$/.test(String(f))).length;
  console.log(`${files} pictures, ${(total / 1024).toFixed(0)} KB in all. Manifest: src/lib/email/designs/assets.ts`);
  for (const [id, v] of Object.entries(pieces)) {
    const big = ["d", "m"].filter((k) => v[k] && v[k].bytes > 250 * 1024);
    if (big.length) console.log(`  large: ${id} ${big.map((k) => `${k} ${(v[k].bytes / 1024).toFixed(0)} KB`).join(", ")}`);
  }
}

await main();
