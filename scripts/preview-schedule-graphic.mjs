// Renders the weekly flyer to PNG from a fixture -- both audiences -- without
// needing a staff login or the dev server, for iterating on the design.
// Transpiles the real render module (which has no Next/Supabase imports)
// with Next's bundled SWC and uses it verbatim. Also reports how much of
// each image is blank, since the brief is 10-20% breathing room, not more.
//
// Usage: node scripts/preview-schedule-graphic.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import QRCode from "qrcode";
import { ImageResponse } from "next/og.js";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const swc = require("next/dist/build/swc");

const outDir = process.argv[2] ?? join(process.cwd(), ".next", "schedule-preview");
mkdirSync(outDir, { recursive: true });

await swc.loadBindings();
const { code } = await swc.transform(readFileSync("src/app/admin/schedule-graphic/image/render.tsx", "utf8"), {
  filename: "render.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2022" },
  module: { type: "es6" },
});
// Inside the project tree so its bare `react/jsx-runtime` import resolves.
const modPath = join(process.cwd(), ".next", "schedule-preview-render.mjs");
writeFileSync(modPath, code);
const render = await import(pathToFileURL(modPath).href);

// ---- Fixture: the week of 2026-09-22, from the real schedule ------------------
const P = "https://bfuwznfwickzeivnfrle.supabase.co/storage/v1/object/public/movie-posters/";
const M = {
  buddy: { title: "Buddy", poster_url: P + "10000000-0000-4000-8000-000000000004.jpg", rating: "R", runtime_minutes: 95, release_year: 2026 },
  hope: { title: "Hope", poster_url: P + "cc787b85-90b0-40e9-b902-6de44425dfb9.jpg", rating: "R", runtime_minutes: 160, release_year: 2026 },
  coyote: { title: "Coyote vs. Acme", poster_url: P + "10000000-0000-4000-8000-000000000003.jpg", rating: "PG", runtime_minutes: 103, release_year: 2026 },
  musical: { title: "The Musical", poster_url: P + "e019f550-f5f0-44f6-95a0-493f2ba8bfeb-1790113286941.jpg", rating: null, runtime_minutes: 87, release_year: 2026 },
  incomer: { title: "The Incomer", poster_url: P + "577e8e5c-78a7-4486-874d-3695313c0f23.jpg", rating: "R", runtime_minutes: 102, release_year: 2026 },
  stunt: { title: "The Stunt Driver", poster_url: P + "145e7324-5f66-443d-9c21-551826f502cd.jpg", rating: "R", runtime_minutes: 99, release_year: 2026 },
  // Older titles -- members' edition only.
  revenant: { title: "The Revenant", poster_url: P + "20f9e08f-dbbb-42cb-a742-062cbd94a57a.jpg", rating: "R", runtime_minutes: 157, release_year: 2015 },
  hairspray: { title: "Hairspray", poster_url: P + "f3522ddb-2f19-4ac7-b18f-19b831522ca9.jpg", rating: "PG", runtime_minutes: 92, release_year: 1988 },
  hotrod: { title: "Hot Rod", poster_url: P + "ea4fb7fb-2007-475c-a163-78b16df23c47.jpg", rating: "PG-13", runtime_minutes: 88, release_year: 2007 },
  indy: { title: "Indiana Jones and the Last Crusade", poster_url: P + "b644db38-7737-4154-a35c-391e46f6679b.jpg", rating: "PG-13", runtime_minutes: 127, release_year: 1989 },
};
const INDOOR = { name: "Indoor Cinema" };
const OUTDOOR = { name: "Outdoor Cinema — patio, weather dependent" };
let n = 0;
const sc = (iso, movie, room = INDOOR) => ({ id: `s${++n}`, starts_at: iso, movie: { ...M[movie], archive: M[movie].release_year !== 2026 }, room });
const all = [
  sc("2026-09-23T02:00:00.000Z", "buddy"),
  sc("2026-09-23T16:00:00.000Z", "hope"),
  sc("2026-09-23T19:00:00.000Z", "coyote"),
  sc("2026-09-23T21:00:00.000Z", "buddy"),
  sc("2026-09-23T23:00:00.000Z", "musical"),
  sc("2026-09-24T00:30:00.000Z", "revenant"),
  sc("2026-09-24T16:00:00.000Z", "hope"),
  sc("2026-09-24T19:00:00.000Z", "musical"),
  sc("2026-09-24T21:00:00.000Z", "hope"),
  sc("2026-09-25T00:00:00.000Z", "coyote"),
  sc("2026-09-25T02:00:00.000Z", "buddy"),
  sc("2026-09-25T16:00:00.000Z", "incomer"),
  sc("2026-09-25T18:00:00.000Z", "hope"),
  sc("2026-09-25T21:00:00.000Z", "stunt"),
  sc("2026-09-25T23:00:00.000Z", "musical"),
  sc("2026-09-26T01:00:00.000Z", "hairspray", OUTDOOR),
  sc("2026-09-26T01:00:00.000Z", "incomer"),
  sc("2026-09-26T03:00:00.000Z", "stunt"),
  sc("2026-09-26T05:00:00.000Z", "hotrod"),
  sc("2026-09-26T16:00:00.000Z", "stunt"),
  sc("2026-09-27T01:00:00.000Z", "indy", OUTDOOR),
  sc("2026-09-27T03:00:00.000Z", "incomer"),
];
const events = [{ id: "e1", event_name: "Smith birthday party", event_date: "2026-09-25", event_time: "18:00:00", hours: 3, room: { name: "West Hall" } }];
const notes = [{ id: "n1", note_date: "2026-09-28", start_time: null, end_time: null, label: "Closed — private event" }];
const rangeStart = "2026-09-22";
const rangeDays = 7;
const rangeLabel = "Tue, Sep 22 – Mon, Sep 28";
const note = process.argv.includes("--no-note") ? "" : "Halloween double feature next Fri";

const qrDataUrl = await QRCode.toDataURL("https://rcl-app.vercel.app/showtimes", { margin: 1, width: 280, color: { dark: render.QR_DARK, light: render.QR_LIGHT } });
const [fonts, logoDataUrl] = await Promise.all([render.loadFonts(), render.loadLogo()]);

// Share of pixels that are just ground (the ink body, cream, or white) --
// a crude dead-space proxy. Type is thin, so even a dense typographic page
// scores 40-50% here; the number is for comparing revisions, not a target.
function blankPercent(buf) {
  const png = PNG.sync.read(buf);
  const near = (r, g, b, R, G, B, t = 10) => Math.abs(r - R) <= t && Math.abs(g - G) <= t && Math.abs(b - B) <= t;
  let empty = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (near(r, g, b, 20, 17, 12) || near(r, g, b, 248, 245, 236) || near(r, g, b, 255, 255, 255)) empty++;
  }
  return (100 * empty) / (png.width * png.height);
}

for (const audience of ["public", "members"]) {
  const screenings = audience === "members" ? all : all.filter((s) => s.movie.release_year === 2026);
  const model = render.buildFlyerModel(screenings, events, notes, rangeStart, rangeDays);
  const opts = { headline: "THIS WEEK", rangeLabel, note, membersEdition: audience === "members", qrDataUrl, logoDataUrl };
  const layout = render.fitFlyer(model, opts);
  const t0 = Date.now();
  const res = new ImageResponse(render.renderFlyer(layout, model, opts), { width: render.FLYER_W, height: layout.height, fonts });
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(outDir, `flyer-${audience}.png`);
  writeFileSync(file, buf);
  console.log(
    `${audience}: ${render.FLYER_W}x${layout.height} (${(layout.height / render.FLYER_W).toFixed(2)}:1), tier poster=${layout.tier.poster}px, ${layout.films.length} films${model.archive.length ? ` + ${model.archive.length} archive` : ""}${layout.hiddenFilms ? ` (+${layout.hiddenFilms} hidden)` : ""}, ${blankPercent(buf).toFixed(1)}% blank, ${Date.now() - t0} ms -> ${file}`
  );
}
