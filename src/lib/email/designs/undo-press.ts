import "server-only";
import { revalidatePath } from "next/cache";
import { getCampaign, undoWave, type UndoOutcome } from "../campaign-send";
import { designOf } from "../render";
import { arrivalLabel } from "../undo";
import { isDesignKey } from "./index";

// Undo on Ready to send, for the minute after Send or Send the next wave:
// calls back the whole wave (it waits a few minutes at Resend for just
// this; undo.ts) and puts the email back as it was before the press.
// Served by /api/email/undo (a Route Handler, not a Server Action: a
// browser sends Server Actions one at a time, so an Undo pressed while
// another was running would wait behind it and miss its minute). Whoever
// may press Send may press Undo (the route checks: managers and up). The
// sending switches and a stop don't hold it back: calling back is always
// allowed, like Pause. The minute is checked by the server's clock.

export type UndoAnswer = { ok: true; message: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function undoPress(key: unknown, campaignId: unknown, undoKey: unknown): Promise<UndoAnswer> {
  if (typeof key !== "string" || typeof campaignId !== "string" || typeof undoKey !== "string" || !isDesignKey(key) || !UUID.test(campaignId) || !UUID.test(undoKey)) {
    return { ok: false, error: "Reload the page and try again." };
  }
  const c = await getCampaign(campaignId);
  if (c && designOf(c.content) !== key) return { ok: false, error: "Reload the page and try again." };
  let r: UndoOutcome;
  try {
    r = await undoWave(campaignId, undoKey);
  } catch (e) {
    refresh();
    return { ok: false, error: `${e instanceof Error ? e.message : "Something went wrong."} Press Undo again.` };
  }
  refresh();
  return undoMessage(r);
}

function refresh() {
  try {
    revalidatePath("/admin/email/ready");
    revalidatePath("/admin/email");
  } catch {
    // Outside a request (the checks): nothing to refresh.
  }
}

// Exactly how many were called back, and honestly what wasn't.
export function undoMessage(r: UndoOutcome): UndoAnswer {
  const n = (x: number) => x.toLocaleString("en-US");
  const went = (x: number) => (x ? ` ${n(x)} had already gone out, so ${x === 1 ? "that person has" : "those people have"} it (and won't get it again).` : "");
  const maybe = (x: number) => (x ? ` ${n(x)} may have gone out (Resend didn't answer when ${x === 1 ? "it was" : "they were"} handed over), so ${x === 1 ? "it isn't" : "they aren't"} sent again.` : "");
  switch (r.kind) {
    case "none":
      return { ok: true, message: "Nothing to undo now: it's already been called back, or it isn't going out. Reload the page." };
    case "late":
      return { ok: false, error: `Too late to undo: the minute is up. It arrives about ${arrivalLabel(r.arrives)}. Pause still calls back any of it that hasn't arrived.` };
    case "stopped":
      return { ok: false, error: "It was stopped from the Email page, so there's nothing to undo." };
    case "busy":
      return { ok: false, error: "Another call-back is running. Press Undo again in a few seconds." };
    case "already":
      return { ok: true, message: `Already undone: ${n(r.done.calledBack)} called back.${went(r.done.went)}${maybe(r.done.maybe ?? 0)}` };
    case "done": {
      if (r.waiting) {
        return {
          ok: false,
          error: `Called back ${n(r.calledBack)}.${went(r.went)}${maybe(r.maybe)} ${n(r.waiting)} couldn't be called back yet (Resend didn't answer in time). Press Undo again, or they arrive about ${arrivalLabel(r.u.arrives)}.`,
        };
      }
      const after = r.u.first ? "You can send it again whenever you're ready." : "It's waiting for Send the next wave again.";
      const kept = r.went + r.maybe;
      if (kept) return { ok: true, message: `Called back ${n(r.calledBack)} of ${n(r.calledBack + kept)}.${went(r.went)}${maybe(r.maybe)} ${after}` };
      const all = r.calledBack === 1 ? "the 1 email" : `all ${n(r.calledBack)}`;
      return { ok: true, message: `Undone: ${all} called back before anyone got it. ${r.u.first ? "Nothing was sent, and you can send it again whenever you're ready." : after}` };
    }
  }
}
