// One minute to undo a wave on Ready to send: the numbers and shapes, no
// server code (the screen uses them too). The work is in campaign-send.ts
// (prepareWave holds the wave, undoWave calls it back).
//
// A wave staff just pressed for (Send, or Send the next wave) is handed to
// Resend at once, but set to arrive a few minutes later (scheduled_at). For
// the first minute after the hand-over, Undo calls every one of them back.
// The hold is long enough that an Undo pressed at the last second still
// reaches the last email well before any is due: Resend cancels one email
// per request, and we keep to RESEND_RPS requests a second (1.5 unless set:
// Resend's default limit is 2 a second for the whole account, shared with
// receipts and tickets), so the hold allows one and a half requests per
// email at that rate, plus the waits. Waves that go by themselves on the
// morning run get no hold and no Undo.

import type { CampaignStatus, Exclusion } from "./types";

// Requests a second to Resend (resend.ts throttles every call to this).
export function requestsPerSecond(): number {
  const n = Number(typeof process === "undefined" ? undefined : process.env.RESEND_RPS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1.5;
}

export const UNDO_SECONDS = 60;
// The server still takes an Undo this long after the minute (the page's
// clock, the network), so a press at 0:01 always counts.
export const UNDO_GRACE_MS = 5_000;
// Undo stops trying this long before the wave is due: a cancel that late
// could cross with Resend sending it.
export const UNDO_STOP_BEFORE_MS = 30_000;
// How long one press of Undo may keep calling back (it runs in a request
// of up to 5 minutes: /api/email/undo).
export const UNDO_RUN_MS = 250_000;
// Waiting for another call-back to finish (UNDO_LEASE_WAIT_MS), or a batch
// still on its way to Resend to land, before Undo can start on it.
export const UNDO_LEASE_WAIT_MS = 40_000;
const WAITS_MS = UNDO_LEASE_WAIT_MS + 10_000;
const MARGIN_MS = 60_000;
// A cancel, and now and then a second request to ask what became of one.
const cancelMsEach = () => Math.ceil(1500 / requestsPerSecond());
// The most one press of Undo can call back in time. A bigger wave goes as
// before, with no hold: Pause still calls back what hasn't arrived.
export const UNDO_MAX_WAVE = 200;

// After the minute, what calling back `n` needs before the stop-before
// point: the grace, the waits, and the cancels.
export function undoNeedsMs(n: number): number {
  return UNDO_GRACE_MS + WAITS_MS + Math.max(0, Math.ceil(n)) * cancelMsEach() + UNDO_STOP_BEFORE_MS;
}

// How long a wave of `n` waits at Resend before it's due: the minute, what
// calling back needs, and a margin, in whole minutes. At 1.5 a second:
// 25 -> 4 minutes, 80 -> 5, 200 -> 7.
export function undoHoldMs(n: number): number {
  return Math.ceil((UNDO_SECONDS * 1000 + undoNeedsMs(n) + MARGIN_MS) / 60_000) * 60_000;
}

// "Send to everyone now": nothing leaves for the first minute. The whole
// send waits here (queued, never handed to Resend), so Undo only has to
// take the rows away, however many there are. It's handed over in chunks
// of 100 once the minute (and the grace, and the stop-before margin) is
// over: about 2 minutes after the press.
export const EVERYONE_STARTS_AFTER_MS = UNDO_SECONDS * 1000 + UNDO_GRACE_MS + UNDO_STOP_BEFORE_MS + 15_000;

export function canUndoWave(n: number): boolean {
  return n > 0 && n <= UNDO_MAX_WAVE && Math.max(0, Math.ceil(n)) * cancelMsEach() + UNDO_LEASE_WAIT_MS <= UNDO_RUN_MS;
}

// The email as it was before the press, put back by a full Undo.
export interface UndoBefore {
  status: CampaignStatus;
  error: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  recipients: number | null;
  held_out: number | null;
  excluded: Partial<Record<Exclusion, number>> | null;
  pace: Record<string, unknown>;
  waves: { at: string; n: number }[] | null;
}

// Saved on the campaign (content.pace.undo) when a pressed wave is queued.
export interface WaveUndo {
  key: string; // the press's page key (send_key, or pace.goKey)
  wave: number; // its number, as the wave-by-wave results count them
  n: number; // how many were chosen
  at: string; // when they were queued
  until: string; // the end of the minute (it starts once they're handed to Resend)
  arrives: string; // when they're due (held at Resend until then)
  planned: string; // when they'd have gone with no hold (if Resend won't hold them)
  after: string | null; // the wave's rows: this email's, created after this...
  to: string; // ...up to this (the database's own times)
  first: boolean; // the first wave of a Send (not Send the next wave)
  before: UndoBefore | null; // null: the email didn't exist before Send
  started?: string | null; // an Undo was taken (in time) then; pressing again carries on
  everyone?: boolean; // "Send to everyone now": held here (queued), not at Resend, until `arrives`
}

// What a finished Undo did (content.pace.undone), so a second press says
// the same thing.
export interface UndoDone {
  key: string;
  at: string;
  calledBack: number;
  went: number;
  maybe?: number; // Resend may have them (it didn't answer when they were handed over)
}

// Whether the wave can still be undone (nothing else may start meanwhile):
// inside the minute (and the grace), or an Undo was started and the wave
// isn't nearly due yet.
export function undoOpen(u: WaveUndo | null | undefined, nowMs: number): boolean {
  if (!u) return false;
  const until = Date.parse(u.until);
  const arrives = Date.parse(u.arrives);
  if (!Number.isFinite(until) || !Number.isFinite(arrives)) return false;
  if (nowMs > arrives - UNDO_STOP_BEFORE_MS) return false;
  return nowMs <= until + UNDO_GRACE_MS || !!u.started;
}

// "5:12 PM", or "10:30 AM Mon, Oct 5" when it isn't today (Central).
export function arrivalLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const tz = "America/Chicago";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  return day(d) === day(now) ? time : `${time} ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz })}`;
}
