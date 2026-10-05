import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { getLineup, LINEUP_DEFAULT_DAYS, LINEUP_MAX_DAYS } from "@/lib/data/lineup";
import { isRestrictedRelease } from "@/lib/mplc";
import { referencedIds, type CampaignContent, type HappeningData, type MenuItemData, type RenderData } from "./render";

// Loads what an email's blocks point at, from the database: the films and
// showtimes in its date range, house events, menu items. Content comes only
// from `house_events`, never the private bookings table.

export function contentRange(content: CampaignContent, today = businessDay().date): { start: string; days: number } {
  const r = content.lineup ?? content.window;
  const start = r?.start && /^\d{4}-\d{2}-\d{2}$/.test(r.start) ? r.start : today;
  const days = Math.max(1, Math.min(LINEUP_MAX_DAYS, Math.floor(Number(r?.days)) || LINEUP_DEFAULT_DAYS));
  return { start, days };
}

export async function loadRenderData(content: CampaignContent): Promise<RenderData> {
  const range = contentRange(content);
  const lineup = await getLineup(range.start, range.days);
  const ids = referencedIds(content);
  const admin = createAdminClient();

  const happenings = new Map<string, HappeningData>(lineup.happenings.map((h) => [h.id, h]));
  const missingEvents = ids.events.filter((id) => !happenings.has(id) && /^[0-9a-f-]{36}$/i.test(id));
  if (missingEvents.length) {
    const { data } = await admin.from("house_events").select("id, title, note, starts_at").in("id", missingEvents);
    for (const h of data ?? []) happenings.set(h.id, { id: h.id, title: h.title, note: h.note, startsAt: h.starts_at });
  }

  let menuItems: MenuItemData[] = [];
  const itemIds = ids.items.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (itemIds.length) {
    const { data } = await admin.from("menu_items").select("id, name, price").in("id", itemIds);
    menuItems = (data ?? []).map((m) => ({ id: m.id, name: m.name, price: Number(m.price) || 0 }));
  }

  return { range, films: lineup.films, happenings: [...happenings.values()], menuItems };
}

// Every restricted (older) title in the film library, for the subject and
// preview-text check. Not just this week's: an old title in a subject line
// is a problem whenever it's showing.
export async function restrictedTitles(): Promise<string[]> {
  const { data, error } = await createAdminClient().from("movies").select("title, release_year");
  if (error) throw new Error("Couldn't load the film library.");
  return (data ?? []).filter((m) => isRestrictedRelease(m)).map((m) => m.title as string);
}

// House event ids in the content that aren't house events (the lint's
// "never a private event" check).
export async function unknownHouseEventIds(content: CampaignContent): Promise<string[]> {
  const ids = referencedIds(content).events;
  if (!ids.length) return [];
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const { data } = valid.length ? await createAdminClient().from("house_events").select("id").in("id", valid) : { data: [] as { id: string }[] };
  const found = new Set((data ?? []).map((d) => d.id));
  return ids.filter((id) => !found.has(id));
}

export interface ComposerOptions {
  films: { id: string; title: string; archive: boolean; firstShow: string | null }[];
  houseEvents: { id: string; title: string; startsAt: string }[];
  menuItems: { id: string; name: string; price: number }[];
  campaigns: { id: string; name: string }[];
  restrictedTitles: string[];
}

// The pickers in the composer: films showing in the next two weeks, house
// events in the next two months, the menu, and recent campaigns.
export async function composerOptions(): Promise<ComposerOptions> {
  const admin = createAdminClient();
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const in60 = new Date(now.getTime() + 60 * 86_400_000).toISOString();
  const [scr, ev, items, camps, titles] = await Promise.all([
    // A private group's showing is never offered for an email.
    admin.from("screenings").select("starts_at, movie:movies(id, title, release_year)").neq("visibility", "private").gte("starts_at", now.toISOString()).lt("starts_at", in14).order("starts_at"),
    admin.from("house_events").select("id, title, starts_at").gte("starts_at", now.toISOString()).lt("starts_at", in60).order("starts_at"),
    admin.from("menu_items").select("id, name, price").eq("active", true).order("name"),
    admin.from("email_campaigns").select("id, name").is("automation", null).in("status", ["sending", "sent", "scheduled"]).order("created_at", { ascending: false }).limit(40),
    restrictedTitles().catch(() => [] as string[]),
  ]);
  const films = new Map<string, ComposerOptions["films"][number]>();
  for (const s of (scr.data ?? []) as unknown as { starts_at: string; movie: { id: string; title: string; release_year: number | null } | null }[]) {
    if (!s.movie || films.has(s.movie.id)) continue;
    films.set(s.movie.id, { id: s.movie.id, title: s.movie.title, archive: isRestrictedRelease(s.movie), firstShow: s.starts_at });
  }
  return {
    films: [...films.values()],
    houseEvents: (ev.data ?? []).map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at })),
    menuItems: (items.data ?? []).map((m) => ({ id: m.id, name: m.name, price: Number(m.price) || 0 })),
    campaigns: (camps.data ?? []) as { id: string; name: string }[],
    restrictedTitles: titles,
  };
}
