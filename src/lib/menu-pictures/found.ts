import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findCandidates, type Candidate } from "./sources";
import { downloadImage, PICTURE_SIZE, squareJpeg } from "./images";
import { categoryQuery, cleanQuery, itemQuery } from "./query";
import { isRowId, photoTable, storePhoto, storedPhotoPath } from "./store";
import { pictureOf, type PhotoTarget, type PictureResult, type PictureState } from "./shared";

// Free-to-use pictures, found and stored: the server downloads the picture
// from its own site, squares it to a 480px JPEG and keeps it in our
// menu-photos bucket like any photo (lib/menu-pictures/store.ts), with its
// credit. Nothing on a register button ever loads from another site.

const GONE = "That picture isn't in the results anymore. Try again.";
const PICTURE_FIELDS = "image_url, image_source, image_credit, image_query, image_index, image_approved_at";

async function jpegOf(c: Candidate): Promise<Buffer> {
  return squareJpeg(await downloadImage(c.image), PICTURE_SIZE, c.source === "off" ? "contain" : "cover");
}

async function pictureNow(target: PhotoTarget, id: string): Promise<PictureState | null> {
  const table = photoTable(target);
  if (!table || !isRowId(id)) return null;
  const { data } = await createAdminClient().from(table).select(PICTURE_FIELDS).eq("id", id.toLowerCase()).maybeSingle();
  return data ? pictureOf(data as Partial<PictureState>) : null;
}

type CategoryRef = { id: string; key: string | null; label: string; parent_id: string | null };

// What to search for when nobody has typed anything: the item's name (with
// its category, for the words it needs), or the category's.
export async function defaultQuery(target: PhotoTarget, id: string): Promise<string | null> {
  if (!isRowId(id)) return null;
  const supabase = createAdminClient();
  const { data: cats } = await supabase.from("menu_categories").select("id, key, label, parent_id");
  const byId = new Map(((cats ?? []) as CategoryRef[]).map((c) => [c.id, c]));
  if (target === "category") {
    const c = byId.get(id.toLowerCase());
    return c ? categoryQuery(c.label, c.key) : null;
  }
  const { data: item } = await supabase.from("menu_items").select("name, category_id").eq("id", id.toLowerCase()).maybeSingle();
  if (!item) return null;
  const cat = byId.get(item.category_id as string);
  const parent = cat?.parent_id ? byId.get(cat.parent_id) : null;
  return itemQuery({ name: item.name as string, category: cat?.label ?? null, parent: parent?.label ?? null });
}

// Result `index` of a search, stored on a button or tab. `page` is the
// source page of the picture the screen showed: if the results have shifted
// since (another server, a day later), the same picture is found by it, and
// never a different one saved in its place. `approved` is true when a
// manager picked it.
export async function storeFoundPicture(target: PhotoTarget, id: string, rawQuery: unknown, index: unknown, page: unknown, approved: boolean): Promise<PictureResult> {
  const query = cleanQuery(rawQuery);
  if (!query) return { ok: false, error: "Type something to search for." };
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return { ok: false, error: GONE };
  const { candidates } = await findCandidates(query);
  let at = index;
  if (typeof page === "string" && page && candidates[at]?.credit.page !== page) at = candidates.findIndex((c) => c.credit.page === page);
  const c = candidates[at];
  if (!c) return { ok: false, error: GONE };
  let jpeg: Buffer;
  try {
    jpeg = await jpegOf(c);
  } catch {
    return { ok: false, error: "That picture wouldn't download. Pick another one." };
  }
  const r = await storePhoto(target, id, jpeg, { source: c.source, credit: c.credit, query, index: at, approved });
  if (!r.ok) return r;
  return { ok: true, picture: (await pictureNow(target, id)) ?? pictureOf({ image_url: r.url, image_source: c.source, image_credit: c.credit, image_query: query, image_index: at }) };
}

// A found picture a manager looked at and kept (the Photo walk, or Keep it
// in the register's settings).
export async function approvePicture(target: PhotoTarget, id: string): Promise<PictureResult> {
  const table = photoTable(target);
  if (!table || !isRowId(id)) return { ok: false, error: "That isn't on the menu anymore. Refresh the page." };
  const { data, error } = await createAdminClient()
    .from(table)
    .update({ image_approved_at: new Date().toISOString() })
    .eq("id", id.toLowerCase())
    .not("image_url", "is", null)
    .select(PICTURE_FIELDS);
  if (error) {
    console.error("menu: picture not kept", error);
    return { ok: false, error: "That didn't save. Try again." };
  }
  if (!data?.length) return { ok: false, error: "Someone just changed this picture. Refresh the page." };
  return { ok: true, picture: pictureOf(data[0] as Partial<PictureState>) };
}

// The first result that downloads, skipping ones another button already got
// from the same search (so two buttons that search alike get different ones).
async function firstThatWorks(target: PhotoTarget, id: string, query: string, taken: Set<number>): Promise<PictureResult> {
  const { candidates } = await findCandidates(query);
  let tries = 0;
  for (let i = 0; i < candidates.length && tries < 4; i++) {
    if (taken.has(i)) continue;
    tries++;
    const c = candidates[i];
    let jpeg: Buffer;
    try {
      jpeg = await jpegOf(c);
    } catch {
      continue;
    }
    taken.add(i);
    const r = await storePhoto(target, id, jpeg, { source: c.source, credit: c.credit, query, index: i, approved: false });
    if (!r.ok) return r;
    return { ok: true, picture: pictureOf({ image_url: r.url, image_source: c.source, image_credit: c.credit, image_query: query, image_index: i }) };
  }
  return { ok: false, error: candidates.length ? "None of the pictures would download." : "No free pictures found." };
}

export interface FillLine {
  target: PhotoTarget;
  id: string;
  name: string;
  query: string;
  ok: boolean;
  error: string | null;
}

export interface FillReport {
  lines: FillLine[];
  left: number; // still without a picture, not counting ones already tried
}

type CategoryRow = CategoryRef & { image_url: string | null; image_source: string | null };
type ItemRow = { id: string; name: string; category_id: string; image_url: string | null; image_source: string | null };

// A picture for every button that has never had one: no photo and no
// decision yet (a label tile someone chose on purpose, and every upload, are
// left alone). Found pictures go on unapproved, for the Photo walk.
// `limit` keeps one call short; `skip` is what earlier calls couldn't fill,
// so they aren't tried again and again. `only` does one new item (or, when
// asked for by name, one category). Category tabs show an icon
// (components/menu/CategoryIcon), so filling everything leaves them out.
export async function fillMissingPictures(opts: { only?: { target: PhotoTarget; id: string }; limit?: number; skip?: string[] } = {}): Promise<FillReport> {
  const supabase = createAdminClient();
  const skip = new Set((opts.skip ?? []).filter(isRowId).map((s) => s.toLowerCase()));
  const only = opts.only ? { target: opts.only.target, id: String(opts.only.id).toLowerCase() } : null;
  if (only && !isRowId(only.id)) return { lines: [], left: 0 };
  const { data: cats } = await supabase.from("menu_categories").select("id, key, label, parent_id, image_url, image_source").order("sort_order");
  const categories = (cats ?? []) as CategoryRow[];
  const byId = new Map(categories.map((c) => [c.id, c]));

  const todo: { target: PhotoTarget; id: string; name: string; query: string }[] = [];
  if (!only || only.target === "item") {
    let itemsQuery = supabase.from("menu_items").select("id, name, category_id, image_url, image_source").is("image_url", null).is("image_source", null).eq("active", true);
    if (only) itemsQuery = itemsQuery.eq("id", only.id);
    const { data: items } = await itemsQuery.order("sort_order");
    for (const item of (items ?? []) as ItemRow[]) {
      if (skip.has(item.id)) continue;
      const cat = byId.get(item.category_id);
      const parent = cat?.parent_id ? byId.get(cat.parent_id) : null;
      todo.push({ target: "item", id: item.id, name: item.name, query: itemQuery({ name: item.name, category: cat?.label ?? null, parent: parent?.label ?? null }) });
    }
  }
  if (only?.target === "category") {
    for (const c of categories) {
      if (c.id !== only.id) continue;
      if (c.image_url || c.image_source || skip.has(c.id)) continue;
      const query = categoryQuery(c.label, c.key);
      if (query) todo.push({ target: "category", id: c.id, name: c.label, query });
    }
  }
  if (todo.length === 0) return { lines: [], left: 0 };

  // Results already on a button, per search, so the next one gets another.
  const taken = new Map<string, Set<number>>();
  for (const t of ["item", "category"] as const) {
    const { data } = await supabase.from(photoTable(t)!).select("image_query, image_index").not("image_query", "is", null).not("image_index", "is", null);
    for (const r of (data ?? []) as { image_query: string; image_index: number }[]) {
      if (!taken.has(r.image_query)) taken.set(r.image_query, new Set());
      taken.get(r.image_query)!.add(r.image_index);
    }
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 200, 200));
  const lines: FillLine[] = [];
  for (const t of todo.slice(0, limit)) {
    if (!taken.has(t.query)) taken.set(t.query, new Set());
    let r: PictureResult;
    try {
      r = await firstThatWorks(t.target, t.id, t.query, taken.get(t.query)!);
    } catch (e) {
      console.error("menu: picture not found", t.name, e);
      r = { ok: false, error: "The search didn't work. Try again later." };
    }
    lines.push({ ...t, ok: r.ok, error: r.ok ? null : r.error });
  }
  return { lines, left: Math.max(0, todo.length - lines.length) };
}

// Every saved picture must be a file in our own bucket.
export async function picturesNotStoredHere(): Promise<{ table: string; id: string; image_url: string }[]> {
  const supabase = createAdminClient();
  const bad: { table: string; id: string; image_url: string }[] = [];
  for (const target of ["item", "category"] as const) {
    const table = photoTable(target)!;
    const { data } = await supabase.from(table).select("id, image_url").not("image_url", "is", null);
    for (const r of (data ?? []) as { id: string; image_url: string }[]) if (!storedPhotoPath(r.image_url)) bad.push({ table, id: r.id, image_url: r.image_url });
  }
  return bad;
}
