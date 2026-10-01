// One email_campaigns row, as the app sees it. No server code.
import type { CampaignContent } from "./render";
import type { Audience, Automation, CampaignKind, CampaignStatus, Category, Exclusion } from "./types";
import type { CampaignShape } from "./rules";

export interface FrozenLink {
  i: number;
  url: string;
  label: string;
}

export interface CampaignRow {
  id: string;
  kind: CampaignKind;
  automation: Automation | null;
  category: Category;
  name: string;
  subject: string;
  preheader: string | null;
  content: CampaignContent;
  audience: Audience;
  holdout_pct: number;
  status: CampaignStatus;
  scheduled_for: string | null;
  send_key: string | null;
  lineup_start: string | null;
  contains_archive: boolean;
  links: FrozenLink[];
  recipients: number | null;
  held_out: number | null;
  excluded: Partial<Record<Exclusion, number>>;
  locked_until: string | null;
  error: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export const CAMPAIGN_COLUMNS =
  "id, kind, automation, category, name, subject, preheader, content, audience, holdout_pct, status, scheduled_for, send_key, lineup_start, contains_archive, links, recipients, held_out, excluded, locked_until, error, created_by, approved_by, approved_at, created_at, updated_at, sent_at";

export function shapeOf(c: Pick<CampaignRow, "id" | "kind" | "category" | "automation" | "content">): CampaignShape {
  return { id: c.id, kind: c.kind, category: c.category, automation: c.automation, alert: c.content?.alert ?? null };
}

// How long after an email "came in after" looks (B9.2 of the plan).
export function outcomeWindowDays(c: Pick<CampaignRow, "kind" | "automation" | "content" | "sent_at" | "scheduled_for">): number {
  if (c.kind === "alert" && c.content?.alert === "tonight") return 3;
  if (c.automation === "winback_45" || c.automation === "winback_90") return 21;
  if (c.automation === "birthday") return 10;
  if (c.kind === "event" && c.content?.eventDate) {
    const from = Date.parse(c.sent_at ?? c.scheduled_for ?? new Date().toISOString());
    const to = Date.parse(`${c.content.eventDate}T23:59:00-05:00`) + 86_400_000;
    const d = Math.ceil((to - from) / 86_400_000);
    if (Number.isFinite(d) && d > 0) return Math.min(45, d);
  }
  return 7;
}
