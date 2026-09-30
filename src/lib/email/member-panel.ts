import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrefs } from "./consent";
import { hashEmail } from "./hash";
import type { ConsentSource, Engagement, PrefCategory, SendStatus } from "./types";

// A member's email marketing record, for the Email panel on their Back
// office page: the master switch, where their yes came from, the
// categories, a pause, engagement, whether their address is on the
// never-mail list (checked by hash), and their last 10 emails.

export interface MemberEmailPanel {
  hasEmail: boolean;
  optIn: boolean;
  optInChangedAt: string | null;
  consentSource: ConsentSource;
  consentAt: string | null;
  prefs: Record<PrefCategory, boolean>;
  pausedUntil: string | null;
  engagement: Engagement;
  lastEngagedAt: string | null;
  suppression: { reason: string; firstAt: string } | null;
  recent: { name: string; status: SendStatus; at: string | null; delivered: boolean; opened: boolean; clicked: boolean; unsubscribed: boolean }[];
}

export async function getMemberEmailPanel(memberId: string): Promise<MemberEmailPanel | null> {
  const admin = createAdminClient();
  const { data: m } = await admin.from("members").select("email, email_opt_in, email_opt_in_changed_at, erased_at").eq("id", memberId).maybeSingle();
  if (!m || m.erased_at) return null;
  const [p, sup, sends] = await Promise.all([
    getPrefs(memberId),
    m.email ? admin.from("email_suppressions").select("reason, first_at").eq("email_hash", hashEmail(m.email)).maybeSingle() : Promise.resolve({ data: null }),
    admin
      .from("email_sends")
      .select("status, submitted_at, deliver_at, delivered_at, first_opened_at, first_clicked_at, unsubscribed_at, created_at, campaign:email_campaigns(name)")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const s = sup.data as { reason: string; first_at: string } | null;
  return {
    hasEmail: !!m.email,
    optIn: m.email_opt_in !== false,
    optInChangedAt: m.email_opt_in_changed_at,
    consentSource: p.consentSource,
    consentAt: p.consentAt,
    prefs: { lineup: p.lineup, alerts: p.alerts, events: p.events, offers: p.offers, rewards: p.rewards },
    pausedUntil: p.pausedUntil && Date.parse(p.pausedUntil) > Date.now() ? p.pausedUntil : null,
    engagement: p.engagement,
    lastEngagedAt: p.lastEngagedAt,
    suppression: s ? { reason: s.reason, firstAt: s.first_at } : null,
    recent: ((sends.data ?? []) as unknown as {
      status: SendStatus;
      submitted_at: string | null;
      deliver_at: string | null;
      delivered_at: string | null;
      first_opened_at: string | null;
      first_clicked_at: string | null;
      unsubscribed_at: string | null;
      created_at: string;
      campaign: { name: string } | null;
    }[]).map((r) => ({
      name: r.campaign?.name ?? "Email",
      status: r.status,
      at: r.deliver_at ?? r.submitted_at ?? r.created_at,
      delivered: !!r.delivered_at,
      opened: !!r.first_opened_at,
      clicked: !!r.first_clicked_at,
      unsubscribed: !!r.unsubscribed_at,
    })),
  };
}
