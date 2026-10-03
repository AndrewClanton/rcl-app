import "server-only";
import { requestsPerSecond } from "./undo";

// Resend's REST API (https://resend.com/docs/api-reference) with plain
// fetch, like send.ts. Only sending: our database decides who gets what, so
// there are no Resend contacts, segments or broadcasts. A "Sending access"
// API key is enough.
//
// Resend's default limit is 2 requests a second for the whole team, shared
// with the everyday mail (receipts, the daily report), so list email and
// call-backs keep to RESEND_RPS a second (1.5 unless set). A 429 is retried
// after the wait Resend asks for; a used-up daily or monthly quota isn't
// (waiting won't clear it). Network errors and 5xx answers are retried
// with the same body and the same idempotency key, so a retry can never
// send twice. When a request fails in the end but an earlier try may have
// reached Resend (no answer, a 5xx, the key still being worked on), the
// failure says so (`unclear`): the caller must not treat it as "nothing
// was taken".

const API = "https://api.resend.com";

let nextSlot = 0;
async function throttle() {
  const gap = Math.ceil(1000 / requestsPerSecond());
  const now = Date.now();
  // Never more than one gap (a clock that jumped back can't stall it).
  const wait = Math.min(gap, Math.max(0, nextSlot - now));
  nextSlot = Math.max(now, Math.min(nextSlot, now + gap)) + gap;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export type ResendResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; name?: string; unclear?: boolean };

export async function resendApi<T>(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ResendResult<T>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 0, error: "Email isn't set up yet (RESEND_API_KEY missing)." };
  // An earlier try may have reached Resend.
  let unclear = false;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    }).catch(() => null);
    if (!res) {
      unclear = true;
      if (attempt < 2) continue;
      return { ok: false, status: 0, error: "Couldn't reach Resend.", unclear };
    }
    const json = (await res.json().catch(() => null)) as (T & { message?: string; name?: string }) | null;
    if (res.ok) return { ok: true, data: json as T };
    const name = json?.name;
    if (res.status === 429 && attempt < 3 && name !== "daily_quota_exceeded" && name !== "monthly_quota_exceeded") {
      const after = Math.min(5, Math.max(1, Number(res.headers.get("retry-after")) || 1));
      await new Promise((r) => setTimeout(r, after * 1000));
      continue;
    }
    // The same key is still being worked on: safe to ask again shortly.
    if (res.status === 409 && name === "concurrent_idempotent_requests") {
      unclear = true;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
    }
    if (res.status >= 500) {
      unclear = true;
      if (attempt < 1) continue;
    }
    return { ok: false, status: res.status, error: json?.message ?? `Resend answered ${res.status}.`, name, ...(unclear ? { unclear } : {}) };
  }
}

export interface OutgoingEmail {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  scheduled_at?: string;
}

// Up to 100 emails in one request (POST /emails/batch). The answer's
// data[i].id is item i's email id. One bad item fails the whole batch, so
// addresses are checked before this is called.
export function sendBatch(emails: OutgoingEmail[], idempotencyKey: string) {
  return resendApi<{ data: { id: string }[] }>("POST", "/emails/batch", emails, { "Idempotency-Key": idempotencyKey.slice(0, 256) });
}

// Stops an email that was handed over with scheduled_at and hasn't gone yet.
export function cancelEmail(id: string) {
  return resendApi<{ id: string }>("POST", `/emails/${encodeURIComponent(id)}/cancel`, {});
}

export function getEmail(id: string) {
  return resendApi<{ id: string; last_event?: string | null; scheduled_at?: string | null }>("GET", `/emails/${encodeURIComponent(id)}`);
}

// Resend refused the email's scheduled_at (the batch endpoint may not take
// it): a setup problem, not a bad address.
export function refusedSchedule(r: Extract<ResendResult<unknown>, { ok: false }>): boolean {
  return (r.status === 422 || r.status === 400) && /schedul/i.test(`${r.name ?? ""} ${r.error}`);
}

// The one place list email leaves the building. Kept behind this function
// so the transport can be swapped (say, to Resend Broadcasts) without
// touching the sender.
export async function deliver(batch: OutgoingEmail[], idempotencyKey: string): Promise<ResendResult<string[]>> {
  const r = await sendBatch(batch, idempotencyKey);
  if (!r.ok) return r;
  const ids = (r.data?.data ?? []).map((d) => d?.id ?? "");
  if (ids.length !== batch.length) return { ok: false, status: 200, error: `Resend returned ${ids.length} ids for ${batch.length} emails.` };
  return { ok: true, data: ids };
}

// One email alone (POST /emails, which documents scheduled_at): for when
// the batch endpoint won't take scheduled_at.
export async function deliverOne(email: OutgoingEmail, idempotencyKey: string): Promise<ResendResult<string[]>> {
  const r = await resendApi<{ id: string }>("POST", "/emails", email, { "Idempotency-Key": idempotencyKey.slice(0, 256) });
  if (!r.ok) return r;
  return { ok: true, data: [r.data?.id ?? ""] };
}
