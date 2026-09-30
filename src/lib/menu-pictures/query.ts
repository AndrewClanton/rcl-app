// What to search the free picture libraries for, for a menu item or
// category. Pure (no server or browser code), so the register, the back
// office and the server all agree, and it can be checked on its own.
//
// Item names on the register are written for staff ("Popcorn (large)",
// "Fountain drink (16oz)", "Well shot"), not for a photo search, so this:
//   - drops sizes: "(regular)", "(16oz)", "(large)"...
//   - keeps what the rest of a bracket says: "Pizza (slice)" → "pizza slice"
//   - maps house names to what they look like: "Butter beer" → a butterbeer
//     drink, "Well shot" → a shot glass, "$5 Special" → popcorn and a soda
//   - adds what a bare cocktail name needs to find the drink and not the
//     island ("Margarita" → "margarita cocktail")
//   - keeps brand names whole for candy and cereal, which are then looked up
//     on Open Food Facts first (a photo of the real box).

export const QUERY_MAX = 80;

const SIZE_WORDS = /^(regular|reg|small|sm|medium|med|large|lg|personal|kids?|mini|jumbo|single|double|\d+(\.\d+)?\s*(oz|ounce|ounces|ml|l|liter|litre|in|inch|")?)$/i;

// Whole-name matches first (lowercased, sizes already dropped).
const HOUSE: Record<string, string> = {
  // Names are cleaned before they're looked up here, and that drops the "$".
  "5 special": "popcorn and soda",
  "butter beer": "butterbeer drink",
  butterbeer: "butterbeer drink",
  "well shot": "shot glass",
  "call shot": "whiskey shot glass",
  "premium shot": "tequila shot glass",
  "fountain drink": "fountain soda cup",
  "iced tea": "iced tea glass",
  "bottled water": "bottled water",
  "italian cream soda": "italian cream soda",
  "sparkling lemonade": "sparkling lemonade",
  "drip coffee": "cup of coffee",
  "batch brew": "black coffee mug",
  latte: "latte art",
  espresso: "espresso cup",
  cappuccino: "cappuccino",
  cortado: "cortado coffee",
  americano: "americano coffee",
  // The coffee bar's movie-named drinks: a coffee drink each, different
  // ones so they don't all get the same photo. Easy to swap on the register.
  "city of stars": "latte art heart",
  "five families": "cappuccino cup saucer",
  "jackie brown": "mocha coffee",
  oppenheimer: "black coffee cup",
  terminator: "iced coffee",
  titanic: "iced latte",
  "draft beer": "draft beer glass",
  "canned beer": "beer can",
  "wine glass": "glass of red wine",
  "wine bottle": "wine bottle",
  "rum or whiskey & coke": "rum and coke",
  "ny whiskey sour": "new york sour cocktail",
  "long island iced tea": "long island iced tea cocktail",
  "moscow mule": "moscow mule copper mug",
  "white russian": "white russian cocktail",
  popcorn: "popcorn",
  "popcorn personal": "popcorn bag",
  "popcorn small": "popcorn box",
  "popcorn large": "popcorn bucket",
  "hot dog": "hot dog mustard bun",
  nachos: "nachos cheese",
  "pizza large": "pepperoni pizza",
  "pizza slice": "pizza slice",
  cereal: "bowl of cereal",
  oreos: "oreo cookies",
  "day pass": "cinema seats",
  "standard movie ticket": "movie ticket",
  "classic release": "film reel",
  "make an event": "party celebration",
  "pay for an event": "event tickets",
  // Candy whose name alone finds the wrong thing.
  "hot tamales": "hot tamales candy",
  whoppers: "whoppers malted milk balls",
  "m&m's": "m&m's milk chocolate",
};

// Categories (and subcategories) by label or key.
const CATEGORY: Record<string, string> = {
  food: "movie theater snacks",
  grub: "movie theater snacks",
  candy: "movie theater candy",
  sweet: "movie theater candy",
  drinks: "soft drinks",
  rad: "soft drinks",
  coffee: "coffee cup",
  caffe: "coffee cup",
  alcohol: "cocktail bar",
  spirits: "cocktail bar",
  beer: "beer glass",
  wine: "wine glasses",
  cocktails: "cocktails",
  "liquor shots": "shots liquor",
  shots: "shots liquor",
  "tickets and events": "movie tickets",
  tickets: "movie tickets",
};

// Brands looked up as packaged products (Open Food Facts first).
const BRANDS = [
  "m&m",
  "skittles",
  "reese",
  "oreo",
  "milk duds",
  "whoppers",
  "junior mints",
  "hot tamales",
  "mike and ike",
  "nerds",
  "sour patch",
  "swedish fish",
  "sweetarts",
  "twizzlers",
  "snickers",
  "kit kat",
  "hershey",
  "twix",
  "starburst",
  "airheads",
  "raisinets",
  "goobers",
  "sno-caps",
  "dots",
  "cheerios",
  "froot loops",
  "lucky charms",
  "frosted flakes",
  "cap'n crunch",
  "cinnamon toast crunch",
  "cocoa puffs",
  "fruity pebbles",
  "coca-cola",
  "coke zero",
  "dr pepper",
  "sprite",
  "fanta",
  "pepsi",
  "mountain dew",
];

const CANDY_CATEGORIES = new Set(["candy", "sweet"]);

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// A typed or stored query, made safe to send: letters, numbers and a little
// punctuation, spaces tidied, lowercased, at most QUERY_MAX characters.
export function cleanQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return tidy(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .replace(/[^\p{L}\p{N}&' .-]+/gu, " "),
  ).slice(0, QUERY_MAX).trim();
}

// "Popcorn (large)" → "popcorn large"; "Fountain drink (16oz)" → "fountain drink".
function withoutSizes(name: string): string {
  const inBrackets: string[] = [];
  const outside = name.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    for (const word of inner.split(/[\s,/]+/)) if (word && !SIZE_WORDS.test(word)) inBrackets.push(word);
    return " ";
  });
  const words = outside.split(/\s+/).filter((w) => w && !SIZE_WORDS.test(w));
  return cleanQuery([...words, ...inBrackets].join(" "));
}

export function isPackagedQuery(query: string): boolean {
  const q = query.toLowerCase();
  return BRANDS.some((b) => q.includes(b));
}

export interface PictureSubject {
  name: string;
  // The item's category and, for a subcategory, its parent (label or key).
  category?: string | null;
  parent?: string | null;
}

// What to search for an item.
export function itemQuery({ name, category, parent }: PictureSubject): string {
  const base = withoutSizes(name);
  if (!base) return categoryQuery(category ?? parent ?? "") || "snack";
  const house = HOUSE[base];
  if (house) return house;
  const cats = [category, parent].map((c) => cleanQuery(c ?? ""));
  if (cats.some((c) => c === "cocktails") && !/cocktail|drink|mule|sour/.test(base)) return `${base} cocktail`;
  if (cats.some((c) => CANDY_CATEGORIES.has(c)) && !isPackagedQuery(base)) return `${base} candy`;
  return base;
}

// What to search for a category's round photo.
export function categoryQuery(label: string, key?: string | null): string {
  const l = cleanQuery(label);
  return CATEGORY[l] ?? CATEGORY[cleanQuery(key ?? "")] ?? l;
}
