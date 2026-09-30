import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { issueEmailClaimLinks } from "@/lib/member-claim";
import { CAMPAIGN_COLUMNS, shapeOf, type CampaignRow, type FrozenLink } from "./campaign";
import { loadFacts, queueSends, resolveAudience } from "./audience";
import { firstNameOf } from "./format";
import { hashEmail } from "./hash";
import { lintCampaign, type LintResult } from "./lint";
import { renderCampaign, type CampaignInput, type RenderData, type Recipient, type RenderLinks } from "./render";
import { loadRenderData, restrictedTitles, unknownHouseEventIds } from "./render-data";
import { deliver, type OutgoingEmail } from "./resend";
import { looksDeliverable } from "./rules";
import { sendEmail } from "./send";
import { nextSendSlot } from "./timing";
import { emailTokensReady, listUnsubscribeHeaders, preferencesUrl, sealEmailToken } from "./tokens";
import type { ConsentSource, PrefCategory } from "./types";

// Sending a campaign to its list, per person, through Resend's batch API.
//
//   draft -> scheduled -> sending -> sent   (side exits: paused, cancelled, failed)
//   automations stay 'active' (or 'off') and keep collecting sends.
//
// A run takes a 5-minute lease on the campaign (email_claim_campaign), so
// only one run works on it at a time and a run that died is taken over
// after the lease runs out. It works out who gets it (audience.ts) once,
// saves those people as 'queued' email_sends rows, freezes the campaign's
// links, then hands them to Resend 100 at a time. Each batch carries the
// Idempotency-Key "<campaign>:<batch number>", and a batch that was
// numbered but never confirmed is retried with the same key and the same
// email, so a retry, a double click or a crashed run never sends twice.
//
// Nothing goes to a list unless EMAIL_SENDING_ENABLED is "true", the
// sender is on a verified domain (not @resend.dev), and EMAIL_TOKEN_SECRET
// is set (no unsubscribe link, no email). Spam complaints or hard bounces
// running too high pause everything until an admin looks (guardrails).

export const LEASE_SECONDS = 300;
export const BATCH_SIZE = 100;

export function replyTo(): string {
  return process.env.EMAIL_REPLY_TO?.trim() || "info@royalecinemajoplin.com";
}

// How far ahead a run hands email over with scheduled_at (so a once-a-day
// cron still lands Tuesday's lineup at 10:30 exactly).
export function scheduleAheadMs(): number {
  const h = Number(process.env.EMAIL_SCHEDULE_AHEAD_HOURS);
  return (Number.isFinite(h) && h >= 0 ? Math.min(h, 60) : 24) * 3_600_000;
}

export interface SenderStatus {
  from: string | null;
  ready: boolean;
  problem: string | null;
}

// A list email has to come from a domain verified in Resend, so the test
// sender (onboarding@resend.dev) won't do.
export function senderStatus(): SenderStatus {
  const from = process.env.EMAIL_FROM?.trim() || null;
  if (!process.env.RESEND_API_KEY) return { from, ready: false, problem: "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel." };
  if (!from) return { from, ready: false, problem: "EMAIL_FROM isn't set in Vercel, so there's no sender for the list." };
  if (/@resend\.dev>?\s*$/i.test(from)) return { from, ready: false, problem: "EMAIL_FROM is still Resend's test address. It has to be an address at royalecinemajoplin.com once the domain is verified." };
  return { from, ready: true, problem: null };
}

// The kill switch and everything else that must be true before a list send.
export function sendingGate(): { ok: true } | { ok: false; reason: string } {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") return { ok: false, reason: "Sending to lists is switched off (EMAIL_SENDING_ENABLED isn't \"true\" in Vercel). Turn it on once the go-live checklist passes." };
  const s = senderStatus();
  if (!s.ready) return { ok: false, reason: s.problem ?? "The sender isn't set up." };
  if (!emailTokensReady()) return { ok: false, reason: "EMAIL_TOKEN_SECRET isn't set, so emails can't carry a working unsubscribe link." };
  return { ok: true };
}

// ---------- guardrails ----------
export const GUARDRAIL = { minDelivered: 300, complaintRate: 0.003, hardBounceRate: 0.05, windowHours: 24 };

export interface GuardrailStatus {
  delivered: number;
  complaints: number;
  hardBounces: number;
  tripped: boolean;
  reason: string | null;
}

export function guardrailVerdict(delivered: number, complaints: number, hardBounces: number): string | null {
  if (delivered < GUARDRAIL.minDelivered) return null;
  if (complaints / delivered > GUARDRAIL.complaintRate) return `Spam complaints hit ${((complaints / delivered) * 100).toFixed(2)}% in the last 24 hours (limit 0.3%).`;
  if (hardBounces / delivered > GUARDRAIL.hardBounceRate) return `Hard bounces hit ${((hardBounces / delivered) * 100).toFixed(1)}% in the last 24 hours (limit 5%).`;
  return null;
}

export async function guardrailStatus(now = new Date()): Promise<GuardrailStatus> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - GUARDRAIL.windowHours * 3_600_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error("Couldn't check the complaint rate.");
    return n ?? 0;
  };
  const [delivered, complaints, hardBounces] = await Promise.all([
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("delivered_at", since)),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("complained_at", since)),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("bounced_at", since).eq("bounce_type", "Permanent")),
  ]);
  const reason = guardrailVerdict(delivered, complaints, hardBounces);
  return { delivered, complaints, hardBounces, tripped: !!reason, reason };
}

export async function guardrailPause(): Promise<{ at: string; reason: string } | null> {
  const { data } = await createAdminClient().from("email_settings").select("value").eq("key", "guardrail_pause").maybeSingle();
  const v = data?.value as { at?: string; reason?: string } | undefined;
  return v?.at ? { at: v.at, reason: v.reason ?? "" } : null;
}

// Checked before every run and after every webhook batch: over the line,
// every scheduled campaign pauses and nothing goes to a list until an
// admin resumes it.
export async function enforceGuardrails(now = new Date()): Promise<GuardrailStatus> {
  const g = await guardrailStatus(now);
  if (!g.tripped) return g;
  const admin = createAdminClient();
  if (!(await guardrailPause())) {
    await admin.from("email_settings").upsert({ key: "guardrail_pause", value: { at: now.toISOString(), reason: g.reason }, updated_at: now.toISOString() }, { onConflict: "key" });
  }
  await admin
    .from("email_campaigns")
    .update({ status: "paused", error: `Guardrail: ${g.reason} An admin needs to look before anything else goes out.`, updated_at: now.toISOString() })
    .in("status", ["scheduled", "sending"]);
  return g;
}

// ---------- the lease ----------
export async function claimCampaign(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("email_claim_campaign", { p_campaign: id, p_seconds: LEASE_SECONDS });
  return !error && data === true;
}

// Runs whose lease ran out go back to the queue.
export async function settleStuck(now = new Date()): Promise<void> {
  const admin = createAdminClient();
  const iso = now.toISOString();
  await admin.from("email_campaigns").update({ status: "scheduled", locked_until: null, updated_at: iso }).eq("status", "sending").lt("locked_until", iso);
  await admin.from("email_campaigns").update({ locked_until: null }).eq("kind", "automation").lt("locked_until", iso);
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const { data } = await createAdminClient().from("email_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  return (data as CampaignRow | null) ?? null;
}

// ---------- links ----------
const SAMPLE: Recipient = { firstName: "Sam", consentSource: "unknown", tier: "Insiders", hasLogin: false, email: null, claimUrl: null };

// Every link in the email gets an index for first-party click tracking
// (/e/<send>/<i>). The list only ever grows, so a link in an email that
// already went out keeps pointing where it did.
export function freezeLinks(c: CampaignInput, data: RenderData, existing: FrozenLink[]): FrozenLink[] {
  const out = [...existing];
  const known = new Set(out.map((l) => l.url));
  const collect: RenderLinks = {
    preferencesUrl: `${SITE_URL}/email/preferences`,
    unsubscribeUrl: `${SITE_URL}/email/preferences#all`,
    href: (url, label) => {
      if (!known.has(url)) {
        known.add(url);
        out.push({ i: out.length, url, label: label.slice(0, 120) });
      }
      return url;
    },
  };
  renderCampaign(c, data, SAMPLE, collect);
  return out;
}

export function trackedLinks(links: FrozenLink[], sendId: string | null): (url: string) => string {
  const idx = new Map(links.map((l) => [l.url, l.i]));
  return (url) => (sendId && idx.has(url) ? `${SITE_URL}/e/${sendId}/${idx.get(url)}` : url);
}

export function asInput(c: Pick<CampaignRow, "kind" | "category" | "subject" | "preheader" | "content">): CampaignInput {
  return { kind: c.kind, category: c.category, subject: c.subject, preheader: c.preheader, content: c.content ?? { blocks: [] } };
}

// ---------- lint ----------
export async function lintStored(c: CampaignInput, data?: RenderData): Promise<LintResult & { recipientPreview: string }> {
  const d = data ?? (await loadRenderData(c.content));
  const r = renderCampaign(c, d, SAMPLE, { preferencesUrl: "#", unsubscribeUrl: "#", href: (u) => u });
  const [titles, unknown] = await Promise.all([restrictedTitles(), unknownHouseEventIds(c.content)]);
  const result = lintCampaign({
    subject: r.subject,
    preheader: r.preheader,
    bodyTexts: r.meta.bodyTexts,
    primaryButtons: r.meta.primaryButtons,
    plainFilmTitles: [],
    restrictedTitles: titles,
    htmlBytes: new TextEncoder().encode(r.html).length,
    unknownEventIds: unknown,
  });
  // Stored film cards for archive titles are rendered in the archive
  // section anyway; still flag them so the block gets moved.
  for (const f of r.meta.plainFilms) if (f.archive) result.warnings.push(`"${f.title}" is an archive title in a film card. It's shown in the members-only section instead; use that block.`);
  if (!c.content.blocks?.length) result.errors.push("The email is empty.");
  return { ...result, recipientPreview: r.subject };
}

// ---------- preparing a run ----------
// Works out who gets a one-off campaign (the first time only), saves them
// as queued sends, and freezes the links.
export async function prepareCampaign(c: CampaignRow, data: RenderData, now = new Date()): Promise<CampaignRow> {
  const admin = createAdminClient();
  const patch: Partial<CampaignRow> = {};
  if (c.kind !== "automation" && c.recipients === null) {
    const planned = c.scheduled_for && Date.parse(c.scheduled_for) > now.getTime() ? new Date(c.scheduled_for) : now;
    const at = nextSendSlot(planned);
    const resolved = await resolveAudience({ ...shapeOf(c), audience: c.audience ?? { include: [{ r: "all" }] }, holdoutPct: c.holdout_pct }, { at, now });
    await queueSends(c.id, resolved, at);
    patch.recipients = resolved.willSend;
    patch.held_out = resolved.heldOut;
    patch.excluded = resolved.excluded;
  }
  const links = freezeLinks(asInput(c), data, c.links ?? []);
  if (links.length !== (c.links ?? []).length) patch.links = links;
  const archive = renderCampaign(asInput(c), data, SAMPLE, { preferencesUrl: "#", unsubscribeUrl: "#", href: (u) => u }).meta.containsArchive;
  if (archive !== c.contains_archive) patch.contains_archive = archive;
  if (Object.keys(patch).length) {
    const { error } = await admin
      .from("email_campaigns")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) throw new Error("Couldn't save who it's going to.");
  }
  return { ...c, ...patch };
}

// ---------- one batch ----------
interface QueuedRow {
  id: string;
  member_id: string | null;
  deliver_at: string | null;
  batch_no: number | null;
  created_at: string;
}

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  tier: string;
  auth_user_id: string | null;
  email_opt_in: boolean | null;
  erased_at: string | null;
}

interface PrefsRow {
  member_id: string;
  lineup: boolean;
  alerts: boolean;
  events: boolean;
  offers: boolean;
  rewards: boolean;
  paused_until: string | null;
  consent_source: ConsentSource;
  engagement: string;
}

// Anyone who opted out, paused, turned this category off, went quiet or
// landed on the never-mail list since they were queued comes off here.
function stillWanted(c: CampaignRow, m: MemberRow | undefined, p: PrefsRow | undefined, suppressed: boolean, now: Date): { ok: true } | { ok: false; status: "cancelled" | "suppressed"; why: string } {
  if (!m || m.erased_at || !m.email) return { ok: false, status: "cancelled", why: "No address anymore" };
  if (m.email_opt_in === false) return { ok: false, status: "cancelled", why: "Unsubscribed before it went" };
  if (suppressed) return { ok: false, status: "suppressed", why: "On the never-mail list" };
  if (!looksDeliverable(m.email)) return { ok: false, status: "cancelled", why: "Address doesn't look deliverable" };
  if (p) {
    if (c.category !== "account" && p[c.category as PrefCategory] === false) return { ok: false, status: "cancelled", why: "Turned this kind of email off" };
    if (p.paused_until && Date.parse(p.paused_until) > now.getTime()) return { ok: false, status: "cancelled", why: "Paused" };
    if (p.engagement === "dormant" && c.kind !== "reconfirm") return { ok: false, status: "cancelled", why: "Gone quiet" };
  }
  return { ok: true };
}

async function ticketSpend(memberIds: string[]): Promise<Map<string, { n: number; spend: number }>> {
  const out = new Map<string, { n: number; spend: number }>();
  if (!memberIds.length) return out;
  const { data } = await createAdminClient()
    .from("bookings")
    .select("member_id, quantity, unit_price")
    .in("member_id", memberIds)
    .eq("status", "confirmed")
    .gt("unit_price", 0)
    .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  for (const b of data ?? []) {
    const cur = out.get(b.member_id) ?? { n: 0, spend: 0 };
    cur.n += Number(b.quantity) || 0;
    cur.spend += (Number(b.quantity) || 0) * (Number(b.unit_price) || 0);
    out.set(b.member_id, cur);
  }
  return out;
}

export interface DeliverResult {
  submitted: number;
  cancelled: number;
  batches: number;
  done: boolean; // nothing left queued for this campaign
  error: string | null;
}

// Hands this campaign's queued sends to Resend, 100 at a time, until none
// are left, the deadline comes, or Resend refuses.
export async function deliverQueued(c: CampaignRow, data: RenderData, deadline: number, now = new Date()): Promise<DeliverResult> {
  const admin = createAdminClient();
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const result: DeliverResult = { submitted: 0, cancelled: 0, batches: 0, done: false, error: null };
  const href = (sendId: string) => trackedLinks(c.links ?? [], sendId);
  const input = asInput(c);
  const needsSpend = (c.content?.blocks ?? []).some((b) => b.t === "ticketSpend");
  const needsClaim = (c.content?.blocks ?? []).some((b) => b.t === "claim");
  const horizon = new Date(now.getTime() + scheduleAheadMs()).toISOString();
  let failures = 0;

  while (Date.now() < deadline) {
    // A batch that was numbered but never confirmed (a crash, a timeout)
    // goes again first, with the same key.
    let rows: QueuedRow[] = [];
    const { data: stuck } = await admin
      .from("email_sends")
      .select("id, member_id, deliver_at, batch_no, created_at")
      .eq("campaign_id", c.id)
      .eq("status", "queued")
      .not("batch_no", "is", null)
      .order("batch_no")
      .order("id")
      .limit(BATCH_SIZE);
    if (stuck?.length) {
      const first = stuck[0].batch_no;
      rows = (stuck as QueuedRow[]).filter((r) => r.batch_no === first);
    } else {
      const { data: fresh, error } = await admin
        .from("email_sends")
        .select("id, member_id, deliver_at, batch_no, created_at")
        .eq("campaign_id", c.id)
        .eq("status", "queued")
        .is("batch_no", null)
        .or(`deliver_at.is.null,deliver_at.lte."${horizon}"`)
        .order("id")
        .limit(BATCH_SIZE);
      if (error) {
        result.error = "Couldn't read the queue.";
        break;
      }
      if (!fresh?.length) {
        const { count } = await admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
        result.done = (count ?? 0) === 0;
        break;
      }
      const { data: top } = await admin.from("email_sends").select("batch_no").eq("campaign_id", c.id).not("batch_no", "is", null).order("batch_no", { ascending: false }).limit(1);
      const batchNo = (top?.[0]?.batch_no ?? 0) + 1;
      const { data: numbered } = await admin
        .from("email_sends")
        .update({ batch_no: batchNo })
        .in(
          "id",
          fresh.map((r) => r.id),
        )
        .is("batch_no", null)
        .eq("status", "queued")
        .select("id, member_id, deliver_at, batch_no, created_at");
      rows = ((numbered ?? []) as QueuedRow[]).sort((a, b) => a.id.localeCompare(b.id));
      if (!rows.length) continue;
    }
    const batchNo = rows[0].batch_no as number;

    // Who they are now.
    const ids = rows.map((r) => r.member_id).filter((x): x is string => !!x);
    const [{ data: members }, { data: prefs }] = await Promise.all([
      admin.from("members").select("id, name, email, tier, auth_user_id, email_opt_in, erased_at").in("id", ids),
      admin.from("member_email_prefs").select("member_id, lineup, alerts, events, offers, rewards, paused_until, consent_source, engagement").in("member_id", ids),
    ]);
    const byId = new Map(((members ?? []) as MemberRow[]).map((m) => [m.id, m]));
    const prefById = new Map(((prefs ?? []) as PrefsRow[]).map((p) => [p.member_id, p]));
    const hashes = [...byId.values()].filter((m) => m.email).map((m) => hashEmail(m.email as string));
    const { data: sup } = hashes.length ? await admin.from("email_suppressions").select("email_hash").in("email_hash", hashes) : { data: [] as { email_hash: string }[] };
    const suppressed = new Set((sup ?? []).map((s) => s.email_hash));
    const [spend, claims] = await Promise.all([
      needsSpend ? ticketSpend(ids) : Promise.resolve(new Map<string, { n: number; spend: number }>()),
      needsClaim ? issueEmailClaimLinks(rows.filter((r) => r.member_id).map((r) => ({ memberId: r.member_id as string, sendId: r.id, queuedAt: r.created_at }))) : Promise.resolve(new Map<string, string>()),
    ]);

    const items: OutgoingEmail[] = [];
    const itemRows: QueuedRow[] = [];
    for (const r of rows) {
      const m = r.member_id ? byId.get(r.member_id) : undefined;
      const p = r.member_id ? prefById.get(r.member_id) : undefined;
      const verdict = stillWanted(c, m, p, !!m?.email && suppressed.has(hashEmail(m.email)), now);
      if (!verdict.ok) {
        await admin.from("email_sends").update({ status: verdict.status, error: verdict.why }).eq("id", r.id).eq("status", "queued");
        result.cancelled++;
        continue;
      }
      const member = m as MemberRow;
      const token = sealEmailToken({ memberId: member.id, sendId: r.id });
      if (!token) {
        result.error = "EMAIL_TOKEN_SECRET isn't set, so there's no unsubscribe link. Nothing more was sent.";
        return result;
      }
      const s = spend.get(member.id);
      const recipient: Recipient = {
        firstName: firstNameOf(member.name),
        consentSource: p?.consent_source ?? "unknown",
        tier: member.tier,
        hasLogin: !!member.auth_user_id,
        email: member.email,
        claimUrl: claims.get(member.id) ?? null,
        ticketSpend30: s?.spend ?? 0,
        paidTickets30: s?.n ?? 0,
      };
      const track = href(r.id);
      const rendered = renderCampaign(input, data, recipient, {
        preferencesUrl: preferencesUrl(token),
        unsubscribeUrl: preferencesUrl(token, "all"),
        href: (url) => track(url),
      });
      const later = r.deliver_at && Date.parse(r.deliver_at) > now.getTime() + 60_000 ? new Date(r.deliver_at).toISOString() : undefined;
      items.push({
        from,
        to: [(member.email as string).trim()],
        reply_to: replyTo(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: listUnsubscribeHeaders(token),
        tags: [
          { name: "campaign", value: c.id },
          { name: "send", value: r.id },
          { name: "kind", value: c.automation ?? c.kind },
        ],
        ...(later ? { scheduled_at: later } : {}),
      });
      itemRows.push(r);
    }
    if (!items.length) continue;

    const sent = await deliver(items, `${c.id}:${batchNo}`);
    const at = new Date().toISOString();
    if (sent.ok) {
      const marks = itemRows.map((r, i) => ({
        id: r.id,
        resend_email_id: sent.data[i] || null,
        status: items[i].scheduled_at ? "scheduled" : "submitted",
        submitted_at: at,
        deliver_at: items[i].scheduled_at ?? at,
        error: null,
      }));
      const { error } = await admin.rpc("email_mark_submitted", { p_rows: marks });
      if (error) {
        // Resend has them; the next run re-sends the same batch under the
        // same key and Resend answers with the same ids, without sending.
        result.error = "Resend took a batch but saving the result failed. The next run finishes it (nothing is sent twice).";
        return result;
      }
      result.submitted += items.length;
      result.batches++;
      failures = 0;
      continue;
    }
    if (sent.status === 409 && sent.name === "invalid_idempotent_request") {
      // Resend already took this batch number earlier with slightly
      // different content (data changed between the two tries). It went;
      // we just don't have the ids. Webhooks still find them by tag.
      const marks = itemRows.map((r) => ({ id: r.id, resend_email_id: null, status: "submitted", submitted_at: at, deliver_at: r.deliver_at ?? at, error: "Handed over earlier; Resend's id wasn't saved." }));
      await admin.rpc("email_mark_submitted", { p_rows: marks });
      result.submitted += items.length;
      continue;
    }
    failures++;
    const retryable = sent.status === 0 || sent.status >= 500 || (sent.status === 429 && sent.name !== "daily_quota_exceeded" && sent.name !== "monthly_quota_exceeded");
    if (!retryable || failures >= 3) {
      result.error = `Resend didn't accept batch ${batchNo}: ${sent.error}`;
      return result;
    }
  }
  return result;
}

// ---------- a whole run ----------
export interface RunResult {
  id: string;
  name: string;
  ran: boolean;
  submitted: number;
  cancelled: number;
  status: string;
  note: string | null;
}

// One campaign, start to finish (or until the deadline). The dispatcher
// (dispatch.ts) and "Send now" both come through here.
export async function runCampaign(id: string, deadline: number, now = new Date()): Promise<RunResult> {
  const admin = createAdminClient();
  const first = await getCampaign(id);
  if (!first) return { id, name: "?", ran: false, submitted: 0, cancelled: 0, status: "missing", note: "No such campaign." };
  const gate = sendingGate();
  if (!gate.ok) {
    if (first.kind !== "automation" && first.error !== gate.reason) await admin.from("email_campaigns").update({ error: gate.reason }).eq("id", id).eq("status", "scheduled");
    return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: gate.reason };
  }
  if (await guardrailPause()) return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: "Paused by a guardrail." };
  if (!(await claimCampaign(id))) return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: "Another run has it." };

  let c = (await getCampaign(id)) as CampaignRow;
  try {
    const data = await loadRenderData(c.content ?? { blocks: [] });
    c = await prepareCampaign(c, data, now);
    const r = await deliverQueued(c, data, deadline, now);
    const iso = new Date().toISOString();
    let status: string = c.status;
    if (c.kind === "automation") {
      await admin.from("email_campaigns").update({ locked_until: null, error: r.error, updated_at: iso }).eq("id", id);
    } else if (r.error) {
      status = "paused";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: r.error, updated_at: iso }).eq("id", id).eq("status", "sending");
    } else if (r.done) {
      status = "sent";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: null, sent_at: iso, updated_at: iso }).eq("id", id).eq("status", "sending");
    } else {
      status = "scheduled";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: null, updated_at: iso }).eq("id", id).eq("status", "sending");
    }
    return { id, name: c.name, ran: true, submitted: r.submitted, cancelled: r.cancelled, status, note: r.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    await admin
      .from("email_campaigns")
      .update(c.kind === "automation" ? { locked_until: null, error: msg } : { status: "scheduled", locked_until: null, error: msg })
      .eq("id", id);
    return { id, name: c.name, ran: true, submitted: 0, cancelled: 0, status: c.kind === "automation" ? c.status : "scheduled", note: msg };
  }
}

// ---------- tests ----------
// "Send a test to me": the same email, rendered on the server from the
// stored campaign, to the staff member's own login address (and the seed
// inboxes in EMAIL_SEED_LIST, never an address typed in the browser).
// If their login is also a member, the test carries their real
// unsubscribe link and one-click header, so the round trip can be tried.
export async function sendTestEmail(c: CampaignInput, to: { email: string; name: string }, opts: { seeds: boolean }): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel." };
  const data = await loadRenderData(c.content);
  const addresses = [to.email, ...(opts.seeds ? seedList() : [])].filter((e, i, a) => looksDeliverable(e) && a.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
  if (!addresses.length) return { ok: false, error: "Your login has no email address to send the test to." };
  let sent = 0;
  let lastError: string | null = null;
  for (const addr of addresses) {
    const facts = await memberForAddress(addr);
    const token = facts ? sealEmailToken({ memberId: facts.id, sendId: null }) : null;
    const prefs = token ? preferencesUrl(token) : `${SITE_URL}/account/email`;
    const unsub = token ? preferencesUrl(token, "all") : `${SITE_URL}/account/email#all`;
    const recipient: Recipient = {
      firstName: firstNameOf(facts?.name ?? to.name),
      consentSource: "unknown",
      tier: facts?.tier ?? "Insiders",
      hasLogin: !!facts?.auth_user_id,
      email: addr,
      claimUrl: null,
      ticketSpend30: 24,
      paidTickets30: 3,
    };
    const r = renderCampaign(c, data, recipient, { preferencesUrl: prefs, unsubscribeUrl: unsub, href: (u) => u });
    const res = await sendEmail(addr, `[Test] ${r.subject}`, r.html, {
      text: r.text,
      replyTo: replyTo(),
      headers: token ? listUnsubscribeHeaders(token) : undefined,
      tags: [{ name: "kind", value: "test" }],
    });
    if (res.ok) sent++;
    else lastError = res.error;
  }
  return sent ? { ok: true, sentTo: sent } : { ok: false, error: lastError ?? "Couldn't send the test." };
}

export function seedList(): string[] {
  return (process.env.EMAIL_SEED_LIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => looksDeliverable(s))
    .slice(0, 8);
}

async function memberForAddress(email: string): Promise<{ id: string; name: string; tier: string; auth_user_id: string | null } | null> {
  const { data } = await createAdminClient()
    .from("members")
    .select("id, name, tier, auth_user_id")
    .ilike("email", email.trim().replace(/[\\%_]/g, (x) => "\\" + x))
    .is("erased_at", null)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// For the composer's dry-run count (no writes).
export async function dryRun(c: Pick<CampaignRow, "id" | "kind" | "category" | "automation" | "content" | "audience" | "holdout_pct">, at: Date) {
  const facts = await loadFacts();
  return resolveAudience({ ...shapeOf(c), audience: c.audience, holdoutPct: c.holdout_pct }, { at, facts });
}
