import "server-only";
import { SITE_URL } from "@/lib/site";
import { cleanQuery, isPackagedQuery } from "./query";
import { SOURCE_NAMES, type CandidateView, type FoundSource, type PictureCredit } from "./shared";

// Finding free-to-use pictures for the menu:
//   - Pixabay and Pexels: big, well-lit stock photos, free for a business to
//     use under their own licenses. Asked first, but only when their key is
//     set (PIXABAY_API_KEY, PEXELS_API_KEY: server only, never sent to a
//     screen); without one that library is skipped and nothing else changes.
//     Both allow downloading a picture to keep; we credit the photographer
//     the way each asks.
//   - Open Food Facts: packaged food, by product name (candy, cereal, soda).
//     Front-of-package photos, CC BY-SA 3.0.
//   - Openverse: openly licensed pictures (medium and large only) from
//     Flickr, Wikimedia and others. Only licenses that allow commercial use
//     and changes (we crop): CC0, Public Domain Mark, CC BY and CC BY-SA.
//   - Wikimedia Commons: the same four kinds of license, as a fallback.
// Not Unsplash: its API only allows showing its pictures from its own
// servers, and every picture on the register is a copy in our own bucket.
//
// Only pictures big enough to look sharp on a 640px register button (at
// least MIN_SIDE on the short side) are offered; the rest are dropped here,
// or when they're downloaded (images.ts) if a library didn't say its size.
//
// Polite by design: each service is asked at most every so often from a
// server (and Pexels at most PEXELS_PER_HOUR times an hour), a service that
// says "too many" is left alone for a while, each search's results are kept
// in this server's memory so browsing ◀ ▶ and the previews don't ask again,
// and every request names the app.

export const USER_AGENT = `RoyaleCinemaLounge-MenuPictures/1.0 (+${SITE_URL})`;

// One result, as kept on the server: where to download the picture and its
// preview from, plus what the screens see.
export interface Candidate extends CandidateView {
  image: string; // the picture itself, to store (a 640px square is made from it)
  thumb: string; // a smaller copy, for the ◀ ▶ preview
  width?: number; // the size of `image`, when the library said
  height?: number;
}

export interface Search {
  query: string;
  candidates: Candidate[];
  complete: boolean; // false when a service didn't answer
  sources: FoundSource[]; // the libraries asked, for their credit on screen
}

export const MIN_SIDE = 600;
const MAX_CANDIDATES = 40;
const FRESH_MS = 24 * 60 * 60_000; // a finished search is kept a day
// Pixabay's links to its pictures stop working after a day, so a search
// with Pixabay pictures in it is asked again a little before that.
const PIXABAY_FRESH_MS = 20 * 60 * 60_000;
const PARTIAL_MS = 30 * 60_000; // one a service missed, half an hour
const KEEP_MAX = 400;

// Time between requests to each service from one server. Pixabay allows 100
// a minute per key, Pexels 200 an hour per key (see PEXELS_PER_HOUR),
// Openverse 20 a minute (and 200 a day) without an account, and Open Food
// Facts asks for no more than 10 searches a minute.
const GAP_MS: Record<FoundSource, number> = { pixabay: 1000, pexels: 1000, off: 6500, openverse: 3500, commons: 1000 };

// Hosts pictures may be downloaded from (the stored picture and the
// preview). Anything else a service points at is skipped.
const IMAGE_HOSTS = [
  /^pixabay\.com$/, // Pixabay's /get/ links
  /^cdn\.pixabay\.com$/,
  /^images\.pexels\.com$/,
  /^images\.openfoodfacts\.org$/,
  /^static\.openfoodfacts\.org$/,
  /^upload\.wikimedia\.org$/,
  /^thumb\.wikimedia\.org$/,
  /^api\.openverse\.org$/,
  /^live\.staticflickr\.com$/,
  /^farm\d+\.staticflickr\.com$/,
  /^c\d*\.staticflickr\.com$/,
  /^cdn\.stocksnap\.io$/, // StockSnap's CC0 photos, through Openverse
];

export function isAllowedImageUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && IMAGE_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextTurn = new Map<FoundSource, number>();

// Waits for this server's turn with a service.
async function politeTurn(source: FoundSource) {
  const now = Date.now();
  const at = Math.max(now, nextTurn.get(source) ?? 0);
  nextTurn.set(source, at + GAP_MS[source]);
  if (at > now) await sleep(at - now);
}

// A service that said "too many" (or is nearly out of its allowance) rests
// until then.
const restUntil = new Map<FoundSource, number>();

function resting(source: FoundSource): boolean {
  return (restUntil.get(source) ?? 0) > Date.now();
}

function rest(source: FoundSource, ms: number, reason: string) {
  restUntil.set(source, Date.now() + ms);
  console.warn(`menu pictures: not asking ${SOURCE_NAMES[source]} for ${Math.max(1, Math.round(ms / 60_000))} min (${reason})`);
}

// Pexels allows 200 requests an hour per key, across every server; this
// server keeps to fewer on its own, and a "too many" rests it anyway.
const PEXELS_PER_HOUR = 180;
const pexelsAsked: number[] = [];

function pexelsTurnThisHour(): boolean {
  const hourAgo = Date.now() - 60 * 60_000;
  while (pexelsAsked.length && pexelsAsked[0] <= hourAgo) pexelsAsked.shift();
  if (pexelsAsked.length >= PEXELS_PER_HOUR) return false;
  pexelsAsked.push(Date.now());
  return true;
}

// A key from the server's settings, or null when it isn't set. Read when
// asked, so setting one needs no code change.
function apiKey(name: "PIXABAY_API_KEY" | "PEXELS_API_KEY"): string | null {
  const key = process.env[name]?.trim();
  return key && /^[\x21-\x7e]{8,200}$/.test(key) ? key : null;
}

class ServiceError extends Error {
  status: number;
  constructor(host: string, status: number) {
    super(`${host} answered ${status}`);
    this.status = status;
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ json: unknown; headers: Headers }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  // Only the host and the status: Pixabay's key is in its address.
  if (!res.ok) throw new ServiceError(new URL(url).hostname, res.status);
  return { json: await res.json(), headers: res.headers };
}

// Why a search failed, for the server's log. Never the request itself.
function why(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "no answer in time";
  if (e instanceof SyntaxError) return "not a proper answer";
  return "no answer";
}

function headerNumber(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// What one library's search came to: its results, or that it failed, is
// resting after a "too many", or has no key (skipped, as if it weren't there).
type Outcome = Candidate[] | "failed" | "resting" | "no key";

// ---------- scoring ----------

const STOP = new Set(["a", "an", "and", "the", "of", "or", "with", "in", "on", "cup", "glass", "bottle", "bag", "box"]);
const FOODISH =
  /\b(food|drink|drinks|beverage|snack|snacks|meal|cocktail|coffee|espresso|cafe|candy|sweets|dessert|restaurant|bar|breakfast|lunch|dinner|beer|wine|soda|juice|tea|chocolate|pizza|popcorn|cinema|movie|theater|theatre|ticket|film|party)\b/;

function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}&']+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// How well a result's text fits the search: one point per search word it
// has (the first word, the subject, counts double), and one for looking
// like food or drink at all. Zero means it has none of the words.
export function fit(text: string, query: string): number {
  const t = ` ${text.toLowerCase().replace(/[_\-.]+/g, " ")} `;
  const ws = words(query);
  let score = 0;
  ws.forEach((w, i) => {
    const plain = w.replace(/'/g, "");
    if (t.includes(w) || t.includes(plain) || (w.endsWith("s") && t.includes(w.slice(0, -1)))) score += i === 0 ? 2 : 1;
  });
  if (score === 0) return 0;
  return score + (FOODISH.test(t) ? 1 : 0);
}

// Best first, ties in the service's own order. Results with none of the
// words are dropped, unless `keepMisses`: Pixabay's and Pexels's own
// ranking is good and their descriptions are short, so theirs come after
// the ones that fit, still in their order.
export function best<T>(items: T[], score: (t: T) => number, keepMisses = false): T[] {
  return items
    .map((t, i) => ({ t, i, s: score(t) }))
    .filter((x) => keepMisses || x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

// A point for a photo big enough to stay sharp however it's cropped.
const BIG_SIDE = 1000;
const sharpness = (short: number) => (short >= BIG_SIDE ? 1 : 0);

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, max) : null;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.startsWith("//") ? `https:${value}` : value;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// A link on a library's own site (its photo pages, its photographers).
function siteUrl(value: unknown, host: RegExp): string | null {
  const url = webUrl(value);
  return url && new URL(url).protocol === "https:" && host.test(new URL(url).hostname) ? url : null;
}

const numberOr0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// ---------- Pixabay ----------

type PixabayHit = {
  pageURL?: string;
  tags?: string;
  webformatURL?: string;
  webformatWidth?: number;
  webformatHeight?: number;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  user?: string;
  user_id?: number;
};

const PIXABAY_SITE = /^(www\.)?pixabay\.com$/;
const PIXABAY_LARGE = 1280; // largeImageURL fits in 1280×1280

// The size of a hit's largeImageURL, from its original size.
function pixabayLarge(h: PixabayHit): { width: number; height: number } {
  const w = numberOr0(h.imageWidth);
  const ht = numberOr0(h.imageHeight);
  if (!w || !ht) return { width: 0, height: 0 };
  const scale = Math.min(1, PIXABAY_LARGE / Math.max(w, ht));
  return { width: Math.round(w * scale), height: Math.round(ht * scale) };
}

async function searchPixabay(query: string, limit: number): Promise<Outcome> {
  const key = apiKey("PIXABAY_API_KEY");
  if (!key) return "no key";
  if (resting("pixabay")) return "resting";
  await politeTurn("pixabay");
  let hits: PixabayHit[];
  try {
    const params = new URLSearchParams({ key, q: query, image_type: "photo", safesearch: "true", per_page: "20", lang: "en", order: "popular" });
    const { json, headers } = await getJson(`https://pixabay.com/api/?${params}`);
    // Nearly out of this minute's requests: wait out the rest of it.
    const left = headerNumber(headers, "x-ratelimit-remaining");
    const reset = headerNumber(headers, "x-ratelimit-reset");
    if (left !== null && left <= 2) rest("pixabay", (Math.min(Math.max(reset ?? 60, 1), 120) + 1) * 1000, "its limit for the minute");
    const hitList = (json as { hits?: PixabayHit[] })?.hits;
    if (!Array.isArray(hitList)) return "failed";
    hits = hitList;
  } catch (e) {
    if (e instanceof ServiceError && e.status === 429) rest("pixabay", 61_000, "too many requests");
    else console.warn("menu pictures: Pixabay search failed", query, why(e), e instanceof ServiceError && e.status < 500 ? "(check PIXABAY_API_KEY)" : "");
    return "failed";
  }
  const out: Candidate[] = [];
  const usable = hits.filter((h) => typeof h.largeImageURL === "string" && isAllowedImageUrl(h.largeImageURL) && Math.min(pixabayLarge(h).width, pixabayLarge(h).height) >= MIN_SIDE);
  for (const h of best(usable, (h) => fit(h.tags ?? "", query), true)) {
    const large = pixabayLarge(h);
    // The 640px copy is enough for the preview when it's at least 400px
    // on its short side.
    const web =
      typeof h.webformatURL === "string" && isAllowedImageUrl(h.webformatURL) && Math.min(numberOr0(h.webformatWidth), numberOr0(h.webformatHeight)) >= 400 ? h.webformatURL : null;
    const user = text(h.user, 80);
    const userId = typeof h.user_id === "number" && Number.isInteger(h.user_id) && h.user_id > 0 ? h.user_id : null;
    out.push({
      source: "pixabay",
      image: h.largeImageURL!,
      thumb: web ?? h.largeImageURL!,
      width: large.width,
      height: large.height,
      credit: {
        title: text(
          (h.tags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join(", "),
          120,
        ),
        creator: user,
        creatorUrl: user && userId ? `https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/` : null,
        license: "Pixabay Content License",
        licenseUrl: "https://pixabay.com/service/license-summary/",
        page: siteUrl(h.pageURL, PIXABAY_SITE),
        provider: null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Pexels ----------

type PexelsPhoto = {
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  photographer_url?: string;
  alt?: string;
  src?: { large2x?: string; large?: string };
};

const PEXELS_SITE = /^(www\.)?pexels\.com$/;

// The size of a photo's large2x copy: fitted in 940×650 at twice the
// pixels, so at most 1880×1300.
function pexelsLarge2x(p: PexelsPhoto): { width: number; height: number } {
  const w = numberOr0(p.width);
  const h = numberOr0(p.height);
  if (!w || !h) return { width: 0, height: 0 };
  const scale = Math.min(1, 1880 / w, 1300 / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function searchPexels(query: string, limit: number): Promise<Outcome> {
  const key = apiKey("PEXELS_API_KEY");
  if (!key) return "no key";
  if (resting("pexels") || !pexelsTurnThisHour()) return "resting";
  await politeTurn("pexels");
  let photos: PexelsPhoto[];
  try {
    const { json, headers } = await getJson(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: "20" })}`, { Authorization: key });
    // The month's allowance nearly used: leave some for next month's start
    // (Pexels says when the month rolls over).
    const left = headerNumber(headers, "x-ratelimit-remaining");
    if (left !== null && left < 200) {
      const reset = headerNumber(headers, "x-ratelimit-reset");
      const ms = reset ? reset * 1000 - Date.now() : 0;
      rest("pexels", Math.min(Math.max(ms, 60 * 60_000), 32 * 24 * 60 * 60_000), "this month's allowance is nearly used");
    }
    const list = (json as { photos?: PexelsPhoto[] })?.photos;
    if (!Array.isArray(list)) return "failed";
    photos = list;
  } catch (e) {
    // "Too many" comes without saying for how long: an hour, quietly.
    if (e instanceof ServiceError && e.status === 429) rest("pexels", 60 * 60_000, "too many requests");
    else console.warn("menu pictures: Pexels search failed", query, why(e), e instanceof ServiceError && e.status < 500 ? "(check PEXELS_API_KEY)" : "");
    return "failed";
  }
  const out: Candidate[] = [];
  const usable = photos.filter(
    (p) =>
      typeof p.src?.large2x === "string" &&
      isAllowedImageUrl(p.src.large2x) &&
      typeof p.src.large === "string" &&
      isAllowedImageUrl(p.src.large) &&
      Math.min(pexelsLarge2x(p).width, pexelsLarge2x(p).height) >= MIN_SIDE,
  );
  for (const p of best(usable, (p) => fit(p.alt ?? "", query), true)) {
    const large = pexelsLarge2x(p);
    out.push({
      source: "pexels",
      image: p.src!.large2x!,
      thumb: p.src!.large!,
      width: large.width,
      height: large.height,
      credit: {
        title: text(p.alt, 160),
        creator: text(p.photographer, 120),
        creatorUrl: siteUrl(p.photographer_url, PEXELS_SITE),
        license: "Pexels License",
        licenseUrl: "https://www.pexels.com/license/",
        page: siteUrl(p.url, PEXELS_SITE),
        provider: null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Open Food Facts ----------

type OffHit = { code?: string; product_name?: string; brands?: string[] | string; image_front_url?: string; countries_tags?: string[] };

async function searchOff(query: string, limit: number): Promise<Outcome> {
  await politeTurn("off");
  const fields = "code,product_name,brands,image_front_url,countries_tags";
  let hits: OffHit[];
  try {
    const { json } = await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=40&fields=${fields}`);
    const list = (json as { hits?: OffHit[] })?.hits;
    if (!Array.isArray(list)) return "failed";
    hits = list;
  } catch (e) {
    console.warn("menu pictures: Open Food Facts search failed", query, why(e));
    return "failed";
  }
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const ranked = best(
    hits.filter((h) => typeof h.image_front_url === "string" && isAllowedImageUrl(h.image_front_url)),
    (h) => {
      const f = fit(`${h.product_name ?? ""} ${Array.isArray(h.brands) ? h.brands.join(" ") : (h.brands ?? "")}`, query);
      // The candy sold here first, not the UK or Canadian box.
      return f && f + (h.countries_tags?.includes("en:united-states") ? 2 : 0);
    },
  );
  for (const h of ranked) {
    const front = h.image_front_url!;
    if (seen.has(front)) continue;
    seen.add(front);
    out.push({
      source: "off",
      // Its size isn't known until it's downloaded (a small one is turned
      // down then, images.ts).
      image: front.replace(/\.\d+\.jpg$/, ".full.jpg"),
      thumb: front,
      credit: {
        title: text(h.product_name, 120),
        creator: "Open Food Facts contributors",
        creatorUrl: null,
        license: "CC BY-SA 3.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
        page: h.code && /^\d{4,20}$/.test(h.code) ? `https://world.openfoodfacts.org/product/${h.code}` : null,
        provider: null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Openverse ----------

type OvResult = {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  source?: string;
  provider?: string;
  width?: number;
  height?: number;
  category?: string | null; // "photograph", "illustration", "digitized_artwork", or often none
  tags?: { name?: string }[];
};

const OV_LICENSES: Record<string, string> = { by: "CC BY", "by-sa": "CC BY-SA", cc0: "CC0", pdm: "Public Domain Mark" };
const PROVIDERS: Record<string, string> = {
  flickr: "Flickr",
  wikimedia: "Wikimedia Commons",
  stocksnap: "StockSnap",
  rawpixel: "rawpixel",
  nappy: "nappy",
  wordpress: "WordPress Photo Directory",
  geographorguk: "Geograph",
};

// Openverse's thumbnails are 600px wide.
const OV_THUMB = 600;

// The file to store for a result, and its size: the picture itself when
// it's on a site we download from, else Openverse's own copy, which is
// sharp enough only for a tall or square photo (a wide one's copy is under
// 600px tall). Null when it's too small, or its size isn't known.
export function openverseImage(r: OvResult): { url: string; width: number; height: number } | null {
  const w = numberOr0(r.width);
  const h = numberOr0(r.height);
  if (!w || !h || Math.min(w, h) < MIN_SIDE) return null;
  if (typeof r.url === "string" && isAllowedImageUrl(r.url)) return { url: r.url, width: w, height: h };
  if (h >= w && typeof r.thumbnail === "string" && isAllowedImageUrl(r.thumbnail)) return { url: r.thumbnail, width: OV_THUMB, height: Math.round((OV_THUMB * h) / w) };
  return null;
}

async function searchOpenverse(query: string, limit: number): Promise<Outcome> {
  await politeTurn("openverse");
  let results: OvResult[];
  try {
    // Medium and large only (Openverse's "medium" starts around 640×480,
    // and most Flickr pictures are 1024px "medium" ones). Not
    // category=photograph: most Flickr photos have no category, so it
    // leaves only a handful ("draft beer glass": 3 results, not 240), so
    // the ones marked as drawings are dropped below instead.
    const { json } = await getJson(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=by,by-sa,cc0,pdm&size=medium,large&page_size=20&mature=false`,
    );
    const list = (json as { results?: OvResult[] })?.results;
    if (!Array.isArray(list)) return "failed";
    results = list;
  } catch (e) {
    console.warn("menu pictures: Openverse search failed", query, why(e));
    return "failed";
  }
  const out: Candidate[] = [];
  const usable = results.filter(
    (r) =>
      r.license &&
      OV_LICENSES[r.license] &&
      r.category !== "illustration" &&
      r.category !== "digitized_artwork" &&
      typeof r.thumbnail === "string" &&
      isAllowedImageUrl(r.thumbnail) &&
      openverseImage(r),
  );
  const ranked = best(usable, (r) => {
    const f = fit(`${r.title ?? ""} ${(r.tags ?? []).map((t) => t.name ?? "").join(" ")}`, query);
    const img = openverseImage(r)!;
    return f && f + sharpness(Math.min(img.width, img.height));
  });
  for (const r of ranked) {
    const img = openverseImage(r)!;
    const provider = r.source || r.provider || "";
    out.push({
      source: "openverse",
      image: img.url,
      thumb: r.thumbnail!,
      width: img.width,
      height: img.height,
      credit: {
        title: text(r.title, 160),
        creator: text(r.creator, 120),
        creatorUrl: webUrl(r.creator_url),
        license: `${OV_LICENSES[r.license!]}${r.license_version && r.license !== "pdm" ? ` ${r.license_version}` : ""}`,
        licenseUrl: webUrl(r.license_url),
        page: webUrl(r.foreign_landing_url),
        provider: PROVIDERS[provider] ?? (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : null),
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Wikimedia Commons ----------

type CommonsPage = {
  index?: number;
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    descriptionurl?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
};

// Commons license codes that allow commercial use and changes.
function commonsLicense(code: string | undefined, short: string | undefined): string | null {
  const c = (code ?? "").toLowerCase();
  if (c === "cc0") return "CC0";
  if (c === "pd" || c.startsWith("pd-") || c === "public domain") return "Public domain";
  const m = /^cc-(by|by-sa)-(\d(\.\d)?)/.exec(c);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  const s = (short ?? "").trim();
  if (/^(CC0|Public domain)$/i.test(s)) return s;
  if (/^CC BY(-SA)? \d(\.\d)?$/i.test(s)) return s.toUpperCase();
  return null;
}

// The size of the copy we'd download: the 1280px-wide one asked for below
// (or the original, when that's smaller).
function commonsSize(ii: NonNullable<CommonsPage["imageinfo"]>[number]): { width: number; height: number } {
  return { width: numberOr0(ii.thumbwidth) || numberOr0(ii.width), height: numberOr0(ii.thumbheight) || numberOr0(ii.height) };
}

async function searchCommons(query: string, limit: number): Promise<Outcome> {
  await politeTurn("commons");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: "15",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1280",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|License|ObjectName",
  });
  let pages: CommonsPage[];
  try {
    const { json } = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    pages = (json as { query?: { pages?: CommonsPage[] } })?.query?.pages ?? [];
  } catch (e) {
    console.warn("menu pictures: Commons search failed", query, why(e));
    return "failed";
  }
  const out: Candidate[] = [];
  const usable = pages
    .filter((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime ?? "") || !ii.thumburl || !isAllowedImageUrl(ii.thumburl)) return false;
      const size = commonsSize(ii);
      return Math.min(size.width, size.height) >= MIN_SIDE;
    })
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of best(usable, (p) => {
    const f = fit(p.title ?? "", query);
    const size = commonsSize(p.imageinfo![0]);
    return f && f + sharpness(Math.min(size.width, size.height));
  })) {
    const ii = p.imageinfo![0];
    const m = ii.extmetadata ?? {};
    const license = commonsLicense(m.License?.value, m.LicenseShortName?.value);
    if (!license) continue;
    const size = commonsSize(ii);
    out.push({
      source: "commons",
      image: ii.thumburl!,
      thumb: ii.thumburl!,
      width: size.width,
      height: size.height,
      credit: {
        title: text(m.ObjectName?.value, 160) ?? text((p.title ?? "").replace(/^File:/, "").replace(/\.[a-z]+$/i, ""), 160),
        creator: text(m.Artist?.value, 120),
        creatorUrl: null,
        license,
        licenseUrl: webUrl(m.LicenseUrl?.value),
        page: webUrl(ii.descriptionurl),
        provider: null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- the search, kept ----------

const SEARCHES: Record<FoundSource, (query: string, limit: number) => Promise<Outcome>> = {
  pixabay: searchPixabay,
  pexels: searchPexels,
  off: searchOff,
  openverse: searchOpenverse,
  commons: searchCommons,
};

// Which libraries to ask, and for how many each, best first: product
// photos first for a packaged brand; Pixabay and Pexels (when their keys
// are set) before the openly licensed ones, which vary more.
export function searchPlan(query: string, keys: { pixabay: boolean; pexels: boolean }): [FoundSource, number][] {
  const packaged = isPackagedQuery(query);
  if (!keys.pixabay && !keys.pexels) {
    return packaged
      ? [
          ["off", 10],
          ["openverse", 14],
          ["commons", 6],
        ]
      : [
          ["openverse", 20],
          ["commons", 10],
        ];
  }
  const plan: [FoundSource, number][] = packaged
    ? [
        ["off", 8],
        ["pixabay", 8],
        ["pexels", 8],
        ["openverse", 8],
        ["commons", 4],
      ]
    : [
        ["pixabay", 12],
        ["pexels", 12],
        ["openverse", 10],
        ["commons", 6],
      ];
  return plan.filter(([s]) => (s !== "pixabay" && s !== "pexels") || keys[s]);
}

const kept = new Map<string, { until: number; search: Search }>();

function keptSearch(query: string): Search | null {
  const k = kept.get(query);
  if (!k) return null;
  if (Date.now() < k.until) return k.search;
  kept.delete(query);
  return null;
}

// Pictures for a search, best first. Every library in the plan is asked at
// once (each waits its own turn), and the results keep the plan's order.
// Kept, so asking again is free.
export async function findCandidates(rawQuery: string): Promise<Search> {
  const query = cleanQuery(rawQuery);
  if (!query) return { query, candidates: [], complete: true, sources: [] };
  const already = keptSearch(query);
  if (already) return already;

  const plan = searchPlan(query, { pixabay: !!apiKey("PIXABAY_API_KEY"), pexels: !!apiKey("PEXELS_API_KEY") });
  const outcomes = await Promise.all(plan.map(([source, limit]) => SEARCHES[source](query, limit).catch((): Outcome => "failed")));
  const found: Candidate[] = [];
  const sources: FoundSource[] = [];
  let complete = true;
  outcomes.forEach((got, i) => {
    if (got === "no key") return;
    if (got !== "resting") sources.push(plan[i][0]);
    if (Array.isArray(got)) found.push(...got);
    else complete = false;
  });
  const seen = new Set<string>();
  const candidates = found.filter((c) => !seen.has(c.image) && !!seen.add(c.image)).slice(0, MAX_CANDIDATES);
  const result: Search = { query, candidates, complete, sources };
  // A search where every service failed isn't kept at all.
  if (complete || candidates.length) {
    const keep = !complete ? PARTIAL_MS : candidates.some((c) => c.source === "pixabay") ? PIXABAY_FRESH_MS : FRESH_MS;
    kept.set(query, { until: Date.now() + keep, search: result });
    if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
  }
  return result;
}

export function toView(c: Candidate): CandidateView {
  return { source: c.source, credit: c.credit };
}

export type { PictureCredit };
