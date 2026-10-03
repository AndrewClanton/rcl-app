import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { addDays, capCheck, compareEngagement, engagementKey, genreKey, hardFilter, matchesAudience, trustRank, type CampaignShape, type OrderExtras, type RuleContext } from "./rules";
import { legacyNeedsSetup } from "@/lib/legacy-plus";
import { holdoutBucket, shuffleKey } from "./hash";
import { SENT_STATUSES, type Audience, type Exclusion, type MemberFacts, type Rule } from "./types";

// Who a campaign goes to. The audience only ever reads `members` (through
// member_email_facts): never the old-site holding table, never Resend.
//
// In order, counting everyone left out by reason:
//   1. hard filters: email on, the campaign's category on, not paused, not
//      gone quiet (except "Still want these?"), address not on the
//      never-mail list, not already sent this campaign (or dedupe key);
//   2. the segment: every include rule, minus any exclude rule (and for
//      "former unlimited, nothing paying now", minus anyone the old system
//      still charges);
//   3. the caps (rules.ts), at the time it would arrive;
//   4. warm-up order and wave size (order 'trust', or 'engaged' for the
//      ready-made emails' daily waves; limit);
//   5. the holdout: a fixed ~pct% get a row but no email, to measure lift.

const PAGE = 1000;

type FactsRow = {
  member_id: string;
  email: string;
  email_hash: string;
  name: string;
  tier: string;
  legacy_plus: boolean;
  legacy_user_id: number | null;
  indy_user_id: string | null;
  has_login: boolean;
  has_phone: boolean;
  created_at: string;
  imported_at: string | null;
  birthday: string | null;
  email_opt_in: boolean;
  lineup: boolean;
  alerts: boolean;
  events: boolean;
  offers: boolean;
  rewards: boolean;
  paused_until: string | null;
  consent_source: MemberFacts["consentSource"];
  import_group: MemberFacts["importGroup"];
  engagement: MemberFacts["engagement"];
  reconfirm_sent_at: string | null;
  last_engaged_at: string | null;
  suppressed: string | null;
  visit_days: string[] | null;
  archive_days: string[] | null;
  first_visit_on: string | null;
  last_visit_on: string | null;
  tickets: MemberFacts["tickets"] | null;
  orders: MemberFacts["orders"] | null;
  last_click_at: string | null;
  sends: MemberFacts["sends"] | null;
  delivered_since_engaged: number | null;
  invite_delivered: boolean | null;
};

export function parseFacts(r: FactsRow): MemberFacts {
  return {
    memberId: r.member_id,
    email: r.email,
    emailHash: r.email_hash,
    name: r.name,
    tier: r.tier === "Insiders+" ? "Insiders+" : "Insiders",
    legacyPlus: !!r.legacy_plus,
    imported: r.legacy_user_id !== null || !!r.indy_user_id,
    fromOldSite: r.legacy_user_id !== null,
    hasLogin: !!r.has_login,
    hasPhone: !!r.has_phone,
    createdAt: r.created_at,
    birthday: r.birthday,
    emailOptIn: r.email_opt_in !== false,
    prefs: { lineup: r.lineup !== false, alerts: r.alerts !== false, events: r.events !== false, offers: r.offers !== false, rewards: r.rewards !== false },
    pausedUntil: r.paused_until,
    consentSource: r.consent_source ?? "unknown",
    importGroup: r.import_group ?? null,
    engagement: r.engagement ?? "active",
    reconfirmSentAt: r.reconfirm_sent_at,
    lastEngagedAt: r.last_engaged_at,
    suppressed: r.suppressed,
    visitDays: (r.visit_days ?? []).map(String),
    archiveDays: (r.archive_days ?? []).map(String),
    firstVisitOn: r.first_visit_on,
    lastVisitOn: r.last_visit_on,
    tickets: (r.tickets ?? []).map((t) => ({ d: t.d, q: Number(t.q) || 0, p: Number(t.p) || 0 })),
    orders: (r.orders ?? []).map((o) => ({ d: o.d, a: !!o.a, c: !!o.c, f: !!o.f, t: Number(o.t) || 0 })),
    lastClickAt: r.last_click_at,
    sends: r.sends ?? [],
    deliveredSinceEngaged: r.delivered_since_engaged ?? 0,
    inviteDelivered: !!r.invite_delivered,
  };
}

// Every live member with an email, a page (1,000) at a time, each page
// starting after the last member id of the one before (so someone joining
// mid-scan can't shift a page and make us skip a person). `memberId`
// narrows it to one person.
export async function loadFacts(opts: { memberId?: string } = {}): Promise<MemberFacts[]> {
  const admin = createAdminClient();
  const out: MemberFacts[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await admin.rpc("member_email_facts", { p_offset: 0, p_limit: PAGE, p_member: opts.memberId ?? null, p_after: after });
    if (error) throw new Error(`Couldn't read the members list (${error.message}).`);
    const rows = (data ?? []) as FactsRow[];
    out.push(...rows.map(parseFacts));
    if (rows.length < PAGE || opts.memberId) break;
    after = rows[rows.length - 1].member_id;
  }
  return out;
}

function genreRules(a: Audience): Extract<Rule, { r: "genre" }>[] {
  return [...(a.include ?? []), ...(a.exclude ?? [])].filter((r): r is Extract<Rule, { r: "genre" }> => r.r === "genre");
}

// Former unlimited members with nothing paying for their Insiders+ now
// (lib/legacy-plus.ts): a few hundred rows. "*" so it works before and
// after the legacy onboarding migration adds its columns.
export async function legacyNeedingSetup(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await createAdminClient().from("members").select("*").eq("legacy_plus", true).is("erased_at", null).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error("Couldn't read the former unlimited members.");
    for (const m of (data ?? []) as Parameters<typeof legacyNeedsSetup>[0][]) if (legacyNeedsSetup(m)) out.add((m as unknown as { id: string }).id);
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

// Former unlimited members the old system still charged in September
// (legacy_billing_payers, 20261002040000): "nothing paying now" isn't true
// for them. Empty before that migration.
export async function oldSystemPayers(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("legacy_billing_payers").select("member_id");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return new Set();
    throw new Error("Couldn't read who pays on the old system.");
  }
  return new Set((data ?? []).map((r) => r.member_id as string));
}

const usesRule = (a: Audience, r: Rule["r"]) => [...(a.include ?? []), ...(a.exclude ?? [])].some((x) => x.r === r);

export async function ruleContext(a: Audience, now: Date): Promise<RuleContext> {
  const today = businessDay(now).date;
  const ctx: RuleContext = { now, today };
  if (usesRule(a, "legacy_needs_setup")) ctx.legacyNeedsSetup = await legacyNeedingSetup();
  if ((a.include ?? []).some((x) => x.r === "legacy_needs_setup")) ctx.paidOldSystem = await oldSystemPayers();
  const genres = genreRules(a);
  if (genres.length) {
    ctx.genreMembers = new Map();
    for (const g of genres) {
      const { data } = await createAdminClient().rpc("member_genre_days", { p_genre: g.v, p_since: addDays(today, -g.within), p_min: g.min });
      ctx.genreMembers.set(genreKey(g), new Set(((data ?? []) as { member_id: string }[]).map((x) => x.member_id)));
    }
  }
  return ctx;
}

// For the engagement order: each member's latest activity
// (members.last_activity_at: check-ins, purchases, bookings, points) and
// when they last said yes to email (member_email_prefs.consent_at), read
// beside member_email_facts so that function needn't change. If either
// read fails, the order uses what the facts have (visits, orders, clicks).
export async function orderExtras(): Promise<Map<string, OrderExtras>> {
  const admin = createAdminClient();
  const out = new Map<string, OrderExtras>();
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from("members").select("id, last_activity_at").not("last_activity_at", "is", null).order("id").range(from, from + PAGE - 1);
      if (error) break;
      for (const r of data ?? []) out.set(r.id as string, { activityAt: r.last_activity_at as string });
      if ((data ?? []).length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from("member_email_prefs").select("member_id, consent_at").not("consent_at", "is", null).order("member_id").range(from, from + PAGE - 1);
      if (error) break;
      for (const r of data ?? []) out.set(r.member_id as string, { ...out.get(r.member_id as string), consentAt: r.consent_at as string });
      if ((data ?? []).length < PAGE) break;
    }
  } catch {
    // The facts alone.
  }
  return out;
}

export interface Resolved {
  send: { facts: MemberFacts; heldOut: boolean; dedupeKey: string | null }[];
  willSend: number;
  heldOut: number;
  excluded: Partial<Record<Exclusion, number>>;
  considered: number;
  rank?: Map<string, number[]>; // order 'engaged': member id -> engagementKey
  spaced?: Map<string, number>; // `spacing`: how many each other email held back (by its name)
}

// Who already has this campaign (or, for an automation, this dedupe key).
async function alreadyHave(campaignId: string): Promise<{ members: Set<string>; keys: Set<string> }> {
  const admin = createAdminClient();
  const members = new Set<string>();
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("email_sends").select("member_id, dedupe_key").eq("campaign_id", campaignId).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error("Couldn't read who already got it.");
    for (const s of data ?? []) {
      if (!s.member_id) continue;
      if (s.dedupe_key) keys.add(`${s.member_id}|${s.dedupe_key}`);
      else members.add(s.member_id);
    }
    if ((data ?? []).length < PAGE) break;
  }
  return { members, keys };
}

export async function resolveAudience(
  c: CampaignShape & { audience: Audience; holdoutPct: number },
  opts: {
    at: Date; // when it would arrive, for the caps
    facts?: MemberFacts[];
    memberId?: string;
    dedupeKey?: (f: MemberFacts) => string | null;
    limit?: number | null;
    now?: Date;
    extras?: Map<string, OrderExtras>; // orderExtras(), read once for several
    withRank?: boolean; // order 'engaged': return each one's engagement key
    // The ready-made emails: anyone who had (or has waiting) one of these
    // other campaigns (id -> name) within `days` of `at` waits for a later
    // wave ("design_gap": they get no row, so a later wave picks them up).
    spacing?: { others: Map<string, string>; days: number };
  },
): Promise<Resolved> {
  const now = opts.now ?? new Date();
  const facts = opts.facts ?? (await loadFacts({ memberId: opts.memberId }));
  const ctx = await ruleContext(c.audience, now);
  const have = await alreadyHave(c.id);
  const excluded: Partial<Record<Exclusion, number>> = {};
  const skip = (why: Exclusion) => {
    excluded[why] = (excluded[why] ?? 0) + 1;
  };

  const ok: { facts: MemberFacts; dedupeKey: string | null }[] = [];
  const spaced = new Map<string, number>();
  const others = opts.spacing?.others;
  const gapMs = (opts.spacing?.days ?? 0) * 86_400_000;
  const tooClose = (f: MemberFacts): string | null => {
    if (!others?.size) return null;
    for (const s of f.sends) {
      const name = others.get(s.c);
      if (!name || !SENT_STATUSES.has(s.s)) continue;
      const t = Date.parse(s.t);
      if (Number.isFinite(t) && Math.abs(t - opts.at.getTime()) < gapMs) return name;
    }
    return null;
  };
  for (const f of facts) {
    const hard = hardFilter(f, c, now);
    if (hard) {
      skip(hard);
      continue;
    }
    const key = opts.dedupeKey ? opts.dedupeKey(f) : null;
    if (opts.dedupeKey && !key) {
      skip("segment");
      continue;
    }
    if (key ? have.keys.has(`${f.memberId}|${key}`) : have.members.has(f.memberId)) {
      skip("already_sent");
      continue;
    }
    if (!matchesAudience(f, c.audience, ctx)) {
      skip("segment");
      continue;
    }
    // "Former unlimited, nothing paying now", but the old system still
    // charged them (counted on its own, so the screen can say so).
    if (ctx.paidOldSystem?.has(f.memberId)) {
      skip("paid_old_system");
      continue;
    }
    const cap = capCheck(f.sends, c, opts.at, { createdAt: f.createdAt, imported: f.imported });
    if (cap) {
      skip(cap);
      continue;
    }
    const close = tooClose(f);
    if (close) {
      skip("design_gap");
      spaced.set(close, (spaced.get(close) ?? 0) + 1);
      continue;
    }
    ok.push({ facts: f, dedupeKey: key });
  }

  const limit = opts.limit ?? c.audience.limit ?? null;
  const tie = (a: MemberFacts, b: MemberFacts) => shuffleKey(a.memberId, c.id).localeCompare(shuffleKey(b.memberId, c.id));
  // Warm-up: the most trusted first, then a fixed random order.
  if (c.audience.order === "trust" || c.audience.order === "random") {
    const rank = (f: MemberFacts) => (c.audience.order === "trust" ? trustRank(f) : 0);
    ok.sort((a, b) => rank(a.facts) - rank(b.facts) || tie(a.facts, b.facts));
  }
  // The ready-made emails' daily waves: the most engaged first (rules.ts
  // engagementKey). Sorted only when the wave takes some and leaves the rest.
  const cut = !!limit && limit > 0 && ok.length > limit;
  let rank: Map<string, number[]> | undefined;
  if (c.audience.order === "engaged" && (cut || opts.withRank)) {
    const extras = opts.extras ?? (await orderExtras());
    const keys = new Map(ok.map((x) => [x.facts.memberId, engagementKey(x.facts, extras.get(x.facts.memberId) ?? {}, now)]));
    if (cut) ok.sort((a, b) => compareEngagement(keys.get(a.facts.memberId) ?? [], keys.get(b.facts.memberId) ?? []) || tie(a.facts, b.facts));
    rank = keys;
  }
  let chosen = ok;
  if (limit && limit > 0 && ok.length > limit) {
    chosen = ok.slice(0, limit);
    excluded.wave_limit = ok.length - limit;
  }

  const send = chosen.map((x) => ({ ...x, heldOut: c.holdoutPct > 0 && holdoutBucket(x.facts.memberId, c.id) < c.holdoutPct }));
  const heldOut = send.filter((s) => s.heldOut).length;
  return { send, willSend: send.length - heldOut, heldOut, excluded, considered: facts.length, rank, spaced };
}

// Writes the chosen people as email_sends rows ('queued' or 'held_out').
// Anyone who already has a row is skipped by the database.
export async function queueSends(campaignId: string, resolved: Resolved, deliverAt: Date): Promise<number> {
  const admin = createAdminClient();
  let n = 0;
  for (let i = 0; i < resolved.send.length; i += 500) {
    const rows = resolved.send.slice(i, i + 500).map((s) => ({
      member_id: s.facts.memberId,
      status: s.heldOut ? "held_out" : "queued",
      dedupe_key: s.dedupeKey ?? "",
      deliver_at: deliverAt.toISOString(),
      tier_at_send: s.facts.tier,
      // For "signed in since" in the results (migration 20261002020000;
      // the database ignores it before that).
      had_login: s.facts.hasLogin,
    }));
    const { data, error } = await admin.rpc("email_queue_sends", { p_campaign: campaignId, p_rows: rows });
    if (error) throw new Error(`Couldn't queue the email (${error.message}).`);
    n += Number(data) || 0;
  }
  return n;
}
