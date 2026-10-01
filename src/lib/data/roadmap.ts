import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRestrictedRelease } from "@/lib/mplc";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { creditName, isRoadmapStatus, parseHistory, releaseLabel, type HistoryEntry, type RoadmapStatus } from "@/lib/roadmap";

// Reads for What's new (/whats-new) and Back office → Roadmap. The public
// side only ever gets what toPublic() builds: never internal notes, member
// ids, members' notes or suggestions, staff names, or a credit the
// requester didn't agree to.

const ITEM_COLUMNS =
  "id, slug, title, public_summary, internal_notes, status, rank, is_public, requested_by_member_id, requested_by_name, credit_ok, shipped_in_version, created_at, updated_at, status_changed_at, shipped_at, history";

interface ItemRow {
  id: string;
  slug: string;
  title: string;
  public_summary: string;
  internal_notes: string | null;
  status: string;
  rank: number;
  is_public: boolean;
  requested_by_member_id: string | null;
  requested_by_name: string | null;
  credit_ok: boolean;
  shipped_in_version: string | null;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  shipped_at: string | null;
  history: unknown;
}

export interface PublicRoadmapItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
  position: number | null; // "#3 in line", for queued items
  updatedAt: string;
  statusSince: string;
  shippedAt: string | null;
  release: string | null; // "1.4"
  credit: string | null; // "Jake B.", only with the requester's OK
  votes: number;
  createdAt: string;
  history: HistoryEntry[];
}

export interface PublicRoadmap {
  building: PublicRoadmapItem[]; // building, then final checks
  shipped: PublicRoadmapItem[]; // newest first
  queued: PublicRoadmapItem[]; // in line order
  ideas: PublicRoadmapItem[]; // most wanted first
  lastUpdate: string | null;
}

function byRank(a: ItemRow, b: ItemRow) {
  return a.rank - b.rank || a.created_at.localeCompare(b.created_at);
}

async function voteCounts(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  const { data, error } = await createAdminClient().rpc("roadmap_vote_counts", { p_items: ids });
  if (error) throw error;
  for (const r of (data ?? []) as { item_id: string; votes: number | string }[]) counts.set(r.item_id, Number(r.votes));
  return counts;
}

// Credits that may be shown: the requester agreed (credit_ok), and isn't
// staff. A linked member who is also a staff login gets none, and neither
// does a name that comes out the same as any staff member's ("Jake B."),
// so the owners and the crew are never named on a public page.
async function publicCredits(rows: ItemRow[]): Promise<Map<string, string>> {
  const credits = new Map<string, string>();
  const wanting = rows.filter((r) => r.credit_ok && (r.requested_by_member_id || r.requested_by_name));
  if (!wanting.length) return credits;
  const db = createAdminClient();
  const memberIds = [...new Set(wanting.map((r) => r.requested_by_member_id).filter((x): x is string => !!x))];
  const [members, staff] = await Promise.all([
    memberIds.length ? db.from("members").select("id, name, auth_user_id, erased_at").in("id", memberIds) : Promise.resolve({ data: [], error: null }),
    db.from("employees").select("name, auth_user_id"),
  ]);
  if (members.error) throw members.error;
  if (staff.error) throw staff.error;
  const staffLogins = new Set((staff.data ?? []).map((e) => e.auth_user_id as string | null).filter(Boolean));
  const staffNames = new Set((staff.data ?? []).map((e) => creditName(e.name as string)).filter(Boolean));
  const byId = new Map((members.data ?? []).map((m) => [m.id as string, m as { id: string; name: string | null; auth_user_id: string | null; erased_at: string | null }]));
  for (const r of wanting) {
    let name: string | null = null;
    if (r.requested_by_member_id) {
      const m = byId.get(r.requested_by_member_id);
      if (!m || m.erased_at || (m.auth_user_id && staffLogins.has(m.auth_user_id))) continue;
      name = creditName(m.name);
    } else {
      name = creditName(r.requested_by_name);
    }
    if (name && !staffNames.has(name)) credits.set(r.id, name);
  }
  return credits;
}

function toPublic(r: ItemRow, votes: number, credit: string | null, position: number | null): PublicRoadmapItem {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.public_summary,
    status: isRoadmapStatus(r.status) ? r.status : "idea",
    position,
    updatedAt: r.updated_at > r.status_changed_at ? r.updated_at : r.status_changed_at,
    statusSince: r.status_changed_at,
    shippedAt: r.shipped_at,
    release: releaseLabel(r.shipped_in_version),
    credit,
    votes,
    createdAt: r.created_at,
    history: parseHistory(r.history),
  };
}

async function publicRows(): Promise<ItemRow[]> {
  const { data, error } = await createAdminClient().from("roadmap_items").select(ITEM_COLUMNS).eq("is_public", true);
  if (error) throw error;
  return (data ?? []) as ItemRow[];
}

// Positions in line count public items only, so a hidden item never leaves
// a gap ("#1, #3") that gives it away.
function queuePositions(rows: ItemRow[]): Map<string, number> {
  return new Map(
    rows
      .filter((r) => r.status === "queued")
      .sort(byRank)
      .map((r, i) => [r.id, i + 1]),
  );
}

export async function getPublicRoadmap(): Promise<PublicRoadmap> {
  const rows = (await publicRows()).filter((r) => r.status !== "not_doing");
  const [votes, credits] = await Promise.all([voteCounts(rows.map((r) => r.id)), publicCredits(rows)]);
  const positions = queuePositions(rows);
  const pub = (r: ItemRow) => toPublic(r, votes.get(r.id) ?? 0, credits.get(r.id) ?? null, positions.get(r.id) ?? null);

  const building = rows
    .filter((r) => r.status === "building" || r.status === "reviewing")
    .sort((a, b) => (a.status === b.status ? byRank(a, b) : a.status === "building" ? -1 : 1))
    .map(pub);
  const shipped = rows
    .filter((r) => r.status === "live")
    .sort((a, b) => (b.shipped_at ?? b.status_changed_at).localeCompare(a.shipped_at ?? a.status_changed_at) || byRank(a, b))
    .map(pub);
  const queued = rows.filter((r) => r.status === "queued").sort(byRank).map(pub);
  const ideas = rows
    .filter((r) => r.status === "idea")
    .sort(byRank)
    .map(pub)
    .sort((a, b) => b.votes - a.votes);
  const lastUpdate = rows.reduce<string | null>((max, r) => {
    const t = r.updated_at > r.status_changed_at ? r.updated_at : r.status_changed_at;
    return !max || t > max ? t : max;
  }, null);
  return { building, shipped, queued, ideas, lastUpdate };
}

// One item for its own page: public items only (not_doing included, so a
// link someone was sent still says where it ended up).
// Cached per request: the page and its metadata share one read.
export const getPublicRoadmapItem = cache(async (slug: string): Promise<PublicRoadmapItem | null> => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const rows = await publicRows();
  const row = rows.find((r) => r.slug === slug);
  if (!row) return null;
  const [votes, credits] = await Promise.all([voteCounts([row.id]), publicCredits([row])]);
  return toPublic(row, votes.get(row.id) ?? 0, credits.get(row.id) ?? null, queuePositions(rows).get(row.id) ?? null);
});

// ---------- the signed-in member's own ----------

export interface MySuggestion {
  id: string;
  body: string;
  status: "new" | "accepted" | "declined";
  createdAt: string;
  itemSlug: string | null; // the item it became, when that's public
  itemTitle: string | null;
}

export interface MemberRoadmapState {
  voted: string[]; // item ids
  suggestions: MySuggestion[];
}

export async function getMemberRoadmapState(memberId: string): Promise<MemberRoadmapState> {
  const db = createAdminClient();
  const [votes, suggestions] = await Promise.all([
    db.from("roadmap_votes").select("item_id").eq("member_id", memberId).limit(1000),
    db
      .from("roadmap_suggestions")
      .select("id, body, status, created_at, item:roadmap_items(slug, title, is_public)")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (votes.error) throw votes.error;
  if (suggestions.error) throw suggestions.error;
  return {
    voted: (votes.data ?? []).map((v) => v.item_id as string),
    suggestions: ((suggestions.data ?? []) as unknown as { id: string; body: string; status: MySuggestion["status"]; created_at: string; item: { slug: string; title: string; is_public: boolean } | null }[]).map(
      (s) => ({
        id: s.id,
        body: s.body,
        status: s.status,
        createdAt: s.created_at,
        itemSlug: s.item?.is_public ? s.item.slug : null,
        itemTitle: s.item?.is_public ? s.item.title : null,
      }),
    ),
  };
}

// ---------- Back office ----------

export interface AdminRoadmapNote {
  id: string;
  body: string;
  createdAt: string;
  memberId: string;
  memberName: string;
}

export interface AdminRoadmapItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  internalNotes: string;
  status: RoadmapStatus;
  rank: number;
  isPublic: boolean;
  requester: { memberId: string | null; memberName: string | null; name: string | null };
  creditOk: boolean;
  publicCredit: string | null; // what the public page shows, if anything
  shippedInVersion: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  shippedAt: string | null;
  votes: number;
  notes: AdminRoadmapNote[];
  fromSuggestion: boolean;
}

export interface AdminSuggestion {
  id: string;
  body: string;
  creditOk: boolean;
  status: "new" | "accepted" | "declined";
  createdAt: string;
  memberId: string | null;
  who: string; // the member's name, or the typed name
  typedName: string | null; // the name staff typed, when it's not a member
  hint: string | null; // masked contact, to tell two Sarahs apart
  loggedBy: string | null; // staff who logged it for someone
  itemSlug: string | null;
  itemTitle: string | null;
}

export interface AdminRoadmap {
  items: AdminRoadmapItem[];
  inbox: AdminSuggestion[]; // new, oldest first
  decided: AdminSuggestion[]; // recently accepted or declined
}

export async function getAdminRoadmap(): Promise<AdminRoadmap> {
  const db = createAdminClient();
  const [items, notes, suggestions] = await Promise.all([
    db.from("roadmap_items").select(ITEM_COLUMNS).order("rank").limit(2000),
    db.from("roadmap_notes").select("id, item_id, member_id, body, created_at").order("created_at", { ascending: false }).limit(1000),
    db
      .from("roadmap_suggestions")
      .select("id, member_id, name, body, credit_ok, status, created_at, decided_at, item_id, logged:employees!roadmap_suggestions_logged_by_fkey(name), item:roadmap_items(slug, title)")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  if (items.error) throw items.error;
  if (notes.error) throw notes.error;
  if (suggestions.error) throw suggestions.error;
  const rows = (items.data ?? []) as ItemRow[];
  const sugg = (suggestions.data ?? []) as unknown as {
    id: string;
    member_id: string | null;
    name: string | null;
    body: string;
    credit_ok: boolean;
    status: AdminSuggestion["status"];
    created_at: string;
    decided_at: string | null;
    item_id: string | null;
    logged: { name: string } | null;
    item: { slug: string; title: string } | null;
  }[];
  const noteRows = (notes.data ?? []) as { id: string; item_id: string; member_id: string; body: string; created_at: string }[];

  const memberIds = [...new Set([...rows.map((r) => r.requested_by_member_id), ...noteRows.map((n) => n.member_id), ...sugg.map((s) => s.member_id)].filter((x): x is string => !!x))];
  const members = new Map<string, { name: string | null; email: string | null; phone: string | null }>();
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await db.from("members").select("id, name, email, phone").in("id", memberIds.slice(i, i + 150));
    if (error) throw error;
    for (const m of data ?? []) members.set(m.id as string, { name: m.name as string | null, email: m.email as string | null, phone: m.phone as string | null });
  }
  const [votes, credits] = await Promise.all([voteCounts(rows.map((r) => r.id)), publicCredits(rows)]);
  const fromSuggestion = new Set(sugg.map((s) => s.item_id).filter(Boolean));
  const notesByItem = new Map<string, AdminRoadmapNote[]>();
  for (const n of noteRows) {
    const list = notesByItem.get(n.item_id) ?? [];
    list.push({ id: n.id, body: n.body, createdAt: n.created_at, memberId: n.member_id, memberName: members.get(n.member_id)?.name || "A member" });
    notesByItem.set(n.item_id, list);
  }

  const toSuggestion = (s: (typeof sugg)[number]): AdminSuggestion => {
    const m = s.member_id ? members.get(s.member_id) : undefined;
    return {
      id: s.id,
      body: s.body,
      creditOk: s.credit_ok,
      status: s.status,
      createdAt: s.created_at,
      memberId: s.member_id,
      who: m?.name || s.name || "Someone",
      typedName: s.member_id ? null : s.name,
      hint: m ? [maskEmail(m.email), maskPhone(m.phone)].filter(Boolean).join(" · ") || null : null,
      loggedBy: s.logged?.name ?? null,
      itemSlug: s.item?.slug ?? null,
      itemTitle: s.item?.title ?? null,
    };
  };

  return {
    items: rows.sort(byRank).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.public_summary,
      internalNotes: r.internal_notes ?? "",
      status: isRoadmapStatus(r.status) ? r.status : "idea",
      rank: r.rank,
      isPublic: r.is_public,
      requester: {
        memberId: r.requested_by_member_id,
        memberName: r.requested_by_member_id ? (members.get(r.requested_by_member_id)?.name ?? "A member") : null,
        name: r.requested_by_name,
      },
      creditOk: r.credit_ok,
      publicCredit: credits.get(r.id) ?? null,
      shippedInVersion: r.shipped_in_version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      statusChangedAt: r.status_changed_at,
      shippedAt: r.shipped_at,
      votes: votes.get(r.id) ?? 0,
      notes: notesByItem.get(r.id) ?? [],
      fromSuggestion: fromSuggestion.has(r.id),
    })),
    inbox: sugg
      .filter((s) => s.status === "new")
      .reverse()
      .map(toSuggestion),
    decided: sugg
      .filter((s) => s.status !== "new")
      .sort((a, b) => (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at))
      .slice(0, 20)
      .map(toSuggestion),
  };
}

// ---------- names that must never go public ----------

// Archive films (our MPLC license lets us name only this year's releases
// publicly: lib/mplc.ts) and private events (their names and hosts) that a
// public title or summary mentions. Back office asks before saving one.
// RegExp constructor: \p{} needs a newer target than this project compiles to.
const NOT_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");

export async function privateNamesIn(text: string): Promise<string[]> {
  const words = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(NOT_WORD, " ").trim();
  const hay = ` ${words(text)} `;
  if (!hay.trim()) return [];
  const db = createAdminClient();
  const [movies, events] = await Promise.all([db.from("movies").select("title, release_year").limit(5000), db.from("events").select("event_name, organizer_name").limit(5000)]);
  const found = new Set<string>();
  for (const m of (movies.data ?? []) as { title: string | null; release_year: number | null }[]) {
    const w = words(m.title);
    if (w.length >= 4 && isRestrictedRelease(m) && hay.includes(` ${w} `)) found.add(`the film "${m.title}"`);
  }
  for (const e of (events.data ?? []) as { event_name: string | null; organizer_name: string | null }[]) {
    const host = words(e.organizer_name);
    if (host.length >= 5 && host.includes(" ") && hay.includes(` ${host} `)) found.add("a private event's host");
    const name = words(e.event_name);
    if (name.length >= 8 && hay.includes(` ${name} `)) found.add(`the private event "${e.event_name}"`);
  }
  return [...found].slice(0, 5);
}
