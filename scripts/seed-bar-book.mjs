// Puts the Bar Book's starter list (src/lib/bar/seed-drinks.ts, about 120
// well-known drinks) into the database: one recipe per drink with no menu
// item (source 'seed'), with its ingredient lines. Needs migration
// 20261004010000_bar_book.sql applied first.
//
// - Safe to run again: a drink already in the book (same name, ignoring
//   case) is left alone, so a manager's edits stay.
// - Each ingredient is matched to what we already have by name, ignoring
//   case and a leading "Well", "House" or "Fresh" ("Well Vodka" is Vodka),
//   then by a few other names it goes by (Coke for Cola, Kahlua for coffee
//   liqueur). Anything still missing is added as NOT carried, in the
//   "Bar Book" category, so the book says "No …" until a manager ticks it
//   (Back office → Bar Book).
// - Fills in kind and color on matched ingredients only where they're empty.
// - All in one transaction: it adds everything or nothing.
//
// Usage (from the main checkout, which has .env.local):
//   node scripts/seed-bar-book.mjs --dry   what it would add; writes nothing
//                                          (works without a database too)
//   node scripts/seed-bar-book.mjs         add them
import { register } from "node:module";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { SEED_DRINKS, SEED_INGREDIENTS } = await import("../src/lib/bar/seed-drinks.ts");
const { GLASS_LABEL } = await import("../src/lib/bar/icons.ts");

const DRY = process.argv.includes("--dry");
const hasDb = !!(process.env.SUPABASE_DB_HOST && process.env.SUPABASE_DB_PASSWORD);
if (!hasDb && !DRY) {
  console.error("No database settings (.env.local: SUPABASE_DB_HOST, SUPABASE_DB_PASSWORD). Run it from the main checkout, or add --dry to see what it would add.");
  process.exit(1);
}

// "Well Vodka" -> "vodka", "Seagram's 7" -> "seagrams 7", "Crème de cacao" -> "creme de cacao".
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(well|house|fresh) /, "");
const ML_PER_OZ = 29.5735;

let client = null;
if (hasDb) {
  client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER || "postgres",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
} else {
  console.log("No database settings: showing what it would add to an empty book.\n");
}

try {
  const existing = client ? (await client.query("select id, name, unit, kind, family from ingredients")).rows : [];
  const bookNames = new Set(
    client ? (await client.query("select lower(btrim(name)) as k from recipes where menu_item_id is null and name is not null")).rows.map((r) => r.k) : [],
  );
  const byLower = new Map(existing.map((i) => [i.name.trim().toLowerCase(), i]));
  const byNorm = new Map();
  for (const i of existing) if (!byNorm.has(norm(i.name))) byNorm.set(norm(i.name), i);

  // Which existing ingredient each seed ingredient is, or null to add it.
  const plan = new Map(); // seed name -> { row | null, via }
  const warnings = [];
  const unitFits = (seed, row) => seed.unit === row.unit || (seed.unit === "oz" && row.unit === "ml");
  for (const [name, seed] of Object.entries(SEED_INGREDIENTS)) {
    const exact = byLower.get(name.toLowerCase());
    let found = exact ? { row: exact, via: "same name" } : null;
    if (!found) {
      for (const n of [name, ...(seed.aliases ?? [])]) {
        const row = byNorm.get(norm(n));
        if (row && unitFits(seed, row)) {
          found = { row, via: n === name ? "name" : `also called ${n}` };
          break;
        }
      }
    }
    if (found && !unitFits(seed, found.row)) warnings.push(`${name}: we have "${found.row.name}" measured in ${found.row.unit}, the starter list uses ${seed.unit}. Its amounts are used as they are.`);
    plan.set(name, found);
  }

  const used = new Set(SEED_DRINKS.flatMap((d) => d.ingredients.map((l) => l.name)));
  const toAdd = [...used].filter((n) => !plan.get(n));
  const matched = [...used].filter((n) => plan.get(n));
  const drinksToAdd = SEED_DRINKS.filter((d) => !bookNames.has(d.name.trim().toLowerCase()));

  console.log(`Ingredients the starter list uses: ${used.size}`);
  console.log(`  matched to ours: ${matched.length}`);
  for (const n of matched) {
    const f = plan.get(n);
    if (f.row.name !== n) console.log(`    ${n} = ${f.row.name} (${f.via})`);
  }
  console.log(`  to add as not carried: ${toAdd.length}${toAdd.length ? `: ${toAdd.join(", ")}` : ""}`);
  for (const w of warnings) console.log(`  note: ${w}`);
  console.log(`Drinks: ${SEED_DRINKS.length} on the list, ${SEED_DRINKS.length - drinksToAdd.length} already in the book, ${drinksToAdd.length} to add.`);

  if (DRY || !client) {
    console.log("\nDry run: nothing written.");
  } else {
    await client.query("begin");
    const idOf = new Map(); // seed name -> ingredient row
    for (const n of matched) {
      const row = plan.get(n).row;
      idOf.set(n, row);
      const seed = SEED_INGREDIENTS[n];
      if (!row.kind || !row.family) {
        await client.query("update ingredients set kind = coalesce(kind, $2), family = coalesce(family, $3) where id = $1", [row.id, seed.kind, seed.family]);
      }
    }
    for (const n of toAdd) {
      const seed = SEED_INGREDIENTS[n];
      const { rows } = await client.query(
        "insert into ingredients (name, unit, kind, family, carried, category) values ($1, $2, $3, $4, false, 'Bar Book') returning id, name, unit",
        [n, seed.unit, seed.kind, seed.family],
      );
      idOf.set(n, rows[0]);
    }
    for (const d of drinksToAdd) {
      const { rows } = await client.query(
        `insert into recipes (name, menu_item_id, source, glassware, method, ice, garnishes, garnish, description, instructions)
         values ($1, null, 'seed', $2, $3, $4, $5, $6, $7, $8) returning id`,
        [d.name, GLASS_LABEL[d.glass], d.method, d.ice, d.garnishes, d.garnishes.join(", ") || null, d.description, d.instructions],
      );
      const recipeId = rows[0].id;
      let order = 0;
      for (const l of d.ingredients) {
        const ing = idOf.get(l.name);
        const qty = ing.unit === "ml" && SEED_INGREDIENTS[l.name].unit === "oz" ? l.amount * ML_PER_OZ : l.amount;
        await client.query("insert into recipe_ingredients (recipe_id, ingredient_id, quantity, optional, sort_order) values ($1, $2, $3, $4, $5)", [
          recipeId,
          ing.id,
          Math.round(qty * 1000) / 1000,
          l.optional === true,
          order++,
        ]);
      }
    }
    await client.query("commit");
    console.log(`\nAdded ${toAdd.length} ingredients (not carried) and ${drinksToAdd.length} drinks.`);
    if (toAdd.length) console.log("Tick the ones the bar does carry in Back office → Bar Book.");
  }
} catch (e) {
  if (client) await client.query("rollback").catch(() => {});
  console.error(`\nNothing was written: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
