// Draws the register's meme prints (Register → ✨ → Print a meme) and turns
// them into 1-bit rasters for the receipt printer, written to
// src/lib/print/meme-rasters.ts. All the art is original, drawn here as SVG
// in the old advice-animal / rage-comic style; no real meme images. The
// captions are set in Archivo Black (OFL, already in the repo), squeezed
// narrow like the classic caption type, white with a black outline, and
// drawn into the picture, so nothing depends on the printer's own font.
//
// The art is dithered (Floyd–Steinberg) so its greys become dot patterns;
// the captions go on top with a plain threshold so they stay crisp.
//
// Usage: node scripts/make-meme-rasters.mjs [previewDir]
//   previewDir (optional): also write each finished 1-bit picture as a PNG.
import sharp from "sharp";
import { ImageResponse } from "next/og.js";
import { createElement as h } from "react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 576; // the TM-m30's full line, in dots
const H = 448;
const FONT = readFileSync("src/app/admin/schedule-graphic/fonts/ArchivoBlack-Regular.ttf");
const SQUEEZE = 0.8; // Archivo Black made narrow, like caption type

// ---------- drawing helpers ----------
const K = "#000";
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

// The advice-animal background: wedges from a centre, two greys.
function burst(cx, cy, n, a, b) {
  let s = `<rect width="${W}" height="${H}" fill="${a}"/>`;
  for (let i = 0; i < n; i += 2) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1) / n) * Math.PI * 2;
    s += `<polygon fill="${b}" points="${cx},${cy} ${cx + 1200 * Math.cos(t0)},${cy + 1200 * Math.sin(t0)} ${cx + 1200 * Math.cos(t1)},${cy + 1200 * Math.sin(t1)}"/>`;
  }
  return s;
}

// A thick outlined stroke (an arm, a straw): black, then a lighter core.
const limb = (d, w, fill = "#fff") =>
  `<path d="${d}" fill="none" stroke="${K}" stroke-width="${w + 12}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

// A union of circles with one outline round the whole lot (popcorn).
function blob(circles, fill = "#fff", sw = 7) {
  const out = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${K}" stroke="${K}" stroke-width="${sw * 2}"/>`).join("");
  const inn = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join("");
  return out + inn;
}

// An open hand, fingers up, palm centred at (x, y); `flip` for the left one.
function hand(x, y, s = 1, flip = false) {
  const f = flip ? -1 : 1;
  const g = (inner) => `<g transform="translate(${x} ${y}) scale(${f * s} ${s})">${inner}</g>`;
  const finger = (dx, len, rot) => `<rect x="${dx - 9}" y="${-28 - len}" width="18" height="${len + 20}" rx="9" fill="#fff" stroke="${K}" stroke-width="5" transform="rotate(${rot} ${dx} -20)"/>`;
  return g(
    finger(-22, 40, -14) +
      finger(-7, 50, -4) +
      finger(9, 48, 5) +
      finger(24, 38, 15) +
      `<rect x="34" y="-6" width="40" height="18" rx="9" fill="#fff" stroke="${K}" stroke-width="5" transform="rotate(-35 34 0)"/>` +
      `<rect x="-34" y="-30" width="68" height="62" rx="22" fill="#fff" stroke="${K}" stroke-width="5"/>` +
      `<rect x="-24" y="30" width="48" height="90" fill="#fff" stroke="${K}" stroke-width="5"/>` +
      `<rect x="-31" y="-26" width="62" height="40" rx="18" fill="#fff"/>`,
  );
}

// ---------- the memes ----------
// Each: key, title (for staff), art (SVG), top/bottom caption lines, and
// any extra words in the picture (`words`: x, y, w, size, colour, align).
const MEMES = [
  {
    key: "courage-popcorn",
    title: "Courage Popcorn",
    top: ["TRAILERS RUN LONG"],
    bottom: ["ARRIVE ON TIME ANYWAY"],
    art: () => {
      const pop = [
        [196, 196, 30], [236, 176, 34], [280, 168, 36], [324, 172, 34], [366, 186, 32], [392, 214, 24], [178, 222, 24],
        [218, 140, 28], [262, 128, 30], [306, 132, 30], [348, 146, 28], [284, 98, 26],
      ];
      const top = [182, 210, 394, 210], bot = [212, 446, 364, 446];
      let stripes = "";
      for (let i = 0; i < 7; i += 2) {
        const x0 = top[0] + ((top[2] - top[0]) * i) / 7, x1 = top[0] + ((top[2] - top[0]) * (i + 1)) / 7;
        const b0 = bot[0] + ((bot[2] - bot[0]) * i) / 7, b1 = bot[0] + ((bot[2] - bot[0]) * (i + 1)) / 7;
        stripes += `<polygon fill="#8c8c8c" points="${x0},210 ${x1},210 ${b1},446 ${b0},446"/>`;
      }
      return svg(
        burst(288, 260, 18, "#e9e9e9", "#c4c4c4") +
          blob(pop) +
          `<polygon points="182,210 394,210 364,446 212,446" fill="#fff"/>` +
          stripes +
          `<polygon points="182,210 394,210 364,446 212,446" fill="none" stroke="${K}" stroke-width="7" stroke-linejoin="round"/>` +
          `<rect x="174" y="200" width="228" height="22" rx="6" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          // the face, fierce, on a white label
          `<ellipse cx="288" cy="306" rx="84" ry="66" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<line x1="226" y1="268" x2="278" y2="292" stroke="${K}" stroke-width="13" stroke-linecap="round"/>` +
          `<line x1="350" y1="268" x2="298" y2="292" stroke="${K}" stroke-width="13" stroke-linecap="round"/>` +
          `<polygon points="236,290 274,302 266,314 242,308" fill="${K}"/>` +
          `<polygon points="340,290 302,302 310,314 334,308" fill="${K}"/>` +
          `<circle cx="257" cy="304" r="3.5" fill="#fff"/><circle cx="319" cy="304" r="3.5" fill="#fff"/>` +
          `<path d="M246 336 Q288 318 330 336 Q288 368 246 336 Z" fill="${K}"/>` +
          `<polygon points="259,330 271,328 265,346" fill="#fff"/><polygon points="305,328 317,330 311,346" fill="#fff"/>` +
          `<polygon points="279,325 297,325 288,334" fill="#fff"/>`,
      );
    },
  },
  {
    key: "insanity-projector",
    title: "Insanity Projector",
    top: ["SOMEONE TALKS", "DURING THE MOVIE"],
    bottom: ["PROJECT IT ONTO THEM"],
    art: () => {
      const reel = (cx, cy, r) => {
        let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#a2a2a2" stroke="${K}" stroke-width="6"/>`;
        for (let i = 0; i < 5; i++) {
          const t = (i / 5) * Math.PI * 2 - Math.PI / 2;
          s += `<circle cx="${cx + r * 0.55 * Math.cos(t)}" cy="${cy + r * 0.55 * Math.sin(t)}" r="${r * 0.22}" fill="#fff" stroke="${K}" stroke-width="4"/>`;
        }
        return s + `<circle cx="${cx}" cy="${cy}" r="${r * 0.14}" fill="${K}"/>`;
      };
      let teeth = "";
      for (let x = 222; x < 380; x += 20) teeth += `<line x1="${x}" y1="290" x2="${x}" y2="340" stroke="${K}" stroke-width="4"/>`;
      return svg(
        burst(300, 250, 22, "#ececec", "#b9b9b9") +
          // the beam
          `<polygon points="452,262 452,300 576,236 576,346" fill="#fff"/>` +
          `<line x1="452" y1="270" x2="576" y2="250" stroke="${K}" stroke-width="3" stroke-dasharray="10 8"/>` +
          `<line x1="452" y1="292" x2="576" y2="332" stroke="${K}" stroke-width="3" stroke-dasharray="10 8"/>` +
          // legs
          `<line x1="250" y1="350" x2="200" y2="448" stroke="${K}" stroke-width="10"/><line x1="290" y1="350" x2="290" y2="448" stroke="${K}" stroke-width="10"/><line x1="330" y1="350" x2="380" y2="448" stroke="${K}" stroke-width="10"/>` +
          reel(226, 168, 58) +
          reel(356, 160, 64) +
          `<rect x="168" y="210" width="246" height="140" rx="20" fill="#bdbdbd" stroke="${K}" stroke-width="7"/>` +
          `<rect x="414" y="250" width="40" height="64" rx="6" fill="#707070" stroke="${K}" stroke-width="6"/>` +
          // the eyes, wide, looking two ways
          `<circle cx="238" cy="258" r="34" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<circle cx="326" cy="254" r="42" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<circle cx="252" cy="246" r="7" fill="${K}"/><circle cx="306" cy="270" r="7" fill="${K}"/>` +
          `<path d="M206 222 L262 214" stroke="${K}" stroke-width="7" stroke-linecap="round"/><path d="M292 200 L362 216" stroke="${K}" stroke-width="7" stroke-linecap="round"/>` +
          // the grin
          `<clipPath id="g"><path d="M200 292 Q300 300 398 284 Q370 352 300 352 Q226 350 200 292 Z"/></clipPath>` +
          `<path d="M200 292 Q300 300 398 284 Q370 352 300 352 Q226 350 200 292 Z" fill="#fff"/>` +
          `<g clip-path="url(#g)">${teeth}<path d="M200 318 Q300 330 398 310" stroke="${K}" stroke-width="4" fill="none"/></g>` +
          `<path d="M200 292 Q300 300 398 284 Q370 352 300 352 Q226 350 200 292 Z" fill="none" stroke="${K}" stroke-width="6"/>`,
      );
    },
  },
  {
    key: "problem-grin",
    title: "The 3D Grin",
    top: ["TOLD YOU THERE'S A SCENE", "AFTER THE CREDITS"],
    bottom: ["PROBLEM?"],
    art: () => {
      let teeth = "";
      for (let x = 196; x < 440; x += 26) teeth += `<line x1="${x}" y1="200" x2="${x + 4}" y2="360" stroke="${K}" stroke-width="4"/>`;
      const mouth = "M168 214 Q300 238 436 196 Q412 330 306 352 Q206 330 168 214 Z";
      return svg(
        `<rect width="${W}" height="${H}" fill="#fff"/>` +
          `<g transform="translate(64 48) scale(0.78)">` +
          // head: wide at the top, one long pointed chin
          `<path d="M140 130 C120 30 440 10 466 120 C486 210 440 330 326 452 C246 380 150 250 140 130 Z" fill="#fff" stroke="${K}" stroke-width="7"/>` +
          // 3D glasses
          `<line x1="140" y1="150" x2="190" y2="152" stroke="${K}" stroke-width="8"/><line x1="410" y1="146" x2="470" y2="140" stroke="${K}" stroke-width="8"/>` +
          `<rect x="186" y="126" width="104" height="56" rx="8" fill="#8a8a8a" stroke="${K}" stroke-width="9"/>` +
          `<rect x="306" y="120" width="106" height="56" rx="8" fill="#d6d6d6" stroke="${K}" stroke-width="9"/>` +
          `<path d="M290 150 Q298 140 306 146" stroke="${K}" stroke-width="9" fill="none"/>` +
          `<path d="M200 100 Q238 84 276 98" stroke="${K}" stroke-width="6" fill="none"/><path d="M320 92 Q360 74 400 90" stroke="${K}" stroke-width="6" fill="none"/>` +
          // the grin, ear to ear
          `<clipPath id="m"><path d="${mouth}"/></clipPath>` +
          `<path d="${mouth}" fill="#fff"/>` +
          `<g clip-path="url(#m)">${teeth}<path d="M168 260 Q300 300 436 244" stroke="${K}" stroke-width="5" fill="none"/></g>` +
          `<path d="${mouth}" fill="none" stroke="${K}" stroke-width="7"/>` +
          `<path d="M152 196 Q164 222 182 232" stroke="${K}" stroke-width="5" fill="none"/><path d="M450 180 Q446 206 426 218" stroke="${K}" stroke-width="5" fill="none"/>` +
          `<path d="M286 392 Q306 404 330 396" stroke="${K}" stroke-width="5" fill="none"/>` +
          `</g>`,
      );
    },
  },
  {
    key: "success-ticket",
    title: "Success Stub",
    top: ["FOUND A FREE SEAT"],
    bottom: ["IT'S THE BEST ONE"],
    words: [{ x: 196, y: 128, w: 176, size: 26, color: "#000", text: "ADMIT ONE" }],
    art: () => {
      let seats = "";
      for (let x = -20; x < W; x += 92) seats += `<rect x="${x}" y="292" width="80" height="120" rx="22" fill="#d2d2d2"/><rect x="${x - 4}" y="372" width="88" height="24" rx="10" fill="#c4c4c4"/>`;
      return svg(
        `<rect width="${W}" height="${H}" fill="#ededed"/>` +
          seats +
          // the stub: notched sides, perforated foot
          `<path d="M190 112 H386 V214 A16 16 0 0 0 386 246 V392 H190 V246 A16 16 0 0 0 190 214 Z" fill="#fff" stroke="${K}" stroke-width="7" stroke-linejoin="round"/>` +
          `<line x1="196" y1="352" x2="380" y2="352" stroke="${K}" stroke-width="4" stroke-dasharray="8 7"/>` +
          `<line x1="204" y1="166" x2="372" y2="166" stroke="${K}" stroke-width="4"/>` +
          // smug squint, set jaw
          `<path d="M222 214 Q246 202 270 214" stroke="${K}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M306 214 Q330 202 354 214" stroke="${K}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
          `<path d="M226 222 Q246 232 266 222" stroke="${K}" stroke-width="5" fill="none"/><path d="M310 222 Q330 232 350 222" stroke="${K}" stroke-width="5" fill="none"/>` +
          `<circle cx="246" cy="224" r="5" fill="${K}"/><circle cx="330" cy="224" r="5" fill="${K}"/>` +
          `<path d="M256 300 Q290 286 324 292" stroke="${K}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
          `<path d="M268 312 Q290 322 312 310" stroke="${K}" stroke-width="4" fill="none"/>` +
          // the fist pump
          limb("M384 300 Q440 320 444 260", 24) +
          `<rect x="416" y="196" width="62" height="64" rx="18" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<path d="M418 214 H460 M418 232 H460 M418 250 H460" stroke="${K}" stroke-width="4"/>` +
          `<path d="M460 206 Q476 226 462 252" stroke="${K}" stroke-width="5" fill="none"/>` +
          limb("M192 300 Q150 330 160 380", 22),
      );
    },
  },
  {
    key: "ermahgerd",
    title: "Ermahgerd Kernel",
    top: ["ERMAHGERD"],
    bottom: ["PERPCERN"],
    art: () => {
      const kernel = [
        [288, 250, 104], [204, 214, 64], [372, 214, 64], [230, 152, 60], [288, 136, 64], [346, 152, 60], [196, 290, 58], [380, 290, 58], [288, 330, 70],
      ];
      let dots = "";
      for (let i = 0; i < 40; i++) dots += `<circle cx="${(i * 137) % W}" cy="${(i * 89) % H}" r="5" fill="#d8d8d8"/>`;
      return svg(
        `<rect width="${W}" height="${H}" fill="#f2f2f2"/>` +
          dots +
          blob(kernel, "#fff", 7) +
          `<path d="M232 196 Q244 170 262 176" stroke="${K}" stroke-width="5" fill="none"/><path d="M220 232 Q228 216 240 216" stroke="${K}" stroke-width="4" fill="none"/>` +
          `<path d="M352 174 Q370 166 380 190" stroke="${K}" stroke-width="5" fill="none"/>` +
          // big round glasses, eyes not quite agreeing
          `<circle cx="244" cy="246" r="44" fill="#fff" stroke="${K}" stroke-width="9"/><circle cx="332" cy="246" r="44" fill="#fff" stroke="${K}" stroke-width="9"/>` +
          `<path d="M288 240 Q288 228 288 240" stroke="${K}" stroke-width="9"/><line x1="286" y1="240" x2="290" y2="240" stroke="${K}" stroke-width="9"/>` +
          `<circle cx="254" cy="256" r="11" fill="${K}"/><circle cx="320" cy="236" r="11" fill="${K}"/>` +
          // the open mouth and two big teeth
          `<ellipse cx="288" cy="330" rx="50" ry="34" fill="${K}"/>` +
          `<rect x="266" y="296" width="21" height="28" rx="3" fill="#fff" stroke="${K}" stroke-width="4"/><rect x="289" y="296" width="21" height="28" rx="3" fill="#fff" stroke="${K}" stroke-width="4"/>` +
          // little arms up
          limb("M190 340 Q150 320 140 280", 14) +
          limb("M386 340 Q426 320 436 280", 14),
      );
    },
  },
  {
    key: "credits",
    title: "One Does Not Simply",
    top: ["ONE DOES NOT SIMPLY"],
    bottom: ["LEAVE DURING THE CREDITS"],
    art: () => {
      let holes = "";
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2 + Math.PI / 6;
        holes += `<circle cx="${330 + 100 * Math.cos(t)}" cy="${232 + 100 * Math.sin(t)}" r="22" fill="#fff" stroke="${K}" stroke-width="5"/>`;
      }
      let sprockets = "";
      for (let x = 420; x < 600; x += 26) sprockets += `<rect x="${x}" y="356" width="12" height="9" fill="#fff"/><rect x="${x}" y="405" width="12" height="9" fill="#fff"/>`;
      return svg(
        `<rect width="${W}" height="${H}" fill="#dedede"/>` +
          `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#c4c4c4" stroke-width="60"/>` +
          // film trailing off
          `<path d="M400 340 H600 V430 H400 Z" fill="#6a6a6a" stroke="${K}" stroke-width="5"/>` +
          sprockets +
          `<circle cx="330" cy="232" r="148" fill="#a8a8a8" stroke="${K}" stroke-width="8"/>` +
          holes +
          // a stern face on the hub
          `<circle cx="330" cy="232" r="64" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<path d="M290 206 L322 218" stroke="${K}" stroke-width="9" stroke-linecap="round"/><path d="M370 206 L338 218" stroke="${K}" stroke-width="9" stroke-linecap="round"/>` +
          `<path d="M296 224 Q306 232 318 226" stroke="${K}" stroke-width="5" fill="none"/><path d="M342 226 Q354 232 364 224" stroke="${K}" stroke-width="5" fill="none"/>` +
          `<circle cx="307" cy="230" r="5" fill="${K}"/><circle cx="353" cy="230" r="5" fill="${K}"/>` +
          `<line x1="310" y1="266" x2="350" y2="264" stroke="${K}" stroke-width="6" stroke-linecap="round"/>` +
          // the hand: thumb and finger in a ring
          `<g transform="translate(120 250)">` +
          `<rect x="-26" y="40" width="52" height="140" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<rect x="-36" y="-10" width="72" height="70" rx="24" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          `<rect x="-6" y="-78" width="18" height="76" rx="9" fill="#fff" stroke="${K}" stroke-width="5" transform="rotate(8 0 0)"/>` +
          `<rect x="14" y="-70" width="18" height="70" rx="9" fill="#fff" stroke="${K}" stroke-width="5" transform="rotate(16 20 0)"/>` +
          `<rect x="30" y="-52" width="16" height="56" rx="8" fill="#fff" stroke="${K}" stroke-width="5" transform="rotate(24 36 0)"/>` +
          `<circle cx="-30" cy="-22" r="22" fill="none" stroke="${K}" stroke-width="22"/><circle cx="-30" cy="-22" r="22" fill="none" stroke="#fff" stroke-width="12"/>` +
          `<rect x="-30" y="-4" width="60" height="40" rx="16" fill="#fff"/>` +
          `</g>`,
      );
    },
  },
  {
    key: "y-u-no",
    title: "Y U NO",
    top: ["Y U NO"],
    bottom: ["SILENCE YOUR PHONE"],
    art: () =>
      svg(
        `<rect width="${W}" height="${H}" fill="#fff"/>` +
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
            const t = (i / 12) * Math.PI * 2;
            return `<line x1="${288 + 150 * Math.cos(t)}" y1="${244 + 150 * Math.sin(t)}" x2="${288 + 400 * Math.cos(t)}" y2="${244 + 400 * Math.sin(t)}" stroke="#bdbdbd" stroke-width="10"/>`;
          }).join("") +
          hand(132, 196, 1.1, true) +
          hand(444, 196, 1.1) +
          `<path d="M200 448 Q210 360 288 350 Q366 360 376 448 Z" fill="#fff" stroke="${K}" stroke-width="7"/>` +
          `<circle cx="288" cy="236" r="112" fill="#fff" stroke="${K}" stroke-width="7"/>` +
          // an usher's pillbox cap
          `<g transform="rotate(-10 288 128)"><rect x="238" y="102" width="100" height="40" rx="6" fill="#8e8e8e" stroke="${K}" stroke-width="6"/><line x1="238" y1="114" x2="338" y2="114" stroke="#fff" stroke-width="5"/></g>` +
          `<path d="M218 200 L274 228" stroke="${K}" stroke-width="13" stroke-linecap="round"/><path d="M358 200 L302 228" stroke="${K}" stroke-width="13" stroke-linecap="round"/>` +
          `<path d="M232 230 L266 240" stroke="${K}" stroke-width="7" stroke-linecap="round"/><path d="M344 230 L310 240" stroke="${K}" stroke-width="7" stroke-linecap="round"/>` +
          `<path d="M238 268 H338 L322 330 H254 Z" fill="${K}" stroke="${K}" stroke-width="6" stroke-linejoin="round"/>` +
          `<rect x="246" y="270" width="84" height="12" fill="#fff"/>` +
          `<path d="M264 330 Q288 314 312 330 Z" fill="#9a9a9a"/>` +
          // the phone, buzzing
          `<rect x="458" y="300" width="58" height="104" rx="10" fill="#fff" stroke="${K}" stroke-width="6" transform="rotate(14 487 352)"/>` +
          `<rect x="468" y="314" width="38" height="68" rx="3" fill="#cfcfcf" transform="rotate(14 487 352)"/>` +
          `<path d="M440 312 Q430 336 438 358 M426 304 Q412 336 424 368 M538 334 Q548 358 538 382 M552 326 Q566 360 552 394" stroke="${K}" stroke-width="4" fill="none"/>`,
      ),
  },
  {
    key: "this-is-fine",
    title: "This Is Fine, VHS",
    top: ["THE VCR IS EATING THE TAPE"],
    bottom: ["THIS IS FINE"],
    art: () => {
      const flame = (x, y, s) =>
        `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0 C-30 -20 -24 -60 -4 -90 C-2 -64 14 -60 18 -76 C34 -50 44 -24 30 0 Z" fill="#9c9c9c" stroke="${K}" stroke-width="${5 / s}" stroke-linejoin="round"/>` +
        `<path transform="translate(${x} ${y}) scale(${s})" d="M4 0 C-8 -14 -2 -34 8 -46 C12 -30 22 -26 22 -10 C22 -4 18 0 14 0 Z" fill="#fff"/>`;
      const flames = [[40, 448, 1.6], [96, 448, 1.2], [520, 448, 1.7], [470, 448, 1.1], [40, 250, 1.1], [540, 250, 1.2], [140, 448, 0.9]];
      return svg(
        `<rect width="${W}" height="${H}" fill="#e6e6e6"/>` +
          `<path d="M0 0 H576 V96 Q520 120 460 98 Q400 128 336 100 Q272 126 208 100 Q144 128 80 100 Q40 118 0 98 Z" fill="#c2c2c2"/>` +
          `<line x1="0" y1="380" x2="576" y2="380" stroke="#bdbdbd" stroke-width="4"/>` +
          flames.map(([x, y, s]) => flame(x, y, s)).join("") +
          // table and mug
          `<rect x="370" y="300" width="120" height="14" fill="#fff" stroke="${K}" stroke-width="5"/><line x1="384" y1="314" x2="384" y2="420" stroke="${K}" stroke-width="7"/><line x1="476" y1="314" x2="476" y2="420" stroke="${K}" stroke-width="7"/>` +
          `<rect x="400" y="260" width="40" height="40" rx="5" fill="#fff" stroke="${K}" stroke-width="5"/><path d="M440 270 Q458 280 440 292" stroke="${K}" stroke-width="5" fill="none"/>` +
          `<path d="M412 250 Q404 236 414 224 M428 250 Q420 236 430 224" stroke="${K}" stroke-width="3" fill="none"/>` +
          // the tape eating itself
          `<path d="M250 300 C230 340 180 330 190 370 C200 410 260 380 250 420 C240 448 300 448 300 410 C300 370 350 400 340 430" stroke="${K}" stroke-width="4" fill="none"/>` +
          `<path d="M270 300 C290 330 330 320 320 360 C312 392 260 380 270 410" stroke="${K}" stroke-width="4" fill="none"/>` +
          // the tape, sitting calmly
          `<line x1="250" y1="304" x2="240" y2="380" stroke="${K}" stroke-width="7"/><line x1="320" y1="304" x2="330" y2="380" stroke="${K}" stroke-width="7"/>` +
          `<path d="M352 240 Q380 262 404 278" stroke="${K}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
          `<rect x="196" y="160" width="182" height="146" rx="10" fill="#6e6e6e" stroke="${K}" stroke-width="7"/>` +
          `<rect x="214" y="174" width="146" height="64" rx="4" fill="#fff" stroke="${K}" stroke-width="4"/>` +
          `<circle cx="262" cy="202" r="5" fill="${K}"/><circle cx="312" cy="202" r="5" fill="${K}"/>` +
          `<path d="M268 220 Q287 230 306 220" stroke="${K}" stroke-width="4" fill="none"/>` +
          `<rect x="226" y="250" width="122" height="42" rx="8" fill="#fff" stroke="${K}" stroke-width="4"/>` +
          `<circle cx="256" cy="271" r="13" fill="#fff" stroke="${K}" stroke-width="4"/><circle cx="318" cy="271" r="13" fill="#fff" stroke="${K}" stroke-width="4"/>` +
          `<circle cx="256" cy="271" r="5" fill="${K}"/><circle cx="318" cy="271" r="5" fill="${K}"/>`,
      );
    },
  },
  {
    key: "good-guy-vcr",
    title: "Good Guy VCR",
    top: ["PAUSES FOR YOUR SNACK RUN"],
    bottom: ["NEVER EATS YOUR TAPE"],
    words: [{ x: 374, y: 244, w: 84, size: 22, color: "#000", text: "12:00" }],
    art: () =>
      svg(
        burst(288, 250, 18, "#ececec", "#c8c8c8") +
          // a ball cap on top
          `<path d="M210 170 Q216 108 286 106 Q356 108 362 170 Z" fill="#8a8a8a" stroke="${K}" stroke-width="6"/>` +
          `<path d="M352 166 Q420 158 446 172 L362 172 Z" fill="#8a8a8a" stroke="${K}" stroke-width="6" stroke-linejoin="round"/>` +
          `<circle cx="286" cy="106" r="7" fill="${K}"/>` +
          `<rect x="112" y="168" width="352" height="148" rx="12" fill="#b4b4b4" stroke="${K}" stroke-width="7"/>` +
          `<line x1="112" y1="296" x2="464" y2="296" stroke="${K}" stroke-width="4"/>` +
          // happy eyes, tape-slot grin
          `<path d="M170 222 Q188 198 206 222" stroke="${K}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M262 222 Q280 198 298 222" stroke="${K}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
          `<path d="M160 246 Q234 290 310 246 L304 262 Q234 300 166 262 Z" fill="${K}"/>` +
          // the clock display, still 12:00
          `<rect x="362" y="236" width="88" height="38" rx="4" fill="#fff" stroke="${K}" stroke-width="5"/>` +
          `<circle cx="378" cy="198" r="9" fill="#fff" stroke="${K}" stroke-width="4"/><circle cx="406" cy="198" r="9" fill="#fff" stroke="${K}" stroke-width="4"/><circle cx="434" cy="198" r="9" fill="#fff" stroke="${K}" stroke-width="4"/>` +
          `<rect x="140" y="316" width="40" height="14" fill="${K}"/><rect x="396" y="316" width="40" height="14" fill="${K}"/>` +
          limb("M114 250 Q70 250 62 300", 16) +
          limb("M462 250 Q506 230 510 180", 16) +
          `<circle cx="512" cy="168" r="18" fill="#fff" stroke="${K}" stroke-width="6"/><path d="M512 150 V130" stroke="${K}" stroke-width="14" stroke-linecap="round"/><path d="M512 150 V130" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
      ),
  },
  {
    key: "scumbag-soda",
    title: "Scumbag Soda",
    top: ["BIGGEST SODA THEY HAD"],
    bottom: ["BATHROOM RUN", "DURING THE BIG TWIST"],
    art: () =>
      svg(
        burst(288, 260, 18, "#ebebeb", "#c6c6c6") +
          // straw
          `<g transform="rotate(16 330 150)"><rect x="318" y="20" width="26" height="150" fill="#fff" stroke="${K}" stroke-width="6"/>` +
          [40, 76, 112].map((y) => `<polygon points="321,${y} 341,${y + 10} 341,${y + 26} 321,${y + 16}" fill="#7a7a7a"/>`).join("") +
          `</g>` +
          // knit beanie on the lid
          `<path d="M208 158 Q214 72 288 70 Q362 72 368 158 Z" fill="#7c7c7c" stroke="${K}" stroke-width="6"/>` +
          [234, 258, 288, 318, 342].map((x) => `<path d="M${x} 150 Q${x + (x - 288) * 0.1} 110 ${288 + (x - 288) * 0.5} 76" stroke="#4a4a4a" stroke-width="4" fill="none"/>`).join("") +
          `<rect x="196" y="140" width="184" height="30" rx="8" fill="#9a9a9a" stroke="${K}" stroke-width="6"/>` +
          // the cup
          `<polygon points="204,172 372,172 350,448 226,448" fill="#fff" stroke="${K}" stroke-width="7" stroke-linejoin="round"/>` +
          `<path d="M210 360 Q250 340 288 360 Q326 380 362 356 L356 420 Q320 440 288 420 Q250 400 220 420 Z" fill="#9a9a9a"/>` +
          // sly face
          `<path d="M234 226 L276 236" stroke="${K}" stroke-width="8" stroke-linecap="round"/><path d="M302 220 Q324 204 346 218" stroke="${K}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
          `<path d="M236 252 H274" stroke="${K}" stroke-width="6" stroke-linecap="round"/><path d="M302 252 H342" stroke="${K}" stroke-width="6" stroke-linecap="round"/>` +
          `<path d="M242 254 A13 11 0 0 0 268 254 Z" fill="${K}"/><path d="M308 254 A13 11 0 0 0 334 254 Z" fill="${K}"/>` +
          `<path d="M252 304 Q300 314 334 290" stroke="${K}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
          `<path d="M328 284 Q340 290 336 300" stroke="${K}" stroke-width="4" fill="none"/>`,
      ),
  },
];

// ---------- the words ----------
const CAP_WIDTH = 0.7; // Archivo Black capitals, ems wide (about)
const SPACING = 0.04; // ems between letters, so the outlines don't run together
function captionSize(lines, max = 64) {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.floor(Math.min(max, (W - 24) / (longest * (CAP_WIDTH + SPACING) * SQUEEZE)));
}

function captionBlock(lines, where) {
  const size = captionSize(lines);
  const wide = W / SQUEEZE;
  return h(
    "div",
    {
      style: {
        position: "absolute",
        left: -(wide - W) / 2,
        width: wide,
        [where]: where === "top" ? 4 : 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `scaleX(${SQUEEZE})`,
      },
    },
    ...lines.map((l, i) =>
      h(
        "div",
        { key: i, style: { fontFamily: "Caption", fontSize: size, lineHeight: `${Math.round(size * 1.08)}px`, letterSpacing: size * SPACING, color: "#fff", WebkitTextStroke: `${Math.max(5, Math.round(size / 8))}px #000`, whiteSpace: "nowrap" } },
        l,
      ),
    ),
  );
}

function wordsLayer(m) {
  const kids = [];
  if (m.top?.length) kids.push(captionBlock(m.top, "top"));
  if (m.bottom?.length) kids.push(captionBlock(m.bottom, "bottom"));
  for (const w of m.words ?? [])
    kids.push(h("div", { style: { position: "absolute", left: w.x, top: w.y, width: w.w, display: "flex", justifyContent: "center", fontFamily: "Caption", fontSize: w.size, color: w.color, whiteSpace: "nowrap" } }, w.text));
  return h("div", { style: { width: W, height: H, display: "flex", position: "relative", backgroundColor: "transparent" } }, ...kids);
}

async function renderWords(m) {
  const res = new ImageResponse(wordsLayer(m), { width: W, height: H, fonts: [{ name: "Caption", data: FONT, weight: 400 }] });
  const png = Buffer.from(await res.arrayBuffer());
  return (await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
}

// ---------- to dots ----------
// Floyd–Steinberg, as in src/lib/print/raster.ts. A touch lighter first:
// thermal paper prints dark, and the art's mid greys should read as grey.
function dither(gray) {
  const bits = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.min(255, gray[i] * 0.94 + 18);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const old = gray[i];
      const black = old < 128;
      bits[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < W) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < H) {
        if (x > 0) gray[i + W - 1] += (err * 3) / 16;
        gray[i + W] += (err * 5) / 16;
        if (x + 1 < W) gray[i + W + 1] += err / 16;
      }
    }
  return bits;
}

async function build(m) {
  const art = await sharp(Buffer.from(m.art())).flatten({ background: "#fff" }).greyscale().raw().toBuffer();
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = art[i];
  const bits = dither(gray);
  // The words go on top, crisp: outline black, letters white.
  const words = await renderWords(m);
  for (let i = 0; i < W * H; i++) {
    if (words[i * 4 + 3] < 128) continue;
    const lum = 0.299 * words[i * 4] + 0.587 * words[i * 4 + 1] + 0.114 * words[i * 4 + 2];
    bits[i] = lum < 128 ? 1 : 0;
  }
  const packed = new Uint8Array((W / 8) * H);
  for (let i = 0; i < W * H; i++) if (bits[i]) packed[((i / W) | 0) * (W / 8) + ((i % W) >> 3)] |= 0x80 >> (i % W & 7);
  return { bits, data: Buffer.from(packed).toString("base64") };
}

const previewDir = process.argv[2];
if (previewDir) mkdirSync(previewDir, { recursive: true });
const out = [];
for (const m of MEMES) {
  const { bits, data } = await build(m);
  out.push(`  { key: ${JSON.stringify(m.key)}, title: ${JSON.stringify(m.title)}, raster: { width: ${W}, height: ${H}, data: "${data}" } },`);
  if (previewDir) {
    const px = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) px[i] = bits[i] ? 0 : 255;
    await sharp(px, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(previewDir, `${m.key}.png`));
  }
  console.log(`${m.key}: ${Math.round((bits.reduce((a, b) => a + b, 0) / (W * H)) * 100)}% black`);
}

writeFileSync(
  "src/lib/print/meme-rasters.ts",
  `// Generated by scripts/make-meme-rasters.mjs: original art, captions drawn in. Do not edit.
import "server-only";
import type { Raster } from "./raster";

export interface Meme {
  key: string;
  title: string;
  raster: Raster;
}

export const MEMES: Meme[] = [
${out.join("\n")}
];
`,
);
console.log(`${out.length} memes written`);
