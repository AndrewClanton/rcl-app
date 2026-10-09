// Renders badge cards (front and back) to PNG, to look at them outside the
// app. Real minted copies when there are some (the newest of each badge
// named), otherwise previews drawn from the Series 1 art.
//
// Usage: node scripts/render-badge-samples.mjs <out-dir> [badge keys...]
//        (default keys: welcome night_owl visits_100)
import { register } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import sharp from "sharp";

config({ path: ".env.local", quiet: true });

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        if (s.startsWith("@/")) return next(${JSON.stringify(srcRoot)} + s.slice(2) + ".ts", c);
        if (s.startsWith(".") && c.parentURL?.endsWith(".ts") && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c);
        return next(s, c);
      }`,
    ),
);

const [outDir = "badge-samples", ...keysArg] = process.argv.slice(2);
const keys = keysArg.length ? keysArg : ["welcome", "night_owl", "visits_100"];
mkdirSync(outDir, { recursive: true });

const { SERIES1_ART, renderArt } = await import("../src/lib/badges/art.ts");
const { cardFrontSvg, cardBackSvg } = await import("../src/lib/badges/card.ts");
const { BADGES } = await import("../src/lib/visits.ts");
const server = await import("../src/lib/badges/server.ts");
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");

const db = createAdminClient();
let cat = null;
let counts = null;
try {
  cat = await server.loadCatalog(db);
  counts = await server.liveCounts(db);
} catch {
  // no database: previews only
}

const png = (svg, file) => sharp(Buffer.from(svg), { density: 288 }).png().toFile(file);

for (const key of keys) {
  let front;
  let back;
  const def = cat?.defs.find((d) => d.key === key);
  if (def) {
    const { data } = await db
      .from("badge_copies")
      .select("id, def_id, issuer_id, series, serial, holder_id, code, minted_at, name, flavor, generator, stats, event_kind, event_ref, event_label, art_svg, art_hash, signature, revoked_at")
      .eq("def_id", def.id)
      .not("signature", "is", null)
      .order("serial", { ascending: false })
      .limit(1);
    const card = data?.[0] ? server.toCard(data[0], cat, counts) : null;
    if (card) ({ front, back } = card);
  }
  if (!front) {
    const i = BADGES.findIndex((b) => b.key === key);
    const art = SERIES1_ART[key];
    if (!art) {
      console.error(`unknown badge ${key}`);
      continue;
    }
    const data = {
      name: BADGES[i].label,
      flavor: art.line,
      art: renderArt(art.spec),
      series: 1,
      setNumber: i + 1,
      setSize: BADGES.length,
      rarity: null,
      serial: null,
      of: 0,
      minted: "",
      issuer: "Royale Cinema Lounge",
      event: null,
      stats: [],
      code: null,
      verifyUrl: null,
      qr: null,
      revoked: false,
    };
    front = cardFrontSvg(data);
    back = cardBackSvg(data);
  }
  await png(front, join(outDir, `${key}-front.png`));
  await png(back, join(outDir, `${key}-back.png`));
  console.log(`${key}: ${join(outDir, `${key}-front.png`)}, ${join(outDir, `${key}-back.png`)}`);
}
process.exit(0);
