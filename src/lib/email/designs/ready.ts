import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { plusPaidFor } from "@/lib/plus-status";
import { CAMPAIGN_COLUMNS, type CampaignRow } from "../campaign";
import { loadFacts, resolveAudience } from "../audience";
import { hardFilter } from "../rules";
import { renderCampaign, type Recipient } from "../render";
import { EXCLUSION_LABEL, type Exclusion, type MemberFacts } from "../types";
import { sealArtName } from "./art-token";
import { DESIGNS, type DesignKey } from "./index";
import { assetUrl } from "./kit";
import { PIECES } from "./assets";
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
  noPhone: number; // the invite only: no login, but no phone on file (no claim link can be made)
}

function topExclusions(ex: Partial<Record<Exclusion, number>>): { why: string; n: number }[] {
  return (Object.entries(ex) as [Exclusion, number][])
    .filter(([k, n]) => n > 0 && k !== "segment" && k !== "wave_limit")
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ why: k === "already_sent" ? "Already got it" : EXCLUSION_LABEL[k], n }));
}

// Who each would go to right now (and who's left out, by reason). One
// read of the member list for all three.
export async function countAudiences(rows: Partial<Record<DesignKey, CampaignRow | null>>, now = new Date()): Promise<Record<DesignKey, AudienceCount>> {
  const facts = await loadFacts();
  const out = {} as Record<DesignKey, AudienceCount>;
  for (const key of DESIGN_KEYS) {
    const d = DESIGNS[key];
    const c = rows[key];
    const shape = { id: c?.id ?? UUID_ZERO, kind: d.kind, category: d.category, automation: null, alert: null };
    const r = await resolveAudience({ ...shape, audience: d.audience, holdoutPct: 0 }, { at: now, now, facts });
    out[key] = { willSend: r.willSend, excluded: topExclusions(r.excluded), noPhone: key === "royale-is-here" ? countNoPhone(facts, shape, now) : 0 };
  }
  return out;
}

function countNoPhone(facts: MemberFacts[], shape: Parameters<typeof hardFilter>[1], now: Date): number {
  return facts.filter((f) => !f.hasLogin && !f.hasPhone && !hardFilter(f, shape, now)).length;
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
}

export async function designResults(c: CampaignRow, key: DesignKey): Promise<DesignResults> {
  const admin = createAdminClient();
  type Row = { member_id: string | null; status: string; delivered_at: string | null; first_opened_at: string | null; first_clicked_at: string | null; unsubscribed_at: string | null; bounce_type: string | null; had_login?: boolean | null };
  const rows: Row[] = [];
  let cols = "member_id, status, delivered_at, first_opened_at, first_clicked_at, unsubscribed_at, bounce_type, had_login";
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
  const handed = rows.filter((r) => HANDED.includes(r.status));
  const out: DesignResults = {
    sent: handed.length,
    delivered: rows.filter((r) => r.delivered_at).length,
    opened: rows.filter((r) => r.first_opened_at).length,
    clicked: rows.filter((r) => r.first_clicked_at).length,
    unsubscribed: rows.filter((r) => r.unsubscribed_at).length,
    bounced: rows.filter((r) => r.status === "bounced" || r.bounce_type === "Permanent").length,
    waiting: rows.filter((r) => r.status === "queued").length,
    outcome: 0,
    outcomeOf: 0,
  };
  const d = DESIGNS[key];
  // Who it could apply to: everyone who got the invite or "Press play"
  // (they had no login, or nothing paying, when it went); for "Come in",
  // the ones who had no login when it went.
  const candidates = handed.filter((r) => r.member_id && (d.outcome.key === "plus" || key === "royale-is-here" || r.had_login === false)).map((r) => r.member_id as string);
  out.outcomeOf = candidates.length;
  for (let i = 0; i < candidates.length; i += 150) {
    const ids = candidates.slice(i, i + 150);
    if (d.outcome.key === "signed_in") {
      const { data } = await admin.from("members").select("id, auth_user_id").in("id", ids);
      out.outcome += (data ?? []).filter((m) => m.auth_user_id).length;
    } else {
      const { data } = await admin.from("members").select("*").in("id", ids);
      out.outcome += ((data ?? []) as Parameters<typeof plusPaidFor>[0][]).filter((m) => plusPaidFor(m)).length;
    }
  }
  return out;
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
