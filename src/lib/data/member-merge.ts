import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactForRole } from "@/lib/contact-mask";
import type { EmployeeRole } from "@/lib/types";
import {
  CARRIED_LABEL,
  MERGE_MEMBER_COLUMNS,
  badgeOverlap,
  countText,
  hasBilling,
  hasLogin,
  isLikelyTabletDuplicate,
  isTabletMade,
  mergeHref,
  mergeRefusal,
  mergeSentence,
  mergedProfile,
  mergedVisitCount,
  suggestKeep,
  usablePhone,
  type MergeMember,
  type MergedProfile,
} from "@/lib/member-merge";

// Reads for merging duplicate members (lib/member-merge.ts has the rules,
// migration 20261001150000 the merge itself). Owner and admin only: every
// caller checks that first. Contact details leave here masked for the
// viewer's role (lib/contact-mask.ts).

type Db = ReturnType<typeof createAdminClient>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asMergeMember(row: Record<string, unknown>): MergeMember {
  return { ...(row as unknown as MergeMember), points: Number(row.points ?? 0) };
}

export async function getMergeMember(id: string): Promise<MergeMember | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await createAdminClient().from("members").select(MERGE_MEMBER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? asMergeMember(data) : null;
}

// ---------- search ----------

export interface MergeCandidate {
  id: string;
  name: string;
  tier: string;
  points: number;
  createdAt: string;
  email: string | null; // masked for the viewer's role
  phone: string | null; // masked for the viewer's role
  hasLogin: boolean;
  oldSite: boolean;
}

function candidateView(m: MergeMember, role: EmployeeRole): MergeCandidate {
  const contact = contactForRole({ email: m.email, phone: m.phone }, role);
  return {
    id: m.id,
    name: m.name,
    tier: m.tier,
    points: Number(m.points),
    createdAt: m.created_at,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    hasLogin: hasLogin(m),
    oldSite: m.legacy_user_id != null,
  };
}

// Other members matching a name, email or phone (the same matching as the
// Members list), most recently active first, never the account itself.
export async function searchMergeCandidates(keepId: string, query: string, role: EmployeeRole): Promise<MergeCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ");
  const filters = [`name.ilike.%${escaped}%`, `email.ilike.%${escaped}%`];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) filters.push(`phone_digits.like.%${digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits}%`);
  const { data, error } = await createAdminClient()
    .from("members")
    .select(MERGE_MEMBER_COLUMNS)
    .is("erased_at", null)
    .neq("id", keepId)
    .or(filters.join(","))
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("name")
    .limit(12);
  if (error) throw error;
  return (data ?? []).map((r) => candidateView(asMergeMember(r), role));
}

// ---------- the preview ----------

export interface MergeSideView extends MergeCandidate {
  avatarUrl: string | null;
  phoneUsable: boolean;
  hasBilling: boolean;
  subscriptionStatus: string | null;
  visits: number;
  orders: number;
  tickets: number;
  tabletMade: boolean;
}

export interface MergePreview {
  keep: MergeSideView;
  drop: MergeSideView;
  refusal: string | null;
  // What comes over from the duplicate, as "3 visits", "12 points history entries"...
  moves: string[];
  // Where both had the same thing and only one stays.
  overlaps: string[];
  // The kept account afterwards.
  result: {
    name: string;
    email: string | null; // masked for the viewer's role
    phone: string | null; // masked for the viewer's role
    tier: string;
    createdAt: string;
    points: number;
    visits: number;
    hasLogin: boolean;
    hasBilling: boolean;
    emailOptIn: boolean;
    // "/m/jake (shared)", "/m/jake (turned off by staff)"... or null.
    profilePage: string | null;
    lineHidden: boolean;
  };
  carried: string[]; // "the phone number", "the birthday"...
  notKept: string[]; // what the duplicate has that won't survive
  sentence: string; // "Jake will have 1 account with 65 points and 1 visit."
}

// The preview is what staff confirm an irreversible merge against, so a
// count that didn't load fails the whole preview (the page says to try
// again) rather than reading as "nothing to move".
async function mustCount(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
}

// Everything that points at a member, counted (what merging moves).
async function memberCounts(db: Db, id: string) {
  const head = { count: "exact" as const, head: true };
  const [visits, orders, allOrders, tickets, allTickets, booths, ledger, badges, rewards, gifts, payments, oldSite] = await Promise.all([
    mustCount(db.from("member_visits").select("id", head).eq("member_id", id)),
    mustCount(db.from("orders").select("id", head).eq("member_id", id).in("status", ["completed", "refunded"])),
    mustCount(db.from("orders").select("id", head).eq("member_id", id)),
    // Online tickets (register tickets are part of their order).
    mustCount(db.from("bookings").select("id", head).eq("member_id", id).is("order_id", null)),
    mustCount(db.from("bookings").select("id", head).eq("member_id", id)),
    mustCount(db.from("booth_reservations").select("id", head).eq("member_id", id)),
    mustCount(db.from("points_ledger").select("id", head).eq("member_id", id)),
    mustCount(db.from("member_badges").select("id", head).eq("member_id", id)),
    mustCount(db.from("member_rewards").select("id", head).eq("member_id", id)),
    mustCount(db.from("gift_memberships").select("id", head).eq("recipient_member_id", id)),
    mustCount(db.from("member_payments").select("id", head).eq("member_id", id)),
    mustCount(db.from("legacy_accounts").select("legacy_user_id", head).eq("imported_member_id", id)),
  ]);
  return { visits, orders, allOrders, tickets, allTickets, booths, ledger, badges, rewards, gifts, payments, oldSite };
}

// Tickets and booths booked as a guest (no member) under an email: the
// merge makes them the kept account's when the duplicate's email doesn't
// stay. Case-insensitive equality, as the database matches them.
async function guestBookings(db: Db, email: string): Promise<{ tickets: number; booths: number }> {
  const head = { count: "exact" as const, head: true };
  const exact = email.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const [tickets, booths] = await Promise.all([
    mustCount(db.from("bookings").select("id", head).is("member_id", null).ilike("customer_email", exact)),
    mustCount(db.from("booth_reservations").select("id", head).is("member_id", null).ilike("customer_email", exact)),
  ]);
  return { tickets, booths };
}

async function visitDates(db: Db, id: string): Promise<string[]> {
  const { data, error } = await db.from("member_visits").select("business_date").eq("member_id", id).limit(2000);
  if (error) throw error;
  return (data ?? []).map((v) => String(v.business_date));
}

async function badgeKeys(db: Db, id: string): Promise<{ badge: string; period: string }[]> {
  const { data, error } = await db.from("member_badges").select("badge, period").eq("member_id", id);
  if (error) throw error;
  return (data ?? []) as { badge: string; period: string }[];
}

async function rewardKeys(db: Db, id: string): Promise<{ badge: string; period: string }[]> {
  const { data, error } = await db.from("member_rewards").select("kind, earned_on").eq("member_id", id);
  if (error) throw error;
  return (data ?? []).map((r) => ({ badge: String(r.kind), period: String(r.earned_on) }));
}

function sideView(m: MergeMember, c: Awaited<ReturnType<typeof memberCounts>>, role: EmployeeRole): MergeSideView {
  return {
    ...candidateView(m, role),
    avatarUrl: m.avatar_url,
    phoneUsable: usablePhone(m.phone),
    hasBilling: hasBilling(m),
    subscriptionStatus: m.subscription_status,
    visits: c.visits,
    orders: c.orders,
    tickets: c.tickets,
    tabletMade: isTabletMade(m),
  };
}

// Null if either account doesn't exist (the page says so). Throws if
// anything it counts couldn't be loaded (the page says to try again).
export async function getMergePreview(keepId: string, dropId: string, role: EmployeeRole): Promise<MergePreview | null> {
  const [keep, drop] = await Promise.all([getMergeMember(keepId), getMergeMember(dropId)]);
  if (!keep || !drop) return null;
  const db = createAdminClient();
  const profile = mergedProfile(keep, drop);
  // The duplicate's email doesn't stay: its guest bookings come over.
  const dropEmail = drop.email?.trim() ?? "";
  const emailGoes = !!dropEmail && dropEmail.toLowerCase() !== (profile.email ?? "").trim().toLowerCase();
  const [kc, dc, kDates, dDates, kBadges, dBadges, kRewards, dRewards, guests] = await Promise.all([
    memberCounts(db, keep.id),
    memberCounts(db, drop.id),
    visitDates(db, keep.id),
    visitDates(db, drop.id),
    badgeKeys(db, keep.id),
    badgeKeys(db, drop.id),
    rewardKeys(db, keep.id),
    rewardKeys(db, drop.id),
    emailGoes ? guestBookings(db, dropEmail) : Promise.resolve({ tickets: 0, booths: 0 }),
  ]);

  const visits = mergedVisitCount(kDates, dDates);
  const sameBadges = badgeOverlap(kBadges, dBadges);
  const sameRewards = badgeOverlap(kRewards, dRewards);

  const moves: string[] = [];
  const add = (n: number, one: string, many?: string) => n > 0 && moves.push(countText(n, one, many));
  add(dc.visits - visits.sameDay, "check-in visit");
  add(dc.ledger, "points history entry", "points history entries");
  add(dc.badges - sameBadges, "badge");
  add(dc.rewards - sameRewards, "reward");
  add(dc.allOrders, "order");
  add(dc.allTickets, "ticket booking");
  add(dc.booths, "booth reservation");
  add(dc.gifts, "gift membership");
  add(dc.payments, "membership payment");
  add(dc.oldSite, "old-site record");
  add(guests.tickets, "ticket booking made as a guest under its email", "ticket bookings made as a guest under its email");
  add(guests.booths, "booth reservation made as a guest under its email", "booth reservations made as a guest under its email");

  const overlaps: string[] = [];
  if (visits.sameDay) overlaps.push(`${countText(visits.sameDay, "day")} both accounts checked in: the kept account's visit stays (its points stay in the history).`);
  if (sameBadges) overlaps.push(`${countText(sameBadges, "badge")} both earned: the earlier one stays.`);
  if (sameRewards) overlaps.push(`${countText(sameRewards, "reward")} both earned the same day: one stays (an unused one if there is one).`);
  if (profile.giftStacked) overlaps.push("Both accounts have gifted Insiders+ time left: it adds up, as gifts do on one account.");

  const notKeptText: Record<MergedProfile["notKept"][number], string> = {
    name: `Its name (${drop.name}): the kept account's name stays. Change it after if it's wrong.`,
    email: "Its email: the kept account's email stays. Removing this member's personal info later still covers anything booked under the other one.",
    phone: "Its phone number: the kept account's phone stays.",
    birthday: "Its birthday: the kept account's stays.",
    photo: "Its photo: the kept account's stays, and the other photo is deleted.",
    tagline: "Its profile line: the kept account's stays.",
    profile_page: `Its profile link (/m/${drop.profile_handle ?? ""}): the kept account's link stays. The old one stops working and is held for this member for 90 days, so nobody else can take it.`,
    flair: "Its check-in flair: the kept account's stays.",
  };
  const result = contactForRole({ email: profile.email, phone: profile.phone }, role);
  const profilePage = profile.profileHandle
    ? `/m/${profile.profileHandle} (${profile.pageHidden ? "turned off by staff" : profile.shareProfile ? "shared" : "not shared"})`
    : null;

  return {
    keep: sideView(keep, kc, role),
    drop: sideView(drop, dc, role),
    refusal: mergeRefusal(keep, drop),
    moves,
    overlaps,
    result: {
      name: profile.name,
      email: result.email ?? null,
      phone: result.phone ?? null,
      tier: profile.tier,
      createdAt: profile.createdAt,
      points: profile.points,
      visits: visits.total,
      hasLogin: profile.hasLogin,
      hasBilling: profile.hasBilling,
      emailOptIn: profile.emailOptIn,
      profilePage,
      lineHidden: profile.lineHidden && !!profile.tagline,
    },
    carried: profile.carried.map((k) => CARRIED_LABEL[k]),
    notKept: profile.notKept.map((k) => notKeptText[k]),
    sentence: mergeSentence(profile.name, profile.points, visits.total),
  };
}

// Where an account went, if it was merged away (the merge log), and the
// account it became's visit count, for the "Merged" message after the
// fact. Null if it wasn't merged (or the log isn't there yet).
export async function mergedInto(droppedId: string): Promise<{ keepId: string; visits: number } | null> {
  if (!UUID.test(droppedId)) return null;
  const db = createAdminClient();
  const { data, error } = await db.from("member_merges").select("keep_id").eq("dropped_id", droppedId).limit(1);
  if (error || !data?.length) return null;
  const keepId = data[0].keep_id as string;
  const { count: visits } = await db.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", keepId);
  return { keepId, visits: visits ?? 0 };
}

// ---------- possible duplicates ----------

interface PairRow {
  older_id: string;
  newer_id: string;
  same_name: boolean;
  same_email: boolean;
  same_phone: boolean;
}

export interface DuplicateSide {
  id: string;
  name: string;
  tier: string;
  points: number;
  createdAt: string;
  lastActivityAt: string | null;
  hasLogin: boolean;
  hasBilling: boolean;
  phoneUsable: boolean;
  oldSite: boolean;
  tabletMade: boolean;
}

export interface DuplicatePair {
  older: DuplicateSide;
  newer: DuplicateSide;
  sameName: boolean;
  sameEmail: boolean;
  samePhone: boolean;
  // Made at the tablet lately, with an older same-name account the tablet
  // couldn't find by phone: the usual duplicate.
  likely: boolean;
  refusal: string | null;
  href: string; // the merge preview, keeping the suggested account
}

export type DuplicatesResult = { ok: true; pairs: DuplicatePair[] } | { ok: false; error: string };

function duplicateSide(m: MergeMember, now: Date): DuplicateSide {
  return {
    id: m.id,
    name: m.name,
    tier: m.tier,
    points: Number(m.points),
    createdAt: m.created_at,
    lastActivityAt: m.last_activity_at,
    hasLogin: hasLogin(m),
    hasBilling: hasBilling(m),
    phoneUsable: usablePhone(m.phone),
    oldSite: m.legacy_user_id != null,
    tabletMade: isTabletMade(m, now),
  };
}

async function membersByIds(db: Db, ids: string[]): Promise<Map<string, MergeMember>> {
  const out = new Map<string, MergeMember>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const results = await Promise.all(chunks.map((chunk) => db.from("members").select(MERGE_MEMBER_COLUMNS).in("id", chunk)));
  for (const { data, error } of results) {
    if (error) throw error;
    for (const r of data ?? []) out.set(r.id as string, asMergeMember(r));
  }
  return out;
}

// Every pair the database finds (one query), with both accounts' details
// (a second, in chunks): the likely tablet duplicates first, then the
// newest. About 2,200 members pair up in well under a second.
export async function getDuplicatePairs(): Promise<DuplicatesResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("member_duplicate_pairs");
  if (error) {
    return { ok: false, error: /member_duplicate_pairs/.test(error.message) ? "The duplicates finder isn't set up yet: the database update for merging (20261001150000) hasn't been applied." : "Couldn't look for duplicates just now. Try again." };
  }
  const rows = (data ?? []) as PairRow[];
  const members = await membersByIds(db, [...new Set(rows.flatMap((r) => [r.older_id, r.newer_id]))]);
  const now = new Date();
  const pairs: DuplicatePair[] = [];
  for (const r of rows) {
    const older = members.get(r.older_id);
    const newer = members.get(r.newer_id);
    if (!older || !newer) continue;
    const { keep, drop } = suggestKeep(older, newer);
    pairs.push({
      older: duplicateSide(older, now),
      newer: duplicateSide(newer, now),
      sameName: r.same_name,
      sameEmail: r.same_email,
      samePhone: r.same_phone,
      likely: isLikelyTabletDuplicate(older, newer, r.same_name, now),
      refusal: mergeRefusal(keep, drop),
      href: mergeHref(keep.id, drop.id),
    });
  }
  pairs.sort(
    (a, b) =>
      Number(b.likely) - Number(a.likely) ||
      Number(!a.refusal) - Number(!b.refusal) ||
      new Date(b.newer.createdAt).getTime() - new Date(a.newer.createdAt).getTime(),
  );
  return { ok: true, pairs };
}

// The other accounts that may be this same person, for the merge page's
// suggestions. Empty if the finder isn't set up yet.
export async function duplicatesOf(memberId: string): Promise<DuplicatePair[]> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("member_duplicate_pairs", { p_member: memberId });
  if (error || !data?.length) return [];
  const rows = data as PairRow[];
  const members = await membersByIds(db, [...new Set(rows.flatMap((r) => [r.older_id, r.newer_id]))]);
  const now = new Date();
  return rows.flatMap((r) => {
    const older = members.get(r.older_id);
    const newer = members.get(r.newer_id);
    if (!older || !newer) return [];
    // Here the account on screen is the one kept.
    const keep = older.id === memberId ? older : newer;
    const drop = older.id === memberId ? newer : older;
    return [
      {
        older: duplicateSide(older, now),
        newer: duplicateSide(newer, now),
        sameName: r.same_name,
        sameEmail: r.same_email,
        samePhone: r.same_phone,
        likely: isLikelyTabletDuplicate(older, newer, r.same_name, now),
        refusal: mergeRefusal(keep, drop),
        href: mergeHref(keep.id, drop.id),
      },
    ];
  });
}

// For the register, after a check-in is confirmed: is this an account the
// tablet made lately, with an older same-name account that has no usable
// phone? Then it's probably the same person. Only the older account's id
// comes back (for a link to the merge preview); nothing is merged here.
// Null when not, or when it can't tell (never in the way of a check-in).
export async function tabletDuplicateOf(memberId: string): Promise<{ olderId: string } | null> {
  if (!UUID.test(memberId)) return null;
  try {
    const db = createAdminClient();
    const { data: m } = await db.from("members").select("id, created_at, phone, legacy_user_id, imported_at, erased_at").eq("id", memberId).maybeSingle();
    if (!m || m.erased_at || !isTabletMade(m)) return null;
    const { data: pairs, error } = await db.rpc("member_duplicate_pairs", { p_member: memberId });
    if (error || !pairs?.length) return null;
    const olderIds = (pairs as PairRow[]).filter((p) => p.same_name && p.newer_id === memberId).map((p) => p.older_id);
    if (!olderIds.length) return null;
    const { data: olders } = await db.from("members").select("id, created_at, phone, legacy_user_id, imported_at").in("id", olderIds).is("erased_at", null);
    const hit = (olders ?? []).find((o) => isLikelyTabletDuplicate(o, m, true));
    return hit ? { olderId: hit.id as string } : null;
  } catch {
    return null;
  }
}
