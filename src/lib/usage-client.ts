import { areaOf, isStaffOnlyPath, isValidPath, MAX_SECONDS, USAGE_ENDPOINT, type Device, type UsageBeacon } from "@/lib/usage";

// Counts page views and the time each one is actually on screen, for
// Reports -> Website usage. Browser-only; started by
// src/components/UsageTracker.tsx in the root layout.
//
// Kept light and anonymous:
//   - Nothing is sent while a page is loading. A page view is sent once,
//     when it ends (the next page, the tab hidden or closed), with
//     navigator.sendBeacon, which never holds the page up. A route change
//     waits for the browser to be idle first.
//   - No cookies. A random id for this browser (localStorage) and one for
//     this tab's visit (sessionStorage) tell visits apart; neither is tied
//     to a name or an account. Staff roles are looked up by the server, not
//     sent from here.
//   - Browsers asking not to be tracked (Global Privacy Control, Do Not
//     Track) send nothing at all.
//   - In development it logs what it would send instead of sending, so the
//     production numbers only count the real site. (Set localStorage
//     "rcl.usage.dev" to "send" to send from a dev server anyway.)

interface View {
  id: string;
  path: string;
  openedAt: number; // performance.now()
  activeMs: number; // on screen, before the current stretch
  visibleSince: number | null; // on screen now, since
  everVisible: boolean;
  sentSeconds: number; // what the last beacon said (-1: none yet)
  firstOfDocument: boolean; // the page the browser loaded (document.referrer is its)
  who: { sid: string; vid: string; isNew: boolean; entry: boolean } | null;
}

const VISITOR_KEY = "rcl.usage.v";
const SESSION_KEY = "rcl.usage.s";
const STAFF_KEY = "rcl.usage.staff";
const DEV_KEY = "rcl.usage.dev";
// A visit ends after half an hour with no page views.
const SESSION_IDLE_MS = 30 * 60_000;
// The register and the screens stay on one page for hours, and a TV may
// never close it, so those send a running total now and then.
const HEARTBEAT_MS = 10 * 60_000;

let current: View | null = null;
const pending = new Set<View>();
const notFound = new Set<string>();
let enabled: boolean | null = null;
let installed = false;
let documentViews = 0;
let memoryVisitor: string | null = null;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function read(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function write(store: "local" | "session", key: string, value: string) {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // private mode, storage off: carry on without it
  }
}

function isEnabled(): boolean {
  if (enabled !== null) return enabled;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  enabled = nav.globalPrivacyControl !== true && dnt !== "1" && dnt !== "yes";
  return enabled;
}

function prerendering() {
  return (document as Document & { prerendering?: boolean }).prerendering === true;
}

function onScreen() {
  return document.visibilityState === "visible" && !prerendering();
}

function newView(path: string): View {
  const now = performance.now();
  const visible = onScreen();
  documentViews += 1;
  return { id: randomId(), path, openedAt: now, activeMs: 0, visibleSince: visible ? now : null, everVisible: visible, sentSeconds: -1, firstOfDocument: documentViews === 1, who: null };
}

function pause(v: View, now = performance.now()) {
  if (v.visibleSince !== null) {
    v.activeMs += now - v.visibleSince;
    v.visibleSince = null;
  }
}

function resume(v: View, now = performance.now()) {
  if (v.visibleSince === null) {
    v.visibleSince = now;
    v.everVisible = true;
  }
}

function device(): Device {
  const w = window.innerWidth;
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (w < 640) return "phone";
  if (w < 1024 || (touch && w <= 1400)) return "tablet";
  return "desktop";
}

// The site that sent them here, for the first page the browser loaded.
function referrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === window.location.hostname.toLowerCase().replace(/^www\./, "")) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

// This browser and this visit, decided when a view is first sent.
function identify(v: View): NonNullable<View["who"]> {
  if (v.who) return v.who;
  let vid = read("local", VISITOR_KEY);
  let freshVisitor = false;
  if (!vid) {
    vid = memoryVisitor ?? randomId();
    memoryVisitor = vid;
    freshVisitor = true;
    write("local", VISITOR_KEY, vid);
  }
  const startedAt = Date.now() - (performance.now() - v.openedAt);
  let session: { id: string; at: number; isNew: boolean } | null = null;
  try {
    session = JSON.parse(read("session", SESSION_KEY) ?? "null");
  } catch {
    session = null;
  }
  let entry = false;
  if (!session || typeof session.id !== "string" || typeof session.at !== "number" || startedAt - session.at > SESSION_IDLE_MS) {
    session = { id: randomId(), at: startedAt, isNew: freshVisitor };
    entry = true;
  }
  session.at = Math.max(session.at, Date.now());
  write("session", SESSION_KEY, JSON.stringify(session));
  v.who = { sid: session.id, vid, isNew: session.isNew || freshVisitor, entry };
  return v.who;
}

function send(v: View) {
  if (!v.everVisible) return; // opened in the background and never looked at
  if (!isValidPath(v.path)) return; // a freak address the server would refuse anyway
  const now = performance.now();
  const activeMs = v.activeMs + (v.visibleSince !== null ? now - v.visibleSince : 0);
  const s = Math.min(MAX_SECONDS, Math.round(activeMs / 1000));
  if (s <= v.sentSeconds) return; // nothing new since the last one
  const who = identify(v);
  const area = areaOf(v.path);
  if (isStaffOnlyPath(v.path)) write("local", STAFF_KEY, "1");
  const beacon: UsageBeacon = {
    id: v.id,
    sid: who.sid,
    vid: who.vid,
    path: v.path,
    area,
    s,
    w: Math.min(MAX_SECONDS, Math.round((now - v.openedAt) / 1000)),
    d: device(),
    ref: who.entry && v.firstOfDocument && (area === "site" || area === "account") ? referrerHost() : null,
    new: who.isNew,
    entry: who.entry,
    nf: notFound.has(v.path),
    staff: read("local", STAFF_KEY) === "1",
  };
  v.sentSeconds = s;
  const body = JSON.stringify(beacon);
  if (process.env.NODE_ENV !== "production" && read("local", DEV_KEY) !== "send") {
    console.debug("[usage] would send", beacon);
    return;
  }
  try {
    if (navigator.sendBeacon?.(USAGE_ENDPOINT, body)) return;
  } catch {
    // fall through
  }
  fetch(USAGE_ENDPOINT, { method: "POST", body, keepalive: true, credentials: "same-origin" }).catch(() => {});
}

function flushAll() {
  for (const v of pending) send(v);
  pending.clear();
  if (current) send(current);
}

function whenIdle(fn: () => void) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 3000 });
  else setTimeout(fn, 200);
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (!current) return;
    if (document.visibilityState === "hidden") {
      pause(current);
      flushAll();
    } else if (!prerendering()) {
      resume(current);
    }
  });
  // A prerendered page starts counting once it's actually shown.
  document.addEventListener("prerenderingchange", () => {
    if (current && document.visibilityState === "visible") resume(current);
  });
  window.addEventListener("pagehide", () => {
    if (current) pause(current);
    flushAll();
  });
  // Back to a page kept in the back/forward cache: a fresh view of it.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && current) current = newView(current.path);
  });
  setInterval(() => {
    if (!current || !onScreen()) return;
    const area = areaOf(current.path);
    if (area === "pos" || area === "display") send(current);
  }, HEARTBEAT_MS);
}

// A new page is on screen (the tracker calls this on every route change).
export function startView(pathname: string) {
  if (typeof window === "undefined" || !isEnabled()) return;
  const path = asciiPath(pathname);
  if (current?.path === path) return;
  install();
  const ended = current;
  current = newView(path);
  if (ended) {
    pause(ended);
    pending.add(ended);
    whenIdle(() => {
      if (!pending.has(ended)) return; // already sent with the tab hidden
      pending.delete(ended);
      send(ended);
    });
  }
}

// The page at this address was the "not found" page.
export function markNotFound(pathname: string) {
  notFound.add(asciiPath(pathname));
}

// Addresses go over the wire the way the browser writes them: plain
// ASCII, anything else percent-encoded.
function asciiPath(pathname: string) {
  if (/^[\x21-\x7e]*$/.test(pathname)) return pathname;
  try {
    return encodeURI(pathname);
  } catch {
    return pathname;
  }
}
