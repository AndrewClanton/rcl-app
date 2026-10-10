// Temporary: three sample monogram receipts for Andrew to compare on paper.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 576, H = 980;
const out = process.argv[2];

// ---------- the three patterns (our own; thin 2px strokes, about 10–15% ink) ----------
const star = (x, y, r) => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    p.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${p.join(" ")}" fill="none" stroke="#000" stroke-width="2"/>`;
};
const spark = (x, y, r) => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="none" stroke="#000" stroke-width="2"/>`;

function monogram() {
  // Diagonal lattice of interlocked "RCL", four-point sparkles and tiny stars.
  let s = "";
  const step = 96;
  for (let row = -1; row < H / step + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0), y = row * step;
      s += `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-style="italic" font-weight="bold" fill="none" stroke="#000" stroke-width="1.6" text-anchor="middle">RCL</text>`;
      s += spark(x + step / 2, y - 10, 13);
      s += star(x, y + step / 2 - 10, 7);
    }
  return s;
}

function filmstrip() {
  // Film strips down both edges with sprocket holes; ticket stubs and stars scattered.
  let s = "";
  for (const x0 of [6, W - 46]) {
    s += `<rect x="${x0}" y="0" width="40" height="${H}" fill="none" stroke="#000" stroke-width="2"/>`;
    for (let y = 8; y < H; y += 28) s += `<rect x="${x0 + 12}" y="${y}" width="16" height="12" rx="3" fill="none" stroke="#000" stroke-width="2"/>`;
  }
  const stub = (x, y, rot) =>
    `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M-34 -16 H34 V-6 A6 6 0 0 0 34 6 V16 H-34 V6 A6 6 0 0 0 -34 -6 Z" fill="none" stroke="#000" stroke-width="2"/><line x1="-14" y1="-16" x2="-14" y2="16" stroke="#000" stroke-width="2" stroke-dasharray="4 4"/><text x="10" y="6" font-family="Arial" font-size="15" font-weight="bold" text-anchor="middle" fill="#000">RCL</text></g>`;
  let k = 0;
  for (let y = 40; y < H; y += 110)
    for (let x = 100; x < W - 80; x += 130) {
      k++;
      s += k % 3 === 0 ? star(x + 20, y + 30, 9) : stub(x + ((y / 110) % 2 ? 40 : 0), y, k % 2 ? -12 : 10);
    }
  return s;
}

function route66() {
  // Route 66 style shields with "RCL" over "66", marquee bulbs between, on a diagonal.
  let s = "";
  const shield = (x, y) =>
    `<g transform="translate(${x} ${y})"><path d="M-26 -30 Q-16 -36 0 -30 Q16 -36 26 -30 Q30 0 0 32 Q-30 0 -26 -30 Z" fill="none" stroke="#000" stroke-width="2"/><line x1="-25" y1="-14" x2="25" y2="-14" stroke="#000" stroke-width="2"/><text x="0" y="-18" font-family="Arial" font-size="11" font-weight="bold" text-anchor="middle" fill="#000">RCL</text><text x="0" y="12" font-family="Arial" font-size="22" font-weight="bold" text-anchor="middle" fill="none" stroke="#000" stroke-width="1.5">66</text></g>`;
  const step = 120;
  for (let row = -1; row < H / step + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0), y = row * step + 40;
      s += shield(x, y);
      for (let b = 0; b < 3; b++) s += `<circle cx="${x + 34 + b * 13}" cy="${y + 52 + b * 4}" r="3.5" fill="none" stroke="#000" stroke-width="2"/>`;
      s += star(x + step / 2, y - 6, 8);
    }
  return s;
}

// LV-style: a staggered grid of separate symbols, each in its own cell.
const rcMark = (x, y, k) =>
  `<g transform="translate(${x} ${y}) scale(${k})"><text x="-7" y="9" font-family="Georgia, serif" font-size="34" font-style="italic" fill="none" stroke="#000" stroke-width="1.7" text-anchor="middle">R</text><text x="8" y="13" font-family="Georgia, serif" font-size="34" font-style="italic" fill="none" stroke="#000" stroke-width="1.7" text-anchor="middle">C</text></g>`;
const reel = (x, y, r) => {
  let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#000" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${r * 0.18}" fill="none" stroke="#000" stroke-width="2"/>`;
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    s += `<circle cx="${(x + r * 0.58 * Math.cos(a)).toFixed(1)}" cy="${(y + r * 0.58 * Math.sin(a)).toFixed(1)}" r="${(r * 0.2).toFixed(1)}" fill="none" stroke="#000" stroke-width="2"/>`;
  }
  return s;
};
const lozenge = (x, y, r) =>
  `<path d="M${x} ${y - r} Q${x + r * 0.35} ${y - r * 0.35} ${x + r} ${y} Q${x + r * 0.35} ${y + r * 0.35} ${x} ${y + r} Q${x - r * 0.35} ${y + r * 0.35} ${x - r} ${y} Q${x - r * 0.35} ${y - r * 0.35} ${x} ${y - r}Z" fill="none" stroke="#000" stroke-width="2"/>` + spark(x, y, r * 0.45);
const bulbStar = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#000" stroke-width="2"/>` + star(x, y, r * 0.65);
function monoGrid(step, k) {
  let s = "";
  const motifs = [(x, y) => rcMark(x, y, k), (x, y) => lozenge(x, y, 17 * k), (x, y) => reel(x, y, 16 * k), (x, y) => bulbStar(x, y, 15 * k)];
  for (let row = -1; row < H / (step / 2) + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0), y = row * (step / 2);
      s += motifs[(((col * 2 + row) % 4) + 4) % 4](x, y);
    }
  return s;
}

// Interlocked RCL (not RC: that's RC Cola).
const rclMark = (x, y, k) =>
  `<g transform="translate(${x} ${y}) scale(${k})" font-family="Georgia, serif" font-size="30" font-style="italic" fill="none" stroke="#000" stroke-width="1.7" text-anchor="middle"><text x="-16" y="8">R</text><text x="1" y="12">C</text><text x="17" y="6">L</text></g>`;
// An admit-one ticket: notched ends, a perforation line, a star.
const ticket = (x, y, k) =>
  `<g transform="translate(${x} ${y}) scale(${k}) rotate(-14)"><path d="M-24 -13 H24 V-5 A5 5 0 0 0 24 5 V13 H-24 V5 A5 5 0 0 0 -24 -5 Z" fill="none" stroke="#000" stroke-width="1.8"/><line x1="-10" y1="-13" x2="-10" y2="13" stroke="#000" stroke-width="1.6" stroke-dasharray="3 3"/></g>` + star(x + 6 * k, y - 1.5 * k, 6 * k);
// A clapperboard.
const clapper = (x, y, k) =>
  `<g transform="translate(${x} ${y}) scale(${k})"><rect x="-18" y="-6" width="36" height="22" fill="none" stroke="#000" stroke-width="1.8"/><path d="M-18 -6 L-16 -17 L19 -12 L18 -6" fill="none" stroke="#000" stroke-width="1.8"/><path d="M-9 -15.5 L-13 -6 M1 -14 L-3 -6 M11 -13 L7 -6" stroke="#000" stroke-width="1.8"/><line x1="-18" y1="2" x2="18" y2="2" stroke="#000" stroke-width="1.4"/></g>`;
function monoGrid2(step, k, fourth) {
  let s = "";
  const motifs = [(x, y) => rclMark(x, y, k), (x, y) => fourth(x, y), (x, y) => reel(x, y, 16 * k), (x, y) => ticket(x, y, k)];
  for (let row = -1; row < H / (step / 2) + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0), y = row * (step / 2);
      s += motifs[(((col * 2 + row) % 4) + 4) % 4](x, y);
    }
  return s;
}

// Film strips down both edges, like real 35mm: perforations on both sides of
// each strip and picture frames between them, with a little film icon in each.
function filmstrip2() {
  let s = "";
  const sw = 74, frameH = 64;
  const icons = [(x, y) => star(x, y, 9), (x, y) => ticket(x, y, 0.55), (x, y) => reel(x, y, 10), (x, y) => clapper(x, y, 0.6), (x, y) => rclMark(x, y, 0.6)];
  let n = 0;
  for (const x0 of [4, W - sw - 4]) {
    s += `<rect x="${x0}" y="-2" width="${sw}" height="${H + 4}" fill="none" stroke="#000" stroke-width="2.5"/>`;
    for (let y = 4; y < H; y += 16) for (const px of [x0 + 4, x0 + sw - 12]) s += `<rect x="${px}" y="${y}" width="8" height="9" rx="2" fill="none" stroke="#000" stroke-width="1.6"/>`;
    for (let y = 6; y < H; y += frameH) {
      s += `<rect x="${x0 + 17}" y="${y}" width="${sw - 34}" height="${frameH - 8}" rx="3" fill="none" stroke="#000" stroke-width="1.8"/>`;
      s += icons[n++ % icons.length](x0 + sw / 2, y + (frameH - 8) / 2);
    }
  }
  // Between the strips (only above and below the receipt): a few stubs and stars.
  for (const y of [70, H - 70]) for (const [i, x] of [180, 288, 396].entries()) s += i === 1 ? star(x, y, 10) : ticket(x, y, 1.1);
  return s;
}

// A fuller Route 66 shield: the classic two-bump top, a band with RCL, a big
// 66, and JOPLIN MO along the bottom, with a double outline.
const shield2 = (x, y, k) => {
  const path = "M-30 -34 Q-24 -40 -15 -38 Q-6 -36 0 -40 Q6 -36 15 -38 Q24 -40 30 -34 Q36 -6 22 18 Q12 32 0 38 Q-12 32 -22 18 Q-36 -6 -30 -34 Z";
  return `<g transform="translate(${x} ${y}) scale(${k})"><path d="${path}" fill="none" stroke="#000" stroke-width="2.2"/><path d="${path}" transform="scale(0.86)" fill="none" stroke="#000" stroke-width="1.2"/><line x1="-27" y1="-20" x2="27" y2="-20" stroke="#000" stroke-width="1.6"/><text x="0" y="-24" font-family="Arial" font-size="10" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="1">RCL</text><text x="0" y="12" font-family="Arial Black, Arial" font-size="27" font-weight="bold" text-anchor="middle" fill="none" stroke="#000" stroke-width="1.6">66</text><text x="0" y="22" font-family="Arial" font-size="6" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="0.4">JOPLIN</text></g>`;
};
function route66b(step, k) {
  let s = "";
  for (let row = -1; row < H / (step / 2) + 2; row++)
    for (let col = -1; col < W / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0), y = row * (step / 2);
      if (row % 2) continue;
      const sx = x + ((row / 2) % 2 ? step / 2 : 0);
      s += shield2(sx, y, k) + spark(sx + step / 2, y, 11) + star(sx + step / 2, y, 4);
    }
  return s;
}

// One wide strip of film, like 70mm IMAX: perforations down both edges, edge
// lettering, and full-width frames, with the receipt printed in a frame.
function imax() {
  let s = "";
  const pw = 28; // perforation band each side
  s += `<line x1="1" y1="0" x2="1" y2="${H}" stroke="#000" stroke-width="2.5"/><line x1="${W - 1}" y1="0" x2="${W - 1}" y2="${H}" stroke="#000" stroke-width="2.5"/>`;
  for (let y = 3; y < H; y += 15) for (const px of [8, W - 8 - 13]) s += `<rect x="${px}" y="${y}" width="13" height="9" rx="2.5" fill="none" stroke="#000" stroke-width="1.6"/>`;
  // Edge lettering, running down the film like the codes on real stock.
  const edge = "RCL 70MM  ▸ 15/70  ★  ROYALE CINEMA LOUNGE  ▸  JOPLIN MO  ★  ";
  for (const [x, rot] of [[pw + 10, 90], [W - pw - 10, -90]])
    s += `<text transform="translate(${x} ${rot > 0 ? 6 : H - 6}) rotate(${rot})" font-family="Courier New, monospace" font-size="11" font-weight="bold" fill="#000" letter-spacing="1.5">${edge.repeat(6)}</text>`;
  // Frames: full width between the edge lettering, with frame lines between.
  const fx = pw + 22, fw = W - 2 * fx;
  for (const [y0, h] of [[-120, 112], [H - 120, 200]]) s += `<rect x="${fx}" y="${y0}" width="${fw}" height="${h}" rx="10" fill="none" stroke="#000" stroke-width="2.2"/>`;
  // Inside the frames above and below: a projected-picture feel, a reel and a clapper.
  s += reel(W / 2 - 60, H - 72, 22) + clapper(W / 2 + 60, H - 70, 1.3);
  return s;
}
function receiptOnFilm(name) {
  // The receipt's own frame, full width inside the film.
  const fx = 28 + 22, fw = W - 2 * fx;
  return `<rect x="${fx}" y="12" width="${fw}" height="${H - 150}" rx="10" fill="#fff" stroke="#000" stroke-width="2.2"/>` + receipt(name, { x: fx + 14, y: 70, w: fw - 28, h: 690, plain: true });
}

// The receipt as a strip of movie frames: one wide film, sprockets down both
// edges, the receipt split across equal frames like stills from a film.
function filmFrames(name) {
  let s = "";
  const pw = 30, fx = pw + 8, fw = W - 2 * fx, gap = 14, n = 4, fh = (H - gap * (n + 1)) / n;
  s += `<rect x="1" y="-2" width="${W - 2}" height="${H + 4}" fill="none" stroke="#000" stroke-width="2.5"/>`;
  for (let y = 4; y < H; y += 16) for (const px of [9, W - 9 - 13]) s += `<rect x="${px}" y="${y}" width="13" height="9" rx="2.5" fill="none" stroke="#000" stroke-width="1.6"/>`;
  const t = (x, y, size, str, o = {}) => `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" ${o.bold ? 'font-weight="bold"' : ""} text-anchor="${o.anchor ?? "middle"}" fill="#000">${esc(str)}</text>`;
  const row = (y, l, r, big) => t(fx + 26, y, big ? 28 : 22, l, { anchor: "start", bold: big }) + t(fx + fw - 26, y, big ? 28 : 22, r, { anchor: "end", bold: big });
  const frames = [
    (y) => t(W / 2, y + 62, 30, "ROYALE CINEMA LOUNGE", { bold: true }) + t(W / 2, y + 94, 20, "Joplin, MO") + t(W / 2, y + 134, 22, `Sample ${name}`, { bold: true }) + t(W / 2, y + 166, 20, "Thu Oct 8, 2026  7:42 PM") + t(W / 2, y + 196, 20, "Order #1048"),
    (y) => row(y + 70, "Popcorn (large)", "$7.00") + row(y + 112, "Manhattan", "$10.00") + row(y + 154, "Day pass", "$5.00"),
    (y) => row(y + 70, "Subtotal", "$22.00") + row(y + 108, "Tax 8.725%", "$1.92") + row(y + 162, "TOTAL", "$23.92", true),
    (y) => t(W / 2, y + 70, 20, "Thanks for coming in.") + t(W / 2, y + 102, 20, "The RCL crew", { bold: true }) + reel(W / 2 - 70, y + 160, 20) + clapper(W / 2 + 70, y + 160, 1.2) + t(W / 2, y + 168, 16, "THE END", { bold: true }),
  ];
  frames.forEach((draw, i) => {
    const y = gap + i * (fh + gap);
    s += `<rect x="${fx}" y="${y}" width="${fw}" height="${fh}" rx="12" fill="#fff" stroke="#000" stroke-width="2.2"/>`;
    s += `<text x="${fx + 10}" y="${y + 18}" font-family="Courier New, monospace" font-size="11" font-weight="bold" fill="#000">${i + 1}</text>`;
    s += draw(y);
  });
  // Edge lettering in the gaps between frames.
  for (let i = 1; i < n; i++) s += `<text x="${W / 2}" y="${i * (fh + gap) + gap / 2 + 4}" font-family="Courier New, monospace" font-size="10" font-weight="bold" text-anchor="middle" fill="#000" letter-spacing="2">RCL 70MM ▸ ${i}A  ★  JOPLIN MO</text>`;
  return s;
}

// ---------- the sample receipt on a white label in the middle ----------
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function receipt(name, o = {}) {
  const { x = 70, y = 150, w = W - 140, h = 690, plain = false } = o;
  const rows = [
    ["center", "ROYALE CINEMA LOUNGE", 30, true],
    ["center", "Joplin, MO", 20, false],
    ["center", "", 14, false],
    ["center", `Sample ${name}`, 22, true],
    ["center", "Thu Oct 8, 2026  7:42 PM", 20, false],
    ["center", "Order #1048", 20, false],
    ["rule"],
    ["row", "Popcorn (large)", "$7.00"],
    ["row", "Manhattan", "$10.00"],
    ["row", "Day pass", "$5.00"],
    ["rule"],
    ["row", "Subtotal", "$22.00"],
    ["row", "Tax 8.725%", "$1.92"],
    ["rowb", "TOTAL", "$23.92"],
    ["rule"],
    ["center", "Thanks for coming in.", 20, false],
    ["center", "The RCL crew", 20, true],
  ];
  let s = plain ? "" : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="3"/><rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" fill="none" stroke="#000" stroke-width="1.5"/>`;
  let cy = y + 60;
  for (const r of rows) {
    if (r[0] === "rule") { s += `<line x1="${x + 28}" y1="${cy - 8}" x2="${x + w - 28}" y2="${cy - 8}" stroke="#000" stroke-width="2" stroke-dasharray="6 5"/>`; cy += 26; continue; }
    if (r[0] === "center") { s += `<text x="${W / 2}" y="${cy}" font-family="Arial" font-size="${r[2]}" ${r[3] ? 'font-weight="bold"' : ""} text-anchor="middle" fill="#000">${esc(r[1])}</text>`; cy += r[2] + 12; continue; }
    const b = r[0] === "rowb";
    s += `<text x="${x + 32}" y="${cy}" font-family="Arial" font-size="${b ? 28 : 22}" ${b ? 'font-weight="bold"' : ""} fill="#000">${esc(r[1])}</text><text x="${x + w - 32}" y="${cy}" font-family="Arial" font-size="${b ? 28 : 22}" ${b ? 'font-weight="bold"' : ""} text-anchor="end" fill="#000">${esc(r[2])}</text>`;
    cy += b ? 42 : 34;
  }
  return s;
}

const samples = [
  ["B4: Movie frames", "", "frames"],
];

const jobs = [];
for (const [name, pattern, film] of samples) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${pattern}${film === "frames" ? filmFrames(name) : film ? receiptOnFilm(name) : receipt(name)}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(`${out}/sample-${name.split(":")[0]}.png`, png);
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const bits = new Uint8Array((W / 8) * H);
  let ink = 0;
  for (let i = 0; i < W * H; i++) if (data[i] < 140) { bits[(i / W | 0) * (W / 8) + ((i % W) >> 3)] |= 0x80 >> (i % W & 7); ink++; }
  const b64 = Buffer.from(bits).toString("base64");
  const xml = `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><image width="${W}" height="${H}" align="center" color="color_1" mode="mono">${b64}</image><feed line="2"/><cut type="feed"/></epos-print>`;
  jobs.push({ label: `Receipt pattern sample ${name}`, xml });
  console.log(name, "ink", ((ink / (W * H)) * 100).toFixed(1) + "%");
}
writeFileSync(`${out}/jobs.json`, JSON.stringify(jobs));
