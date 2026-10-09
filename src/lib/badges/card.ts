// A badge copy as a trading card: the front (its art, name and series line)
// and the back (set number, rarity, serial, mint date, issuer, event, stats
// and a QR code to its verify page). Both are drawn as SVG, the same on the
// account page, the shared profile, Back office, the verify page and the
// customer tablet, and straight to PNG in scripts/render-badge-samples.mjs.
// Pure: no imports, so the browser (Back office's live preview) can use it.
//
// The art inside is the copy's frozen SVG, as minted; the rest (rarity,
// "of N") is live.

export type Rarity = "Common" | "Uncommon" | "Rare" | "Legendary";

export interface RarityThresholds {
  common: number;
  uncommon: number;
  rare: number;
}

export const DEFAULT_THRESHOLDS: RarityThresholds = { common: 0.5, uncommon: 0.2, rare: 0.05 };

// A badge's rarity: its live copies over everyone holding any badge.
export function rarityFor(copies: number, holders: number, t: RarityThresholds = DEFAULT_THRESHOLDS): Rarity | null {
  if (copies <= 0 || holders <= 0) return null;
  const share = copies / holders;
  if (share >= t.common) return "Common";
  if (share >= t.uncommon) return "Uncommon";
  if (share >= t.rare) return "Rare";
  return "Legendary";
}

export function cleanThresholds(v: unknown): RarityThresholds {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === "number" && x > 0 && x <= 1 ? x : d);
  return { common: n(o.common, DEFAULT_THRESHOLDS.common), uncommon: n(o.uncommon, DEFAULT_THRESHOLDS.uncommon), rare: n(o.rare, DEFAULT_THRESHOLDS.rare) };
}

const RARITY_COLOR: Record<Rarity, { band: string; ink: string }> = {
  Common: { band: "#7d8590", ink: "#ffffff" },
  Uncommon: { band: "#2f6f6b", ink: "#ffffff" },
  Rare: { band: "#1c2c4c", ink: "#c9cdd2" },
  Legendary: { band: "#e8b331", ink: "#1a1612" },
};
const UNMINTED = { band: "#5f584a", ink: "#f6ecd6" };

// ---------- stats ----------
// What a copy's stats object holds, by key, and how the back says it. A
// time of day never shows publicly (it would say when they were here).
const STAT_LABEL: Record<string, string> = {
  visits: "Check-in no.",
  weeks: "Weeks in a row",
  time: "Checked in at",
  year: "Birthday year",
  for: "Awarded for",
  date: "Date", // event badges (lib/badges/events.ts)
  nth: "Attended",
};
const PRIVATE_STATS = new Set(["time"]);

export interface StatLine {
  label: string;
  value: string;
}

export function statLines(stats: Record<string, unknown> | null | undefined, opts: { publicView?: boolean } = {}): StatLine[] {
  const out: StatLine[] = [];
  for (const [k, label] of Object.entries(STAT_LABEL)) {
    const v = stats?.[k];
    if (v === undefined || v === null || v === "") continue;
    if (opts.publicView && PRIVATE_STATS.has(k)) continue;
    out.push({ label, value: typeof v === "number" ? v.toLocaleString("en-US") : String(v).slice(0, 40) });
  }
  return out.slice(0, 3);
}

// ---------- the card ----------

export interface BadgeCardData {
  name: string;
  flavor: string;
  art: string; // the frozen <svg viewBox="0 0 100 100">
  series: number;
  setNumber: number;
  setSize: number; // badges in the series
  rarity: Rarity | null;
  serial: number | null; // null on a preview
  of: number; // live copies of this badge
  minted: string; // "Oct 9, 2026", or less on a public page
  issuer: string;
  event: string | null;
  stats: StatLine[];
  code: string | null;
  verifyUrl: string | null;
  qr: { size: number; d: string } | null;
  revoked: boolean;
}

const W = 250;
const H = 350;
const CREAM = "#f6ecd6";
const INK = "#1a1612";
const GOLD = "#e8b331";
const MUTED = "#6b6152";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad2 = (n: number) => String(n).padStart(2, "0");

// The font classes let a page swap in its own web fonts (globals.css,
// .badge-svg); the attributes are the fallback (a PNG, an email).
const DISPLAY = `class="bcd" font-family="Archivo Black,Arial Black,sans-serif"`;
const MONO = `class="bcm" font-family="Space Mono,Courier New,monospace" font-weight="700"`;
const BODY = `class="bcb" font-family="Archivo,Arial,Helvetica,sans-serif"`;

// "Series 1 · #07 of 11"
export function seriesLine(d: Pick<BadgeCardData, "series" | "setNumber" | "setSize">): string {
  return `Series ${d.series} · #${pad2(d.setNumber)} of ${d.setSize}`;
}

// "#12 of 37"
export function serialLine(d: Pick<BadgeCardData, "serial" | "of">): string {
  return d.serial ? `#${d.serial} of ${Math.max(d.of, 1)}` : "Not minted yet";
}

// Words into at most `lines` lines of about `max` characters.
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${kept[lines - 1].slice(0, max - 1)}…`;
    return kept;
  }
  return out;
}

// The frozen art placed in a box on the card.
function placeArt(art: string, x: number, y: number, size: number): string {
  return art.replace(/^<svg\b/, `<svg x="${x}" y="${y}" width="${size}" height="${size}"`);
}

function frame(inner: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
}

const revokedStamp = () =>
  `<g transform="rotate(-24 125 175)"><rect x="35" y="150" width="180" height="50" rx="6" fill="none" stroke="#c8141b" stroke-width="5"/><text x="125" y="186" text-anchor="middle" ${DISPLAY} font-size="30" fill="#c8141b">REVOKED</text></g>`;

export function cardFrontSvg(d: BadgeCardData): string {
  const tone = d.rarity ? RARITY_COLOR[d.rarity] : UNMINTED;
  const name = d.name.slice(0, 40);
  const nameSize = Math.min(24, Math.floor(212 / Math.max(1, name.length * 0.66)));
  const flavor = wrap(d.flavor, 40, 2);
  return frame(
    `<rect width="${W}" height="${H}" rx="14" fill="${INK}"/>` +
      `<rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="9" fill="${CREAM}"/>` +
      `<path d="M7 16 Q7 7 16 7 H${W - 16} Q${W - 7} 7 ${W - 7} 16 V36 H7 Z" fill="${tone.band}"/>` +
      `<text x="17" y="26" ${MONO} font-size="9.5" fill="${tone.ink}" letter-spacing=".6">${esc(seriesLine(d).toUpperCase())}</text>` +
      `<text x="${W - 17}" y="26" text-anchor="end" ${MONO} font-size="9.5" fill="${tone.ink}" letter-spacing=".6">${esc((d.rarity ?? "New").toUpperCase())}</text>` +
      `<rect x="18" y="45" width="${W - 36}" height="196" rx="7" fill="#efe3c6" stroke="${INK}" stroke-width="2"/>` +
      `<g opacity=".5" stroke="#e3d3ad" stroke-width="1">${Array.from({ length: 9 }, (_, i) => `<line x1="${18 + (i + 1) * 21.4}" y1="47" x2="${18 + (i + 1) * 21.4}" y2="239"/>`).join("")}</g>` +
      placeArt(d.art, 33, 51, 184) +
      `<text x="${W / 2}" y="${270 + Math.round(nameSize / 3)}" text-anchor="middle" ${DISPLAY} font-size="${nameSize}" fill="${INK}">${esc(name)}</text>` +
      flavor.map((l, i) => `<text x="${W / 2}" y="${302 + i * 15}" text-anchor="middle" ${BODY} font-size="11.5" fill="${MUTED}">${esc(l)}</text>`).join("") +
      `<text x="${W / 2}" y="${H - 15}" text-anchor="middle" ${MONO} font-size="7.5" fill="${MUTED}" letter-spacing="1.4">${esc(d.issuer.toUpperCase())}</text>` +
      (d.revoked ? revokedStamp() : ""),
    `${d.name} badge, ${seriesLine(d)}`,
  );
}

export function cardBackSvg(d: BadgeCardData): string {
  const tone = d.rarity ? RARITY_COLOR[d.rarity] : UNMINTED;
  const rows: [string, string, string?][] = [
    ["Set", `#${pad2(d.setNumber)} of ${d.setSize}`],
    ["Rarity", d.rarity ?? "New", tone.band],
    ["Serial", serialLine(d)],
    ["Minted", d.minted || "—"],
    ["Issuer", d.issuer],
  ];
  if (d.event) rows.push(["Event", d.event]);
  for (const s of d.stats) rows.push([s.label, s.value]);
  const shown = rows.slice(0, 8);
  const top = 70;
  const step = 21;
  const rowSvg = shown
    .map(([k, v, chip], i) => {
      const y = top + i * step;
      const value = v.length > 22 ? `${v.slice(0, 21)}…` : v;
      const val = chip
        ? `<rect x="${W - 22 - value.length * 6.6 - 12}" y="${y - 11}" width="${value.length * 6.6 + 12}" height="15" rx="7.5" fill="${chip}"/><text x="${W - 28}" y="${y}" text-anchor="end" ${MONO} font-size="9.5" fill="${tone.ink}">${esc(value.toUpperCase())}</text>`
        : `<text x="${W - 22}" y="${y}" text-anchor="end" ${BODY} font-weight="700" font-size="11" fill="${CREAM}">${esc(value)}</text>`;
      return `<text x="22" y="${y}" ${MONO} font-size="8.5" fill="#b3aa97" letter-spacing=".8">${esc(k.toUpperCase())}</text>${val}<line x1="22" y1="${y + 6}" x2="${W - 22}" y2="${y + 6}" stroke="#3a3428" stroke-width="1"/>`;
    })
    .join("");
  const qrBox = 92;
  const qrY = H - qrBox - 26;
  const qr = d.qr
    ? `<rect x="20" y="${qrY}" width="${qrBox}" height="${qrBox}" rx="5" fill="#ffffff"/><svg x="25" y="${qrY + 5}" width="${qrBox - 10}" height="${qrBox - 10}" viewBox="0 0 ${d.qr.size} ${d.qr.size}" shape-rendering="crispEdges"><path d="${d.qr.d}" fill="${INK}"/></svg>`
    : `<rect x="20" y="${qrY}" width="${qrBox}" height="${qrBox}" rx="5" fill="none" stroke="#3a3428" stroke-dasharray="4 3"/><text x="${20 + qrBox / 2}" y="${qrY + qrBox / 2 + 3}" text-anchor="middle" ${MONO} font-size="8" fill="#b3aa97">QR AT MINT</text>`;
  const tx = 124;
  return frame(
    `<rect width="${W}" height="${H}" rx="14" fill="${INK}"/>` +
      `<rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="9" fill="#211d17" stroke="${tone.band}" stroke-width="2"/>` +
      `<text x="22" y="32" ${DISPLAY} font-size="15" fill="${GOLD}">${esc(d.name.length > 24 ? `${d.name.slice(0, 23)}…` : d.name)}</text>` +
      `<text x="22" y="47" ${MONO} font-size="8.5" fill="#b3aa97" letter-spacing=".8">${esc(seriesLine(d).toUpperCase())}</text>` +
      rowSvg +
      qr +
      `<text x="${tx}" y="${qrY + 16}" ${DISPLAY} font-size="11.5" fill="${CREAM}">Scan to verify</text>` +
      `<text x="${tx}" y="${qrY + 32}" ${BODY} font-size="9.5" fill="#b3aa97">Signed by the issuer.</text>` +
      `<text x="${tx}" y="${qrY + 45}" ${BODY} font-size="9.5" fill="#b3aa97">Every copy is unique.</text>` +
      (d.code ? `<text x="${tx}" y="${qrY + 68}" ${MONO} font-size="8.5" fill="${GOLD}" letter-spacing=".4">${esc(d.code)}</text>` : "") +
      `<text x="${tx}" y="${qrY + 84}" ${MONO} font-size="7" fill="#7d8590" letter-spacing="1">${esc(d.issuer.toUpperCase().slice(0, 22))}</text>` +
      (d.revoked ? revokedStamp() : ""),
    `Back of the ${d.name} badge: ${serialLine(d)}, ${d.rarity ?? "new"}`,
  );
}
