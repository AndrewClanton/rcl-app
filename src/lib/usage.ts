// Website usage: which pages get looked at, and for how long. The pieces
// the browser (src/lib/usage-client.ts) and the server (src/app/api/usage,
// src/lib/data/usage.ts) both need. No browser or server APIs here.

export const USAGE_ENDPOINT = "/api/usage";

// Where a page is. Customers: site + account. Staff: admin + pos +
// training. Screens: display (the TVs and boards, kept apart so a screen
// left on all night doesn't swamp the rest).
export const AREAS = ["site", "account", "admin", "pos", "display", "training"] as const;
export type Area = (typeof AREAS)[number];

export const STAFF_AREAS: readonly Area[] = ["admin", "pos", "display", "training"];

export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export const MAX_PATH = 200;
// Time on one page view is counted up to 4 hours.
export const MAX_SECONDS = 4 * 3600;

export function isArea(s: unknown): s is Area {
  return typeof s === "string" && (AREAS as readonly string[]).includes(s);
}

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function areaOf(path: string): Area {
  if (under(path, "/admin") || under(path, "/login")) return "admin";
  if (under(path, "/pos")) return "pos";
  if (under(path, "/display")) return "display";
  if (under(path, "/training")) return "training";
  if (under(path, "/account")) return "account";
  return "site";
}

// Pages that are only ever drawn for someone signed in to the back office,
// the register or a screen (the staff sign-in page isn't one of them).
export function isStaffOnlyPath(path: string) {
  return ["/admin", "/pos", "/display", "/training"].some((p) => under(path, p));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,18}$/;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID.test(s);
}

// "/showtimes/2f0c…" -> { pattern: "/showtimes/[id]", entityId: "2f0c…" }.
// Ids (UUIDs, plain numbers) are what change from one address to the next;
// everything else (a training's name, "old-site") stays as it is. With more
// than one id, the last one is kept.
export function normalizePath(path: string): { path: string; pattern: string; entityId: string | null } {
  // A member's shared profile (/m/<their link name>): counted as one page,
  // never by whose it is.
  if (/^\/m\/[^/]+\/?$/i.test(path)) return { path: "/m/[handle]", pattern: "/m/[handle]", entityId: null };
  const clean = path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
  let entityId: string | null = null;
  const pattern = clean
    .split("/")
    .map((seg) => {
      if (UUID.test(seg) || NUMBER.test(seg)) {
        entityId = seg.toLowerCase();
        return "[id]";
      }
      return seg;
    })
    .join("/");
  return { path: clean, pattern: pattern || "/", entityId };
}

// A pathname as the browser gives it: percent-encoded, printable ASCII,
// no spaces, no query or fragment.
export function isValidPath(s: unknown): s is string {
  return typeof s === "string" && s.length >= 1 && s.length <= MAX_PATH && /^\/[\x21-\x7e]*$/.test(s) && !/[?#]/.test(s);
}

// Checks a beacon field by field; null for anything off. The area has to
// be the one its path is in, and times are held to 0-4 hours.
export function parseBeacon(raw: unknown): UsageBeacon | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.id) || !isUuid(b.sid) || !isUuid(b.vid)) return null;
  if (!isValidPath(b.path) || !isArea(b.area) || areaOf(b.path) !== b.area) return null;
  if (typeof b.s !== "number" || !Number.isFinite(b.s) || typeof b.w !== "number" || !Number.isFinite(b.w)) return null;
  const d = b.d === null || b.d === undefined ? null : (DEVICES as readonly unknown[]).includes(b.d) ? (b.d as Device) : undefined;
  if (d === undefined) return null;
  let ref: string | null = null;
  if (b.ref !== null && b.ref !== undefined) {
    if (typeof b.ref !== "string" || !/^[a-z0-9.-]{1,100}$/i.test(b.ref)) return null;
    ref = b.ref.toLowerCase();
  }
  const flag = (x: unknown) => x === true;
  const clamp = (n: number) => Math.min(MAX_SECONDS, Math.max(0, Math.round(n)));
  const entry = flag(b.entry);
  return {
    id: b.id.toLowerCase(),
    sid: b.sid.toLowerCase(),
    vid: b.vid.toLowerCase(),
    path: b.path,
    area: b.area,
    s: clamp(b.s),
    w: clamp(b.w),
    d,
    // Where people came from is only for customers arriving at the site.
    ref: entry && (b.area === "site" || b.area === "account") ? ref : null,
    new: flag(b.new),
    entry,
    nf: flag(b.nf),
    staff: flag(b.staff),
  };
}

// What the browser sends, once per page view (again only if the tab was
// hidden and came back, with the new total; the server keeps the larger).
export interface UsageBeacon {
  id: string; // this page view
  sid: string; // this tab's visit
  vid: string; // this browser
  path: string;
  area: Area;
  s: number; // seconds on the page while it was on screen
  w: number; // seconds since the page was opened (to date the view)
  d: Device | null;
  ref: string | null; // the site that sent them, on a visit's first page
  new: boolean; // first visit from this browser
  entry: boolean; // first page of the visit
  nf: boolean; // the page wasn't found (the 404)
  staff: boolean; // this browser has also opened the back office or register
}
