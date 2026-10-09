import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RewardKind, VisitFacts } from "@/lib/visits";
import { GENERATOR, cleanSpec, renderArt, type ArtSpec } from "./art";
import { cardBackSvg, cardFrontSvg, cleanThresholds, rarityFor, statLines, type BadgeCardData, type RarityThresholds } from "./card";
import { artHash, signCert, verifyCert, type CertFields } from "./cert";
import { FALLBACK_DEFS, RULE_TYPES, statsFor, type RuleDef, type RuleParams, type RuleType } from "./rules";

// The Badge Case on the server: the catalog (badge_defs), minting signed
// copies (badge_copies) for claims (member_badges), and the cards the pages
// show. See supabase/migrations/20261009030000_badge_case.sql.
//
// Minting a copy: badge_reserve_copy gives it the badge's next serial and
// freezes its face and stats; then the art is drawn (lib/badges/art.ts, the
// def's generator), hashed and signed (lib/badges/cert.ts) and written once.
// A copy that was reserved but not signed (no BADGE_SIGNING_KEY, a dropped
// connection) is finished by the next ensureCopies; pages only ever show
// signed copies.

type Db = ReturnType<typeof createAdminClient>;

export interface Issuer {
  id: string;
  name: string;
  publicKey: string | null;
  verifyUrlBase: string;
}

export interface CatalogDef {
  id: string;
  key: string;
  name: string;
  flavor: string;
  issuerId: string;
  seriesId: string;
  series: number;
  setNumber: number;
  ruleType: RuleType;
  params: RuleParams;
  period: "once" | "yearly";
  points: number;
  reward: RewardKind | null;
  cheer: string | null;
  formLabel: string | null;
  spec: ArtSpec;
  generator: string;
  minted: number;
  active: boolean;
}

interface Catalog {
  issuer: Issuer;
  defs: CatalogDef[];
  setSize: Map<number, number>; // series number -> badges in it
  thresholds: Map<number, RarityThresholds>;
}

const CATALOG_MS = 60_000;
let catalogCache: { at: number; value: Catalog } | null = null;

export function forgetCatalog() {
  catalogCache = null;
}

export async function loadCatalog(db: Db = createAdminClient()): Promise<Catalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_MS) return catalogCache.value;
  const [iss, ser, defs] = await Promise.all([
    db.from("badge_issuers").select("id, name, public_key, verify_url_base").eq("slug", "rcl").single(),
    db.from("badge_series").select("id, number, rarity_thresholds"),
    db
      .from("badge_defs")
      .select("id, key, name, flavor, issuer_id, series_id, set_number, rule_type, rule_params, period, points, reward, cheer, form_label, parts_spec, generator, minted_count, active")
      .order("set_number"),
  ]);
  if (iss.error || ser.error || defs.error) throw new Error(`badge catalog: ${(iss.error ?? ser.error ?? defs.error)?.message}`);
  const seriesNo = new Map((ser.data ?? []).map((s) => [s.id as string, Number(s.number)]));
  const thresholds = new Map((ser.data ?? []).map((s) => [Number(s.number), cleanThresholds(s.rarity_thresholds)]));
  const list: CatalogDef[] = (defs.data ?? []).map((d) => ({
    id: d.id as string,
    key: d.key as string,
    name: d.name as string,
    flavor: (d.flavor as string) ?? "",
    issuerId: d.issuer_id as string,
    seriesId: d.series_id as string,
    series: seriesNo.get(d.series_id as string) ?? 1,
    setNumber: Number(d.set_number),
    ruleType: d.rule_type as RuleType,
    params: (d.rule_params ?? {}) as RuleParams,
    period: d.period === "yearly" ? "yearly" : "once",
    points: Number(d.points) || 0,
    reward: (d.reward as RewardKind | null) ?? null,
    cheer: (d.cheer as string | null) ?? null,
    formLabel: (d.form_label as string | null) ?? null,
    spec: d.parts_spec as ArtSpec,
    generator: d.generator as string,
    minted: Number(d.minted_count) || 0,
    active: d.active !== false,
  }));
  const setSize = new Map<number, number>();
  for (const d of list) setSize.set(d.series, Math.max(setSize.get(d.series) ?? 0, d.setNumber));
  const value: Catalog = {
    issuer: { id: iss.data.id as string, name: iss.data.name as string, publicKey: (iss.data.public_key as string | null) ?? null, verifyUrlBase: iss.data.verify_url_base as string },
    defs: list,
    setSize,
    thresholds,
  };
  catalogCache = { at: Date.now(), value };
  return value;
}

// The check-in rules: the catalog's active check-in badges, or the eleven
// from code if the catalog can't be read (a check-in still pays the same).
export async function checkinRules(): Promise<RuleDef[]> {
  try {
    const { defs } = await loadCatalog();
    const live = defs.filter((d) => d.active && d.ruleType !== "manual" && d.ruleType !== "event");
    if (!live.length) return FALLBACK_DEFS;
    return live.map((d) => ({ key: d.key, name: d.name, ruleType: d.ruleType, params: d.params, period: d.period, points: d.points, reward: d.reward, cheer: d.cheer, setNumber: d.setNumber }));
  } catch (e) {
    console.error("badge rules: using the built-in list", e instanceof Error ? e.message : e);
    return FALLBACK_DEFS;
  }
}

// ---------- minting ----------

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export function newCode(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export const isCopyCode = (s: unknown): s is string => typeof s === "string" && /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/.test(s);

export interface ClaimToMint {
  claimId: string; // member_badges.id
  key: string;
  period: string;
  facts: VisitFacts | null;
  note?: string | null;
  event?: { kind: string; ref: string; label: string } | null;
  mintedAt?: string | null; // when it was earned, for a copy minted after the fact
}

interface CopyRow {
  id: string;
  def_id: string;
  issuer_id: string;
  series: number;
  serial: number;
  holder_id: string;
  code: string;
  minted_at: string;
  name: string;
  flavor: string;
  generator: string;
  stats: Record<string, unknown>;
  event_kind: string | null;
  event_ref: string | null;
  event_label: string | null;
  art_svg: string | null;
  art_hash: string | null;
  signature: string | null;
  revoked_at: string | null;
}

const COPY_COLUMNS =
  "id, def_id, issuer_id, series, serial, holder_id, code, minted_at, name, flavor, generator, stats, event_kind, event_ref, event_label, art_svg, art_hash, signature, revoked_at";

export function certFields(c: CopyRow, hash: string): CertFields {
  return {
    copyId: c.id,
    defId: c.def_id,
    series: Number(c.series),
    serial: Number(c.serial),
    holderId: c.holder_id,
    issuerId: c.issuer_id,
    mintedAt: c.minted_at,
    artHash: hash,
    name: c.name,
    flavor: c.flavor ?? "",
    stats: c.stats ?? {},
    event: { kind: c.event_kind, ref: c.event_ref, label: c.event_label },
  };
}

export async function holderFor(memberId: string, db: Db = createAdminClient()): Promise<string | null> {
  const { data, error } = await db.rpc("badge_holder_for_member", { p_member: memberId });
  if (error) {
    console.error("badge holder", error.code, error.message);
    return null;
  }
  return data as string;
}

// Draws, hashes and signs a reserved copy, once.
async function finishCopy(db: Db, c: CopyRow, def: CatalogDef): Promise<CopyRow | null> {
  if (c.signature) return c;
  const key = process.env.BADGE_SIGNING_KEY;
  if (!key) {
    console.error("badge copy left unsigned: BADGE_SIGNING_KEY isn't set");
    return null;
  }
  if (c.generator !== GENERATOR) return null; // another generator draws it
  const art = renderArt(def.spec);
  const hash = artHash(art);
  const signature = signCert(certFields(c, hash), key);
  const { data, error } = await db.from("badge_copies").update({ art_svg: art, art_hash: hash, signature }).eq("id", c.id).is("signature", null).select(COPY_COLUMNS);
  if (error) {
    console.error("badge copy sign", error.code, error.message);
    return null;
  }
  if (data?.length) return data[0] as CopyRow;
  const { data: again } = await db.from("badge_copies").select(COPY_COLUMNS).eq("id", c.id).maybeSingle();
  return (again as CopyRow | null) ?? null;
}

// A signed copy for each claim (one per claim, however many times it's
// asked), for one holder. Claims whose badge isn't in the catalog are
// skipped.
export async function mintClaims(holderId: string, claims: ClaimToMint[], db: Db = createAdminClient()): Promise<CopyRow[]> {
  if (!claims.length) return [];
  const { defs } = await loadCatalog(db);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: CopyRow[] = [];
  for (const cl of claims) {
    const def = byKey.get(cl.key);
    if (!def) continue;
    const { data, error } = await db.rpc("badge_reserve_copy", {
      p_def: def.id,
      p_holder: holderId,
      p_source: `member_badges:${cl.claimId}`,
      p_id: randomUUID(),
      p_code: newCode(),
      p_stats: statsFor(def, cl.facts, cl.period, cl.note),
      p_event_kind: cl.event?.kind ?? null,
      p_event_ref: cl.event?.ref ?? null,
      p_event_label: cl.event?.label ?? null,
      p_minted_at: cl.mintedAt ?? null,
    });
    if (error || !data) {
      console.error("badge reserve", cl.key, error?.code, error?.message);
      continue;
    }
    const done = await finishCopy(db, data as CopyRow, def);
    if (done) out.push(done);
  }
  forgetCounts();
  return out;
}

// Copies for any of a member's claims that don't have a signed one yet.
// Facts for the stats come from the visit that earned it.
export async function ensureCopies(memberId: string, db: Db = createAdminClient()): Promise<number> {
  const { data: claims, error } = await db.from("member_badges").select("id, badge, period, visit_id, earned_at").eq("member_id", memberId).order("earned_at");
  if (error || !claims?.length) return 0;
  const refs = claims.map((c) => `member_badges:${c.id}`);
  const { data: have } = await db.from("badge_copies").select("source_ref, signature").in("source_ref", refs);
  const done = new Set((have ?? []).filter((h) => h.signature).map((h) => h.source_ref as string));
  const todo = claims.filter((c) => !done.has(`member_badges:${c.id}`));
  if (!todo.length) return 0;
  const holder = await holderFor(memberId, db);
  if (!holder) return 0;
  const facts = await claimFacts(db, memberId, todo);
  const minted = await mintClaims(
    holder,
    todo.map((c) => ({ claimId: c.id as string, key: c.badge as string, period: (c.period as string) ?? "", facts: facts.get(c.id as string) ?? null, mintedAt: c.earned_at as string })),
    db,
  );
  return minted.length;
}

// What was true at the visit that earned each claim: its time, the visit's
// number and the week streak saved with it.
export async function claimFacts(db: Db, memberId: string, claims: { id: unknown; visit_id: unknown }[]): Promise<Map<string, VisitFacts>> {
  const out = new Map<string, VisitFacts>();
  const visitIds = [...new Set(claims.map((c) => c.visit_id as string | null).filter((v): v is string => !!v))];
  if (!visitIds.length) return out;
  const { data: visits } = await db.from("member_visits").select("id, business_date, checked_in_at, streak").eq("member_id", memberId).order("business_date");
  const order = new Map((visits ?? []).map((v, i) => [v.id as string, { n: i + 1, v }]));
  for (const c of claims) {
    const hit = order.get(c.visit_id as string);
    if (!hit) continue;
    out.set(c.id as string, { at: new Date(hit.v.checked_in_at as string), visitNumber: hit.n, weekStreak: Math.max(0, Number(hit.v.streak) || 0), birthday: null });
  }
  return out;
}

// ---------- live counts: "of N" and rarity ----------

interface Counts {
  perDef: Map<string, number>;
  holders: number;
}
let countsCache: { at: number; value: Counts } | null = null;
function forgetCounts() {
  countsCache = null;
}

export async function liveCounts(db: Db = createAdminClient()): Promise<Counts> {
  if (countsCache && Date.now() - countsCache.at < 30_000) return countsCache.value;
  const perDef = new Map<string, number>();
  const holders = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("badge_copies").select("def_id, holder_id").is("revoked_at", null).not("signature", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      perDef.set(r.def_id as string, (perDef.get(r.def_id as string) ?? 0) + 1);
      holders.add(r.holder_id as string);
    }
    if (!data || data.length < 1000) break;
  }
  const value = { perDef, holders: holders.size };
  countsCache = { at: Date.now(), value };
  return value;
}

// ---------- cards ----------

const TZ = "America/Chicago";
function dateLabel(iso: string, form: "day" | "month" | "year"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (form === "year") return d.toLocaleDateString("en-US", { year: "numeric", timeZone: TZ });
  return d.toLocaleDateString("en-US", form === "day" ? { month: "short", day: "numeric", year: "numeric", timeZone: TZ } : { month: "short", year: "numeric", timeZone: TZ });
}

function qrFor(url: string): { size: number; d: string } {
  const m = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  let d = "";
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.get(y, x)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.size && m.get(y, x + run)) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size: m.size, d };
}

export interface BadgeCard {
  code: string;
  key: string;
  name: string;
  serial: number;
  mintedAt: string;
  front: string; // SVG
  back: string; // SVG
}

// A copy as its card. publicView: a page anyone can see (the shared
// profile, the verify page): a time-of-day badge shows only the month it
// was minted, a birthday badge only the year, and no time of day.
export function toCard(c: CopyRow, cat: Catalog, counts: Counts, opts: { publicView?: boolean } = {}): BadgeCard | null {
  if (!c.art_svg || !c.signature) return null;
  const def = cat.defs.find((d) => d.id === c.def_id);
  const form = !opts.publicView ? "day" : def?.ruleType === "birthday_week" ? "year" : def?.ruleType === "checkin_time" ? "month" : "day";
  const of = counts.perDef.get(c.def_id) ?? 0;
  const verifyUrl = `${cat.issuer.verifyUrlBase}${c.code}`;
  const data: BadgeCardData = {
    name: c.name,
    flavor: c.flavor ?? "",
    art: c.art_svg,
    series: Number(c.series),
    setNumber: def?.setNumber ?? 0,
    setSize: cat.setSize.get(Number(c.series)) ?? 0,
    rarity: rarityFor(of, counts.holders, cat.thresholds.get(Number(c.series))),
    serial: Number(c.serial),
    of,
    minted: dateLabel(c.minted_at, form),
    issuer: cat.issuer.id === c.issuer_id ? cat.issuer.name : "Another venue",
    event: c.event_label,
    stats: statLines(c.stats, { publicView: opts.publicView }),
    code: c.code,
    verifyUrl,
    qr: qrFor(verifyUrl),
    revoked: !!c.revoked_at,
  };
  return { code: c.code, key: def?.key ?? "", name: c.name, serial: Number(c.serial), mintedAt: c.minted_at, front: cardFrontSvg(data), back: cardBackSvg(data) };
}

// The holder ids that are this member's: theirs, and any merged into it.
async function holderIds(db: Db, memberId: string): Promise<string[]> {
  const { data: m } = await db.from("members").select("badge_holder_id").eq("id", memberId).maybeSingle();
  const h = (m?.badge_holder_id as string | null) ?? null;
  if (!h) return [];
  const { data: merged } = await db.from("badge_holders").select("id").eq("merged_into", h);
  return [h, ...(merged ?? []).map((r) => r.id as string)];
}

// A member's badge case: their signed, live copies as cards, oldest first.
// `before`: only copies minted before then (the shared profile leaves out
// today's).
export async function memberCards(memberId: string, opts: { publicView?: boolean; before?: Date; repair?: boolean } = {}): Promise<BadgeCard[]> {
  const db = createAdminClient();
  try {
    if (opts.repair) await ensureCopies(memberId, db);
    const ids = await holderIds(db, memberId);
    if (!ids.length) return [];
    const [cat, counts, copies] = await Promise.all([
      loadCatalog(db),
      liveCounts(db),
      db.from("badge_copies").select(COPY_COLUMNS).in("holder_id", ids).is("revoked_at", null).not("signature", "is", null).order("minted_at"),
    ]);
    return ((copies.data ?? []) as CopyRow[])
      .filter((c) => !opts.before || Date.parse(c.minted_at) < opts.before.getTime())
      .flatMap((c) => toCard(c, cat, counts, opts) ?? []);
  } catch (e) {
    console.error("badge case", e instanceof Error ? e.message : e);
    return [];
  }
}

// The cards for copies just minted (the tablet's reward).
export async function cardsFor(copies: CopyRow[]): Promise<Map<string, BadgeCard>> {
  const out = new Map<string, BadgeCard>();
  if (!copies.length) return out;
  const db = createAdminClient();
  const [cat, counts] = await Promise.all([loadCatalog(db), liveCounts(db)]);
  for (const c of copies) {
    const card = toCard(c, cat, counts);
    const def = cat.defs.find((d) => d.id === c.def_id);
    if (card && def) out.set(def.key, card);
  }
  return out;
}

// ---------- the verify page ----------

export interface VerifiedCopy {
  card: BadgeCard;
  holder: string; // "Maya R."
  issuer: string;
  verified: boolean;
  revoked: boolean;
  mintedAt: string;
}

// "Maya Rodriguez" -> "Maya R."
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || /^guest\b/i.test(parts[0])) return "A guest";
  const first = parts[0].slice(0, 30);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${first} ${last[0].toLocaleUpperCase()}.` : first;
}

export async function verifyCopy(code: string): Promise<VerifiedCopy | null> {
  if (!isCopyCode(code)) return null;
  const db = createAdminClient();
  const { data: c } = await db.from("badge_copies").select(COPY_COLUMNS).eq("code", code).maybeSingle();
  const copy = c as CopyRow | null;
  if (!copy?.art_svg || !copy.signature) return null;
  const [cat, counts, issuer, holder] = await Promise.all([
    loadCatalog(db),
    liveCounts(db),
    db.from("badge_issuers").select("name, public_key").eq("id", copy.issuer_id).maybeSingle(),
    db.from("badge_holders").select("display_name").eq("id", copy.holder_id).maybeSingle(),
  ]);
  const card = toCard(copy, cat, counts, { publicView: true });
  if (!card) return null;
  const key = (issuer.data?.public_key as string | null) ?? null;
  const verified = !!key && artHash(copy.art_svg) === copy.art_hash && verifyCert(certFields(copy, copy.art_hash ?? ""), copy.signature, key);
  return {
    card,
    holder: shortName(holder.data?.display_name as string | null),
    issuer: (issuer.data?.name as string) ?? "Unknown issuer",
    verified,
    revoked: !!copy.revoked_at,
    mintedAt: copy.minted_at,
  };
}

// ---------- Back office ----------

export interface CatalogEntry {
  def: CatalogDef;
  copies: number;
  rarity: ReturnType<typeof rarityFor>;
  front: string;
}

// A card front for a badge that may have no copies yet (the catalog, the
// maker's preview).
export function previewFront(def: Pick<CatalogDef, "name" | "flavor" | "spec" | "series" | "setNumber">, setSize: number, issuer: string, rarity: ReturnType<typeof rarityFor>, of: number): string {
  return cardFrontSvg({
    name: def.name,
    flavor: def.flavor,
    art: renderArt(def.spec),
    series: def.series,
    setNumber: def.setNumber,
    setSize,
    rarity,
    serial: null,
    of,
    minted: "",
    issuer,
    event: null,
    stats: [],
    code: null,
    verifyUrl: null,
    qr: null,
    revoked: false,
  });
}

// The badges a member can still earn at check-in, as card fronts, for the
// account's badge case.
export interface LockedBadge {
  key: string;
  name: string;
  flavor: string;
  points: number;
  reward: RewardKind | null;
  front: string;
}

export async function earnableBadges(): Promise<{ locked: LockedBadge[]; total: number }> {
  try {
    const db = createAdminClient();
    const [cat, counts] = await Promise.all([loadCatalog(db), liveCounts(db)]);
    const earnable = cat.defs.filter((d) => d.active && d.ruleType !== "manual");
    return {
      total: earnable.length,
      locked: earnable.map((def) => {
        const copies = counts.perDef.get(def.id) ?? 0;
        const rarity = rarityFor(copies, counts.holders, cat.thresholds.get(def.series));
        return { key: def.key, name: def.name, flavor: def.flavor, points: def.points, reward: def.reward, front: previewFront(def, cat.setSize.get(def.series) ?? 0, cat.issuer.name, rarity, copies) };
      }),
    };
  } catch {
    return { locked: [], total: 0 };
  }
}

export async function catalogEntries(): Promise<{ entries: CatalogEntry[]; holders: number; issuer: string }> {
  forgetCatalog();
  forgetCounts();
  const db = createAdminClient();
  const [cat, counts] = await Promise.all([loadCatalog(db), liveCounts(db)]);
  const entries = cat.defs.map((def) => {
    const copies = counts.perDef.get(def.id) ?? 0;
    const rarity = rarityFor(copies, counts.holders, cat.thresholds.get(def.series));
    return { def, copies, rarity, front: previewFront(def, cat.setSize.get(def.series) ?? 0, cat.issuer.name, rarity, copies) };
  });
  return { entries, holders: counts.holders, issuer: cat.issuer.name };
}

export interface CopyListRow {
  serial: number;
  code: string;
  mintedAt: string;
  holder: string;
  memberId: string | null;
  revoked: boolean;
}

export async function defDetail(id: string): Promise<{ entry: CatalogEntry; copies: CopyListRow[]; sample: BadgeCard | null; holders: number } | null> {
  const { entries, holders } = await catalogEntries();
  const entry = entries.find((e) => e.def.id === id);
  if (!entry) return null;
  const db = createAdminClient();
  const { data } = await db.from("badge_copies").select(COPY_COLUMNS).eq("def_id", id).not("signature", "is", null).order("serial").limit(500);
  const rows = (data ?? []) as CopyRow[];
  const hIds = [...new Set(rows.map((r) => r.holder_id))];
  const [hs, ms] = hIds.length
    ? await Promise.all([db.from("badge_holders").select("id, display_name, merged_into").in("id", hIds), db.from("members").select("id, badge_holder_id").in("badge_holder_id", hIds)])
    : [{ data: [] }, { data: [] }];
  const names = new Map((hs.data ?? []).map((h) => [h.id as string, (h.display_name as string | null) ?? "A guest"]));
  const member = new Map((ms.data ?? []).map((m) => [m.badge_holder_id as string, m.id as string]));
  const cat = await loadCatalog(db);
  const counts = await liveCounts(db);
  const latest = rows.filter((r) => !r.revoked_at).at(-1);
  return {
    entry,
    holders,
    sample: latest ? toCard(latest, cat, counts) : null,
    copies: rows.map((r) => ({
      serial: Number(r.serial),
      code: r.code,
      mintedAt: r.minted_at,
      holder: names.get(r.holder_id) ?? "A guest",
      memberId: member.get(r.holder_id) ?? null,
      revoked: !!r.revoked_at,
    })),
  };
}

export interface NewDefInput {
  name: string;
  flavor: string;
  spec: unknown;
  formLabel: string | null;
  ruleType: RuleType;
  params: RuleParams;
  points: number;
  cheer: string | null;
  createdBy: string | null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "badge";

// A new Series 1 badge at the end of the set. Its art and name freeze once
// a copy is minted.
export async function createDef(input: NewDefInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const spec = cleanSpec(input.spec);
  if (!spec) return { ok: false, error: "That art isn't one the maker can draw. Pick a form and parts again." };
  if (!RULE_TYPES.includes(input.ruleType)) return { ok: false, error: "Pick how it's earned." };
  const db = createAdminClient();
  const cat = await loadCatalog(db);
  const { data: series } = await db.from("badge_series").select("id, number").eq("issuer_id", cat.issuer.id).eq("generator", GENERATOR).order("number").limit(1).maybeSingle();
  if (!series) return { ok: false, error: "Series 1 isn't set up yet." };
  let key = slug(input.name);
  if (cat.defs.some((d) => d.key === key)) key = `${key}_${Date.now().toString(36)}`;
  const setNumber = Math.max(0, ...cat.defs.filter((d) => d.seriesId === series.id).map((d) => d.setNumber)) + 1;
  const { data, error } = await db
    .from("badge_defs")
    .insert({
      issuer_id: cat.issuer.id,
      series_id: series.id,
      key,
      name: input.name,
      flavor: input.flavor,
      set_number: setNumber,
      rule_type: input.ruleType,
      rule_params: input.params,
      period: input.ruleType === "birthday_week" ? "yearly" : "once",
      points: input.points,
      cheer: input.cheer,
      form_label: input.formLabel,
      parts_spec: spec,
      generator: GENERATOR,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  forgetCatalog();
  if (error) return { ok: false, error: error.code === "23505" ? "There's already a badge by that name." : "It didn't save. Try again." };
  return { ok: true, id: data.id as string };
}

// Gives a member a badge by hand: the claim and its points (capped like any
// badge's), then its signed copy.
export async function awardByHand(defId: string, memberId: string, note: string | null, by: string | null): Promise<{ ok: true; code: string | null } | { ok: false; error: string }> {
  const db = createAdminClient();
  forgetCatalog();
  const cat = await loadCatalog(db);
  const def = cat.defs.find((d) => d.id === defId);
  if (!def) return { ok: false, error: "That badge isn't in the catalog." };
  if (!def.active) return { ok: false, error: "That badge is switched off." };
  const { data, error } = await db.rpc("award_member_badge", {
    p_member: memberId,
    p_key: def.key,
    p_period: "",
    p_points: def.points,
    p_note: def.name,
    p_by: by,
  });
  if (error || !data) return { ok: false, error: "It didn't save. Try again." };
  const r = data as { awarded: boolean; id: string | null };
  if (!r.awarded || !r.id) return { ok: false, error: "They already have this badge." };
  const holder = await holderFor(memberId, db);
  if (!holder) return { ok: true, code: null };
  const [copy] = await mintClaims(holder, [{ claimId: r.id, key: def.key, period: "", facts: null, note }], db);
  return { ok: true, code: copy?.code ?? null };
}
