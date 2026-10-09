// The badge art generator, gen-1: the parts library from the approved
// design (docs/cloud-handoff/badges/script-v3.js), ported as is. A badge's
// art is a recipe (ArtSpec): a form (pin, patch, coin...) and parts placed
// on it. Pure, no imports: the server, Back office's badge maker (a live
// preview in the browser) and the scripts all draw with it.
//
// FROZEN. Every copy minted from gen-1 stores the SVG this file drew when it
// was minted, and its signature covers that SVG's hash. Changing how a part
// or form draws here would make new copies of an old badge look different
// from the ones already out. New drawing goes in a new generator (gen-2,
// Series 2); adding a brand-new part or form id here is fine, since no
// issued copy uses it yet.

export const GENERATOR = "gen-1";

export const P = {
  red: "#c8141b",
  dred: "#8f0b10",
  gold: "#e8b331",
  lgold: "#ffd36b",
  navy: "#1c2c4c",
  night: "#121a33",
  cream: "#f6ecd6",
  ink: "#1a1612",
  teal: "#2f6f6b",
  plum: "#5a2a4a",
  orange: "#e0702a",
  pink: "#e98fa8",
  green: "#3f7a3a",
  brown: "#6b4426",
  walnut: "#5b3a22",
  silver: "#c9cdd2",
  steel: "#7d8590",
  white: "#ffffff",
  bronze: "#b07a45",
  dbronze: "#8a5a2c",
  brass: "#c9a24a",
} as const;

export interface FormOpts {
  shape?: ShapeId;
  fill?: string;
  edge?: string;
  stitch?: string;
  tail?: string;
}

export interface PartOpts {
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  c?: string;
  c2?: string;
  t?: string;
  w?: number;
}

export interface ArtSpec {
  form: [FormId] | [FormId, FormOpts];
  parts?: ([PartId] | [PartId, PartOpts])[];
}

// Text in the art: XML-escaped (a name plate's "TYLER" comes from Back office).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const T = (t: string, x: number, y: number, s: number, fill: string, font = "Archivo Black,Arial Black,sans-serif", extra = "") =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${s}" fill="${fill}" ${extra}>${esc(t)}</text>`;

const ring = (n: number, r: number, cx: number, cy: number, f: (a: number, x: number, y: number, i: number) => string) =>
  Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2, cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2), i)).join("");

const SHAPES = {
  round: "M50 6 A44 44 0 1 1 49.9 6 Z",
  rounded: "M10 30 Q10 14 26 14 H74 Q90 14 90 30 V82 H10 Z",
  square: "M14 10 H86 V90 H14 Z",
  card: "M12 16 Q12 10 18 10 H82 Q88 10 88 16 V84 Q88 90 82 90 H18 Q12 90 12 84 Z",
  diamond: "M50 6 L92 50 L50 94 L8 50 Z",
  slice: "M50 92 L12 22 Q50 2 88 22 Z",
};
export type ShapeId = keyof typeof SHAPES;
export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

// ---------- forms: the base object ----------
const FORMS = {
  pin: (o: FormOpts) =>
    `<path d="${SHAPES[o.shape || "round"]}" fill="${o.edge}"/><path d="${SHAPES[o.shape || "round"]}" fill="${o.fill}" transform="translate(50 50) scale(.86) translate(-50 -50)"/>`,
  patch: (o: FormOpts) =>
    `<path d="${SHAPES[o.shape || "round"]}" fill="${o.fill}"/><path d="${SHAPES[o.shape || "round"]}" fill="none" stroke="${o.stitch}" stroke-width="2.2" stroke-dasharray="3 2.4" transform="translate(50 50) scale(.88) translate(-50 -50)"/>`,
  coin: (o: FormOpts) =>
    `<circle cx="50" cy="50" r="44" fill="${o.edge}"/><circle cx="50" cy="50" r="44" fill="none" stroke="${o.fill}" stroke-width="4" stroke-dasharray="1.6 1.9"/><circle cx="50" cy="50" r="36" fill="${o.fill}"/><circle cx="50" cy="50" r="32" fill="none" stroke="${o.edge}" stroke-width="1.6"/>`,
  button: (o: FormOpts) => `<circle cx="50" cy="50" r="42" fill="${o.fill}"/><circle cx="50" cy="50" r="42" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>`,
  stub: (o: FormOpts) =>
    `<path d="M10 24 H90 V40 A8 8 0 0 0 90 60 V76 H10 V60 A8 8 0 0 0 10 40 Z" fill="${o.fill}"/><line x1="70" y1="27" x2="70" y2="73" stroke="${P.cream}" stroke-width="1.6" stroke-dasharray="2.5 2.5"/>`,
  rosette: (o: FormOpts) =>
    `<path d="M38 66 L30 96 L40 89 L46 98 L50 68 Z M62 66 L70 96 L60 89 L54 98 L50 68 Z" fill="${o.tail}"/>${ring(16, 30, 50, 44, (a, x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${o.fill}"/>`)}<circle cx="50" cy="44" r="27" fill="${o.fill}"/><circle cx="50" cy="44" r="22" fill="none" stroke="${P.cream}" stroke-width="1.4" stroke-dasharray="2 2"/>`,
  pennant: (o: FormOpts) =>
    `<rect x="14" y="10" width="5" height="84" rx="2" fill="${P.brown}"/><path d="M19 14 L92 36 L19 60 Z" fill="${o.fill}"/><path d="M23 20 L84 36 L23 53 Z" fill="none" stroke="${P.cream}" stroke-width="1.6" stroke-dasharray="3 2.5"/>`,
  crest: (o: FormOpts) =>
    `<path d="M50 10 L84 20 V46 Q84 76 50 92 Q16 76 16 46 V20 Z" fill="${o.fill}"/><path d="M50 15 L79 24 V46 Q79 72 50 86 Q21 72 21 46 V24 Z" fill="none" stroke="${o.edge}" stroke-width="1.8"/>`,
  filmcan: () => `<circle cx="50" cy="50" r="42" fill="${P.steel}"/><circle cx="50" cy="50" r="38" fill="${P.silver}"/>`,
  none: () => "",
};
export type FormId = keyof typeof FORMS;
export const FORM_IDS = Object.keys(FORMS) as FormId[];

// What each form is called, and which of its colors the maker offers.
export type FormColor = "fill" | "edge" | "stitch" | "tail";
export const FORM_INFO: Record<FormId, { label: string; colors: FormColor[]; shapes?: boolean }> = {
  pin: { label: "Enamel pin", colors: ["fill", "edge"], shapes: true },
  patch: { label: "Stitched patch", colors: ["fill", "stitch"], shapes: true },
  coin: { label: "Coin", colors: ["fill", "edge"] },
  button: { label: "Pinback button", colors: ["fill"] },
  stub: { label: "Ticket stub", colors: ["fill"] },
  rosette: { label: "Ribbon rosette", colors: ["fill", "tail"] },
  pennant: { label: "Felt pennant", colors: ["fill"] },
  crest: { label: "Crest", colors: ["fill", "edge"] },
  filmcan: { label: "Film can", colors: [] },
  none: { label: "No form", colors: [] },
};

// ---------- parts: pictures, accents and plates, centered on 50,50 ----------
const PARTS = {
  admit: () => T("ADMIT", 50, 46, 10, P.cream) + T("ONE", 50, 59, 10, P.cream),
  star: (o: PartOpts) => `<path d="M50 41 l2.6 5.4 5.9 .7 -4.4 4 1.2 5.8 -5.3 -3 -5.3 3 1.2 -5.8 -4.4 -4 5.9 -.7 z" fill="${o.c || P.lgold}"/>`,
  stars: (o: PartOpts) => `<g fill="${o.c || P.white}"><circle cx="24" cy="24" r="1.8"/><circle cx="32" cy="15" r="1.2"/><circle cx="78" cy="70" r="1.4"/><circle cx="18" cy="60" r="1.2"/></g>`,
  sunrise: () =>
    `<circle cx="50" cy="58" r="18" fill="${P.red}"/><rect x="8" y="58" width="84" height="34" fill="${P.navy}"/><g stroke="${P.red}" stroke-width="4" stroke-linecap="round"><path d="M50 30 v-10 M30 40 l-7 -7 M70 40 l7 -7 M24 56 h-10 M76 56 h10"/></g>`,
  owl: () =>
    `<path d="M30 78 Q28 46 50 42 Q72 46 70 78 Z" fill="${P.brown}"/><path d="M33 46 l-3 -10 9 6 M67 46 l3 -10 -9 6" fill="${P.brown}"/><circle cx="41" cy="54" r="8" fill="${P.cream}"/><circle cx="59" cy="54" r="8" fill="${P.cream}"/><circle cx="41" cy="54" r="3.6" fill="${P.ink}"/><circle cx="59" cy="54" r="3.6" fill="${P.ink}"/><path d="M47 61 L50 67 L53 61 Z" fill="${P.orange}"/>`,
  moon: (o: PartOpts) => `<path d="M52 38 a12 12 0 1 0 10 18 a10 10 0 0 1 -10 -18 z" fill="${o.c || P.lgold}"/>`,
  cake: () =>
    `<rect x="28" y="52" width="44" height="22" rx="3" fill="${P.cream}"/><path d="M28 58 q5.5 5 11 0 t11 0 11 0 11 0" stroke="${P.red}" stroke-width="3" fill="none"/><rect x="47" y="36" width="6" height="16" rx="1.5" fill="${P.navy}"/><path d="M50 26 q6 6 0 10 q-6 -4 0 -10 z" fill="${P.lgold}"/>`,
  confetti: () =>
    `<circle cx="24" cy="28" r="2.4" fill="${P.lgold}"/><circle cx="76" cy="30" r="2.4" fill="${P.navy}"/><circle cx="72" cy="20" r="2" fill="${P.white}"/><circle cx="20" cy="70" r="2" fill="${P.white}"/>`,
  calendar4: () =>
    `<rect x="32" y="32" width="36" height="34" rx="3" fill="${P.cream}"/><rect x="32" y="32" width="36" height="9" rx="3" fill="${P.red}"/><g stroke="${P.ink}" stroke-width="2.6" stroke-linecap="round"><path d="M40 48 v12 M46 48 v12 M52 48 v12 M58 48 v12 M37 58 l25 -8"/></g>`,
  popcorn: () =>
    `<path d="M32 46 L37 82 H63 L68 46 Z" fill="${P.white}"/><g fill="${P.red}"><path d="M37 46 L41 82 H46 L44 46 Z"/><path d="M53 46 L53 82 H58 L60 46 Z"/></g><g fill="#fff7dc" stroke="#e2c98a" stroke-width="1"><circle cx="37" cy="42" r="7"/><circle cx="47" cy="36" r="8"/><circle cx="57" cy="38" r="8"/><circle cx="65" cy="44" r="6"/><circle cx="51" cy="28" r="6"/></g>`,
  pizza: () =>
    `<path d="M50 84 L24 32 Q50 20 76 32 Z" fill="#f3c35a"/><path d="M24 32 Q50 20 76 32 L73 38 Q50 27 27 38 Z" fill="#c9883b"/><g fill="${P.red}"><circle cx="42" cy="44" r="5"/><circle cx="58" cy="46" r="5"/><circle cx="50" cy="62" r="5"/></g>`,
  num: (o: PartOpts) => T(o.t ?? "", 50, o.y || 57, o.s || 22, o.c || P.ink),
  seat: () =>
    `<path d="M32 30 Q50 22 68 30 V56 H32 Z" fill="${P.red}"/><path d="M36 34 Q50 28 64 34" stroke="${P.dred}" stroke-width="2" fill="none"/><rect x="28" y="54" width="44" height="12" rx="4" fill="${P.dred}"/><rect x="30" y="66" width="5" height="12" fill="${P.ink}"/><rect x="65" y="66" width="5" height="12" fill="${P.ink}"/>`,
  sofa: () =>
    `<path d="M20 52 Q20 32 50 32 Q80 32 80 52 V62 H20 Z" fill="${P.red}"/><path d="M29 50 Q50 39 71 50" stroke="${P.dred}" stroke-width="2" fill="none"/><rect x="16" y="58" width="68" height="12" rx="4" fill="${P.dred}"/><rect x="22" y="70" width="5" height="8" fill="${P.ink}"/><rect x="73" y="70" width="5" height="8" fill="${P.ink}"/>`,
  crown: (o: PartOpts) => `<path d="M32 60 L30 38 L40 46 L50 32 L60 46 L70 38 L68 60 Z" fill="${o.c || P.red}"/><rect x="32" y="60" width="36" height="6" rx="1.5" fill="${o.c2 || P.dred}"/>`,
  laurel: (o: PartOpts) =>
    `<g fill="${o.c || "#7d5a0b"}"><path d="M24 66 q-6 -10 -2 -22 q6 10 2 22 z"/><path d="M76 66 q6 -10 2 -22 q-6 10 -2 22 z"/><path d="M28 74 q-9 -3 -12 -12 q9 2 12 12 z"/><path d="M72 74 q9 -3 12 -12 q-9 2 -12 12 z"/></g>`,
  calWed: () =>
    `<rect x="24" y="18" width="52" height="42" rx="3" fill="${P.white}" stroke="${P.navy}" stroke-width="1.6"/><rect x="24" y="18" width="52" height="13" rx="3" fill="${P.red}"/>${T("WED", 50, 28.5, 9.5, P.white)}<path d="M30 52 Q50 32 70 52" stroke="${P.navy}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  filmstrip: () =>
    `<rect x="14" y="66" width="72" height="14" fill="${P.ink}"/><g fill="${P.cream}">${Array.from({ length: 9 }, (_, i) => `<rect x="${17 + i * 8}" y="68" width="4" height="3" rx=".6"/><rect x="${17 + i * 8}" y="75" width="4" height="3" rx=".6"/>`).join("")}</g>`,
  reels: () => ring(5, 22, 50, 50, (a, x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${P.steel}"/>`) + `<circle cx="50" cy="50" r="12" fill="${P.red}"/>`,
  clock12: () =>
    `<circle cx="50" cy="50" r="24" fill="${P.cream}"/>${Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return `<line x1="${(50 + 20 * Math.sin(a)).toFixed(1)}" y1="${(50 - 20 * Math.cos(a)).toFixed(1)}" x2="${(50 + 22.5 * Math.sin(a)).toFixed(1)}" y2="${(50 - 22.5 * Math.cos(a)).toFixed(1)}" stroke="${P.ink}" stroke-width="${i % 3 ? 1.2 : 2.4}"/>`;
    }).join(
      "",
    )}<line x1="50" y1="50" x2="50" y2="32" stroke="${P.ink}" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="50" x2="50" y2="36" stroke="${P.red}" stroke-width="4.5" stroke-linecap="round"/><circle cx="50" cy="50" r="2.6" fill="${P.ink}"/>`,
  yearText: (o: PartOpts) => T("ANNUAL", 50, 40, 7, P.cream, "Space Mono,Courier New,monospace", 'font-weight="700" letter-spacing="1.5"') + T(o.t ?? "", 50, 56, 15, P.lgold),
  vhs: () =>
    `<g transform="rotate(-6 50 50)"><rect x="8" y="24" width="84" height="52" rx="4" fill="${P.ink}"/><rect x="16" y="30" width="68" height="20" rx="2" fill="#e9dcbc"/><path d="M16 30 h20 l-6 6 -8 -2 z M70 46 l14 -4 v8 h-10 z" fill="#c9b78f"/>${T("LONG HAUL · SP", 50, 44, 7, "#6b5a3a", "Space Mono,Courier New,monospace", 'font-weight="700"')}<rect x="26" y="56" width="48" height="14" rx="3" fill="#2b2620"/><circle cx="38" cy="63" r="5" fill="${P.steel}"/><circle cx="62" cy="63" r="5" fill="${P.steel}"/><path d="M12 30 l5 4 M84 70 l4 -3 M88 34 l-3 6" stroke="#5c5650" stroke-width="1.4"/></g>`,
  letterR: (o: PartOpts) => T("R", 50, 62, 30, o.c || P.lgold),
  mic: () =>
    `<rect x="44" y="26" width="12" height="22" rx="6" fill="${P.cream}"/><path d="M39 40 a11 11 0 0 0 22 0 M50 51 v8 M43 60 h14" stroke="${P.cream}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  qbubble: () => `<path d="M38 30 h24 q5 0 5 5 v12 q0 5 -5 5 h-13 l-7 6 v-6 h-4 q-5 0 -5 -5 v-12 q0 -5 5 -5 z" fill="${P.lgold}"/>${T("?", 50, 46, 14, P.ink)}`,
  pumpkin: () =>
    `<path d="M50 32 q2 -8 8 -9" stroke="${P.green}" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="54" rx="24" ry="20" fill="${P.orange}"/><path d="M38 48 l5 -6 5 6 z M52 48 l5 -6 5 6 z" fill="${P.ink}"/><path d="M36 58 q14 12 28 0 l-4 4 -4 -3 -4 4 -4 -4 -4 4 -4 -3 z" fill="${P.ink}"/>`,
  gift: () =>
    `<rect x="28" y="46" width="44" height="30" rx="2" fill="${P.red}"/><rect x="25" y="38" width="50" height="10" rx="2" fill="${P.dred}"/><rect x="46" y="38" width="8" height="38" fill="${P.lgold}"/><path d="M50 38 q-14 -14 -16 -4 q0 6 16 4 z M50 38 q14 -14 16 -4 q0 6 -16 4 z" fill="${P.lgold}"/>`,
  barstool: () =>
    `<ellipse cx="50" cy="34" rx="20" ry="6" fill="${P.red}"/><rect x="30" y="34" width="40" height="5" rx="2" fill="${P.dred}"/><g stroke="${P.brass}" stroke-width="3.2" stroke-linecap="round"><path d="M38 39 L32 80 M62 39 L68 80 M50 39 V80"/><path d="M35 62 H65"/></g>`,
  plate: (o: PartOpts) => {
    const w = o.w ?? 50;
    const y = o.y ?? 50;
    return `<rect x="${50 - w / 2}" y="${y - 7}" width="${w}" height="14" rx="2.5" fill="${P.brass}" stroke="#8a6a1f" stroke-width="1.2"/><circle cx="${50 - w / 2 + 4}" cy="${y}" r="1.2" fill="#8a6a1f"/><circle cx="${50 + w / 2 - 4}" cy="${y}" r="1.2" fill="#8a6a1f"/>${T(o.t ?? "", 50, y + 3.6, 9.5, P.ink)}`;
  },
  speech: () =>
    `<path d="M14 18 h18 q4 0 4 4 v7 q0 4 -4 4 h-8 l-5 4 v-4 h-5 q-4 0 -4 -4 v-7 q0 -4 4 -4 z" fill="${P.cream}"/><g fill="${P.ink}"><circle cx="18" cy="25.5" r="1.4"/><circle cx="23" cy="25.5" r="1.4"/><circle cx="28" cy="25.5" r="1.4"/></g><path d="M68 12 h16 q4 0 4 4 v6 q0 4 -4 4 h-3 v4 l-5 -4 h-8 q-4 0 -4 -4 v-6 q0 -4 4 -4 z" fill="${P.lgold}"/>`,
  shine: () => `<path d="M24 34 Q30 18 50 13 Q34 22 29 38 Z" fill="#fff" opacity=".28"/>`,
};
export type PartId = keyof typeof PARTS;
export const PART_IDS = Object.keys(PARTS) as PartId[];

// Parts that take words, and parts that take a color.
export const PART_TEXT: Partial<Record<PartId, number>> = { num: 4, yearText: 4, plate: 10 };
export const PART_COLOR: PartId[] = ["star", "stars", "moon", "num", "crown", "laurel", "letterR"];

// A recipe's art as SVG markup (the inside of a 100x100 viewBox).
function compose(r: ArtSpec): string {
  const [formId, formOpts] = r.form;
  return (
    FORMS[formId](formOpts || {}) +
    (r.parts || [])
      .map(([id, o = {}]) => `<g transform="translate(${o.x ?? 50} ${o.y ?? 50}) rotate(${o.r || 0}) scale(${o.s ?? 1}) translate(-50 -50)">${PARTS[id](o)}</g>`)
      .join("")
  );
}

// The art as a standalone SVG with no size: what a copy freezes.
export function renderArt(spec: ArtSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${compose(spec)}</svg>`;
}

// ---------- checking a recipe from Back office ----------

const COLOR = /^#[0-9a-f]{6}$/i;
const TEXT = /^[A-Za-z0-9 .'&!?#-]*$/;
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return undefined;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
};

// A recipe made only of known forms, parts, shapes and plain colors and
// numbers, or null. Anything else in it is dropped.
export function cleanSpec(input: unknown): ArtSpec | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { form?: unknown; parts?: unknown };
  if (!Array.isArray(raw.form) || !FORM_IDS.includes(raw.form[0] as FormId)) return null;
  const formId = raw.form[0] as FormId;
  const fo = (raw.form[1] && typeof raw.form[1] === "object" ? raw.form[1] : {}) as Record<string, unknown>;
  const form: FormOpts = {};
  if (SHAPE_IDS.includes(fo.shape as ShapeId)) form.shape = fo.shape as ShapeId;
  for (const k of ["fill", "edge", "stitch", "tail"] as const) if (typeof fo[k] === "string" && COLOR.test(fo[k] as string)) form[k] = (fo[k] as string).toLowerCase();
  // Every color a form draws with has to be there.
  for (const k of FORM_INFO[formId].colors) if (!form[k]) return null;
  const parts: NonNullable<ArtSpec["parts"]> = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts.slice(0, 8) : []) {
    if (!Array.isArray(p) || !PART_IDS.includes(p[0] as PartId)) return null;
    const id = p[0] as PartId;
    const po = (p[1] && typeof p[1] === "object" ? p[1] : {}) as Record<string, unknown>;
    const o: PartOpts = {};
    const x = num(po.x, 0, 100);
    const y = num(po.y, 0, 100);
    const s = num(po.s, 0.2, 2);
    const r = num(po.r, -180, 180);
    const w = num(po.w, 20, 90);
    if (x !== undefined) o.x = x;
    if (y !== undefined) o.y = y;
    if (s !== undefined) o.s = s;
    if (r !== undefined) o.r = r;
    if (w !== undefined && id === "plate") o.w = w;
    for (const k of ["c", "c2"] as const) if (typeof po[k] === "string" && COLOR.test(po[k] as string)) o[k] = (po[k] as string).toLowerCase();
    const maxText = PART_TEXT[id];
    if (maxText) {
      const t = typeof po.t === "string" ? po.t.trim().toUpperCase().slice(0, maxText) : "";
      if (!TEXT.test(t)) return null;
      o.t = t;
    }
    parts.push(Object.keys(o).length ? [id, o] : [id]);
  }
  return { form: Object.keys(form).length ? [formId, form] : [formId], parts };
}

// ---------- Series 1 ----------
// The eleven badges from before the Badge Case, drawn from the approved
// design. Keyed by member_badges.badge.
export const SERIES1_ART: Record<string, { line: string; spec: ArtSpec; form: string }> = {
  welcome: { line: "Your first check-in.", form: "Ticket stub", spec: { form: ["stub", { fill: P.red }], parts: [["admit", { x: 40 }], ["star", { x: 81, y: 50 }]] } },
  early_riser: { line: "Checked in before 8:30 AM.", form: "Enamel pin", spec: { form: ["pin", { fill: "#fde3b0", edge: P.gold }], parts: [["sunrise", { s: 0.86 }], ["shine"]] } },
  night_owl: { line: "Checked in at 11 PM or later.", form: "Stitched patch", spec: { form: ["patch", { fill: P.night, stitch: P.gold }], parts: [["owl", { y: 52 }], ["moon", { x: 70, y: 28, s: 0.85 }], ["stars"]] } },
  birthday: { line: "Came in on your birthday week.", form: "Pinback button", spec: { form: ["button", { fill: P.pink }], parts: [["cake"], ["confetti"], ["shine"]] } },
  weeks_4: { line: "Four weeks in a row.", form: "Bronze coin", spec: { form: ["coin", { fill: P.bronze, edge: P.dbronze }], parts: [["calendar4"]] } },
  weeks_13: { line: "13 weeks in a row. Free popcorn.", form: "Stitched patch", spec: { form: ["patch", { shape: "square", fill: P.cream, stitch: P.red }], parts: [["popcorn", { y: 52 }]] } },
  weeks_26: { line: "26 weeks in a row. Free pizza.", form: "Enamel pin", spec: { form: ["pin", { fill: P.cream, edge: P.gold }], parts: [["pizza", { y: 52 }], ["shine"]] } },
  weeks_52: { line: "Every week for a year.", form: "Ribbon rosette", spec: { form: ["rosette", { fill: P.gold, tail: P.red }], parts: [["num", { t: "52", y: 52 }]] } },
  visits_10: { line: "Your 10th check-in.", form: "Pinback button", spec: { form: ["button", { fill: P.teal }], parts: [["seat"], ["shine"]] } },
  visits_50: { line: "Your 50th check-in.", form: "Enamel pin", spec: { form: ["pin", { shape: "rounded", fill: P.plum, edge: P.gold }], parts: [["sofa", { y: 50 }], ["shine"]] } },
  visits_100: { line: "Your 100th check-in.", form: "Gold coin", spec: { form: ["coin", { fill: P.lgold, edge: "#b8860b" }], parts: [["crown"], ["laurel"]] } },
};

// Starting points for Back office's badge maker: the remixes from the
// design, made only from parts already in the library.
export const STARTERS: { name: string; spec: ArtSpec }[] = [
  { name: "Midnight", spec: { form: ["pin", { fill: P.night, edge: P.silver }], parts: [["clock12", { y: 54 }], ["moon", { x: 66, y: 22, s: 0.9 }], ["stars"]] } },
  { name: "Trivia Night", spec: { form: ["pennant", { fill: P.red }], parts: [["mic", { x: 38, y: 38, s: 0.62 }], ["qbubble", { x: 63, y: 34, s: 0.7 }]] } },
  { name: "Horror Month", spec: { form: ["patch", { shape: "diamond", fill: P.ink, stitch: P.orange }], parts: [["pumpkin", { y: 52 }]] } },
  { name: "Midweek Movies", spec: { form: ["patch", { shape: "card", fill: P.cream, stitch: P.navy }], parts: [["calWed", { y: 44 }], ["filmstrip", { y: 52 }]] } },
  { name: "The Usual Spot", spec: { form: ["pin", { fill: P.walnut, edge: P.brass }], parts: [["barstool", { y: 50, s: 0.92 }], ["speech", { y: 52 }], ["plate", { t: "NAME", w: 44, y: 84 }], ["shine"]] } },
  { name: "Gift Giver", spec: { form: ["button", { fill: P.green }], parts: [["gift"], ["shine"]] } },
  { name: "Pizza & a Movie", spec: { form: ["stub", { fill: P.navy }], parts: [["pizza", { x: 38, y: 52, s: 0.7 }], ["star", { x: 81, y: 50 }]] } },
  { name: "Quiz Champ", spec: { form: ["rosette", { fill: P.navy, tail: P.gold }], parts: [["mic", { y: 42, s: 0.7 }], ["crown", { y: 20, s: 0.45, c: P.lgold, c2: P.lgold }]] } },
  { name: "Long Haul", spec: { form: ["none"], parts: [["vhs"]] } },
  { name: "Midweek Regular", spec: { form: ["filmcan"], parts: [["reels"], ["num", { t: "10", y: 55, s: 12, c: P.white }], ["shine"]] } },
];
