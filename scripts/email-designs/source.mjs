// The three invite designs from the Design canvas (page "The invites"),
// copied here as the canvas exported them (source/*.dc.html), and how to
// open one in Chrome: the canvas's /_blob/ pictures are our own photos in
// public/, so each is pointed at the file here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
const WORK = join(tmpdir(), "rcl-email-render-work");

// Canvas asset id -> the same file (sha256-identical) in public/.
export const BLOBS = {
  f8d049db27cd4388c45caaaab737905b: "public/email/logo-600.png",
  "5236c2dff9cec3eecef56a555a0c71f4": "public/photos/lounge-booths.png",
  "75d504a6dede0ad6a6b972978266c41d": "public/photos/lounge-neon.png",
  "11b92d8824ba88b1f8fdcacd258594af": "public/photos/hero-couple.jpg",
  "3c9b044e4f2ef55e8c87a48c5aa93435": "public/photos/theater-popcorn-couple.jpg",
  c186b21dc893108d6d351f06287a8322: "public/photos/theater-friends.jpg",
  "98343e4f3fd7de09cd6968993fc05d54": "public/photos/cocktails-bar.jpg",
  c8765078438bf2b21f7736c840f04eb3: "public/photos/popcorn-reeses.png",
  "865154bac6516ee4b8dc14c07663286b": "public/photos/pizza.jpg",
  e4d629cffa2b735f1931714e664a0636: "public/photos/vhs-shelf-couple.jpg",
  "94be596f6b35b1a6061873b4dd644789": "public/photos/hot-dog.jpg",
};

export const DESIGNS = [
  { key: "royale-is-here", stem: "RoyaleIsHere" },
  { key: "come-in", stem: "ComeIn" },
  { key: "press-play", stem: "PressPlay" },
];

// A local copy of one design (device "Desktop" or "Phone") that Chrome can
// open: pictures pointed at public/, the canvas runtime script left out.
// A design drawn by hand rather than on the canvas (PaidThrough) is one file
// for both: data-dev="Desktop" or "Phone" on <html> picks the size.
export function designUrl(stem, device) {
  const own = join(HERE, "source", `${stem}-${device}.dc.html`);
  let html = existsSync(own)
    ? readFileSync(own, "utf8")
    : readFileSync(join(HERE, "source", `${stem}.dc.html`), "utf8").replace(/<html\b/, `<html data-dev="${device}"`);
  html = html.replace(/\/_blob\/([0-9a-f]{32})/g, (m, id) => {
    if (!BLOBS[id]) throw new Error(`Unknown canvas picture ${id} in ${stem}-${device}`);
    return pathToFileURL(join(ROOT, BLOBS[id])).href;
  });
  html = html.replace(/<script src="\.\/support\.js"><\/script>/, "");
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `${stem}-${device}.html`);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}
