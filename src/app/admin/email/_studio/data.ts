import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_COLUMNS, type CampaignRow } from "@/lib/email/campaign";
import { designOf, renderCampaign, type CampaignContent, type Recipient } from "@/lib/email/render";
import { DESIGNS } from "@/lib/email/designs";
import { DESIGN_KEYS, type DesignKey } from "@/lib/email/designs/types";
import { countAudiences, designCampaign, designResults, type AudienceCount, type DesignResults } from "@/lib/email/designs/ready";
import { asInput, BRAKE_PREFIX, dryRun, guardrailPause, lastWave, lintStored, nextWaveAfter, recallRunning, sendingGate, waitingAtResend, waveDayWord } from "@/lib/email/campaign-send";
import type { CampaignSummary, PausedEmail } from "@/lib/email/reports";
import { nextSendSlot } from "@/lib/email/timing";
import { KIND_LABEL } from "@/lib/email/types";
import { whenLabel } from "@/lib/email/format";
import { SITE_URL } from "@/lib/site";
import { campaignTestKey, designTestKey, lastTestOf, testWhen, type LastTest, type TestLog } from "./tests-log";
import type { ChipTone, Step, Thumb } from "./ui";

// What the Email pages show, read-only: each email's thumbnail, the three
// ready-made emails' state, the campaign cards, the step tracks and the
// "Up next" pick. Nothing here sends or writes.

const n = (x: number) => x.toLocaleString("en-US");
const people = (x: number) => `${n(x)} ${x === 1 ? "member" : "members"}`;
const short = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const waveDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------- thumbnails ----------
// The headline's last word is the red one, as the ready-made designs set
// it ("The new Royale is here.": "here" is red).
function splitAccent(kicker: string, headline: string, lede: string | null, accent: boolean): Thumb {
  const m = accent ? /^(.*\S)\s+(\S+?)([.!?]*)$/.exec(headline.trim()) : null;
  return m ? { kicker, head: m[1], accent: m[2], tail: m[3], lede } : { kicker, head: headline.trim(), accent: null, tail: "", lede };
}

const SAMPLE: Recipient = {
  firstName: "Sam",
  consentSource: "unknown",
  tier: "Insiders",
  hasLogin: false,
  email: null,
  claimUrl: null,
  sample: true,
  artToken: null,
  fromOldSite: true,
  sendId: null,
  finishUrl: null,
};
const NO_DATA = { range: { start: "", days: 7 }, films: [], happenings: [], menuItems: [] };
const LINKS = { preferencesUrl: `${SITE_URL}/account/email`, unsubscribeUrl: `${SITE_URL}/account/email#all`, href: (u: string) => u };

export interface DesignLook {
  thumb: Thumb;
  subject: string; // as Sam would see it
  preheader: string;
}

// A ready-made email's top, from the design itself: its plain text starts
// with the hero's label, and its first words are the headline and the line
// under it (lib/email/designs/*.ts hero()).
// The designs are fixed in the code, so each is drawn once per server.
const looks = new Map<DesignKey, DesignLook>();
export function designLook(key: DesignKey): DesignLook {
  const known = looks.get(key);
  if (known) return known;
  const look = drawLook(key);
  looks.set(key, look);
  return look;
}

function drawLook(key: DesignKey): DesignLook {
  const d = DESIGNS[key];
  const out = renderCampaign({ kind: d.kind, category: d.category, subject: d.subject, preheader: d.preheader, content: { blocks: [{ t: "design", key }] } }, NO_DATA, SAMPLE, LINKS);
  const kicker = out.text.split("\n")[0]?.trim() || d.title.toUpperCase();
  const [head = d.title, lede = null] = out.meta.bodyTexts;
  return { thumb: splitAccent(kicker, head, lede || null, true), subject: out.subject, preheader: out.preheader };
}

// A written email's top: its first headline panel, or its kind and subject.
export function campaignThumb(c: Pick<CampaignRow, "kind" | "name" | "subject" | "content">): Thumb {
  const key = designOf(c.content);
  if (key) return designLook(key).thumb;
  const hero = (c.content?.blocks ?? []).find((b): b is Extract<CampaignContent["blocks"][number], { t: "hero" }> => b.t === "hero");
  const head = hero?.headline?.trim() || c.subject?.trim() || c.name;
  return splitAccent(hero?.eyebrow?.trim() || KIND_LABEL[c.kind], head.replace(/\{first name\},?\s*/gi, ""), hero?.sub?.trim() || null, false);
}

// ---------- sending, in a few words ----------
export interface SendingState {
  gate: { ok: true } | { ok: false; reason: string };
  pause: { at: string; reason: string; by: "Guardrail" | "Stopped" } | null;
  waitingAtResend: number;
  recallRunning: boolean;
  pausedEmails: PausedEmail[];
}

// For the tabs that don't load the whole overview (Campaigns, Settings).
export async function sendingState(): Promise<SendingState> {
  const [gate, pause, waiting, recalling, paused] = await Promise.all([
    sendingGate(),
    guardrailPause().catch(() => null),
    waitingAtResend().catch(() => 0),
    recallRunning().catch(() => false),
    createAdminClient().from("email_campaigns").select("id, name, error").is("automation", null).eq("status", "paused").order("updated_at", { ascending: false }).limit(10),
  ]);
  return { gate, pause, waitingAtResend: waiting, recallRunning: recalling, pausedEmails: (paused.data ?? []) as PausedEmail[] };
}

// How many automations are switched on (they send by themselves).
export async function automationsOn(): Promise<number> {
  const { count } = await createAdminClient().from("email_campaigns").select("id", { count: "exact", head: true }).not("automation", "is", null).eq("status", "active");
  return count ?? 0;
}

// ---------- the three ready-made emails ----------
export interface DesignState {
  key: DesignKey;
  title: string;
  who: string;
  outcomeLabel: string;
  look: DesignLook;
  row: CampaignRow | null;
  results: DesignResults | null;
  count: AudienceCount | null; // null: couldn't count just now
  status: "new" | "going" | "paused" | "sent" | "failed";
  brake: boolean;
  nextWaveOn: string | null; // a wave went today: the next can go "tomorrow"
  lastTest: LastTest | null;
  sent: number;
  left: number; // still to get it (would get it now, plus queued)
}

export async function designStates(opts: { now: Date; firstWave: number; tests: TestLog; me: string }): Promise<DesignState[]> {
  const rows = Object.fromEntries(await Promise.all(DESIGN_KEYS.map(async (k) => [k, await designCampaign(k).catch(() => null)] as const))) as Record<DesignKey, CampaignRow | null>;
  const [counts, extra] = await Promise.all([
    countAudiences(rows, opts.now, opts.firstWave).catch(() => null),
    Promise.all(
      DESIGN_KEYS.map(async (k) => {
        const c = rows[k];
        if (!c) return { results: null, next: null };
        const [results, wave] = await Promise.all([designResults(c, k).catch(() => null), lastWave(c.id).catch(() => null)]);
        return { results, next: nextWaveAfter(wave, opts.now) };
      }),
    ),
  ]);
  return DESIGN_KEYS.map((key, i) => {
    const d = DESIGNS[key];
    const c = rows[key];
    const { results, next } = extra[i];
    const count = counts?.[key] ?? null;
    const status: DesignState["status"] = !c ? "new" : c.status === "scheduled" || c.status === "sending" ? "going" : c.status === "paused" ? "paused" : c.status === "sent" ? "sent" : "failed";
    return {
      key,
      title: d.title,
      who: d.who,
      outcomeLabel: d.outcome.label,
      look: designLook(key),
      row: c,
      results,
      count,
      status,
      brake: status === "paused" && !!c?.error?.startsWith(BRAKE_PREFIX),
      nextWaveOn: next ? waveDayWord(next, opts.now) : null,
      lastTest: lastTestOf(opts.tests, designTestKey(key), opts.me),
      sent: results?.sent ?? 0,
      left: (count?.willSend ?? 0) + (results?.waiting ?? 0),
    };
  });
}

// ---------- step tracks ----------
type Raw = { label: string; sub: string; state: "done" | "attention" | "tip" | "open" };

// The first open step is where the email is ("You're here"); later open
// ones are "Not yet". A step that needs a look says so wherever it is.
function settle(raw: Raw[]): Step[] {
  const first = raw.findIndex((s) => s.state === "open" || s.state === "attention");
  return raw.map((s, i) => ({ label: s.label, sub: s.sub, state: s.state === "open" ? (i === first ? "current" : "todo") : s.state }));
}

function testStep(t: LastTest | null, started: boolean, now: Date): Raw {
  if (t) return { label: "Tested on my phone", sub: `${t.who}, ${testWhen(t.at, now)}`, state: "done" };
  // Sent before tests were noted down: there may well have been one.
  if (started) return { label: "Tested on my phone", sub: "No test on record", state: "tip" };
  return { label: "Tested on my phone", sub: "Send yourself a test", state: "open" };
}

export function designSteps(d: DesignState, o: { firstWave: number; perDay: number; picturesReady: boolean; auto: boolean; now: Date }): Step[] {
  const waves = d.results?.waves ?? [];
  const started = waves.length > 0 && d.status !== "new";
  const w1 = waves[0];
  const raw: Raw[] = [
    o.picturesReady ? { label: "Looked over", sub: "Checked for you", state: "done" } : { label: "Looked over", sub: "The pictures aren't up yet", state: "attention" },
    testStep(d.lastTest, started, o.now),
    started && w1 ? { label: `First ${n(o.firstWave)}`, sub: `${n(w1.sent)} sent ${waveDay(w1.day)}`, state: "done" } : { label: `First ${n(o.firstWave)}`, sub: "Most regular first", state: "open" },
    !started
      ? { label: "See how they liked it", sub: "The next day", state: "open" }
      : d.brake
        ? { label: "See how they liked it", sub: "The brake stopped it", state: "attention" }
        : d.status === "sent" || waves.length > 1
          ? { label: "See how they liked it", sub: w1 ? `Wave 1: ${n(w1.clicked)} tapped a link` : "Done", state: "done" }
          : { label: "See how they liked it", sub: d.status === "paused" ? "Paused" : d.nextWaveOn ? `Next wave ${d.nextWaveOn}` : "Wave 1's results are in", state: "open" },
    d.status === "sent" && d.left === 0
      ? { label: "Everyone else", sub: "Everyone has it", state: "done" }
      : { label: "Everyone else", sub: started ? `${n(d.left)} to go, ${n(o.perDay)} a day` : `${n(o.perDay)} a day${o.auto ? ", by themselves" : ""}`, state: "open" },
  ];
  return settle(raw);
}

// ---------- the campaign cards ----------
export interface CardItem {
  key: string;
  href: string;
  title: string;
  thumb: Thumb;
  chip: { label: string; tone: ChipTone };
  progress: { done: number; total: number; label: string } | null;
  line: string;
}

export function designCard(d: DesignState, o: { auto: boolean; now: Date }): CardItem {
  const waves = d.results?.waves.length ?? 0;
  const total = d.sent + d.left;
  const progress = { done: d.sent, total: Math.max(total, d.sent), label: `${n(d.sent)} of ${n(total)} sent` };
  const base = { key: d.key, href: `/admin/email/ready#${d.key}`, title: d.title, thumb: d.look.thumb };
  if (d.status === "going")
    return {
      ...base,
      chip: { label: `Wave ${Math.max(1, waves)}`, tone: "going" },
      progress,
      line: `${n(d.sent)} sent · ${o.auto ? `next wave ${d.nextWaveOn ?? "on the morning run"}` : d.nextWaveOn ? `next wave can go ${d.nextWaveOn}` : "next wave when you're ready"}`,
    };
  if (d.status === "paused")
    return d.brake
      ? { ...base, chip: { label: "Brake on", tone: "stopped" }, progress, line: "Stopped by the brake: check it before it carries on" }
      : { ...base, chip: { label: "Paused", tone: "paused" }, progress, line: `Paused · ${n(d.sent)} sent, ${n(d.left)} to go` };
  if (d.status === "sent") {
    const r = d.results;
    const won = r ? `${n(r.outcome)} ${d.outcomeLabel.toLowerCase()} since` : "results below";
    return {
      ...base,
      chip: { label: "Sent", tone: "sent" },
      progress: { done: d.sent, total: Math.max(d.sent, 1), label: `Sent to ${n(d.sent)}` },
      line: `${waves === 1 ? "1 wave" : `All ${waves} waves`} · ${won}${d.count && d.count.willSend > 0 ? ` · ${n(d.count.willSend)} new could get it` : ""}`,
    };
  }
  if (d.status === "failed") return { ...base, chip: { label: "Didn't finish", tone: "paused" }, progress, line: short(d.row?.error ?? "It stopped partway. Open it to see.") };
  return {
    ...base,
    chip: { label: "Ready", tone: "ready" },
    progress: d.count ? { done: 0, total: d.count.willSend, label: `Not sent yet, ${n(d.count.willSend)} would get it` } : null,
    line: d.lastTest ? `Tested ${testWhen(d.lastTest.at, o.now)} · not sent yet` : d.count ? `Not sent yet · ${people(d.count.willSend)} would get it` : "Not sent yet",
  };
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

// A written email (or the lineup) as a card. `summary`: how it did, for
// one that's gone out.
export function campaignCard(c: CampaignRow, summary: CampaignSummary | null): CardItem {
  const base = { key: c.id, href: `/admin/email/${c.id}`, title: c.name, thumb: campaignThumb(c) };
  const stopped = c.status === "paused" && /^(Guardrail|Stopped):/.test(c.error ?? "");
  switch (c.status) {
    case "draft":
      return {
        ...base,
        chip: { label: "Draft", tone: "draft" },
        progress: null,
        line: c.content?.autopilot ? "Monday draft · look it over and approve it by Tue 10 AM" : `Draft · started ${whenLabel(c.created_at)}`,
      };
    case "scheduled":
      return (c.recipients ?? 0) > 0
        ? { ...base, chip: { label: "Going", tone: "going" }, progress: null, line: `${n(c.recipients ?? 0)} sent · more to go` }
        : { ...base, chip: { label: "Scheduled", tone: "scheduled" }, progress: null, line: c.scheduled_for ? `Goes ${whenLabel(c.scheduled_for)}` : "Goes on the next run" };
    case "sending":
      return { ...base, chip: { label: "Sending", tone: "going" }, progress: null, line: `Going out now · ${n(c.recipients ?? 0)} so far` };
    case "paused":
      return { ...base, chip: { label: stopped ? "Stopped" : "Paused", tone: stopped ? "stopped" : "paused" }, progress: null, line: short(c.error ?? "Paused, waiting for someone to decide") };
    case "sent": {
      const s = summary?.sent;
      return {
        ...base,
        chip: { label: "Sent", tone: "sent" },
        progress: { done: 1, total: 1, label: "Sent" },
        line: s ? `${n(s.recipients)} sent · ${pct(s.clickers, s.delivered)} tapped a link · ${n(s.came_in)} came in after` : `Sent${c.sent_at ? ` ${whenLabel(c.sent_at)}` : ""} to ${n(c.recipients ?? 0)}`,
      };
    }
    case "cancelled":
      return { ...base, chip: { label: "Stopped", tone: "off" }, progress: null, line: (c.recipients ?? 0) > 0 ? `Stopped after ${n(c.recipients ?? 0)}` : "Stopped before it went" };
    default:
      return { ...base, chip: { label: "Didn't go", tone: "paused" }, progress: null, line: short(c.error ?? "Open it to see why") };
  }
}

// Every written email, newest first (the ready-made ones have their own
// cards). Automations live on their own tab.
export async function writtenCampaigns(limit = 80): Promise<CampaignRow[]> {
  const { data } = await createAdminClient().from("email_campaigns").select(CAMPAIGN_COLUMNS).is("automation", null).order("created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as CampaignRow[]).filter((c) => !designOf(c.content));
}

// ---------- Up next ----------
// The one email most worth a look, in this order (Andrew, 10/3):
//   1. one partway through its waves, going or paused: a ready-made email,
//      or a written one that has already gone to some (paused ones first,
//      since they wait on someone);
//   2. a ready-made email not sent yet, with people to send it to (in the
//      order they're listed on Ready to send);
//   3. the Monday lineup draft waiting for approval;
//   4. otherwise, all caught up.
export interface UpNext {
  title: string;
  subject: string;
  who: string; // "For 1,240 members"
  whoMore: string | null;
  thumb: Thumb;
  preheader: string | null;
  steps: Step[];
  href: string;
  action: string;
  hint: string;
}

export async function upNext(o: {
  designs: DesignState[];
  campaigns: CampaignRow[]; // written, newest first
  drafts: CampaignRow[];
  firstWave: number;
  perDay: number;
  picturesReady: boolean;
  auto: boolean;
  tests: TestLog;
  me: string;
  now: Date;
}): Promise<UpNext | null> {
  const designFor = (d: DesignState): UpNext => {
    const steps = designSteps(d, o);
    const started = d.status === "going" || d.status === "paused";
    const left = d.count?.excluded.reduce((a, e) => a + e.n, 0) ?? 0;
    return {
      title: d.title,
      subject: d.look.subject,
      preheader: d.look.preheader,
      thumb: d.look.thumb,
      who: started ? `${n(d.sent)} sent so far, ${n(d.left)} to go` : d.count ? `For ${people(d.count.willSend)}` : "Couldn't count who it's for just now",
      whoMore: started ? null : `${d.who}${left ? ` ${n(left)} are left out, and Ready to send says why.` : ""}`,
      steps,
      href: `/admin/email/ready#${d.key}`,
      action: d.brake ? "See why it stopped" : d.status === "paused" ? "Open it to carry on" : started ? "See how it's going" : `Open ${d.title}`,
      hint: d.brake
        ? "The automatic brake paused it. Nothing more goes until someone who sends has checked."
        : d.status === "paused"
          ? "Paused. Nothing more goes until someone who sends presses Carry on."
          : started
            ? o.auto
              ? "The next wave goes by itself in the morning. Pause any time."
              : "The next wave goes only when someone presses Send the next wave."
            : `Look it over, send yourself a test, then the first ${n(o.firstWave)}. Nothing goes until you confirm, and you get a minute to undo.`,
    };
  };

  const going = o.designs.filter((d) => d.status === "going" || d.status === "paused");
  const written = o.campaigns.filter((c) => ["scheduled", "sending", "paused"].includes(c.status) && ((c.recipients ?? 0) > 0 || ((c.content as { waves?: unknown[] }).waves?.length ?? 0) > 0));
  // Paused first (they wait on someone), then the latest.
  const pausedDesign = going.find((d) => d.status === "paused");
  const pausedWritten = written.find((c) => c.status === "paused");
  if (pausedDesign) return designFor(pausedDesign);
  if (pausedWritten) return writtenFor(pausedWritten);
  if (going[0]) return designFor(going[0]);
  if (written[0]) return writtenFor(written[0]);
  const fresh = o.designs.find((d) => (d.status === "new" || d.status === "failed") && (d.count?.willSend ?? 0) > 0);
  if (fresh) return designFor(fresh);
  const monday = o.drafts.find((c) => c.kind === "lineup" && c.content?.autopilot);
  if (monday) return mondayFor(monday);
  return null;

  function writtenFor(c: CampaignRow): UpNext {
    const waves = ((c.content as { waves?: { at: string; n: number }[] }).waves ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
    const t = lastTestOf(o.tests, campaignTestKey(c.id), o.me);
    const raw: Raw[] = [
      { label: "Looked over", sub: c.approved_at ? `Approved ${whenLabel(c.approved_at)}` : "Approved", state: "done" },
      testStep(t, true, o.now),
      { label: waves.length ? "First wave" : "Sent", sub: waves[0] ? `${n(waves[0].n)} on ${whenLabel(waves[0].at)}` : `${n(c.recipients ?? 0)} so far`, state: "done" },
      c.status === "paused" ? { label: "See how they liked it", sub: "Paused: open it to decide", state: "attention" } : { label: "See how they liked it", sub: "Results on its page", state: "open" },
      { label: "Everyone else", sub: `${n(c.recipients ?? 0)} sent so far`, state: "open" },
    ];
    return {
      title: c.name,
      subject: c.subject,
      preheader: c.preheader,
      thumb: campaignThumb(c),
      who: `${n(c.recipients ?? 0)} sent so far`,
      whoMore: null,
      steps: settle(raw),
      href: `/admin/email/${c.id}`,
      action: c.status === "paused" ? "Open it to decide" : "See how it's going",
      hint: c.status === "paused" ? "Paused. Nothing more goes until someone who sends resumes it." : "It's going out. You can stop the rest on its page.",
    };
  }

  async function mondayFor(c: CampaignRow): Promise<UpNext> {
    const at = nextSendSlot(c.scheduled_for && Date.parse(c.scheduled_for) > o.now.getTime() ? new Date(c.scheduled_for) : o.now);
    const [lint, count] = await Promise.all([lintStored(asInput(c)).catch(() => null), dryRun(c, at).catch(() => null)]);
    const problems = lint?.errors.length ?? 0;
    const raw: Raw[] = [
      !lint
        ? { label: "Looked over", sub: "Open it to check", state: "open" }
        : problems
          ? { label: "Looked over", sub: `${problems} ${problems === 1 ? "thing" : "things"} to fix`, state: "attention" }
          : { label: "Looked over", sub: "Checked for you", state: "done" },
      testStep(lastTestOf(o.tests, campaignTestKey(c.id), o.me), false, o.now),
      { label: "Approve it", sub: "By Tue 10 AM", state: "open" },
      { label: "Goes to everyone", sub: c.scheduled_for ? whenLabel(c.scheduled_for) : "Tue 10:30 AM", state: "open" },
      { label: "See how they liked it", sub: "Over the week", state: "open" },
    ];
    return {
      title: c.name,
      subject: c.subject || "This week at the Royale",
      preheader: c.preheader,
      thumb: campaignThumb(c),
      who: count ? `For ${people(count.willSend)}` : "The weekly lineup",
      whoMore: "Everyone who gets the weekly lineup from us.",
      steps: settle(raw),
      href: `/admin/email/${c.id}`,
      action: "Look it over",
      hint: "The Monday draft is built from the showtimes. Look it over, send yourself a test, and approve it by Tuesday 10 AM.",
    };
  }
}
