import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_COLUMNS, outcomeWindowDays, type CampaignRow } from "./campaign";
import { loadFacts } from "./audience";
import { guardrailPause, guardrailStatus, recallRunning, senderStatus, sendingGate, waitingAtResend, type GuardrailStatus } from "./campaign-send";
import { hardFilter } from "./rules";
import type { ConsentSource } from "./types";

// The numbers on Back office -> Email. Counts only: who got what, person by
// person, lives on each member's own page.

// PostgREST puts .in() lists in the request address; 150 ids keeps it well
// under the gateway's limit.
const IN_CHUNK = 150;

export interface Outcome {
  grp: "sent" | "held_out";
  recipients: number;
  delivered: number;
  clickers: number;
  came_in: number;
  came_in_after_click: number;
  tickets: number;
  tickets_after_click: number;
  ticket_revenue: number; // online tickets (register tickets are in order_total)
  order_total: number; // register orders, minus tips and what trivia vouchers paid
  voucher_total: number; // what trivia vouchers paid (prizes, no money in)
  now_plus: number;
  unsubscribes: number;
  complaints: number;
}

export interface CampaignSummary {
  campaign: CampaignRow;
  sent: Outcome | null;
  heldOut: Outcome | null;
  windowDays: number;
  opened: number;
  hardBounces: number;
}

export async function campaignOutcomes(c: CampaignRow): Promise<{ sent: Outcome | null; heldOut: Outcome | null; windowDays: number }> {
  const windowDays = outcomeWindowDays(c);
  const { data, error } = await createAdminClient().rpc("email_campaign_outcomes", { p_campaign: c.id, p_days: windowDays });
  if (error) return { sent: null, heldOut: null, windowDays };
  const rows = ((data ?? []) as Outcome[]).map((r) => ({ ...r, ticket_revenue: Number(r.ticket_revenue) || 0, order_total: Number(r.order_total) || 0, voucher_total: Number(r.voucher_total) || 0 }));
  return { sent: rows.find((r) => r.grp === "sent") ?? null, heldOut: rows.find((r) => r.grp === "held_out") ?? null, windowDays };
}

export async function summarize(c: CampaignRow): Promise<CampaignSummary> {
  const admin = createAdminClient();
  const [o, opened, hardBounces] = await Promise.all([
    campaignOutcomes(c),
    admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).not("first_opened_at", "is", null),
    admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("bounce_type", "Permanent"),
  ]);
  return { campaign: c, ...o, opened: opened.count ?? 0, hardBounces: hardBounces.count ?? 0 };
}

export type PausedEmail = { id: string; name: string; error: string | null };

export interface Overview {
  mailable: number;
  onList: number;
  joined30: number;
  left30: number;
  paused: number;
  dormant: number;
  suppressed: number;
  byConsent: Partial<Record<ConsentSource, number>>;
  next: CampaignRow | null;
  drafts: CampaignRow[];
  recent: CampaignSummary[];
  guardrail: GuardrailStatus | null;
  paused_by_guardrail: { at: string; reason: string; by: "Guardrail" | "Stopped" } | null;
  waitingAtResend: number; // handed to Resend with scheduled_at, not yet due
  recallRunning: boolean; // calling that back right now (in the background)
  pausedEmails: PausedEmail[]; // one-off emails waiting for an admin
  rates30: { delivered: number; complaints: number; hardBounces: number };
  lastWebhookAt: string | null;
  sender: ReturnType<typeof senderStatus>;
  gate: Awaited<ReturnType<typeof sendingGate>>;
}

export async function getOverview(): Promise<Overview> {
  const admin = createAdminClient();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const lineupShape = { id: "", kind: "lineup" as const, category: "lineup" as const, automation: null };

  const [facts, campaigns, left, delivered, complaints, hardBounces, lastHook, guardrail, pause, waiting, recalling, pausedRows] = await Promise.all([
    loadFacts().catch(() => []),
    admin.from("email_campaigns").select(CAMPAIGN_COLUMNS).is("automation", null).order("created_at", { ascending: false }).limit(40),
    admin.from("email_consent_log").select("id", { count: "exact", head: true }).eq("action", "opt_out").gte("at", since30),
    admin.from("email_sends").select("id", { count: "exact", head: true }).gte("delivered_at", since30),
    admin.from("email_sends").select("id", { count: "exact", head: true }).gte("complained_at", since30),
    admin.from("email_sends").select("id", { count: "exact", head: true }).gte("bounced_at", since30).eq("bounce_type", "Permanent"),
    admin.from("email_events").select("received_at").not("svix_id", "is", null).order("received_at", { ascending: false }).limit(1),
    guardrailStatus(now).catch(() => null),
    guardrailPause().catch(() => null),
    waitingAtResend().catch(() => 0),
    recallRunning().catch(() => false),
    admin.from("email_campaigns").select("id, name, error").is("automation", null).eq("status", "paused").order("updated_at", { ascending: false }).limit(10),
  ]);

  let mailable = 0;
  let onList = 0;
  let paused = 0;
  let dormant = 0;
  let suppressed = 0;
  let joined30 = 0;
  const byConsent: Partial<Record<ConsentSource, number>> = {};
  for (const f of facts) {
    if (f.emailOptIn) onList++;
    const why = hardFilter(f, lineupShape, now);
    if (why === "paused") paused++;
    if (why === "dormant") dormant++;
    if (why === "suppressed") suppressed++;
    if (!why || why === "pref_off") {
      mailable++;
      byConsent[f.consentSource] = (byConsent[f.consentSource] ?? 0) + 1;
    }
    if (!f.imported && f.emailOptIn && Date.parse(f.createdAt) > now.getTime() - 30 * 86_400_000) joined30++;
  }

  const rows = (campaigns.data ?? []) as CampaignRow[];
  const upcoming = rows.filter((c) => c.status === "scheduled").sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
  const recentRows = rows.filter((c) => ["sent", "sending", "paused"].includes(c.status) || (c.recipients ?? 0) > 0).slice(0, 10);
  const recent = await Promise.all(recentRows.map(summarize));

  return {
    mailable,
    onList,
    joined30,
    left30: left.count ?? 0,
    paused,
    dormant,
    suppressed,
    byConsent,
    next: upcoming[0] ?? null,
    drafts: rows.filter((c) => c.status === "draft").slice(0, 10),
    recent,
    guardrail,
    paused_by_guardrail: pause,
    waitingAtResend: waiting,
    recallRunning: recalling,
    pausedEmails: (pausedRows.data ?? []) as PausedEmail[],
    rates30: { delivered: delivered.count ?? 0, complaints: complaints.count ?? 0, hardBounces: hardBounces.count ?? 0 },
    lastWebhookAt: (lastHook.data?.[0]?.received_at as string | undefined) ?? null,
    sender: senderStatus(),
    gate: await sendingGate(),
  };
}

// ---------- one campaign in detail ----------
export interface CampaignDetail {
  summary: CampaignSummary;
  funnel: { queued: number; heldOut: number; submitted: number; waitingAtResend: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number; unsubscribed: number; cancelled: number; failed: number };
  topLinks: { i: number; label: string; url: string; clicks: number; people: number }[];
  byCohort: { cohort: string; sent: number; delivered: number; clicked: number }[];
  clicksByDay: { day: string; clicks: number }[];
  suspectClicks: number;
  waves: { at: string; n: number; delivered: number; hardBounces: number; complaints: number }[];
}

const COHORT: Record<string, string> = {
  indy_yes: "Said yes on Indy",
  old_site_import: "Old site only",
  join_form: "New (join form)",
  kiosk: "New (check-in screen)",
  checkout: "New (checkout)",
  claim: "Claimed account",
  account: "Chose on their account",
  staff: "Set by staff",
  indy_no: "Said no on Indy",
  unknown: "Not recorded",
};

export async function getCampaignDetail(c: CampaignRow): Promise<CampaignDetail> {
  const admin = createAdminClient();
  const sends: { id: string; member_id: string | null; status: string; deliver_at: string | null; delivered_at: string | null; first_opened_at: string | null; first_clicked_at: string | null; unsubscribed_at: string | null; complained_at: string | null; bounce_type: string | null; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("email_sends")
      .select("id, member_id, status, deliver_at, delivered_at, first_opened_at, first_clicked_at, unsubscribed_at, complained_at, bounce_type, created_at")
      .eq("campaign_id", c.id)
      .order("id")
      .range(from, from + 999);
    sends.push(...((data ?? []) as typeof sends));
    if ((data ?? []).length < 1000) break;
  }
  const funnel = { queued: 0, heldOut: 0, submitted: 0, waitingAtResend: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0, cancelled: 0, failed: 0 };
  const nowMs = Date.now();
  for (const s of sends) {
    if (s.status === "scheduled" && s.deliver_at && Date.parse(s.deliver_at) > nowMs) funnel.waitingAtResend++;
    if (s.status === "held_out") funnel.heldOut++;
    else if (s.status === "queued") funnel.queued++;
    else if (s.status === "cancelled" || s.status === "suppressed") funnel.cancelled++;
    else if (s.status === "failed") funnel.failed++;
    else funnel.submitted++;
    if (s.delivered_at) funnel.delivered++;
    if (s.first_opened_at) funnel.opened++;
    if (s.first_clicked_at) funnel.clicked++;
    if (s.status === "bounced") funnel.bounced++;
    if (s.complained_at) funnel.complained++;
    if (s.unsubscribed_at) funnel.unsubscribed++;
  }

  // Cohorts by where each person's yes came from (counts only). The ids
  // go in the request address, so 150 at a time keeps it short enough.
  const memberIds = [...new Set(sends.map((s) => s.member_id).filter((x): x is string => !!x))];
  const consent = new Map<string, string>();
  let cohortsKnown = true;
  for (let i = 0; i < memberIds.length; i += IN_CHUNK) {
    const { data, error } = await admin.from("member_email_prefs").select("member_id, consent_source").in("member_id", memberIds.slice(i, i + IN_CHUNK));
    if (error) cohortsKnown = false;
    for (const p of data ?? []) consent.set(p.member_id, p.consent_source);
  }
  const cohorts = new Map<string, { sent: number; delivered: number; clicked: number }>();
  for (const s of sends) {
    if (s.status === "held_out" || s.status === "cancelled" || s.status === "suppressed" || s.status === "queued") continue;
    const k = cohortsKnown ? (COHORT[consent.get(s.member_id ?? "") ?? "unknown"] ?? "Not recorded") : "Couldn't read";
    const cur = cohorts.get(k) ?? { sent: 0, delivered: 0, clicked: 0 };
    cur.sent++;
    if (s.delivered_at) cur.delivered++;
    if (s.first_clicked_at) cur.clicked++;
    cohorts.set(k, cur);
  }

  // This email's clicks, found through their send (a join, so no long list
  // of ids goes in the request address), a page at a time.
  const clicks: { send_id: string; link_index: number | null; occurred_at: string; suspect: boolean }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("email_events")
      .select("send_id, link_index, occurred_at, suspect, email_sends!inner(campaign_id)")
      .eq("type", "clicked")
      .eq("email_sends.campaign_id", c.id)
      .order("id")
      .range(from, from + 999);
    if (error) break;
    clicks.push(...((data ?? []) as unknown as typeof clicks));
    if ((data ?? []).length < 1000) break;
  }
  const byLink = new Map<number, { clicks: number; people: Set<string> }>();
  const byDay = new Map<string, number>();
  let suspectClicks = 0;
  for (const e of clicks) {
    if (e.suspect) {
      suspectClicks++;
      continue;
    }
    const l = byLink.get(e.link_index ?? -1) ?? { clicks: 0, people: new Set<string>() };
    l.clicks++;
    l.people.add(e.send_id);
    byLink.set(e.link_index ?? -1, l);
    const d = new Date(e.occurred_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const links = c.links ?? [];
  const topLinks = [...byLink.entries()]
    .map(([i, v]) => ({ i, label: links.find((l) => l.i === i)?.label ?? "?", url: links.find((l) => l.i === i)?.url ?? "", clicks: v.clicks, people: v.people.size }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 12);

  // Waves (the warm-up tool): sends grouped by when they were queued.
  const waveList = ((c.content as { waves?: { at: string; n: number }[] })?.waves ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const waves = waveList.map((w, i) => {
    const end = waveList[i + 1]?.at ?? "9999";
    const inWave = sends.filter((s) => s.created_at >= w.at && s.created_at < end && s.status !== "held_out");
    return {
      at: w.at,
      n: inWave.length,
      delivered: inWave.filter((s) => s.delivered_at).length,
      hardBounces: inWave.filter((s) => s.bounce_type === "Permanent").length,
      complaints: inWave.filter((s) => s.complained_at).length,
    };
  });

  return {
    summary: await summarize(c),
    funnel,
    topLinks,
    byCohort: [...cohorts.entries()].map(([cohort, v]) => ({ cohort, ...v })).sort((a, b) => b.sent - a.sent),
    clicksByDay: [...byDay.entries()].map(([day, n]) => ({ day, clicks: n })).sort((a, b) => a.day.localeCompare(b.day)),
    suspectClicks,
    waves,
  };
}

// The warm-up thresholds (A5): stop before the next wave if the last one
// had over 3% hard bounces or over 0.2% complaints.
export const WAVE_LIMITS = { hardBounce: 0.03, complaint: 0.002 };

export function waveProblem(w: { delivered: number; n: number; hardBounces: number; complaints: number } | undefined): string | null {
  if (!w || w.n === 0) return null;
  const base = Math.max(w.delivered, 1);
  if (w.hardBounces / w.n > WAVE_LIMITS.hardBounce) return `The last wave had ${((w.hardBounces / w.n) * 100).toFixed(1)}% hard bounces (limit 3%).`;
  if (w.complaints / base > WAVE_LIMITS.complaint) return `The last wave had ${((w.complaints / base) * 100).toFixed(2)}% spam complaints (limit 0.2%).`;
  return null;
}

// For the Today page (the merger wires it in): anything about email that
// needs a person.
export async function emailAttention(): Promise<{ tone: "danger" | "warn" | "info"; text: string; href: string }[]> {
  const out: { tone: "danger" | "warn" | "info"; text: string; href: string }[] = [];
  try {
    const admin = createAdminClient();
    const pause = await guardrailPause();
    if (pause) out.push({ tone: "danger", text: `Email sending is paused: ${pause.reason}`, href: "/admin/email" });
    const { data: drafts } = await admin.from("email_campaigns").select("id, lineup_start, content").eq("kind", "lineup").eq("status", "draft").not("lineup_start", "is", null).order("lineup_start").limit(3);
    for (const d of drafts ?? []) {
      if ((d.content as { autopilot?: boolean })?.autopilot) out.push({ tone: "warn", text: "Lineup draft ready: approve by Tue 10:00", href: `/admin/email/${d.id}` });
    }
    const { data: stuck } = await admin.from("email_campaigns").select("id, name").eq("status", "paused").limit(3);
    for (const s of stuck ?? []) out.push({ tone: "warn", text: `Email paused: ${s.name}`, href: `/admin/email/${s.id}` });
  } catch {
    // Quietly nothing: the Today page shouldn't break over email.
  }
  return out;
}

// Each automation's last 30 days: sent, delivered, clicked.
export async function automationStats(ids: string[], now = new Date()): Promise<{ sent: number; delivered: number; clicked: number }[]> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return Promise.all(
    ids.map(async (id) => {
      const [sent, delivered, clicked] = await Promise.all([
        admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", id).gte("created_at", since).neq("status", "held_out"),
        admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", id).gte("created_at", since).not("delivered_at", "is", null),
        admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", id).gte("created_at", since).not("first_clicked_at", "is", null),
      ]);
      return { sent: sent.count ?? 0, delivered: delivered.count ?? 0, clicked: clicked.count ?? 0 };
    }),
  );
}
