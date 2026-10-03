import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, centralToIso } from "@/lib/ops/time";
import { rangeLabel } from "./format";
import { CAMPAIGN_COLUMNS, shapeOf, type CampaignRow } from "./campaign";
import { loadFacts, queueSends, resolveAudience } from "./audience";
import { runCampaign, sendingGate } from "./campaign-send";
import { addDays, birthdayWithin, sunsetDue } from "./rules";
import { AUTOMATION_STARTERS, lineupStarter } from "./templates";
import { nextLineupSlot, nextSendSlot, SLOT } from "./timing";
import { AUTOMATIONS, SENT_STATUSES, type Automation, type MemberFacts } from "./types";

// The automatic emails. Each is one long-lived email_campaigns row
// (kind 'automation', status 'active' or 'off') that keeps collecting
// sends, and every send still goes through the audience rules, the
// preferences, the never-mail list and the caps. A dedupe key per person
// ('welcome_1', 'birthday:2026', 'winback45:2026-11-03') means nobody gets
// the same one twice. They start switched off: an admin turns each on
// (the plan switches welcome and birthday on about two weeks into warm-up).

const DAY = 86_400_000;

// Makes any automation row that doesn't exist yet (switched off).
export async function ensureAutomations(): Promise<CampaignRow[]> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("email_campaigns").select(CAMPAIGN_COLUMNS).not("automation", "is", null);
  const have = new Set((existing ?? []).map((r) => (r as CampaignRow).automation));
  // An early "Still want these?" row was made with kind 'reconfirm', which
  // the sender took for a one-off and never ran: every automation row is
  // kind 'automation'.
  if ((existing ?? []).some((r) => (r as CampaignRow).kind !== "automation")) {
    await admin.from("email_campaigns").update({ kind: "automation" }).not("automation", "is", null).neq("kind", "automation");
  }
  for (const a of AUTOMATIONS) {
    if (have.has(a)) continue;
    const s = AUTOMATION_STARTERS[a];
    const { error } = await admin.from("email_campaigns").insert({
      kind: s.kind,
      automation: a,
      category: s.category,
      name: s.name,
      subject: s.subject,
      preheader: s.preheader,
      content: s.content,
      audience: s.audience,
      holdout_pct: s.holdoutPct,
      status: "off",
    });
    if (error && error.code !== "23505") throw new Error(`Couldn't set up the ${s.name} email.`);
  }
  const { data } = await admin.from("email_campaigns").select(CAMPAIGN_COLUMNS).not("automation", "is", null);
  return ((data ?? []) as CampaignRow[]).sort((x, y) => AUTOMATIONS.indexOf(x.automation as Automation) - AUTOMATIONS.indexOf(y.automation as Automation));
}

export async function getAutomation(a: Automation): Promise<CampaignRow | null> {
  const { data } = await createAdminClient().from("email_campaigns").select(CAMPAIGN_COLUMNS).eq("automation", a).maybeSingle();
  return (data as CampaignRow | null) ?? null;
}

const daysSinceIso = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / DAY;

// Which dedupe key (if any) this member would get for this automation
// today. Null: not due.
export function automationKey(a: Automation, f: MemberFacts, now: Date, today: string): string | null {
  switch (a) {
    case "welcome_1":
      return "welcome_1";
    case "welcome_2": {
      // Day 3 (up to day 7, if the caps held it back).
      const d = daysSinceIso(f.createdAt, now);
      return !f.imported && f.tier === "Insiders" && d >= 3 && d < 8 ? "welcome_2" : null;
    }
    case "welcome_3": {
      const d = daysSinceIso(f.createdAt, now);
      return !f.imported && !f.firstVisitOn && d >= 10 && d < 15 ? "welcome_3" : null;
    }
    case "birthday": {
      // The Monday-to-Sunday week holding their birthday, until the day itself.
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const daysLeftInWeek = 7 - ((dow + 6) % 7);
      for (let i = 0; i < daysLeftInWeek; i++) {
        const d = addDays(today, i);
        if (birthdayWithin(f.birthday, d, 1)) return `birthday:${d.slice(0, 4)}`;
      }
      return null;
    }
    case "plus_upsell":
      // Someone in the held-back group stays held back for the 60 days the
      // cap covers, rather than getting a new held-back row every day.
      if (f.sends.some((s) => s.a === "plus_upsell" && s.s === "held_out" && daysSinceIso(s.t, now) < 60)) return null;
      return `plus_upsell:${today}`;
    case "winback_45": {
      if (!f.lastVisitOn || f.lastVisitOn > addDays(today, -45) || f.lastVisitOn <= addDays(today, -90)) return null;
      // Nothing for six months after the second try.
      if (f.sends.some((s) => s.a === "winback_90" && daysSinceIso(s.t, now) < 180)) return null;
      return `winback45:${f.lastVisitOn}`;
    }
    case "winback_90":
      if (!f.lastVisitOn || f.lastVisitOn > addDays(today, -90)) return null;
      if (f.sends.some((s) => s.a === "winback_90" && daysSinceIso(s.t, now) < 180)) return null;
      return `winback90:${f.lastVisitOn}`;
    case "reconfirm":
      // Once a round: not again while one is queued, waiting at Resend or
      // recently sent (its 14 days only start once it's handed over), or
      // held back (if it ever has a holdout).
      if (f.sends.some((s) => s.a === "reconfirm" && (SENT_STATUSES.has(s.s) || s.s === "held_out") && daysSinceIso(s.t, now) < 30)) return null;
      return sunsetDue(f, now) ? `reconfirm:${today}` : null;
  }
}

// When today's copy of an automation should arrive: 10:30 AM (the birthday
// one on the Monday of the week), or the next open slot if that's passed.
function arrivalFor(a: Automation, now: Date, today: string): Date {
  let slot: Date;
  if (a === "birthday") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    slot = new Date(centralToIso(addDays(today, -((dow + 6) % 7)), SLOT));
  } else {
    slot = new Date(centralToIso(today, SLOT));
  }
  return nextSendSlot(slot.getTime() > now.getTime() ? slot : now);
}

// Queues today's sends for one automation. Returns how many were queued.
export async function queueAutomation(row: CampaignRow, now = new Date(), facts?: MemberFacts[]): Promise<number> {
  if (row.status !== "active" || !row.automation || row.automation === "welcome_1") return 0;
  const a = row.automation;
  const today = businessDay(now).date;
  const at = arrivalFor(a, now, today);
  const resolved = await resolveAudience(
    { ...shapeOf(row), audience: row.audience ?? { include: [{ r: "all" }] }, holdoutPct: row.holdout_pct },
    { at, now, facts: facts ?? (await loadFacts()), dedupeKey: (f) => automationKey(a, f, now, today) },
  );
  const n = await queueSends(row.id, resolved, at);
  await createAdminClient().from("email_campaigns").update({ excluded: resolved.excluded, updated_at: now.toISOString() }).eq("id", row.id);
  // "Still want these?" doesn't start anyone's 14 days here: that happens
  // when it's handed to Resend (campaign-send.ts), so one that's cancelled,
  // dropped or held back never makes anyone go quiet.
  return n;
}

// Welcome #1: queued the moment someone joins (the join form, the kiosk,
// checkout, a claimed account), sent right away, or at the next morning
// slot during quiet hours. Runs after the page has answered, so nobody
// waits on it, and never throws.
export function memberJoined(memberId: string): void {
  try {
    after(async () => {
      try {
        await queueWelcome(memberId);
      } catch (e) {
        console.error("welcome email not queued:", e instanceof Error ? e.message : e);
      }
    });
  } catch {
    // Outside a request (a script): nothing to do.
  }
}

export async function queueWelcome(memberId: string, now = new Date()): Promise<boolean> {
  // Sending off (the kill switch, no sender): nothing queues, so turning it
  // back on can never fire a pile of days-old welcomes.
  if (!(await sendingGate()).ok) return false;
  const row = await getAutomation("welcome_1");
  if (!row || row.status !== "active") return false;
  const facts = await loadFacts({ memberId });
  if (!facts.length) return false;
  const at = nextSendSlot(now);
  const resolved = await resolveAudience(
    { ...shapeOf(row), audience: row.audience ?? { include: [{ r: "all" }] }, holdoutPct: 0 },
    { at, now, facts, dedupeKey: () => "welcome_1" },
  );
  const n = await queueSends(row.id, resolved, at);
  if (n > 0) await runCampaign(row.id, Date.now() + 45_000, now);
  return n > 0;
}

// ---------- the Monday lineup draft ----------
// Every Monday the cron drafts Tuesday's lineup (Tuesday to Monday) and
// the Today page says "Lineup draft ready: approve by Tue 10:00". It never
// sends without a person approving it.
export async function draftWeeklyLineup(now = new Date()): Promise<string | null> {
  const { date: tuesday } = nextLineupSlot(now);
  const admin = createAdminClient();
  const { data: existing } = await admin.from("email_campaigns").select("id").eq("kind", "lineup").eq("lineup_start", tuesday).limit(1);
  if (existing?.length) return null;
  const s = lineupStarter(tuesday, 7);
  const { data, error } = await admin
    .from("email_campaigns")
    .insert({
      kind: "lineup",
      category: "lineup",
      name: `Weekly lineup, ${rangeLabel(tuesday, 7)}`,
      subject: "This week at the Royale",
      preheader: null,
      content: { ...s.content, autopilot: true },
      audience: s.audience,
      holdout_pct: 0,
      status: "draft",
      lineup_start: tuesday,
      scheduled_for: centralToIso(tuesday, SLOT),
    })
    .select("id")
    .single();
  if (error) return null;
  return data.id as string;
}

export function isMonday(now = new Date()): boolean {
  const today = businessDay(now).date;
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
}

