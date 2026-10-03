import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { plusPaidFor } from "@/lib/plus-status";
import { CAMPAIGN_COLUMNS, type CampaignRow } from "../campaign";
import { loadFacts, orderExtras, resolveAudience } from "../audience";
import { ENGAGEMENT_GROUPS, engagementGroup } from "../rules";
import { renderCampaign, type Recipient } from "../render";
import { EXCLUSION_LABEL, type Exclusion } from "../types";
import { sealArtName } from "./art-token";
import { DESIGNS, type DesignKey } from "./index";
import { DESIGN_GAP_DAYS, designCampaignIds, otherDesigns } from "../campaign-send";
import { nextSendSlot } from "../timing";
import { ASSET_BUCKET, assetUrl } from "./kit";
import { ART, PIECES } from "./assets";
import { DESIGN_KEYS } from "./types";

// Back office -> Email -> Ready to send, the server side: each ready-made
// email's campaign row, who it would go to now, how it did, and its
// preview. The sending itself is the ordinary sender (campaign-send.ts).

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";
const HANDED = ["submitted", "scheduled", "delivered", "bounced", "complained"];

// The ready-made email's campaign: one row per design, reused for every
// wave and every later "send to the new people" (anyone who's had it is
// never sent it again). A cancelled one is left alone.
export async function designCampaign(key: DesignKey): Promise<CampaignRow | null> {
  const { data } = await createAdminClient()
    .from("email_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("content->>design", key)
    .in("status", ["scheduled", "sending", "sent", "paused", "failed"])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as CampaignRow | undefined) ?? null;
}

export interface AudienceCount {
  willSend: number;
  excluded: { why: string; n: number }[];
  // The next wave if it went now: how many, and how engaged they are (in
  // the order they're picked; rules.ts ENGAGEMENT_GROUPS).
  next: { n: number; mix: { label: string; n: number }[] };
  // Of those it's for, how many had one of the other ready-made emails in
  // the last 3 days (by that email's name): they wait for a later wave.
  spaced: { title: string; n: number }[];
}

function topExclusions(ex: Partial<Record<Exclusion, number>>): { why: string; n: number }[] {
  return (Object.entries(ex) as [Exclusion, number][])
    .filter(([k, n]) => n > 0 && k !== "segment" && k !== "wave_limit" && k !== "design_gap")
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ why: k === "already_sent" ? "Already got it" : EXCLUSION_LABEL[k], n }));
}

// Who each would go to right now (and who's left out, by reason), and who
// the next wave of `waveSize` would be. One read of the member list (and
// of the engagement extras) for all three.
export async function countAudiences(rows: Partial<Record<DesignKey, CampaignRow | null>>, now = new Date(), waveSize = 100): Promise<Record<DesignKey, AudienceCount>> {
  const [facts, extras, designIds] = await Promise.all([loadFacts(), orderExtras(), designCampaignIds()]);
  const out = {} as Record<DesignKey, AudienceCount>;
  // The next wave would arrive at the next send slot (the 3-day gap is
  // measured from then, as the wave itself does).
  const at = nextSendSlot(now);
  for (const key of DESIGN_KEYS) {
    const d = DESIGNS[key];
    const c = rows[key];
    const shape = { id: c?.id ?? UUID_ZERO, kind: d.kind, category: d.category, automation: null, alert: null };
    const spacing = { others: otherDesigns(designIds, key), days: DESIGN_GAP_DAYS };
    const r = await resolveAudience({ ...shape, audience: d.audience, holdoutPct: 0 }, { at, now, facts, extras, limit: Math.max(1, waveSize), withRank: true, spacing });
    const groups = ENGAGEMENT_GROUPS.map(() => 0);
    for (const s of r.send) groups[engagementGroup(r.rank?.get(s.facts.memberId) ?? [4, 3])]++;
    out[key] = {
      willSend: r.willSend + (r.excluded.wave_limit ?? 0) + (r.excluded.design_gap ?? 0),
      excluded: topExclusions(r.excluded),
      next: { n: r.willSend, mix: ENGAGEMENT_GROUPS.map((label, i) => ({ label, n: groups[i] })).filter((g) => g.n > 0) },
      spaced: [...(r.spaced ?? new Map<string, number>())].map(([title, n]) => ({ title, n })).sort((a, b) => b.n - a.n),
    };
  }
  return out;
}

// ---------- results ----------
export interface DesignResults {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  waiting: number; // queued, not handed to Resend yet
  outcome: number; // signed in, or set up Insiders+, since
  outcomeOf: number; // out of how many it could apply to
  waves: WaveResult[]; // the same, one wave at a time, first wave first
}

// One daily wave: everyone chosen on one day (Central), by when their
// row was queued.
export type WaveResult = Omit<DesignResults, "waves"> & { n: number; day: string };

const chicagoDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export async function designResults(c: CampaignRow, key: DesignKey): Promise<DesignResults> {
  const admin = createAdminClient();
  type Row = { member_id: string | null; status: string; created_at: string; delivered_at: string | null; first_opened_at: string | null; first_clicked_at: string | null; unsubscribed_at: string | null; bounce_type: string | null; had_login?: boolean | null };
  const rows: Row[] = [];
  let cols = "member_id, status, created_at, delivered_at, first_opened_at, first_clicked_at, unsubscribed_at, bounce_type, had_login";
  for (let from = 0; ; from += 1000) {
    let { data, error } = await admin.from("email_sends").select(cols).eq("campaign_id", c.id).order("id").range(from, from + 999);
    if (error && cols.includes("had_login")) {
      // Before the migration that adds had_login.
      cols = cols.replace(", had_login", "");
      ({ data, error } = await admin.from("email_sends").select(cols).eq("campaign_id", c.id).order("id").range(from, from + 999));
    }
    if (error) throw new Error("Couldn't read how it did.");
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const d = DESIGNS[key];
  // Who it could apply to: everyone who got the invite or "Press play"
  // (they had no login, or nothing paying, when it went); for "Come in",
  // the ones who had no login when it went.
  const applies = (r: Row) => !!r.member_id && HANDED.includes(r.status) && (d.outcome.key === "plus" || key === "royale-is-here" || r.had_login === false);
  const candidates = rows.filter(applies).map((r) => r.member_id as string);
  const won = new Set<string>();
  for (let i = 0; i < candidates.length; i += 150) {
    const ids = candidates.slice(i, i + 150);
    if (d.outcome.key === "signed_in") {
      const { data } = await admin.from("members").select("id, auth_user_id").in("id", ids);
      for (const m of data ?? []) if (m.auth_user_id) won.add(m.id as string);
    } else {
      const { data } = await admin.from("members").select("*").in("id", ids);
      for (const m of (data ?? []) as (Parameters<typeof plusPaidFor>[0] & { id: string })[]) if (plusPaidFor(m)) won.add(m.id);
    }
  }
  const tally = (list: Row[]): Omit<DesignResults, "waves"> => {
    const could = list.filter(applies);
    return {
      sent: list.filter((r) => HANDED.includes(r.status)).length,
      delivered: list.filter((r) => r.delivered_at).length,
      opened: list.filter((r) => r.first_opened_at).length,
      clicked: list.filter((r) => r.first_clicked_at).length,
      unsubscribed: list.filter((r) => r.unsubscribed_at).length,
      bounced: list.filter((r) => r.status === "bounced" || r.bounce_type === "Permanent").length,
      waiting: list.filter((r) => r.status === "queued").length,
      outcome: could.filter((r) => won.has(r.member_id as string)).length,
      outcomeOf: could.length,
    };
  };
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.status === "held_out") continue;
    const day = chicagoDay(r.created_at);
    const list = byDay.get(day);
    if (list) list.push(r);
    else byDay.set(day, [r]);
  }
  const waves = [...byDay.keys()].sort().map((day, i) => ({ n: i + 1, day, ...tally(byDay.get(day) ?? []) }));
  return { ...tally(rows), waves };
}

// ---------- preview ----------
export type PreviewAs = "claim" | "login";

// The email as "Sam" would get it: with no login yet (their own "Set my
// password"), or already signed up. Links are the ordinary pages.
export function previewHtml(key: DesignKey, as: PreviewAs = "claim"): { subject: string; preheader: string; html: string; text: string } {
  const d = DESIGNS[key];
  const r: Recipient = {
    firstName: "Sam",
    consentSource: "unknown",
    tier: "Insiders",
    hasLogin: as === "login",
    email: null,
    claimUrl: null,
    sample: true,
    artToken: sealArtName("Sam"),
    fromOldSite: true,
    sendId: null,
    finishUrl: null,
  };
  const out = renderCampaign(
    { kind: d.kind, category: d.category, subject: d.subject, preheader: d.preheader, content: { blocks: [{ t: "design", key }] } },
    { range: { start: "", days: 7 }, films: [], happenings: [], menuItems: [] },
    r,
    { preferencesUrl: `${SITE_URL}/account/email`, unsubscribeUrl: `${SITE_URL}/account/email#all`, href: (u) => u },
  );
  return { subject: out.subject, preheader: out.preheader, html: out.html, text: out.text };
}

// ---------- the pictures ----------
// Every picture the three designs use (assets.ts): desktop and phone, and
// the no-name version of each per-person picture.
export function referencedPictures(): string[] {
  const files = new Set<string>();
  for (const p of Object.values(PIECES)) for (const f of [p.d, p.m]) if (f) files.add(f.file);
  for (const a of Object.values(ART)) for (const v of [a.d, a.m]) if (v) files.add(v.generic);
  return [...files].sort();
}

// The go-live checklist: which of those are missing from the email-assets
// bucket (one listing per folder). Null if the bucket couldn't be read.
export async function picturesCheck(): Promise<{ expected: number; missing: string[] } | null> {
  const want = referencedPictures();
  const folders = [...new Set(want.map((f) => f.slice(0, f.lastIndexOf("/"))))];
  const storage = createAdminClient().storage.from(ASSET_BUCKET);
  const have = new Set<string>();
  try {
    for (const folder of folders) {
      const { data, error } = await storage.list(folder, { limit: 1000 });
      if (error) return null;
      for (const o of data ?? []) have.add(`${folder}/${o.name}`);
    }
  } catch {
    return null;
  }
  return { expected: want.length, missing: want.filter((f) => !have.has(f)) };
}

// Whether the pictures are in the email-assets bucket yet (one is asked
// for; they all go up together). Nothing is sent without them.
export async function picturesReady(): Promise<boolean> {
  const probe = PIECES["common/header"]?.d?.file;
  if (!probe || !process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
  try {
    const res = await fetch(assetUrl(probe), { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
