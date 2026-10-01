import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { hashEmail } from "./hash";
import { scrubAddresses } from "./format";
import { cancelPendingSends, logAddressEvent, logMemberEvent, setMarketingOptIn, suppressHash } from "./consent";
import { enforceGuardrails } from "./campaign-send";

// What Resend tells us about each email it handled (the webhook at
// /api/resend/webhook): delivered, bounced, complained, opened, failed,
// suppressed, delayed. Each event is recorded by its svix-id and marked
// processed only once everything it does is done: a re-delivered event that
// was handled changes nothing, and one whose handling failed partway (a
// database error) is handled again in full. It's matched to its email_sends
// row by Resend's email id (or the "send" tag), and:
//   - a hard bounce puts the address on the never-mail list;
//   - three soft bounces, at least a week apart, do too;
//   - a spam complaint puts the address on the list and turns that
//     member's marketing email off (receipts still go). Complaints about
//     receipts count too;
//   - an open is counted, but never counts as engagement (Apple Mail opens
//     everything by itself);
//   - Resend refusing a known-bad address is mirrored to our list.
// Nothing stored here holds an email address: bounce messages are scrubbed
// and the recipient is kept only as a hash.

export interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
    suppressed?: { type?: string; message?: string };
    tags?: Record<string, string> | { name: string; value: string }[];
  };
}

export const scrub = scrubAddresses;

function tagValue(tags: NonNullable<ResendEvent["data"]>["tags"], name: string): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) return tags.find((t) => t?.name === name)?.value ?? null;
  const v = (tags as Record<string, string>)[name];
  return typeof v === "string" ? v : null;
}

const SHORT: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked_resend",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "email.scheduled": "scheduled",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WebhookOutcome {
  duplicate: boolean;
  type: string;
  matched: boolean;
  effect: string | null;
}

// Throws on a database error, so the route answers 500 and Resend retries;
// the retry does the whole thing again (every step is safe to repeat).
export async function handleResendEvent(event: ResendEvent, svixId: string, now = new Date()): Promise<WebhookOutcome> {
  const admin = createAdminClient();
  const type = SHORT[event.type ?? ""] ?? (event.type ?? "unknown").replace(/^email\./, "").slice(0, 40);
  const d = event.data ?? {};
  const to = (Array.isArray(d.to) ? d.to[0] : d.to) ?? null;
  const toHash = to ? hashEmail(to) : null;
  const occurred = event.created_at && Number.isFinite(Date.parse(event.created_at)) ? event.created_at : now.toISOString();
  const detail: Record<string, unknown> = {
    ...(toHash ? { to_hash: toHash } : {}),
    ...(d.bounce ? { bounce_type: d.bounce.type ?? null, bounce_sub_type: d.bounce.subType ?? null, bounce_message: scrub(d.bounce.message) } : {}),
    ...(d.failed ? { failed_reason: scrub(d.failed.reason) } : {}),
    ...(d.suppressed ? { suppressed_type: d.suppressed.type ?? null } : {}),
    ...(tagValue(d.tags, "kind") ? { kind: tagValue(d.tags, "kind") } : {}),
  };

  // 1. Once per svix-id: recorded now, marked processed at the end.
  const { data: inserted, error: insErr } = await admin
    .from("email_events")
    .upsert({ svix_id: svixId, type, resend_email_id: d.email_id ?? null, detail, occurred_at: occurred }, { onConflict: "svix_id", ignoreDuplicates: true })
    .select("id");
  if (insErr) throw new Error(`event not saved: ${insErr.message}`);
  let eventId: string;
  let again = false;
  if (inserted?.length) eventId = inserted[0].id as string;
  else {
    const { data: prior, error: priorErr } = await admin.from("email_events").select("id, processed_at").eq("svix_id", svixId).maybeSingle();
    if (priorErr) throw new Error("event lookup failed");
    if (!prior || prior.processed_at) return { duplicate: true, type, matched: false, effect: null };
    // Seen before, but its handling didn't finish: do it again.
    eventId = prior.id as string;
    again = true;
  }

  // 2. Which email this was.
  let send: { id: string; member_id: string | null; status: string; delivered_at: string | null } | null = null;
  if (d.email_id) {
    const { data, error } = await admin.from("email_sends").select("id, member_id, status, delivered_at").eq("resend_email_id", d.email_id).maybeSingle();
    if (error) throw new Error("send lookup failed");
    send = data;
  }
  const tagged = tagValue(d.tags, "send");
  if (!send && tagged && UUID.test(tagged)) {
    const { data, error } = await admin.from("email_sends").select("id, member_id, status, delivered_at").eq("id", tagged).maybeSingle();
    if (error) throw new Error("send lookup failed");
    send = data;
    if (send && d.email_id) await admin.from("email_sends").update({ resend_email_id: d.email_id }).eq("id", send.id).is("resend_email_id", null);
  }
  if (send) {
    const { error } = await admin.from("email_events").update({ send_id: send.id }).eq("id", eventId);
    if (error) throw new Error("event link failed");
  }

  const setSend = async (fields: Record<string, unknown>, onlyFrom?: string[]) => {
    if (!send) return;
    let q = admin.from("email_sends").update(fields).eq("id", send.id);
    if (onlyFrom) q = q.in("status", onlyFrom);
    const { error } = await q;
    if (error) throw new Error("send update failed");
  };

  // Members with this address (a complaint about a receipt has no send row).
  const membersFor = async (): Promise<string[]> => {
    if (send?.member_id) return [send.member_id];
    if (!to) return [];
    const { data, error } = await admin.from("members").select("id").ilike("email", exactEmail(to)).is("erased_at", null);
    if (error) throw new Error("member lookup failed");
    return (data ?? []).map((m) => m.id as string);
  };

  let effect: string | null = null;
  switch (type) {
    case "delivered":
      await setSend({ delivered_at: send?.delivered_at ?? occurred, status: "delivered" }, ["submitted", "scheduled", "queued"]);
      if (send && send.delivered_at === null) await setSend({ delivered_at: occurred }, ["bounced", "complained"]);
      break;
    case "bounced": {
      const permanent = (d.bounce?.type ?? "").toLowerCase() === "permanent";
      if (permanent) {
        await setSend({ status: "bounced", bounced_at: occurred, bounce_type: "Permanent" });
        if (toHash) {
          await suppressHash(toHash, "hard_bounce", scrub(d.bounce?.subType));
          effect = "suppressed (hard bounce)";
          const ids = await membersFor();
          for (const id of ids) {
            // Anything else waiting to go to that address stops too.
            await cancelPendingSends(id, "Address bounced");
            await logMemberEvent(id, "hard_bounce", "webhook", { sub_type: d.bounce?.subType ?? null });
          }
          if (!ids.length && to) await logAddressEvent(to, "hard_bounce", "webhook");
        }
      } else {
        await setSend({ bounce_type: d.bounce?.type ?? "Transient" });
        if (toHash && (await softBouncesAWeekApart(toHash)) >= 3) {
          await suppressHash(toHash, "soft_bounce_repeat");
          effect = "suppressed (repeated soft bounces)";
        }
      }
      await enforceGuardrails(now);
      break;
    }
    case "complained": {
      await setSend({ status: "complained", complained_at: occurred });
      if (toHash) await suppressHash(toHash, "complaint");
      const ids = await membersFor();
      for (const id of ids) {
        // A member removed since is already off the list (setMarketingOptIn says so).
        const r = await setMarketingOptIn(id, false, "webhook", { at: null, detail: { reason: "complaint", kind: tagValue(d.tags, "kind") } });
        if (!r.ok) throw new Error(r.error);
        await logMemberEvent(id, "complaint", "webhook", { kind: tagValue(d.tags, "kind") });
      }
      if (!ids.length && to) await logAddressEvent(to, "complaint", "webhook");
      effect = `opted out ${ids.length}, suppressed`;
      await enforceGuardrails(now);
      break;
    }
    case "opened":
      // Not counted again on a retry (it may have been counted the first time).
      if (send && !again) {
        const { error } = await admin.rpc("email_bump_send", { p_send: send.id, p_what: "open", p_at: occurred });
        if (error) throw new Error("open not counted");
      }
      break;
    case "failed":
      await setSend({ status: "failed", error: scrub(d.failed?.reason) || "Resend couldn't send it." }, ["queued", "submitted", "scheduled"]);
      break;
    case "suppressed":
      await setSend({ status: "suppressed", error: scrub(d.suppressed?.type) || "Suppressed by Resend" });
      if (toHash) await suppressHash(toHash, "resend_suppressed", scrub(d.suppressed?.type));
      effect = "mirrored suppression";
      break;
    default:
      // sent, delayed, scheduled: recorded above, nothing to change.
      break;
  }
  const { error: doneErr } = await admin.from("email_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
  if (doneErr) throw new Error("event not marked processed");
  return { duplicate: false, type, matched: !!send, effect };
}

// Soft (transient) bounces for this address, counting only ones at least
// 7 days after the last one counted, each on a different email.
async function softBouncesAWeekApart(toHash: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("email_events")
    .select("send_id, occurred_at, detail")
    .eq("type", "bounced")
    .eq("detail->>to_hash", toHash)
    .order("occurred_at")
    .limit(200);
  if (error) throw new Error("bounce history lookup failed");
  let n = 0;
  let last = -Infinity;
  const sends = new Set<string>();
  for (const e of data ?? []) {
    const bt = String((e.detail as { bounce_type?: string } | null)?.bounce_type ?? "").toLowerCase();
    if (bt === "permanent") continue;
    const key = e.send_id ?? `x${e.occurred_at}`;
    const t = Date.parse(e.occurred_at);
    if (sends.has(key) || t - last < 7 * 86_400_000) continue;
    sends.add(key);
    last = t;
    n++;
  }
  return n;
}
