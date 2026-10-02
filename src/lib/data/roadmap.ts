import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRoadmapStatus, type RoadmapStatus } from "@/lib/roadmap";

// Reads for Back office → Roadmap, the crew's own list of what's shipped,
// being built, in line and being considered. Staff only: nothing here
// reaches a public page.
//
// The table still has columns from when the list had a public page
// (is_public, credit_ok, and the votes, notes and suggestions tables).
// They're left in place, unused; members' notes from back then still show
// on their item.

const ITEM_COLUMNS =
  "id, slug, title, public_summary, internal_notes, status, rank, requested_by_member_id, requested_by_name, shipped_in_version, created_at, updated_at, status_changed_at, shipped_at";

interface ItemRow {
  id: string;
  slug: string;
  title: string;
  public_summary: string;
  internal_notes: string | null;
  status: string;
  rank: number;
  requested_by_member_id: string | null;
  requested_by_name: string | null;
  shipped_in_version: string | null;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  shipped_at: string | null;
}

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
  requester: { memberId: string | null; memberName: string | null; name: string | null };
  shippedInVersion: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  shippedAt: string | null;
  notes: AdminRoadmapNote[]; // left by members on the old public page
}

function byRank(a: ItemRow, b: ItemRow) {
  return a.rank - b.rank || a.created_at.localeCompare(b.created_at);
}

// Every item, in rank order (the queue's order for items in line).
export async function getAdminRoadmap(): Promise<AdminRoadmapItem[]> {
  const db = createAdminClient();
  const [items, notes] = await Promise.all([
    db.from("roadmap_items").select(ITEM_COLUMNS).order("rank").limit(2000),
    db.from("roadmap_notes").select("id, item_id, member_id, body, created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  if (items.error) throw items.error;
  if (notes.error) throw notes.error;
  const rows = (items.data ?? []) as ItemRow[];
  const noteRows = (notes.data ?? []) as { id: string; item_id: string; member_id: string; body: string; created_at: string }[];

  const memberIds = [...new Set([...rows.map((r) => r.requested_by_member_id), ...noteRows.map((n) => n.member_id)].filter((x): x is string => !!x))];
  const names = new Map<string, string | null>();
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await db.from("members").select("id, name").in("id", memberIds.slice(i, i + 150));
    if (error) throw error;
    for (const m of data ?? []) names.set(m.id as string, m.name as string | null);
  }
  const notesByItem = new Map<string, AdminRoadmapNote[]>();
  for (const n of noteRows) {
    const list = notesByItem.get(n.item_id) ?? [];
    list.push({ id: n.id, body: n.body, createdAt: n.created_at, memberId: n.member_id, memberName: names.get(n.member_id) || "A member" });
    notesByItem.set(n.item_id, list);
  }

  return rows.sort(byRank).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.public_summary,
    internalNotes: r.internal_notes ?? "",
    status: isRoadmapStatus(r.status) ? r.status : "idea",
    rank: r.rank,
    requester: {
      memberId: r.requested_by_member_id,
      memberName: r.requested_by_member_id ? (names.get(r.requested_by_member_id) ?? "A member") : null,
      name: r.requested_by_name,
    },
    shippedInVersion: r.shipped_in_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    statusChangedAt: r.status_changed_at,
    shippedAt: r.shipped_at,
    notes: notesByItem.get(r.id) ?? [],
  }));
}
