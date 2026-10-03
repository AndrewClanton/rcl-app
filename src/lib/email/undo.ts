// One minute to undo a wave on Ready to send: the numbers and shapes, no
// server code (the screen uses them too). The work is in campaign-send.ts
// (prepareWave holds the wave, undoWave calls it back).
//
// A wave staff just pressed for (Send, or Send the next wave) is handed to
// Resend at once, but set to arrive a few minutes later (scheduled_at). For
// the first minute, Undo calls every one of them back. The hold is long
// enough that an Undo pressed at the last second still reaches the last
// email well before any is due: Resend cancels one email per request, and
// its default limit is 2 requests a second for the whole account (shared
// with receipts and tickets), so the hold allows a full second for each
// (a 429 from Resend waits a second or more before it's tried again).
// Waves that go by themselves on the morning run get no hold and no Undo.

import type { CampaignStatus, Exclusion } from "./types";

export const UNDO_SECONDS = 60;
// The server still takes an Undo this long after the minute (the page's
// clock, the network), so a press at 0:01 always counts.
export const UNDO_GRACE_MS = 5_000;
// Undo calls back 2 a second at most, Resend's default limit.
export const UNDO_CANCEL_GAP_MS = 500;
// Undo stops trying this long before the wave is due: a cancel that late
// could cross with Resend sending it.
export const UNDO_STOP_BEFORE_MS = 30_000;
// How long one press of Undo may keep calling back (Back office actions on
// that page get 5 minutes).
export const UNDO_RUN_MS = 230_000;
// Waiting for another call-back to finish, or a batch still on its way to
// Resend to land, before Undo can start on it.
const WAITS_MS = 50_000;
const CANCEL_MS_EACH = 1_000;
const MARGIN_MS = 60_000;
// The most one press of Undo can call back in time (a second each, inside
// UNDO_RUN_MS). A bigger wave goes as before, with no hold: Pause still
// calls back what hasn't arrived.
export const UNDO_MAX_WAVE = 200;

// How long a wave of `n` waits at Resend before it's due: the minute, the
// grace, the waits, a second per email, and a margin, in whole minutes.
// 25 -> 4 minutes, 80 -> 5, 200 -> 7.
export function undoHoldMs(n: number): number {
  const ms = UNDO_SECONDS * 1000 + UNDO_GRACE_MS + WAITS_MS + Math.max(0, Math.ceil(n)) * CANCEL_MS_EACH + UNDO_STOP_BEFORE_MS + MARGIN_MS;
  return Math.ceil(ms / 60_000) * 60_000;
}

export function canUndoWave(n: number): boolean {
  return n > 0 && n <= UNDO_MAX_WAVE;
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
  at: string; // when they were queued: the minute starts here
  until: string; // the end of the minute
  arrives: string; // when they're due (held at Resend until then)
  after: string | null; // the wave's rows: this email's, created after this...
  to: string; // ...up to this (the database's own times)
  first: boolean; // the first wave of a Send (not Send the next wave)
  before: UndoBefore | null; // null: the email didn't exist before Send
  started?: string | null; // an Undo was taken (in time) then; pressing again carries on
}

// What a finished Undo did (content.pace.undone), so a second press says
// the same thing.
export interface UndoDone {
  key: string;
  at: string;
  calledBack: number;
  went: number;
}

// Whether Undo is still taken for this wave: inside the minute (and the
// grace), or one that was started and hasn't finished, until shortly before
// the wave is due.
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
