import "server-only";

// Resend's REST API (https://resend.com/docs/api-reference), with plain
// fetch like send.ts. Used for the members' mailing list: contacts, the
// list's segment, and broadcasts. Needs a "Full access" RESEND_API_KEY
// ("Sending access" keys can only send single emails).
//
// Resend allows 10 requests a second per team, across every key. Calls
// here are spaced to 8 a second and a 429 is retried after the wait Resend
// asks for, so a big list sync doesn't trip the limit.

const API = "https://api.resend.com";
const MIN_GAP_MS = 125;

let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export type ResendResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; name?: string };

export async function resendApi<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ResendResult<T>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 0, error: "Email isn't set up yet (RESEND_API_KEY missing)." };
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    }).catch(() => null);
    if (!res) {
      if (attempt < 2) continue;
      return { ok: false, status: 0, error: "Couldn't reach Resend." };
    }
    const json = (await res.json().catch(() => null)) as (T & { message?: string; name?: string }) | null;
    if (res.ok) return { ok: true, data: json as T };
    const name = json?.name;
    // Too many requests: wait as long as Resend says (capped) and try again.
    // A used-up daily or monthly quota won't clear by waiting.
    if (res.status === 429 && attempt < 3 && name !== "daily_quota_exceeded" && name !== "monthly_quota_exceeded") {
      const after = Math.min(5, Math.max(1, Number(res.headers.get("retry-after")) || 1));
      await new Promise((r) => setTimeout(r, after * 1000));
      continue;
    }
    if (res.status >= 500 && attempt < 1) continue;
    return { ok: false, status: res.status, error: json?.message ?? `Resend answered ${res.status}.`, name };
  }
}

const enc = encodeURIComponent;

// ---------- contacts ----------

export interface ResendContact {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  created_at?: string;
  unsubscribed: boolean;
}

interface ResendList<T> {
  object: "list";
  has_more: boolean;
  data: T[];
}

export function getContact(email: string) {
  return resendApi<ResendContact>("GET", `/contacts/${enc(email)}`);
}

export function createContact(c: { email: string; firstName: string | null; segmentId: string }) {
  return resendApi<{ id: string }>("POST", "/contacts", {
    email: c.email,
    ...(c.firstName ? { first_name: c.firstName } : {}),
    unsubscribed: false,
    segments: [{ id: c.segmentId }],
  });
}

export function updateContact(email: string, fields: { firstName?: string | null; unsubscribed?: boolean }) {
  return resendApi<{ id: string }>("PATCH", `/contacts/${enc(email)}`, {
    ...(fields.firstName !== undefined ? { first_name: fields.firstName } : {}),
    ...(fields.unsubscribed !== undefined ? { unsubscribed: fields.unsubscribed } : {}),
  });
}

// A missing contact counts as deleted.
export async function deleteContact(email: string): Promise<ResendResult<null>> {
  const r = await resendApi<unknown>("DELETE", `/contacts/${enc(email)}`);
  if (r.ok || r.status === 404) return { ok: true, data: null };
  return r;
}

export function addContactToSegment(email: string, segmentId: string) {
  return resendApi<{ id: string }>("POST", `/contacts/${enc(email)}/segments/${enc(segmentId)}`);
}

export async function contactInSegment(email: string, segmentId: string): Promise<ResendResult<boolean>> {
  const r = await resendApi<ResendList<{ id: string }>>("GET", `/contacts/${enc(email)}/segments`);
  return r.ok ? { ok: true, data: r.data.data.some((s) => s.id === segmentId) } : r;
}

// Every contact in a segment, 100 at a time.
export async function listSegmentContacts(segmentId: string): Promise<ResendResult<ResendContact[]>> {
  const all: ResendContact[] = [];
  let after: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const q: string = `?limit=100${after ? `&after=${enc(after)}` : ""}`;
    const r: ResendResult<ResendList<ResendContact>> = await resendApi<ResendList<ResendContact>>("GET", `/segments/${enc(segmentId)}/contacts${q}`);
    if (!r.ok) return r;
    all.push(...r.data.data);
    if (!r.data.has_more || r.data.data.length === 0) break;
    after = r.data.data[r.data.data.length - 1].id;
  }
  return { ok: true, data: all };
}

// ---------- segments ----------

export async function findOrCreateSegment(name: string): Promise<ResendResult<string>> {
  const list = await resendApi<ResendList<{ id: string; name: string }>>("GET", "/segments");
  if (!list.ok) return list;
  const found = list.data.data.find((s) => s.name === name);
  if (found) return { ok: true, data: found.id };
  const made = await resendApi<{ id: string }>("POST", "/segments", { name });
  return made.ok ? { ok: true, data: made.data.id } : made;
}

// ---------- broadcasts ----------

export interface ResendBroadcast {
  id: string;
  status: string; // draft | scheduled | queued | sending | sent | canceled
  sent_at?: string | null;
}

export function createBroadcast(b: { segmentId: string; from: string; replyTo?: string; subject: string; html: string; text: string; name: string }) {
  return resendApi<{ id: string }>("POST", "/broadcasts", {
    segment_id: b.segmentId,
    from: b.from,
    ...(b.replyTo ? { reply_to: b.replyTo } : {}),
    subject: b.subject,
    html: b.html,
    text: b.text,
    name: b.name,
  });
}

export function sendBroadcast(id: string) {
  return resendApi<{ id: string }>("POST", `/broadcasts/${enc(id)}/send`, {});
}

export function getBroadcast(id: string) {
  return resendApi<ResendBroadcast>("GET", `/broadcasts/${enc(id)}`);
}
