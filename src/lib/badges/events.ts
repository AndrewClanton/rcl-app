import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitBusinessDate } from "@/lib/visits";
import { DEFAULT_SERIES, MEMBERS_SHOWING, guessSeries } from "@/lib/event-series";
import { P, STARTERS, cleanSpec, type ArtSpec } from "./art";
import { whoCame, showingLabel, type Attendance, type CameFilter } from "./attendance";
import { createDef, forgetCatalog, holderFor, loadCatalog, mintClaims, signedClaims, type CatalogDef, type CopyRow } from "./server";
import type { RuleParams } from "./rules";

// Event badges (Badge Case build 2): badges_defs with rule_type 'event'.
// One showing, one house event, or a series tag ("came to Trivia", "came to
// 5 Trivia nights"). Awarded on their own when attendance (lib/badges/
// attendance.ts) becomes true: at check-in (lib/visits-server.ts), at a
// ticket sale or scan, and by the daily cron for anything missed. The claim
// and its points go through award_member_badge, so points caps and rewards
// are exactly as for any badge; then a signed copy is minted with the
// showing or event that earned it.

type Db = ReturnType<typeof createAdminClient>;

export interface EventRule {
  kind: "screening" | "house_event" | "series";
  match: string;
  times: number;
}

export function eventRule(p: RuleParams | null | undefined): EventRule | null {
  if (!p || (p.kind !== "screening" && p.kind !== "house_event" && p.kind !== "series")) return null;
  const match = typeof p.match === "string" ? p.match.trim() : "";
  if (!match) return null;
  const times = p.kind === "series" && Number.isInteger(p.times) && (p.times ?? 0) >= 1 ? (p.times as number) : 1;
  return { kind: p.kind, match, times };
}

export function targetOf(r: EventRule): CameFilter {
  if (r.kind === "screening") return { screeningIds: [r.match] };
  if (r.kind === "house_event") return { houseEventIds: [r.match] };
  return { series: r.match };
}

const fits = (r: EventRule, a: Attendance) => (r.kind === "series" ? a.series === r.match : a.kind === r.kind && a.id === r.match);

export interface Earned {
  memberId: string;
  att: Attendance; // the showing or event that earned it
  nth: number | null; // their nth of its series, counting that one
}

// Who has earned a rule, from attendance sorted oldest first. `series`:
// attendance of the series the earning ones carry, for "nth".
function earners(r: EventRule, atts: Attendance[], series: Attendance[] = atts): Map<string, Earned> {
  const byMember = new Map<string, Attendance[]>();
  for (const a of atts) if (fits(r, a)) byMember.set(a.memberId, [...(byMember.get(a.memberId) ?? []), a]);
  const out = new Map<string, Earned>();
  for (const [m, list] of byMember) {
    if (list.length < r.times) continue;
    const att = list[r.times - 1];
    let nth: number | null = null;
    if (att.series) {
      const mine = series.filter((s) => s.memberId === m && s.series === att.series);
      const i = mine.findIndex((s) => s.kind === att.kind && s.id === att.id);
      nth = i >= 0 ? i + 1 : null;
    }
    out.set(m, { memberId: m, att, nth });
  }
  return out;
}

const ordinal = (n: number) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

// The stats a copy is minted with: the date, and "5th Trivia night" when
// the showing or event has a series. Its event label is the showing's
// public face or the event's title (lib/badges/attendance.ts).
export function eventStats(e: Earned): Record<string, string | number> {
  const s: Record<string, string | number> = { date: dayLabel(e.att.date) };
  if (e.nth && e.att.series) s.nth = `${ordinal(e.nth)} ${e.att.series} ${e.att.kind === "house_event" ? "night" : "showing"}`.slice(0, 40);
  return s;
}

// Everyone who has earned these rules so far (a dry run, or the award).
async function earnersFor(rules: { rule: EventRule; key: string }[], db: Db, memberIds?: string[]): Promise<Map<string, Map<string, Earned>>> {
  const out = new Map<string, Map<string, Earned>>();
  if (memberIds) {
    const atts = await whoCame({ memberIds }, db);
    for (const { rule, key } of rules) out.set(key, earners(rule, atts));
    return out;
  }
  const seriesCache = new Map<string, Attendance[]>();
  const seriesAtts = async (name: string) => {
    if (!seriesCache.has(name)) seriesCache.set(name, await whoCame({ series: name }, db));
    return seriesCache.get(name)!;
  };
  for (const { rule, key } of rules) {
    const atts = rule.kind === "series" ? await seriesAtts(rule.match) : await whoCame(targetOf(rule), db);
    const first = earners(rule, atts);
    const tags = [...new Set([...first.values()].map((e) => e.att.series).filter((s): s is string => !!s))];
    const series = rule.kind === "series" ? atts : (await Promise.all(tags.map(seriesAtts))).flat();
    out.set(key, earners(rule, atts, series));
  }
  return out;
}

async function erasedAmong(db: Db, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db
      .from("members")
      .select("id")
      .in("id", ids.slice(i, i + 150))
      .not("erased_at", "is", null);
    for (const r of data ?? []) out.add(r.id as string);
  }
  return out;
}

// Claims already made for a badge, by member, and whether each has a signed copy.
async function claimsOf(db: Db, key: string, memberIds: string[]): Promise<Map<string, { id: string; signed: boolean }>> {
  const out = new Map<string, { id: string; signed: boolean }>();
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await db
      .from("member_badges")
      .select("id, member_id, copy_id")
      .eq("badge", key)
      .in("member_id", memberIds.slice(i, i + 150));
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const signed = rows.length ? await signedClaims(db, rows) : new Set<string>();
    for (const r of rows) out.set(r.member_id as string, { id: r.id as string, signed: signed.has(r.id as string) });
  }
  return out;
}

export interface EventAward {
  memberId: string;
  def: CatalogDef;
  copy: CopyRow | null;
  balance: number | null;
}

export interface EventAwardResult {
  perDef: Record<string, { name: string; came: number; toAward: number; awarded: number }>;
  awards: EventAward[];
}

async function mintEvent(db: Db, memberId: string, def: CatalogDef, claimId: string, e: Earned): Promise<CopyRow | null> {
  const holder = await holderFor(memberId, db);
  if (!holder) return null;
  const [copy] = await mintClaims(holder, [{ claimId, key: def.key, period: "", facts: null, event: { kind: e.att.kind, ref: e.att.id, label: e.att.label }, stats: eventStats(e) }], db);
  return copy ?? null;
}

// Awards the active event badges to everyone who has earned them and
// doesn't have them yet (or just counts, with dryRun). memberIds: only
// these members (a check-in, a ticket); defIds: only these badges. Never
// throws for one member's trouble: it's logged and the rest go on.
export async function awardEventBadges(opts: { memberIds?: string[]; defIds?: string[]; dryRun?: boolean; fresh?: boolean } = {}): Promise<EventAwardResult> {
  const db = createAdminClient();
  if (opts.fresh) forgetCatalog();
  const cat = await loadCatalog(db);
  const defs = cat.defs.filter((d) => d.active && d.ruleType === "event" && eventRule(d.params) && (!opts.defIds || opts.defIds.includes(d.id)));
  const result: EventAwardResult = { perDef: {}, awards: [] };
  if (!defs.length || (opts.memberIds && !opts.memberIds.length)) return result;
  const earned = await earnersFor(
    defs.map((d) => ({ rule: eventRule(d.params)!, key: d.key })),
    db,
    opts.memberIds,
  );
  for (const def of defs) {
    const who = earned.get(def.key) ?? new Map<string, Earned>();
    const ids = [...who.keys()];
    const [erased, claims] = await Promise.all([erasedAmong(db, ids), claimsOf(db, def.key, ids)]);
    const todo = ids.filter((m) => !erased.has(m) && !claims.get(m)?.signed);
    const stat = { name: def.name, came: ids.length - erased.size, toAward: todo.filter((m) => !claims.has(m)).length, awarded: 0 };
    result.perDef[def.id] = stat;
    if (opts.dryRun) continue;
    for (const m of todo) {
      try {
        const e = who.get(m)!;
        let claimId = claims.get(m)?.id ?? null;
        let balance: number | null = null;
        if (!claimId) {
          const { data, error } = await db.rpc("award_member_badge", { p_member: m, p_key: def.key, p_period: "", p_points: def.points, p_note: def.name, p_by: null });
          if (error || !data) {
            console.error("event badge award", def.key, error?.code, error?.message);
            continue;
          }
          const r = data as { awarded: boolean; id: string | null; balance: number | string | null };
          if (!r.awarded || !r.id) continue; // claimed a moment ago elsewhere: that one mints it
          claimId = r.id;
          balance = r.balance === null ? null : Number(r.balance);
          stat.awarded++;
        }
        const copy = await mintEvent(db, m, def, claimId, e);
        if (balance !== null) result.awards.push({ memberId: m, def, copy, balance });
      } catch (err) {
        console.error("event badge", def.key, err instanceof Error ? err.message : err);
      }
    }
  }
  return result;
}

// A dry run for a badge that isn't saved yet (Back office's "For an event").
export async function countEarners(rule: EventRule): Promise<{ came: number }> {
  const db = createAdminClient();
  const earned = (await earnersFor([{ rule, key: "_" }], db)).get("_") ?? new Map();
  const ids = [...earned.keys()];
  const erased = await erasedAmong(db, ids);
  return { came: ids.length - erased.size };
}

// The event badges a member just earned, for the check-in screen. Never
// throws: a check-in never fails over a badge.
export async function eventBadgesFor(memberId: string): Promise<EventAward[]> {
  try {
    return (await awardEventBadges({ memberIds: [memberId] })).awards;
  } catch (e) {
    console.error("event badges at check-in", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------- what Back office can pick ----------

export interface EventChoice {
  id: string;
  label: string; // staff-facing: "Fri, Oct 16 · 7:00 PM · Trivia Night"
  series: string | null;
  upcoming: boolean;
}

const TZ = "America/Chicago";
const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function eventChoices(): Promise<{ screenings: EventChoice[]; houseEvents: EventChoice[]; series: string[] }> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const until = new Date(Date.now() + 45 * 86_400_000).toISOString();
  const now = Date.now();
  const [s, h, tags] = await Promise.all([
    db.from("screenings").select("id, starts_at, series, visibility, movie:movies(title)").gte("starts_at", since).lte("starts_at", until).order("starts_at", { ascending: false }).limit(400),
    db.from("house_events").select("id, title, starts_at, series").gte("starts_at", since).lte("starts_at", until).order("starts_at", { ascending: false }).limit(200),
    seriesTags(db),
  ]);
  return {
    screenings: (s.data ?? []).map((r) => {
      const movie = r.movie as unknown as { title: string } | null;
      const vis = r.visibility === "public" ? "" : r.visibility === "members" ? " (members)" : " (private)";
      return { id: r.id as string, label: `${whenLabel(r.starts_at as string)} · ${movie?.title ?? "Movie"}${vis}`, series: (r.series as string | null) ?? null, upcoming: Date.parse(r.starts_at as string) > now };
    }),
    houseEvents: (h.data ?? []).map((r) => ({ id: r.id as string, label: `${whenLabel(r.starts_at as string)} · ${r.title}`, series: (r.series as string | null) ?? null, upcoming: Date.parse(r.starts_at as string) > now })),
    series: tags.filter((t) => t.active).map((t) => t.name),
  };
}

export interface SeriesTag {
  name: string;
  active: boolean;
  sort: number;
}

// The managed list, in order. Falls back to the built-in seven if it can't
// be read (before the migration).
export async function seriesTags(db: Db = createAdminClient()): Promise<SeriesTag[]> {
  const { data, error } = await db.from("event_series").select("name, active, sort").order("sort").order("name");
  if (error) return DEFAULT_SERIES.map((name, i) => ({ name, active: true, sort: (i + 1) * 10 }));
  return (data ?? []).map((r) => ({ name: r.name as string, active: r.active !== false, sort: Number(r.sort) || 0 }));
}

// ---------- drafts from the calendar ----------

const SERIES_LOOK: Record<string, { flavor: string; spec: ArtSpec; times: number }> = {
  Trivia: { flavor: "Knew the line before the line.", spec: STARTERS.find((s) => s.name === "Trivia Night")!.spec, times: 5 },
  "Horror Month": { flavor: "Stayed for the scary part.", spec: STARTERS.find((s) => s.name === "Horror Month")!.spec, times: 3 },
  "Midweek Movies": { flavor: "A Wednesday well spent.", spec: STARTERS.find((s) => s.name === "Midweek Movies")!.spec, times: 5 },
  [MEMBERS_SHOWING]: { flavor: "In the room for the members' cut.", spec: { form: ["crest", { fill: P.navy, edge: P.gold }], parts: [["letterR", { c: P.gold }], ["shine"]] }, times: 3 },
  Outdoor: { flavor: "A movie under the stars.", spec: { form: ["pennant", { fill: P.green }], parts: [["moon", { x: 40, y: 34, s: 0.7 }], ["stars"]] }, times: 3 },
  Comedy: { flavor: "Laughed out loud with the room.", spec: { form: ["button", { fill: P.orange }], parts: [["mic", { x: 42, y: 50, s: 0.7 }], ["speech", { x: 64, y: 34, s: 0.6 }], ["shine"]] }, times: 3 },
  "Book Swap": { flavor: "Left with a better book.", spec: { form: ["patch", { shape: "card", fill: P.cream, stitch: P.teal }], parts: [["gift", { y: 44, s: 0.8 }], ["plate", { t: "BOOK SWAP", w: 60, y: 82 }]] }, times: 3 },
};
const EVENT_LOOK = { flavor: "Was here for it.", spec: STARTERS.find((s) => s.name === "Pizza & a Movie")!.spec };
const SHOWING_LOOK: { flavor: string; spec: ArtSpec } = { flavor: "Saw it on the big screen.", spec: { form: ["stub", { fill: P.navy }], parts: [["filmstrip", { x: 40, y: 52, s: 0.7 }], ["star", { x: 81, y: 50 }]] } };

const md = (iso: string) => {
  const d = visitBusinessDate(new Date(iso));
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
};
// "Trivia Night 10/16", fitting the 32-character name.
const datedName = (title: string, iso: string) => {
  const tail = ` ${md(iso)}`;
  return `${title.trim().slice(0, 32 - tail.length).trim()}${tail}`;
};

export interface DraftRow {
  id: string;
  sourceKind: "screening" | "house_event" | "series";
  sourceRef: string;
  sourceLabel: string;
  startsAt: string | null;
  times: number;
  name: string;
  flavor: string;
  spec: ArtSpec;
  formLabel: string | null;
  points: number;
}

// Drafts for upcoming house events and tagged showings in the next 14
// days, and one "came to N" draft per series they carry that has no series
// badge yet. Each thing gets one draft, ever (a skipped one stays skipped),
// and none when an event badge already points at it. Awards nothing.
export async function refreshDrafts(days = 14): Promise<{ added: number }> {
  const db = createAdminClient();
  forgetCatalog();
  const cat = await loadCatalog(db);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000).toISOString();
  const [h, s, existing] = await Promise.all([
    db.from("house_events").select("id, title, starts_at, series").gte("starts_at", now.toISOString()).lte("starts_at", until).order("starts_at"),
    db.from("screenings").select("id, starts_at, series, visibility, movie:movies(title, release_year)").not("series", "is", null).gte("starts_at", now.toISOString()).lte("starts_at", until).order("starts_at"),
    db.from("badge_drafts").select("source_kind, source_ref"),
  ]);
  if (h.error || s.error || existing.error) throw new Error((h.error ?? s.error ?? existing.error)!.message);
  const taken = new Set((existing.data ?? []).map((r) => `${r.source_kind}|${r.source_ref}`));
  for (const d of cat.defs) {
    const r = d.ruleType === "event" ? eventRule(d.params) : null;
    if (r) taken.add(`${r.kind}|${r.match}`);
  }
  const rows: Record<string, unknown>[] = [];
  const add = (row: Omit<DraftRow, "id">) => {
    const k = `${row.sourceKind}|${row.sourceRef}`;
    if (taken.has(k)) return;
    taken.add(k);
    const spec = cleanSpec(row.spec);
    if (!spec) return;
    rows.push({
      source_kind: row.sourceKind,
      source_ref: row.sourceRef,
      source_label: row.sourceLabel.slice(0, 120),
      starts_at: row.startsAt,
      times: row.times,
      name: row.name.slice(0, 32),
      flavor: row.flavor.slice(0, 80),
      parts_spec: spec,
      form_label: row.formLabel,
      points: row.points,
    });
  };
  const seriesSeen = new Map<string, "screening" | "house_event">();
  const tags = (await seriesTags(db)).filter((t) => t.active).map((t) => t.name);
  for (const e of h.data ?? []) {
    // Untagged, its name may still say which series it looks like.
    const look = SERIES_LOOK[(e.series as string | null) ?? guessSeries(e.title as string, tags) ?? ""] ?? EVENT_LOOK;
    add({ sourceKind: "house_event", sourceRef: e.id as string, sourceLabel: `${whenLabel(e.starts_at as string)} · ${e.title}`, startsAt: e.starts_at as string, times: 1, name: datedName(e.title as string, e.starts_at as string), flavor: look.flavor, spec: look.spec, formLabel: null, points: 25 });
    if (e.series && !seriesSeen.has(e.series as string)) seriesSeen.set(e.series as string, "house_event");
  }
  for (const r of s.data ?? []) {
    const row = r as unknown as { id: string; starts_at: string; series: string; visibility: string | null; movie: { title: string | null; release_year: number | null } | null };
    const face = showingLabel(row, now);
    const look = SERIES_LOOK[row.series] ?? SHOWING_LOOK;
    // A members' or unadvertisable title never goes on the card: the series names it.
    const name = face === MEMBERS_SHOWING ? datedName(row.series, row.starts_at) : datedName(face, row.starts_at);
    add({ sourceKind: "screening", sourceRef: row.id, sourceLabel: `${whenLabel(row.starts_at)} · ${row.movie?.title ?? "Movie"} (${row.series})`, startsAt: row.starts_at, times: 1, name, flavor: look.flavor, spec: look.spec, formLabel: null, points: 25 });
    if (!seriesSeen.has(row.series)) seriesSeen.set(row.series, "screening");
  }
  for (const [name, kind] of seriesSeen) {
    const look = SERIES_LOOK[name] ?? (kind === "house_event" ? { ...EVENT_LOOK, times: 5 } : { ...SHOWING_LOOK, times: 5 });
    const unit = kind === "house_event" ? "nights" : "showings";
    add({ sourceKind: "series", sourceRef: name, sourceLabel: `Series: ${name}, ${look.times} ${unit}`, startsAt: null, times: look.times, name: `${name} Regular`.slice(0, 32), flavor: `Came to ${look.times} ${name} ${unit}.`, spec: look.spec, formLabel: null, points: 50 });
  }
  if (rows.length) {
    const { error } = await db.from("badge_drafts").upsert(rows, { onConflict: "source_kind,source_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { added: rows.length };
}

export async function openDrafts(): Promise<DraftRow[]> {
  const { data, error } = await createAdminClient()
    .from("badge_drafts")
    .select("id, source_kind, source_ref, source_label, starts_at, times, name, flavor, parts_spec, form_label, points")
    .eq("status", "open")
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(60);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    sourceKind: r.source_kind as DraftRow["sourceKind"],
    sourceRef: r.source_ref as string,
    sourceLabel: r.source_label as string,
    startsAt: (r.starts_at as string | null) ?? null,
    times: Number(r.times) || 1,
    name: r.name as string,
    flavor: (r.flavor as string) ?? "",
    spec: r.parts_spec as ArtSpec,
    formLabel: (r.form_label as string | null) ?? null,
    points: Number(r.points) || 0,
  }));
}

// Approving a draft makes it a badge (with its edits) and awards it to
// everyone who already came; anyone who comes later gets it then.
export async function approveDraft(
  id: string,
  edits: { name: string; flavor: string; points: number },
  by: string | null,
): Promise<{ ok: true; defId: string; awarded: number } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data: d } = await db.from("badge_drafts").select("*").eq("id", id).eq("status", "open").maybeSingle();
  if (!d) return { ok: false, error: "That draft was already handled." };
  const made = await createDef({
    name: edits.name,
    flavor: edits.flavor,
    spec: d.parts_spec,
    formLabel: (d.form_label as string | null) ?? null,
    ruleType: "event",
    params: { kind: d.source_kind as EventRule["kind"], match: d.source_ref as string, times: Number(d.times) || 1 },
    points: edits.points,
    cheer: null,
    createdBy: by,
  });
  if (!made.ok) return made;
  await db.from("badge_drafts").update({ status: "approved", def_id: made.id, decided_by: by, decided_at: new Date().toISOString(), name: edits.name, flavor: edits.flavor, points: edits.points }).eq("id", id);
  const r = await awardEventBadges({ defIds: [made.id], fresh: true });
  return { ok: true, defId: made.id, awarded: r.perDef[made.id]?.awarded ?? 0 };
}

export async function skipDraft(id: string, by: string | null): Promise<void> {
  await createAdminClient().from("badge_drafts").update({ status: "skipped", decided_by: by, decided_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
}

// What an event badge points at, said for staff: "Trivia, 5 times".
export async function describeRule(p: RuleParams): Promise<string | null> {
  const r = eventRule(p);
  if (!r) return null;
  if (r.kind === "series") return `Any ${r.match} showing or event${r.times > 1 ? `, ${r.times} times` : ""}`;
  const db = createAdminClient();
  if (r.kind === "house_event") {
    const { data } = await db.from("house_events").select("title, starts_at").eq("id", r.match).maybeSingle();
    return data ? `${data.title}, ${whenLabel(data.starts_at as string)}` : "A house event that's been removed";
  }
  const { data } = await db.from("screenings").select("starts_at, movie:movies(title)").eq("id", r.match).maybeSingle();
  const movie = data?.movie as unknown as { title: string } | null;
  return data ? `${movie?.title ?? "A showing"}, ${whenLabel(data.starts_at as string)}` : "A showing that's been removed";
}
