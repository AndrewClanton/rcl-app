import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { allowAttempt } from "@/lib/rate-limit";
import type { FrozenLink } from "./campaign";
import { PERSONAL_CLAIM, PERSONAL_FINISH } from "./designs/links";

// First-party click tracking. Every link in a campaign email is
// /e/<send id>/<link number>; this records the click and sends the person
// on to the link stored on the campaign (campaign.links). Only ever to a
// stored link: an unknown send or number goes to the showtimes page, so
// the route can't be used to bounce people to someone else's site.
//
// Mail scanners open every link in an email within moments of delivery. A
// click that lands within a minute of delivery in the same second as
// another link from the same email (or a HEAD request) is marked suspect,
// along with the rest of that burst, and doesn't count as a click or as
// engagement.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FALLBACK = `${SITE_URL}/showtimes`;

// Our own pages get utm tags (page views are anonymous, so this only says
// "came from the email", never who).
export function withUtm(url: string, campaign: string): string {
  if (!url.startsWith(SITE_URL)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("utm_source")) {
      u.searchParams.set("utm_source", "royale");
      u.searchParams.set("utm_medium", "email");
      u.searchParams.set("utm_campaign", campaign.replace(/[^a-z0-9_-]/gi, "").slice(0, 60));
    }
    return u.toString();
  } catch {
    return url;
  }
}

// A burst of clicks from one email, right after it arrived: a scanner.
export function looksLikeScanner(p: { method: string; now: number; arrivedAt: number | null; otherClicksSameSecond: number }): boolean {
  if (p.method === "HEAD") return true;
  if (p.arrivedAt === null) return false;
  return p.now - p.arrivedAt < 60_000 && p.otherClicksSameSecond > 0;
}

export function pickLink(links: FrozenLink[] | null | undefined, i: number): FrozenLink | null {
  const l = (links ?? []).find((x) => x.i === i);
  if (!l || typeof l.url !== "string") return null;
  // Stored links are https (our site or a typed https address). Anything
  // else is refused, however it got there.
  return /^https:\/\//i.test(l.url) ? l : null;
}

export async function handleClick(sendId: string, index: string, method: string, now = new Date()): Promise<string> {
  const i = Number(index);
  if (!UUID.test(sendId) || !Number.isInteger(i) || i < 0 || i > 5000) return FALLBACK;
  const admin = createAdminClient();
  const { data: send } = await admin.from("email_sends").select("id, member_id, campaign_id, submitted_at, deliver_at").eq("id", sendId).maybeSingle();
  if (!send) return FALLBACK;
  const { data: campaign } = await admin.from("email_campaigns").select("kind, automation, links, sent_at, created_at").eq("id", send.campaign_id).maybeSingle();
  const link = pickLink(campaign?.links as FrozenLink[] | undefined, i);
  if (!link) return FALLBACK;
  const day = (send.deliver_at ?? send.submitted_at ?? campaign?.created_at ?? now.toISOString()).slice(0, 10).replace(/-/g, "");
  const target = withUtm(link.url, `${campaign?.automation ?? campaign?.kind ?? "email"}-${day}`);

  // Past a sane number of clicks per email, just send them on.
  if (!(await allowAttempt(`email-click:${sendId}`, 60, 3600))) return target;

  await recordClick(send, i, method, now);
  return target;
}

// One click on link i of a send: recorded, checked for a mail scanner,
// and counted (a real click is engagement). Best effort.
type SendRow = { id: string; member_id: string | null; submitted_at: string | null; deliver_at: string | null };
async function recordClick(send: SendRow, i: number, method: string, now: Date): Promise<void> {
  const admin = createAdminClient();
  const sendId = send.id;
  try {
    const at = now.toISOString();
    const lo = new Date(now.getTime() - 1000).toISOString();
    const hi = new Date(now.getTime() + 1000).toISOString();
    const { count: sameSecond } = await admin
      .from("email_events")
      .select("id", { count: "exact", head: true })
      .eq("send_id", sendId)
      .eq("type", "clicked")
      .neq("link_index", i)
      .gte("occurred_at", lo)
      .lte("occurred_at", hi);
    const arrived = send.deliver_at ?? send.submitted_at;
    const arrivedAt = arrived ? Date.parse(arrived) : null;
    const suspect = looksLikeScanner({ method, now: now.getTime(), arrivedAt, otherClicksSameSecond: sameSecond ?? 0 });
    const burst = looksLikeScanner({ method: "GET", now: now.getTime(), arrivedAt, otherClicksSameSecond: sameSecond ?? 0 });
    await admin.from("email_events").insert({ send_id: sendId, type: "clicked", link_index: i, suspect, occurred_at: at, detail: { method } });

    if (suspect) {
      if (burst) {
        // The rest of the burst was a scanner too: take back what it counted.
        await admin.from("email_events").update({ suspect: true }).eq("send_id", sendId).eq("type", "clicked").gte("occurred_at", lo).lte("occurred_at", hi);
        await recount(sendId);
      }
    } else {
      await admin.rpc("email_bump_send", { p_send: sendId, p_what: "click", p_at: at });
      if (send.member_id) {
        // A click is engagement: anyone who'd been asked "Still want
        // these?" (or gone quiet) is back.
        const { data: p } = await admin.from("member_email_prefs").select("engagement").eq("member_id", send.member_id).maybeSingle();
        if (p && p.engagement !== "active") {
          await admin.from("member_email_prefs").update({ engagement: "active", updated_at: at }).eq("member_id", send.member_id);
          await admin.from("email_consent_log").insert({ member_id: send.member_id, action: "reactivate", source: "click", detail: { send_id: sendId } });
        }
      }
    }
  } catch {
    // Recording is best effort: the person still gets where they're going.
  }
}

// The personal buttons in the ready-made emails ("Set my password",
// "Restart my unlimited", lib/email/designs) go straight to the person's own
// link, tagged e=<send id>, so the link itself is theirs from the moment it
// was sent. The page it opens (the claim page, /membership/finish) records
// the click here, on the email's "their own link" line in Top links. Only
// when the send belongs to the same member as the link. Never throws.
export async function recordPersonalClick(sendId: string | null | undefined, memberId: string, which: "claim" | "finish", now = new Date()): Promise<void> {
  try {
    if (!sendId || !UUID.test(sendId) || !UUID.test(memberId)) return;
    const admin = createAdminClient();
    const { data: send } = await admin.from("email_sends").select("id, member_id, campaign_id, submitted_at, deliver_at").eq("id", sendId).maybeSingle();
    if (!send || send.member_id !== memberId) return;
    const { data: campaign } = await admin.from("email_campaigns").select("links").eq("id", send.campaign_id).maybeSingle();
    const want = which === "claim" ? PERSONAL_CLAIM : PERSONAL_FINISH;
    const link = ((campaign?.links ?? []) as FrozenLink[]).find((l) => l.url === want);
    if (!link) return;
    if (!(await allowAttempt(`email-click:${sendId}`, 60, 3600))) return;
    await recordClick(send, link.i, "GET", now);
  } catch {
    // Recording is best effort.
  }
}

// Rebuilds a send's click counts from its non-suspect click events.
async function recount(sendId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("email_events").select("occurred_at").eq("send_id", sendId).eq("type", "clicked").eq("suspect", false).order("occurred_at");
  const times = (data ?? []).map((e) => e.occurred_at as string);
  await admin
    .from("email_sends")
    .update({ clicks: times.length, first_clicked_at: times[0] ?? null, last_clicked_at: times[times.length - 1] ?? null })
    .eq("id", sendId);
}
