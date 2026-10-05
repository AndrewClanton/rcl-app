// Checks the Bar Book without a database (nothing is read from or written
// to the live one):
//  1. The client-safe modules (icons, book, menu, pricing, the starter
//     list, the icon component) import nothing server-side, so the
//     register and the bar display can use them.
//  2. The drink icons: one for every starter-list drink at 36, 56 and 96 px
//     with no NaN, undefined or Infinity, self-contained (hex colors and
//     currentColor, no CSS variables or color-mix), and everything escaped.
//  3. The starter list: about 120 drinks, unique names, valid glasses,
//     methods and ice, every ingredient known with a family and kind, sane
//     amounts, no ingredient twice in a drink (the database forbids it).
//  4. Reading recipe text: glassware to a glass, garnish text to garnishes,
//     ingredient names to a color family.
//  5. Can we make it: makeable, "No Cointreau", "Gin ran out", a count of 0,
//     optional lines never blocking, and the "Uses what we have" sort.
//  6. The book: our menu's recipe wins over the starter list, a book drink
//     rings up as the menu item of the same name, off-menu drinks don't.
//  7. The bar display: a ticket with no recipe (coffee, a custom line, an
//     unknown item) gets nothing and never throws; an off-menu book drink
//     gets its recipe's.
//  8. The migrations: in order, columns only, idempotent.
//  9. Prices: cost, suggested price, the cocktail average, rounding,
//     unknown costs, below cost, and the order line a book drink makes
//     (and which recipe ids the server keeps).
// 10. The Bar tab: the cocktail grid fills its box at both iPad sizes and
//     pages when it must; quick pour names.
// 11. "What's in it?": the matcher on the drinks guests describe, never
//     across spirits; a custom drink's cost, name, icon and order line; and
//     which ingredient lists the server keeps.
//
// Usage: node scripts/check-bar-book.mjs   (Node 22.18+ runs the .ts directly)
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const I = await import("../src/lib/bar/icons.ts");
const B = await import("../src/lib/bar/book.ts");
const M = await import("../src/lib/bar/menu.ts");
const P = await import("../src/lib/bar/pricing.ts");
const X = await import("../src/lib/bar/match.ts");
const { SEED_DRINKS, SEED_INGREDIENTS } = await import("../src/lib/bar/seed-drinks.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- 1. client-safe imports ----------
const SERVER = [/["']server-only["']/, /@\/lib\/supabase/, /["']next\/headers["']/, /["']next\/cache["']/, /@\/lib\/data\//, /@\/lib\/auth["']/, /["']pg["']/, /["']node:/, /["']fs["']/];
const CLIENT_SAFE = ["src/lib/bar/icons.ts", "src/lib/bar/book.ts", "src/lib/bar/menu.ts", "src/lib/bar/pricing.ts", "src/lib/bar/match.ts", "src/lib/bar/seed-drinks.ts", "src/components/bar/DrinkIcon.tsx"];
const seen = new Set();
function walk(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const text = read(rel);
  const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const bad = SERVER.filter((re) => re.test(text));
  check(`${rel} imports nothing server-side`, bad.length === 0, bad.map(String).join(", "));
  for (const spec of imports) {
    if (spec === "react") continue;
    const ok = spec.startsWith("@/lib/bar/");
    check(`${rel} imports only the bar's own modules (${spec})`, ok);
    if (ok) walk(`src/${spec.slice(2)}.ts`);
  }
}
for (const f of CLIENT_SAFE) walk(f);
check("the database loader is separate (src/lib/data/barBook.ts uses the admin client)", /@\/lib\/supabase\/admin/.test(read("src/lib/data/barBook.ts")));
check("the bar board imports the pure modules only", !/@\/lib\/data\/barBook/.test(read("src/app/display/PrepTicketBoard.tsx")));

// ---------- 2. icons ----------
const seedSpec = (d) =>
  I.iconSpecFor(
    {
      glassware: d.glass,
      garnishes: d.garnishes,
      ice: d.ice,
      ingredients: d.ingredients.map((l) => ({ name: l.name, quantity: l.amount, unit: SEED_INGREDIENTS[l.name]?.unit, family: SEED_INGREDIENTS[l.name]?.family, kind: SEED_INGREDIENTS[l.name]?.kind })),
    },
    "cocktails",
  );
const BAD_OUTPUT = /NaN|undefined|Infinity|null|var\(|color-mix/;
let iconFails = [];
for (const d of SEED_DRINKS) {
  const spec = seedSpec(d);
  for (const size of [36, 56, 96]) {
    const svg = I.drinkIconSvg(spec, { size, id: `t${size}`, label: d.name });
    if (BAD_OUTPUT.test(svg) || !svg.startsWith("<svg ") || !svg.endsWith("</svg>") || spec.glass !== d.glass || spec.layers.length === 0) iconFails.push(`${d.name}@${size}`);
  }
}
check(`an icon for every starter drink at 36/56/96 px (${SEED_DRINKS.length * 3})`, iconFails.length === 0, iconFails.slice(0, 5).join(", "));
const marg = seedSpec(SEED_DRINKS.find((d) => d.name === "Margarita"));
check("a margarita is a margarita glass, tequila-tinted, salt rim and lime", marg.glass === "margarita" && marg.base === "tequila" && marg.garnishes.join() === "salt,lime", JSON.stringify(marg));
check("the margarita's tequila is the top layer, in proportion", marg.layers.at(-1).family === "tequila" && marg.layers.at(-1).amount === 2);
const svg = I.drinkIconSvg(marg, { size: 56 });
check("the glass outline is currentColor and drink colors are hex", /stroke="currentColor"/.test(svg) && svg.includes(I.FAMILY_COLOR.tequila));
check("a data URI version renders", I.drinkIconDataUri(marg, { size: 48, color: "#14110c" }).startsWith("data:image/svg+xml"));
for (const glass of I.GLASSES) {
  const s = I.drinkIconSvg({ glass, layers: [{ family: "whiskey", amount: 1 }], ice: 2, garnishes: [...I.GARNISHES], base: "whiskey" }, { size: 36 });
  check(`every garnish draws in a ${glass} with no bad numbers`, !BAD_OUTPUT.test(s));
}
const junk = I.drinkIconSvg({ glass: "teacup", layers: [{ family: "nope", amount: NaN }, { family: "gin", amount: -1 }], ice: Infinity, garnishes: ["umbrella"], base: null }, { size: -5 });
check("bad specs still give a clean icon", !BAD_OUTPUT.test(junk) && junk.startsWith("<svg "), junk.slice(0, 80));
check("an empty recipe falls back by section", I.iconSpecFor(null, "beer").glass === "pint" && I.iconSpecFor(null, "wine").glass === "wine" && I.iconSpecFor(null, "shots").glass === "shot" && I.iconSpecFor(null, "cocktails").glass === "rocks");
check("a beer item with no recipe is a pint", M.itemIconSpec(null, "beer").layers[0].family === "beer");

// escaping
const evil = `Tom's "Big" <script>alert(1)</script> & co`;
const esc = I.drinkIconSvg(marg, { label: evil, id: `"><script>x</script>` });
check("labels are escaped", !esc.includes("<script") && esc.includes("&lt;script&gt;") && esc.includes("&quot;Big&quot;") && esc.includes("&#39;") && esc.includes("&amp; co"));
check("ids keep only letters and digits", !/id="[^"]*[<>]/.test(esc) && esc.includes('id="discriptxscript"'));
check("escapeXml escapes all five", I.escapeXml(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;");
check("no label hides the icon from screen readers", /aria-hidden="true"/.test(I.drinkIconSvg(marg)));

// ---------- 3. the starter list ----------
check(`about 120 drinks (${SEED_DRINKS.length})`, SEED_DRINKS.length >= 110 && SEED_DRINKS.length <= 135);
const keys = SEED_DRINKS.map((d) => B.nameKey(d.name));
check("drink names are unique", new Set(keys).size === keys.length, keys.filter((k, i) => keys.indexOf(k) !== i).join(", "));
for (const call of ["vodka soda", "rum and coke", "whiskey shot", "mimosa", "michelada", "margarita", "old fashioned", "manhattan", "martini", "mojito", "negroni", "daiquiri", "moscow mule"]) {
  check(`the list has ${call}`, keys.includes(call));
}
const listProblems = [];
for (const d of SEED_DRINKS) {
  if (!I.isGlass(d.glass)) listProblems.push(`${d.name}: glass ${d.glass}`);
  if (!I.isMethod(d.method)) listProblems.push(`${d.name}: method ${d.method}`);
  if (!I.isIce(d.ice)) listProblems.push(`${d.name}: ice ${d.ice}`);
  if (!d.name || d.name.length > 80) listProblems.push(`${d.name}: name`);
  if (!d.description || d.description.length > 400) listProblems.push(`${d.name}: description`);
  if (!d.instructions || d.instructions.length > 1000) listProblems.push(`${d.name}: instructions`);
  if (!Array.isArray(d.garnishes) || d.garnishes.length > 6 || d.garnishes.some((g) => !g || g.length > 40)) listProblems.push(`${d.name}: garnishes`);
  if (!d.ingredients.length || d.ingredients.every((l) => l.optional)) listProblems.push(`${d.name}: no required ingredients`);
  const names = d.ingredients.map((l) => l.name);
  if (new Set(names).size !== names.length) listProblems.push(`${d.name}: an ingredient twice`);
  for (const l of d.ingredients) {
    const ing = SEED_INGREDIENTS[l.name];
    if (!ing) listProblems.push(`${d.name}: unknown ingredient ${l.name}`);
    if (!(typeof l.amount === "number" && Number.isFinite(l.amount) && l.amount >= 0.001 && l.amount <= 16)) listProblems.push(`${d.name}: amount for ${l.name}`);
    if (ing?.unit === "count" && !Number.isInteger(l.amount)) listProblems.push(`${d.name}: ${l.name} should be a whole count`);
  }
}
check("every drink has a glass, method, ice, garnishes, words and good ingredient lines", listProblems.length === 0, listProblems.slice(0, 6).join("; "));
const ingProblems = Object.entries(SEED_INGREDIENTS).filter(([n, i]) => !I.isFamily(i.family) || !I.isKind(i.kind) || !["oz", "count"].includes(i.unit) || n.length > 80);
check(`every seed ingredient has a family and kind (${Object.keys(SEED_INGREDIENTS).length})`, ingProblems.length === 0, ingProblems.map(([n]) => n).join(", "));
const aliasOwners = new Map();
for (const [n, i] of Object.entries(SEED_INGREDIENTS)) for (const a of [n, ...(i.aliases ?? [])]) {
  const k = a.toLowerCase();
  if (aliasOwners.has(k) && aliasOwners.get(k) !== n) check(`"${a}" names one ingredient`, false, `${aliasOwners.get(k)} and ${n}`);
  aliasOwners.set(k, n);
}

// ---------- 4. reading recipe text ----------
const glassCases = { "Copper mug": "mug", "mule mug": "mug", "rocks glass": "rocks", "Double old fashioned": "rocks", Collins: "highball", "Hurricane glass": "highball", "Champagne flute": "wine", "Wine glass": "wine", "Beer mug": "pint", "Pint glass": "pint", Coupe: "coupe", "Nick & Nora": "coupe", "Martini glass": "martini", "Cocktail glass": "martini", "Margarita glass": "margarita", "Shot glass": "shot", "Irish coffee mug": "mug", "": null, "a jam jar": null };
for (const [text, want] of Object.entries(glassCases)) check(`glass "${text}" → ${want}`, I.normalizeGlass(text) === want, String(I.normalizeGlass(text)));
const garnishCases = { "Salt rim, lime wheel": "salt,lime", "Orange peel and a cherry": "orange,cherry", "Twist": "lemon", "lemon twist": "lemon", "Mint sprig, lime": "mint,lime", "Whipped cream": "whip", "Sugar rim": "salt", "Luxardo cherry": "cherry", "None": "", "Celery stalk": "", "Olive": "" };
for (const [text, want] of Object.entries(garnishCases)) check(`garnish "${text}" → [${want}]`, I.parseGarnishes(text).join() === want, I.parseGarnishes(text).join());
check("garnish lists read too", I.parseGarnishes(["Salt rim", "Lime wedge"]).join() === "salt,lime");
const familyCases = { "Well Vodka": "vodka", "Well Gin": "gin", "Ginger beer": "ginger", "Ginger ale": "ginger", "Sloe gin": "liqueur", "Triple Sec": "liqueur", "Coffee liqueur": "coffee", Kahlua: "coffee", "Irish cream": "cream", "Cream soda": "ginger", Coke: "cola", "Root beer": "cola", "7-Up": "soda", "Lemon-lime soda": "soda", "Lime juice": "citrus", "Sour mix": "citrus", "Grapefruit juice": "grapefruit", "Cranberry juice": "grapefruit", "Simple syrup": "syrup", "Orange juice": "syrup", "Sweet Vermouth": "vermouth", "Angostura bitters": "vermouth", "Seagram's Seven": "whiskey", "Buffalo Trace": "whiskey", "Captain Morgan": "rum", "Jose Cuervo": "tequila", "Tonic water": "soda", "Space Dust": "beer", Prosecco: "ginger", "House red": "wine", "Red Bull": "syrup" };
for (const [name, want] of Object.entries(familyCases)) check(`"${name}" is ${want}`, I.familyFor(name) === want, String(I.familyFor(name)));
check("the database's family wins over the name", I.familyFor("Well Vodka", { family: "gin" }) === "gin");
check("a bad database family is ignored", I.familyFor("Well Vodka", { family: "plaid" }) === "vodka");
check("bar categories", M.isBarCategory({ key: "spirits", label: "Alcohol" }) && !M.isBarCategory({ key: "rad", label: "Drinks" }) && M.barSectionOf({ key: "shots", label: "Liquor shots" }) === "shots" && M.barSectionOf({ key: "beer", label: "Beer" }) === "beer");

// ---------- 5. can we make it ----------
const stock = B.stockMap([
  { id: "teq", name: "Tequila", carried: true, outLabel: null, lastCount: 12 },
  { id: "cointreau", name: "Cointreau", carried: false, outLabel: null, lastCount: null },
  { id: "lime", name: "Lime juice", carried: true, outLabel: null, lastCount: null },
  { id: "gin", name: "Gin", carried: true, outLabel: "Well Gin", lastCount: 10 },
  { id: "tonic", name: "Tonic water", carried: true, outLabel: null, lastCount: 0 },
  { id: "vodka", name: "Vodka", carried: true, outLabel: null, lastCount: null },
  { id: "soda", name: "Soda water", carried: true, outLabel: null, lastCount: null },
  { id: "salt", name: "Salt", carried: false, outLabel: null, lastCount: null },
]);
const line = (ingredientId, name, quantity, optional = false) => ({ ingredientId, name, quantity, unit: "oz", optional, family: null, kind: null });
const margarita = { name: "Margarita", lines: [line("teq", "Tequila", 2), line("cointreau", "Cointreau", 1), line("lime", "Lime juice", 1), line("salt", "Salt", 1, true)] };
const gt = { name: "Gin & Tonic", lines: [line("gin", "Gin", 2), line("tonic", "Tonic water", 4)] };
const vt = { name: "Vodka Tonic", lines: [line("vodka", "Vodka", 2), line("tonic", "Tonic water", 4)] };
const vs = { name: "Vodka Soda", lines: [line("vodka", "Vodka", 2), line("soda", "Soda water", 4), line("salt", "Salt", 1, true)] };
const ghost = { name: "Ghost", lines: [line("nope", "Unicorn tears", 1)] };
const both = { name: "Both", lines: [line("gin", "Gin", 1), line("cointreau", "Cointreau", 1)] };
check("a drink we don't carry something for says which", JSON.stringify(B.drinkStatus(margarita, stock)) === JSON.stringify({ state: "missing", label: "No Cointreau", ingredient: "Cointreau" }));
check("a drink whose par line ran out says which", B.drinkStatus(gt, stock).label === "Gin ran out" && B.drinkStatus(gt, stock).state === "out");
check("a count of 0 stops it", B.drinkStatus(vt, stock).label === "Out of Tonic water" && !B.isMakeable(vt, stock));
check("a missing optional line never blocks", B.drinkStatus(vs, stock).state === "ok" && B.isMakeable(vs, stock));
check("an ingredient we don't know is missing", B.drinkStatus(ghost, stock).label === "No Unicorn tears");
check("missing comes before ran out", B.drinkStatus(both, stock).label === "No Cointreau");
check("no count at all doesn't block", B.lineState({ ingredientId: "lime" }, stock) === "ok");
check("uses what we have: the share of required lines", JSON.stringify(B.usesWhatWeHave(margarita, stock)) === JSON.stringify({ share: 2 / 3, have: 2, need: 3 }));
const sorted = B.sortByWhatWeHave([ghost, margarita, vt, vs, gt], stock).map((d) => d.name);
check("sorted by share, then count, then name", sorted.join("|") === "Vodka Soda|Margarita|Vodka Tonic|Ghost|Gin & Tonic", sorted.join("|"));

// ---------- 6. the book ----------
const rec = (id, name, source, menuItemId, lines) => ({ id, menuItemId, name, source, glassware: null, method: null, ice: null, garnishes: [], description: null, instructions: null, lines });
const book = B.buildBook(
  [
    rec("r1", "Margarita", "seed", null, margarita.lines),
    rec("r2", "Margarita", "menu", "m-marg", [line("teq", "Tequila", 2)]),
    rec("r3", "Mojito", "seed", null, []),
    rec("r4", "Dark 'n' Stormy", "seed", null, []),
    rec("r5", "Old fashioned", "house", null, []),
  ],
  [
    { id: "m-marg", name: "Margarita", price: 9 },
    { id: "m-dark", name: "Dark and Stormy", price: 8 },
  ],
);
check("one drink per name, A–Z", book.map((d) => d.name).join("|") === "Dark 'n' Stormy|Margarita|Mojito|Old fashioned", book.map((d) => d.name).join("|"));
check("our menu's recipe wins over the starter list", book.find((d) => d.key === "margarita").id === "r2");
check("a book drink rings up as the menu item of the same name", book.find((d) => d.key === "dark and stormy").menu?.id === "m-dark");
check("an off-menu drink has nothing to ring up", book.find((d) => d.key === "mojito").menu === null);
check("the makeable count", B.countMakeable([rec("a", "A", "seed", null, vs.lines), rec("b", "B", "seed", null, gt.lines)], [...stock.values()], []) === 1);
check("amounts read like a bar spec", ["2 oz", "¾ oz", "1½ oz", "2 dashes", "8", "0.4 oz", "30 ml"].join() === [B.formatAmount(2, "oz"), B.formatAmount(0.75, "oz"), B.formatAmount(1.5, "oz"), B.formatAmount(0.06, "oz"), B.formatAmount(8, "count"), B.formatAmount(0.4, "oz"), B.formatAmount(30, "ml")].join(), [B.formatAmount(0.06, "oz")].join());

// ---------- 7. the bar display ----------
const entries = { "m-marg": { spec: marg, card: B.recipeCard(rec("r2", "Margarita", "menu", "m-marg", margarita.lines)) }, "m-beer": { spec: M.itemIconSpec(null, "beer"), card: null } };
let threw = null;
try {
  check("a coffee or custom line (no menu item) gets nothing", B.boardEntryFor(entries, null) === null && B.boardEntryFor(entries, undefined) === null && B.boardEntryFor(entries, "") === null);
  check("an item added after the page loaded gets nothing", B.boardEntryFor(entries, "m-new") === null);
  check("odd ids get nothing", B.boardEntryFor(entries, "__proto__") === null && B.boardEntryFor(entries, "constructor") === null && B.boardEntryFor(entries, "toString") === null);
  check("the kitchen board (no map) gets nothing", B.boardEntryFor(undefined, "m-marg") === null && B.boardEntryFor(null, "m-marg") === null);
  check("a cocktail gets its icon and card", B.boardEntryFor(entries, "m-marg")?.card?.lines.length === 4);
  check("a beer gets its icon and no Recipe button", B.boardEntryFor(entries, "m-beer")?.card === null);
} catch (e) {
  threw = e;
}
check("the board helpers never throw", threw === null, threw?.message);
const maps = { items: entries, recipes: { "11111111-2222-4333-8444-555555555555": { spec: marg, card: null } } };
let threw2 = null;
try {
  check("a book drink rung up off the menu gets its recipe's icon", B.boardEntryForTicket(maps, { menu_item_id: null, recipe_id: "11111111-2222-4333-8444-555555555555" })?.spec === marg);
  check("a menu line uses its menu item, not a recipe", B.boardEntryForTicket(maps, { menu_item_id: "m-beer", recipe_id: "11111111-2222-4333-8444-555555555555" })?.card === null && B.boardEntryForTicket(maps, { menu_item_id: "m-beer" })?.spec.glass === "pint");
  check("a ticket with no recipe gets nothing", B.boardEntryForTicket(maps, { menu_item_id: null, recipe_id: null }) === null && B.boardEntryForTicket(maps, { menu_item_id: null }) === null && B.boardEntryForTicket(maps, {}) === null);
  check("an unknown recipe gets nothing", B.boardEntryForTicket(maps, { menu_item_id: null, recipe_id: "99999999-2222-4333-8444-555555555555" }) === null);
  check("no maps (the kitchen board, or before the migration) gets nothing", B.boardEntryForTicket(undefined, { recipe_id: "x" }) === null && B.boardEntryForTicket({ items: {}, recipes: {} }, { menu_item_id: "m-marg" }) === null);
} catch (e) {
  threw2 = e;
}
check("the board's ticket helper never throws", threw2 === null, threw2?.message);
const board = read("src/app/display/PrepTicketBoard.tsx");
check("the realtime insert carries menu_item_id and recipe_id", /menu_item_id: row\.menu_item_id \?\? null/.test(board) && /recipe_id: row\.recipe_id \?\? null/.test(board));
check("the server tickets read recipe_id, and fall back without it", /read\(", recipe_id"\)/.test(read("src/lib/data/prepTickets.ts")) && /schemaMissing\(error\)\) \(\{ data, error \} = await read\(""\)\)/.test(read("src/lib/data/prepTickets.ts")));
check("the server tickets carry menu_item_id", /menu_item_id: row\.menu_item_id \?\? null/.test(read("src/lib/data/prepTickets.ts")) && /menu_item_id\$\{extra\}, menu_item:menu_items/.test(read("src/lib/data/prepTickets.ts")));
check("the kitchen page passes no drinks", !/drinks=/.test(read("src/app/display/kitchen/page.tsx")));

// ---------- 8. the migrations ----------
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
const mine = "20261004010000_bar_book.sql";
const second = "20261004030000_order_item_recipe.sql";
check("both Bar Book migrations are there, the recipe link after the book", migrations.includes(mine) && migrations.includes(second) && migrations.indexOf(second) > migrations.indexOf(mine));
check("the recipe link is later than every migration before it", migrations.filter((f) => f < second).length === migrations.indexOf(second));
const sql2 = read(`supabase/migrations/${second}`).replace(/--.*$/gm, "");
check("order_items.recipe_id: columns only, safe to run twice", /alter table order_items add column if not exists recipe_id uuid references recipes\(id\) on delete set null/.test(sql2) && !/create\s+(table|function|view|sequence)/i.test(sql2) && /create index if not exists/.test(sql2));
const sql = read(`supabase/migrations/${mine}`).replace(/--.*$/gm, "");
check("columns only: no new table or function", !/create\s+(table|function|view|sequence)/i.test(sql));
for (const col of ["ingredients add column if not exists kind", "ingredients add column if not exists family", "ingredients add column if not exists carried", "recipes add column if not exists name", "recipes add column if not exists method", "recipes add column if not exists garnishes", "recipes add column if not exists source", "recipes add column if not exists description", "recipe_ingredients add column if not exists optional", "alter column menu_item_id drop not null"]) {
  check(`migration: ${col}`, sql.includes(col));
}
const adds = [...sql.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
check("every constraint is dropped first (safe to run twice)", adds.every((c) => sql.includes(`drop constraint if exists ${c}`)), adds.join(", "));
check("the backfill only fills empty ones", /where i\.id = g\.id and g\.kind is not null and i\.kind is null/.test(sql) && /i\.family is null/.test(sql));

// ---------- 9. prices ----------
const cl = (name, quantity, unitCost, optional = false) => ({ name, quantity, unitCost, optional });
const margCost = P.drinkCost([cl("Tequila", 2, 0.55), cl("Triple sec", 1, 0.32), cl("Lime juice", 1, 0.2), cl("Salt", 1, null, true)]);
check("cost adds amount × unit cost", margCost.cost === 1.62 && margCost.known === 1.62 && margCost.missing.length === 0, JSON.stringify(margCost));
check("an optional line with no cost doesn't make the cost unknown", margCost.cost !== null);
check("an optional line with a cost counts", P.drinkCost([cl("Rum", 2, 0.5), cl("Mint", 1, 0.25, true)]).cost === 1.25);
const partial = P.drinkCost([cl("Tequila", 2, 0.55), cl("Triple Sec", 1, null), cl("Lime juice", 1, undefined)]);
check("a required line with no cost makes it unknown, and says which", partial.cost === null && partial.missing.join() === "Triple Sec,Lime juice" && partial.known === 1.1 && partial.anyCost);
const none = P.drinkCost([cl("Tequila", 2, null), cl("Lime juice", 1, null)]);
check("nothing costed", none.cost === null && !none.anyCost && none.known === 0);
check("a cost of $0 counts as a cost", P.drinkCost([cl("Water", 4, 0)]).cost === 0);
check("suggested: cost ÷ 20%, up to a whole dollar", P.suggestedPrice(1.62, 0.2) === 9 && P.suggestedPrice(1.6, 0.2) === 8 && P.suggestedPrice(1.61, 0.2) === 9);
check("suggested: float noise doesn't add a dollar", P.suggestedPrice(0.3 + 0.3 + 0.3 + 0.1 + 0.6, 0.2) === 8 && P.suggestedPrice(1.8, 0.18) === 10);
check("suggested: other targets", P.suggestedPrice(2, 0.25) === 8 && P.suggestedPrice(2.01, 0.25) === 9 && P.suggestedPrice(0.05, 0.2) === 1);
check("suggested: nothing without a cost", P.suggestedPrice(null, 0.2) === null && P.suggestedPrice(0, 0.2) === null && P.suggestedPrice(NaN, 0.2) === null);
check("a bad target falls back to 20%", P.suggestedPrice(1.62, 0) === 9 && P.suggestedPrice(1.62, 5) === 9 && P.suggestedPrice(1.62, "x") === 9);
check("target bounds", P.validTarget(0.2) === 0.2 && P.validTarget("0.18") === 0.18 && P.validTarget(0.04) === null && P.validTarget(0.61) === null && P.validTarget(null) === null);
check("pour cost", Math.abs(P.pourCost(1.62, 9) - 0.18) < 1e-12 && P.pourCost(null, 9) === null && P.pourCost(1, 0) === null);
check("the average: menu cocktails fully costed only", Math.abs(P.averagePourCost([{ cost: 1.8, price: 9 }, { cost: 1.8, price: 10 }, { cost: null, price: 9 }, { cost: 2, price: 0 }]) - 0.19) < 1e-9);
check("no costed cocktails, no average", P.averagePourCost([{ cost: null, price: 9 }]) === null && P.averagePourCost([]) === null);
check("below cost, to the cent", P.isBelowCost(1.61, margCost) && !P.isBelowCost(1.62, margCost) && !P.isBelowCost(9, margCost));
check("below what we know it costs even with some costs missing", P.isBelowCost(1.09, partial) && !P.isBelowCost(1.1, partial));
check("never below cost with no costs", !P.isBelowCost(0.01, none));
const sumText = P.priceSummary({ cost: margCost, target: 0.2, average: 0.19 }).text;
check("the card line", sumText === "Cost $1.62 · Suggested $9 · Our cocktails average 19% pour cost; this would be 18%", sumText);
const menuText = P.priceSummary({ cost: margCost, target: 0.2, menuPrice: 8, average: 0.19 }).text;
check("a menu drink shows its price and pour cost too", menuText === "Cost $1.62 · Menu $8.00 (20% pour cost) · Suggested $9 · Our cocktails average 19% pour cost; this would be 18%", menuText);
check("no average yet", P.priceSummary({ cost: margCost, target: 0.2, average: null }).text === "Cost $1.62 · Suggested $9 · This would be 18% pour cost");
check("nothing costed says where to add costs", P.priceSummary({ cost: none, target: 0.2 }).text === "No bottle costs yet: add them in Back office → Bar Book." && P.priceSummary({ cost: none, target: 0.2 }).suggested === null);
check("some costs missing names them", P.priceSummary({ cost: partial, target: 0.2 }).text === "Cost unknown: no price for Triple Sec and Lime juice.", P.priceSummary({ cost: partial, target: 0.2 }).text);
check("many missing are counted", P.priceSummary({ cost: P.drinkCost([cl("A", 1, 0.1), cl("B", 1, null), cl("C", 1, null), cl("D", 1, null), cl("E", 1, null)]), target: 0.2 }).text === "Cost unknown: no price for B, C, D and 1 more.");
check("bottle price ÷ size", P.unitCostFromBottle(22.6, 25.4) === 0.8898 && P.unitCostFromBottle(10, 0) === null && P.unitCostFromBottle(-1, 25.4) === null);
// the price box
check("prices read like money", P.readPrice("9").ok && P.readPrice("$9.50").price === 9.5 && P.readPrice(" 12 ").price === 12);
check("bad prices are refused", ["", "0", "0.00", "abc", "9.999", "1e3", "-5", ".", "10000"].every((t) => !P.readPrice(t).ok));
// the order line
const RID = "11111111-2222-4333-8444-555555555555";
const ln = P.bookOrderLine({ recipeId: RID, name: "  Mojito " }, 9.004);
check("a book drink's line: one-off, named for the drink, alcohol, its recipe", JSON.stringify(ln) === JSON.stringify({ menuItemId: null, name: "Mojito", unit: 9, qty: 1, mods: [], isAlcohol: true, recipeId: RID }), JSON.stringify(ln));
const known = new Set([RID]);
check("the server keeps a known recipe on a one-off line", P.bookRecipeIdOf({ menu_item_id: null, screening_id: null, recipe_id: RID.toUpperCase() }, known) === RID);
check("never on a menu item's line", P.bookRecipeIdOf({ menu_item_id: "m-marg", recipe_id: RID }, known) === null);
check("never on a ticket", P.bookRecipeIdOf({ menu_item_id: null, screening_id: "s1", recipe_id: RID }, known) === null);
check("never an unknown or menu recipe", P.bookRecipeIdOf({ menu_item_id: null, recipe_id: "99999999-2222-4333-8444-555555555555" }, known) === null);
check("never something that isn't an id", [null, undefined, 5, "", "x", `${RID}' or 1=1`, { id: RID }].every((v) => P.bookRecipeIdOf({ menu_item_id: null, recipe_id: v }, { has: () => true }) === null));
const actions = read("src/app/pos/actions.ts");
check("the server looks recipes up before saving and drops what it can't find", /bookRecipesFor\(lines\)/.test(actions) && /bookRecipeIdOf\(l, book\)/.test(actions));
check("before the recipe migration it saves without the link", /schemaMissing\(insertErr\) && withRecipes !== rows/.test(actions));
check("only off-menu recipes count (menu_item_id is null)", /\.in\("id", ids\)\s*\.is\("menu_item_id", null\)/.test(read("src/lib/data/barBook.ts")));
const bb = read("src/app/admin/bar-book/actions.ts");
check("making a menu item and the target are owners and admins, on the server", /export async function makeMenuItemFromRecipe[\s\S]*?await notOwner\(\)/.test(bb) && /export async function setTargetPourCost[\s\S]*?await notOwner\(\)/.test(bb) && /hasAdminAccess\(staff\.role\)/.test(bb));
check("costs are managers and up, on the server", /export async function setIngredientCost[\s\S]*?await denied\(\)/.test(bb));
check("below cost asks the register's manager PIN", /checkManagerPin\(pin, "below-cost-drink"/.test(read("src/app/pos/bar-book-actions.ts")));
check("sale math untouched: register-totals.ts isn't imported by the pricing", !/register-totals/.test(read("src/lib/bar/pricing.ts")));

// ---------- 10. the Bar tab's layout ----------
// The cocktails' column at the register's two iPad sizes (measured in a
// render of the real page): 1180×820 gives 452×608, 1024×768 gives 336×556.
const fills = (p, w, h) => Math.abs(p.cols * p.tileW + (p.cols - 1) * 8 - w) < 0.5 && Math.abs(p.rows * p.tileH + (p.rows - 1) * 8 - h) < 0.5;
for (const [w, h, label] of [
  [452, 608, "1180×820"],
  [336, 556, "1024×768"],
]) {
  for (const n of [1, 3, 8, 11, 12]) {
    const p = M.gridPlan(w, h, n);
    check(`${n} cocktails at ${label}: one page, filling the box edge to edge`, p && p.pages === 1 && p.perPage >= n && fills(p, w, h) && p.tileW >= M.TILE_MIN_W && p.tileH >= M.TILE_MIN_H, JSON.stringify(p));
  }
}
const p11 = M.gridPlan(452, 608, 11);
check("11 cocktails at 1180×820 are 3 × 4", p11.cols === 3 && p11.rows === 4, JSON.stringify(p11));
const p8 = M.gridPlan(452, 608, 8);
check("8 cocktails leave no empty cell", p8.perPage === 8, JSON.stringify(p8));
const p16a = M.gridPlan(452, 608, 16);
check("16 cocktails fit one page at 1180×820 (4 × 4)", p16a.pages === 1 && p16a.cols === 4 && p16a.rows === 4, JSON.stringify(p16a));
const p16b = M.gridPlan(336, 556, 16);
check("16 cocktails page at 1024×768: 12 a page, 2 pages", p16b.pages === 2 && p16b.perPage === 12, JSON.stringify(p16b));
check("a page fills the box above the pager exactly", fills(p16b, 336, 556 - M.PAGER_H - 8), JSON.stringify(p16b));
const p40 = M.gridPlan(336, 556, 40);
check("40 cocktails: same full pages, as many as it takes", p40.perPage === 12 && p40.pages === 4);
check("no box, no plan", M.gridPlan(0, 600, 11) === null && M.gridPlan(400, NaN, 11) === null);
check("a tiny box still pages one at a time", M.gridPlan(120, 150, 5).pages === 5);
check("deterministic", JSON.stringify(M.gridPlan(452, 608, 11)) === JSON.stringify(M.gridPlan(452, 608, 11)));
const qp = [
  ["Draft beer", "beer", "Draft"],
  ["Canned beer", "beer", "Canned"],
  ["Wine glass", "wine", "Glass"],
  ["Wine bottle", "wine", "Bottle"],
  ["Glass of wine", "wine", "Glass"],
  ["Well shot", "shots", "Well"],
  ["Premium shots", "shots", "Premium"],
  ["Space Dust", "beer", "Space Dust"],
  ["Beer", "beer", "Beer"],
  ["Root beer float", "beer", "Root beer float"],
  ["Well shot", "cocktails", "Well shot"],
];
for (const [name, section, want] of qp) check(`quick pour "${name}" under ${section} reads "${want}"`, M.quickPourName(name, section) === want, M.quickPourName(name, section));
const tab = read("src/app/pos/BarTab.tsx");
const pos = read("src/app/pos/PosApp.tsx");
check("the cocktail page lives in the register, reset only by switching tabs", /const \[barPage, setBarPage\] = useState\(0\)/.test(pos) && /setBarPage\(0\)/.test(pos) && (pos.match(/setBarPage\(0\)/g) ?? []).length === 1 && /page=\{barPage\}/.test(pos));
check("the pager's buttons are 44 px or more", (tab.match(/min-h-11 min-w-14/g) ?? []).length === 2 && /h-11 w-6/.test(tab));
check("the Bar tab never scrolls: no overflow-y-auto in it", !/overflow-y-auto/.test(tab));

// ---------- 11. "What's in it?" ----------
const asDrink = (d) => ({ name: d.name, lines: d.ingredients.map((l) => ({ name: l.name, kind: SEED_INGREDIENTS[l.name].kind, family: SEED_INGREDIENTS[l.name].family, optional: !!l.optional })) });
const seedBook = SEED_DRINKS.map(asDrink);
const g = (name, kind, family) => ({ name, kind, family });
const VODKA = g("Well Vodka", "spirit", "vodka");
const CRAN = g("Cranberry juice", "juice", "grapefruit");
const LIME = g("Lime juice", "juice", "citrus");
const cases = [
  ["vodka, cranberry and a splash of lime", [VODKA, CRAN, LIME], "Cape Codder"],
  ["Tito's, cranberry, grapefruit", [g("Tito's", "spirit", "vodka"), g("Cranberry", "juice", "grapefruit"), g("Grapefruit juice", "juice", "grapefruit")], "Sea Breeze"],
  ["vodka, cranberry, pineapple", [VODKA, CRAN, g("Pineapple juice", "juice", "ginger")], "Bay Breeze"],
  ["tequila with grapefruit soda", [g("Well Tequila", "spirit", "tequila"), g("Grapefruit soda", "mixer", "grapefruit")], "Paloma"],
  ["vodka and orange juice", [VODKA, g("Orange juice", "juice", "syrup")], "Screwdriver"],
  ["vodka, OJ and Galliano", [VODKA, g("OJ", "juice", "syrup"), g("Galliano", "liqueur", "liqueur")], "Harvey Wallbanger"],
  ["rum and Coke with lime", [g("Bacardi", "spirit", "rum"), g("Coke", "mixer", "cola"), LIME], "Cuba Libre"],
  ["rum and Coke", [g("Captain Morgan", "spirit", "rum"), g("Fountain Coke", "mixer", "cola")], "Rum & Coke"],
  ["gin and tonic", [g("Well Gin", "spirit", "gin"), g("Tonic", "mixer", "soda")], "Gin & Tonic"],
];
for (const [said, picked, want] of cases) {
  const r = X.matchDrinks(picked, seedBook);
  check(`"${said}" is ${want}`, r.best?.drink.name === want, r.best ? `${r.best.drink.name} ${r.best.score}` : "no match");
}
const sea = X.matchDrinks(cases[1][1], seedBook);
check("a Sea Breeze offers the Bay Breeze as a near miss", sea.alternatives.some((a) => a.drink.name === "Bay Breeze" && a.text === "Swap grapefruit for pineapple and it's a Bay Breeze."), sea.alternatives.map((a) => a.text).join(" | "));
const screw = X.matchDrinks(cases[4][1], seedBook);
check("a Screwdriver offers a Harvey Wallbanger: add Galliano", screw.alternatives.some((a) => a.drink.name === "Harvey Wallbanger" && a.text === "A Harvey Wallbanger adds Galliano."), screw.alternatives.map((a) => a.text).join(" | "));
const cranOnly = X.matchDrinks([VODKA, CRAN], seedBook);
check("vodka and cranberry: a Vodka Cranberry, and a Cape Codder adds lime", cranOnly.best?.drink.name === "Vodka Cranberry" && cranOnly.alternatives.some((a) => a.text === "A Cape Codder adds lime."));
const cosmo = X.matchDrinks([VODKA, CRAN, LIME], seedBook);
check("add triple sec and it's close to a Cosmopolitan", cosmo.alternatives.some((a) => a.drink.name === "Cosmopolitan" && /triple sec/.test(a.text)), cosmo.alternatives.map((a) => a.text).join(" | "));
// never across spirits
const spiritOf = (d) => [...new Set(d.lines.filter((l) => !l.optional).flatMap(X.tokensOf).filter((t) => t.key.startsWith("spirit:")).map((t) => t.key))].sort().join();
for (const [said, picked] of [
  ["vodka and Coke", [VODKA, g("Coke", "mixer", "cola")]],
  ["gin and cranberry", [g("Well Gin", "spirit", "gin"), CRAN]],
  ["whiskey and grapefruit soda", [g("Well Whiskey", "spirit", "whiskey"), g("Grapefruit soda", "mixer", "grapefruit")]],
  ["vodka, cranberry and lime", [VODKA, CRAN, LIME]],
  ["tequila with grapefruit soda", cases[3][1]],
]) {
  const r = X.matchDrinks(picked, seedBook);
  const want = [...new Set(picked.flatMap(X.tokensOf).filter((t) => t.key.startsWith("spirit:")).map((t) => t.key))].sort().join();
  const all = [r.best, ...r.alternatives].filter(Boolean);
  check(`"${said}": nothing offered with another spirit`, all.every((c) => spiritOf(c.drink) === want), all.map((c) => c.drink.name).join(", "));
}
check("vodka and Coke is no drink in the book (no Rum & Coke)", X.matchDrinks([VODKA, g("Coke", "mixer", "cola")], seedBook).best === null);
check("gin and cranberry is no drink in the book", X.matchDrinks([g("Well Gin", "spirit", "gin"), CRAN], seedBook).best === null);
check("nothing picked, nothing matched", X.matchDrinks([], seedBook).best === null && X.matchDrinks([], seedBook).alternatives.length === 0);
check("deterministic", JSON.stringify(X.matchDrinks(cases[1][1], seedBook)) === JSON.stringify(X.matchDrinks(cases[1][1], seedBook)));
check("an optional line never counts against a match", X.compare([g("Well Tequila", "spirit", "tequila")], asDrink(SEED_DRINKS.find((d) => d.name === "Tequila Shot"))).exact);
check("any vodka is vodka", X.tokensOf(g("Grey Goose", "spirit", "vodka"))[0].key === "spirit:vodka" && X.tokensOf(g("Tito's", null, null))[0].key === "spirit:vodka");
check("cranberry is cranberry juice, Coke is cola, Cointreau is triple sec", X.tokensOf(g("Cranberry", "juice"))[0].key === X.tokensOf(g("Cranberry juice", "juice"))[0].key && X.tokensOf(g("Coke"))[0].key === "cola" && X.tokensOf(g("Cointreau", "liqueur"))[0].key === X.tokensOf(g("Triple sec", "liqueur"))[0].key);
check("a grapefruit soda is grapefruit and soda water", X.tokensOf(g("Grapefruit soda", "mixer")).map((t) => t.key).join() === "grapefruit,soda water");
check("a/an", X.withArticle("Old Fashioned") === "an Old Fashioned" && X.withArticle("Cape Codder") === "a Cape Codder");
// default amounts and steps
check("default amounts by kind", [["spirit", 1.5], ["liqueur", 0.75], ["mixer", 4], ["juice", 0.5], ["syrup", 0.5], ["bitters", 0.05]].every(([k, v]) => X.defaultAmount(k) === v));
check("− / + steps and limits", X.nudge(1.5, 0.25, 1) === 1.75 && X.nudge(0.25, 0.25, -1) === 0.25 && X.nudge(9.9, 0.5, 1) === 10 && X.nudge(0.05, 0.025, -1) === 0.025);
// a custom drink
const pk = (id, name, unit, kind, family, amount) => ({ id, name, unit, kind, family, amount });
const I1 = "11111111-1111-4111-8111-111111111111", I2 = "22222222-2222-4222-8222-222222222222", I3 = "33333333-3333-4333-8333-333333333333";
const vcl = [pk(I1, "Well Vodka", "oz", "spirit", "vodka", 1.5), pk(I2, "Cranberry juice", "oz", "juice", "grapefruit", 4), pk(I3, "Lime juice", "oz", "juice", "citrus", 0.5)];
check("a custom drink is named for what's in it", X.customName(vcl) === "Vodka, cranberry juice, lime juice", X.customName(vcl));
const cspec = X.customSpec(vcl);
check("a custom drink's icon: a tall glass, vodka on top", cspec.glass === "highball" && cspec.base === "vodka" && !/NaN|undefined/.test(I.drinkIconSvg(cspec)));
check("a shot of spirit alone is a shot glass", X.customSpec([pk(I1, "Well Vodka", "oz", "spirit", "vodka", 1.5)]).glass === "shot");
const ccost = P.drinkCost(vcl.map((p, i) => ({ name: p.name, quantity: p.amount, unitCost: [0.5, 0.1, null][i] })));
check("a custom drink's cost names what's missing", ccost.cost === null && ccost.missing.join() === "Lime juice" && P.priceSummary({ cost: ccost, target: 0.2 }).text === "Cost unknown: no price for Lime juice.");
const ccost2 = P.drinkCost(vcl.map((p, i) => ({ name: p.name, quantity: p.amount, unitCost: [0.5, 0.1, 0.2][i] })));
check("a custom drink's cost and suggested price", ccost2.cost === 1.25 && P.suggestedPrice(ccost2.cost, 0.2) === 7);
check("alcohol when anything in it is", X.customIsAlcohol(vcl) && !X.customIsAlcohol([pk(I2, "Cranberry juice", "oz", "juice", "grapefruit", 4)]) && X.customIsAlcohol([g("Prosecco", "wine")]) && X.customIsAlcohol([g("Peach schnapps", "liqueur")]));
const col = X.customOrderLine("  Vodka,  cranberry, lime ", 7.004, [...vcl, pk(I1, "Well Vodka", "oz", "spirit", "vodka", 0.5)]);
check(
  "a custom drink's order line: one-off, alcohol, its list merged",
  JSON.stringify(col) ===
    JSON.stringify({ menuItemId: null, name: "Vodka, cranberry, lime", unit: 7, qty: 1, mods: [], isAlcohol: true, customRecipe: [{ ingredient_id: I1, quantity: 2 }, { ingredient_id: I2, quantity: 4 }, { ingredient_id: I3, quantity: 0.5 }] }),
  JSON.stringify(col),
);
// what the server keeps
const knownIngs = new Map([
  [I1, { name: "Well Vodka", unit: "oz", family: "vodka", kind: "spirit" }],
  [I2, { name: "Cranberry juice", unit: "oz", family: "grapefruit", kind: "juice" }],
]);
const good = { menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: 1.5 }, { ingredient_id: I2.toUpperCase(), quantity: 4 }] };
const kept = X.cleanCustomRecipe(good, knownIngs);
check("the server keeps a good list and writes the names itself", kept?.length === 2 && kept[0].name === "Well Vodka" && kept[1].ingredient_id === I2 && kept[1].unit === "oz", JSON.stringify(kept));
check("…merging the same ingredient twice", X.cleanCustomRecipe({ menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: 1 }, { ingredient_id: I1, quantity: 0.5 }] }, knownIngs)?.[0].quantity === 1.5);
const bad = [
  ["on a menu item's line", { ...good, menu_item_id: "m1" }],
  ["on a Bar Book drink's line", { ...good, recipe_id: I3 }],
  ["on a ticket", { ...good, screening_id: "s1" }],
  ["an ingredient we don't have", { menu_item_id: null, custom_recipe: [{ ingredient_id: I3, quantity: 1 }] }],
  ["not an id", { menu_item_id: null, custom_recipe: [{ ingredient_id: "x' or 1=1", quantity: 1 }] }],
  ["an amount of 0", { menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: 0 }] }],
  ["an amount over 10", { menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: 10.5 }] }],
  ["two that add up over 10", { menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: 6 }, { ingredient_id: I1, quantity: 6 }] }],
  ["an amount that isn't a number", { menu_item_id: null, custom_recipe: [{ ingredient_id: I1, quantity: "2" }] }],
  ["13 lines", { menu_item_id: null, custom_recipe: Array.from({ length: 13 }, () => ({ ingredient_id: I1, quantity: 0.1 })) }],
  ["an empty list", { menu_item_id: null, custom_recipe: [] }],
  ["not a list", { menu_item_id: null, custom_recipe: { ingredient_id: I1, quantity: 1 } }],
  ["nothing", { menu_item_id: null }],
];
for (const [what, line] of bad) check(`the server drops a list ${what}`, X.cleanCustomRecipe(line, knownIngs) === null);
check("a list in a line of text", X.customRecipeText(kept) === "well vodka 1.5 oz, cranberry juice 4 oz");
// the bar tablet
const ticketMaps = { items: {}, recipes: {} };
const ce = B.boardEntryForTicket(ticketMaps, { menu_item_id: null, recipe_id: null, custom_recipe: kept, name: "Vodka cran" });
check("the bar tablet builds a custom drink's Recipe card from its list", ce?.card?.lines.length === 2 && ce.card.lines[0].amount === "1½ oz" && ce.card.name === "Vodka cran" && ce.spec.base === "vodka");
let threw3 = null;
try {
  check("a custom list that's junk gets nothing", [null, 5, "x", [], [{}], [{ name: 5 }], { a: 1 }].every((v) => B.boardEntryForTicket(ticketMaps, { menu_item_id: null, custom_recipe: v, name: "x" }) === null));
  check("the kitchen board (no maps) shows no custom drink", B.boardEntryForTicket(undefined, { menu_item_id: null, custom_recipe: kept, name: "x" }) === null);
} catch (e) {
  threw3 = e;
}
check("…and never throws", threw3 === null, threw3?.message);
check("the tablet reads custom_recipe, and falls back without it", /read\(", recipe_id, custom_recipe"\)/.test(read("src/lib/data/prepTickets.ts")) && /custom_recipe: row\.custom_recipe \?\? null/.test(read("src/app/display/PrepTicketBoard.tsx")));
// the server and the migration
const act = read("src/app/pos/actions.ts");
check("the server checks lists before saving and saves without them before the migration", /customRecipeOf\(l, extras\)/.test(act) && /schemaMissing\(insertErr\) && withCustoms !== withRecipes/.test(act) && /schemaMissing\(insertErr\) && withRecipes !== rows/.test(act));
check("tabs keep the list through save and reload", /items:order_items\(\$\{ITEM_COLUMNS\}, recipe_id, custom_recipe\)/.test(act) && /custom_recipe: l\.customRecipe/.test(read("src/app/pos/PosApp.tsx")) && /customRecipe: l\.custom_recipe/.test(read("src/app/pos/PosApp.tsx")));
const third = "20261005010000_order_item_custom_recipe.sql";
const sql3 = read(`supabase/migrations/${third}`).replace(/--.*$/gm, "");
check("order_items.custom_recipe: after the recipe link, columns only, safe to run twice", migrations.includes(third) && third > second && /add column if not exists custom_recipe jsonb/.test(sql3) && !/create\s+(table|function|view|sequence)/i.test(sql3) && /drop constraint if exists order_items_custom_recipe_check/.test(sql3));
check("sale math untouched by the matcher", !/register-totals|register-sale-checks/.test(read("src/lib/bar/match.ts")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll Bar Book checks passed.");
process.exit(failures ? 1 : 0);
