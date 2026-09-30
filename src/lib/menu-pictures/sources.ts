import "server-only";
import { SITE_URL } from "@/lib/site";
import { cleanQuery, isPackagedQuery } from "./query";
import type { CandidateView, FoundSource, PictureCredit } from "./shared";

// Finding free-to-use pictures for the menu. Three services, none of which
// needs an account or a key:
//   - Open Food Facts: packaged food, by product name (candy, cereal, soda).
//     Front-of-package photos, CC BY-SA 3.0.
//   - Openverse: openly licensed photos from Flickr, Wikimedia and others.
//     Only licenses that allow commercial use and changes (we crop): CC0,
//     Public Domain Mark, CC BY and CC BY-SA.
//   - Wikimedia Commons: the same four kinds of license, as a fallback.
//
// Polite by design: each service is asked at most every few seconds from a
// server, each search's results are kept in this server's memory so
// browsing ◀ ▶ and the previews don't ask again, and every request names
// the app.

export const USER_AGENT = `RoyaleCinemaLounge-MenuPictures/1.0 (+${SITE_URL})`;

// One result, as kept on the server: where to download the picture and its
// preview from, plus what the screens see.
export interface Candidate extends CandidateView {
  image: string; // the picture itself, to store (480px square)
  thumb: string; // a smaller copy, for the ◀ ▶ preview
}

export interface Search {
  query: string;
  candidates: Candidate[];
  complete: boolean; // false when a service didn't answer
}

const MAX_CANDIDATES = 30;
const FRESH_MS = 24 * 60 * 60_000; // a finished search is kept a day
const PARTIAL_MS = 30 * 60_000; // one a service missed, half an hour
const KEEP_MAX = 400;

// Time between requests to each service from one server. Openverse allows
// 20 a minute (and 200 a day) without an account, Open Food Facts asks for
// no more than 10 searches a minute.
const GAP_MS: Record<FoundSource, number> = { off: 6500, openverse: 3500, commons: 1000 };

// Hosts pictures may be downloaded from (the stored picture and the
// preview). Anything else a service points at is skipped.
const IMAGE_HOSTS = [
  /^images\.openfoodfacts\.org$/,
  /^static\.openfoodfacts\.org$/,
  /^upload\.wikimedia\.org$/,
  /^thumb\.wikimedia\.org$/,
  /^api\.openverse\.org$/,
  /^live\.staticflickr\.com$/,
  /^farm\d+\.staticflickr\.com$/,
  /^c\d*\.staticflickr\.com$/,
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

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

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

function best<T>(items: T[], score: (t: T) => number): T[] {
  return items
    .map((t, i) => ({ t, i, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

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

// ---------- Open Food Facts ----------

type OffHit = { code?: string; product_name?: string; brands?: string[] | string; image_front_url?: string; countries_tags?: string[] };

async function searchOff(query: string, limit: number): Promise<Candidate[] | null> {
  await politeTurn("off");
  const fields = "code,product_name,brands,image_front_url,countries_tags";
  let hits: OffHit[];
  try {
    const json = (await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=40&fields=${fields}`)) as { hits?: OffHit[] };
    if (!Array.isArray(json?.hits)) return null;
    hits = json.hits;
  } catch (e) {
    console.warn("menu pictures: Open Food Facts search failed", query, e instanceof Error ? e.message : e);
    return null;
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

async function searchOpenverse(query: string, limit: number): Promise<Candidate[] | null> {
  await politeTurn("openverse");
  let results: OvResult[];
  try {
    const json = (await getJson(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=by,by-sa,cc0,pdm&page_size=20&mature=false`,
    )) as { results?: OvResult[] };
    if (!Array.isArray(json?.results)) return null;
    results = json.results;
  } catch (e) {
    console.warn("menu pictures: Openverse search failed", query, e instanceof Error ? e.message : e);
    return null;
  }
  const out: Candidate[] = [];
  const usable = results.filter(
    (r) =>
      r.license &&
      OV_LICENSES[r.license] &&
      typeof r.thumbnail === "string" &&
      isAllowedImageUrl(r.thumbnail) &&
      !(typeof r.width === "number" && typeof r.height === "number" && Math.min(r.width, r.height) < 300),
  );
  for (const r of best(usable, (r) => fit(`${r.title ?? ""} ${(r.tags ?? []).map((t) => t.name ?? "").join(" ")}`, query))) {
    const provider = r.source || r.provider || "";
    out.push({
      source: "openverse",
      // The full picture when it's on a site we download from, else
      // Openverse's own copy.
      image: typeof r.url === "string" && isAllowedImageUrl(r.url) ? r.url : r.thumbnail!,
      thumb: r.thumbnail!,
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

async function searchCommons(query: string, limit: number): Promise<Candidate[] | null> {
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
    iiurlwidth: "960",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|License|ObjectName",
  });
  let pages: CommonsPage[];
  try {
    const json = (await getJson(`https://commons.wikimedia.org/w/api.php?${params}`)) as { query?: { pages?: CommonsPage[] } };
    pages = json?.query?.pages ?? [];
  } catch (e) {
    console.warn("menu pictures: Commons search failed", query, e instanceof Error ? e.message : e);
    return null;
  }
  const out: Candidate[] = [];
  const usable = pages
    .filter((p) => {
      const ii = p.imageinfo?.[0];
      return ii && /^image\/(jpeg|png|webp)$/.test(ii.mime ?? "") && Math.min(ii.width ?? 0, ii.height ?? 0) >= 300 && !!ii.thumburl && isAllowedImageUrl(ii.thumburl);
    })
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of best(usable, (p) => fit(p.title ?? "", query))) {
    const ii = p.imageinfo![0];
    const m = ii.extmetadata ?? {};
    const license = commonsLicense(m.License?.value, m.LicenseShortName?.value);
    if (!license) continue;
    out.push({
      source: "commons",
      image: ii.thumburl!,
      thumb: ii.thumburl!,
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

const kept = new Map<string, { at: number; search: Search }>();

function keptSearch(query: string): Search | null {
  const k = kept.get(query);
  if (!k) return null;
  if (Date.now() - k.at < (k.search.complete ? FRESH_MS : PARTIAL_MS)) return k.search;
  kept.delete(query);
  return null;
}

// Pictures for a search, best first: product photos first for a packaged
// brand, then photos, then Commons. Kept, so asking again is free.
export async function findCandidates(rawQuery: string): Promise<Search> {
  const query = cleanQuery(rawQuery);
  if (!query) return { query, candidates: [], complete: true };
  const already = keptSearch(query);
  if (already) return already;

  const plan: [FoundSource, number][] = isPackagedQuery(query)
    ? [
        ["off", 10],
        ["openverse", 14],
        ["commons", 6],
      ]
    : [
        ["openverse", 20],
        ["commons", 10],
      ];
  const search = { off: searchOff, openverse: searchOpenverse, commons: searchCommons };
  const found: Candidate[] = [];
  let complete = true;
  for (const [source, limit] of plan) {
    const got = await search[source](query, limit);
    if (got === null) complete = false;
    else found.push(...got);
  }
  const seen = new Set<string>();
  const candidates = found.filter((c) => !seen.has(c.image) && !!seen.add(c.image)).slice(0, MAX_CANDIDATES);
  const result = { query, candidates, complete };
  // A search where every service failed isn't kept at all.
  if (complete || candidates.length) {
    kept.set(query, { at: Date.now(), search: result });
    if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
  }
  return result;
}

export function toView(c: Candidate): CandidateView {
  return { source: c.source, credit: c.credit };
}

export type { PictureCredit };
