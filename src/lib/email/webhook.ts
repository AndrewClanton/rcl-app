import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { hashEmail } from "./hash";
import { logAddressEvent, logMemberEvent, setMarketingOptIn, suppressHash } from "./consent";
import { enforceGuardrails } from "./campaign-send";

// What Resend tells us about each email it handled (the webhook at
// /api/resend/webhook): delivered, bounced, complained, opened, failed,
// suppressed, delayed. Each event is recorded once (by its svix-id, so a
// re-delivered event changes nothing), matched to its email_sends row by
// Resend's email id (or the "send" tag), and:
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

const ADDRESS = /[^\s<>@"'(),;:]+@[^\s<>@"'(),;:]+/g;
export const scrub = (s: string | undefined | null) => (s ?? "").replace(ADDRESS, "[address]").slice(0, 300);

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

// Throws on a database error, so the route answers 500 and Resend retries.
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

  // 1. Once per svix-id.
  const { data: inserted, error: insErr } = await admin
    .from("email_events")
    .upsert({ svix_id: svixId, type, resend_email_id: d.email_id ?? null, detail, occurred_at: occurred }, { onConflict: "svix_id", ignoreDuplicates: true })
    .select("id");
  if (insErr) throw new Error(`event not saved: ${insErr.message}`);
  if (!inserted?.length) return { duplicate: true, type, matched: false, effect: null };
  const eventId = inserted[0].id as string;

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
  if (send) await admin.from("email_events").update({ send_id: send.id }).eq("id", eventId);

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
          if (ids.length) for (const id of ids) await logMemberEvent(id, "hard_bounce", "webhook", { sub_type: d.bounce?.subType ?? null });
          else if (to) await logAddressEvent(to, "hard_bounce", "webhook");
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
      if (send) {
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
