import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_TARGETS, pictureOf, textIconOf, type PhotoTarget, type PictureCredit, type PictureResult, type PictureSource } from "./shared";

// Where menu photos live, and putting one on a register button (an item) or
// tab (a category), or taking it off. Shared by Back office → Menu and the
// register's item settings, which check who's asking in their own ways.
//
// Every photo is a JPEG in the public "menu-photos" bucket under a name
// made here ("<row id>-<milliseconds>.jpg"); image_url points at it. The
// file a photo replaces is deleted so old ones don't pile up. A change only
// lands over the photo that was there when it started, so two people
// changing the same button can't both win.

type Db = ReturnType<typeof createAdminClient>;
export type Result = { ok: true } | { ok: false; error: string };

export const PHOTO_BUCKET = "menu-photos";
export const PHOTO_MAX_BYTES = 2_000_000;
const TABLES = { item: "menu_items", category: "menu_categories" } as const;
// Names this file makes: "<row id>-<milliseconds>.jpg".
const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{13,}\.jpg$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NOT_THERE: Result = { ok: false, error: "That isn't on the menu anymore. Refresh the page." };
const PHOTO_RACE: Result = { ok: false, error: "Someone just changed this photo. Refresh the page and try again." };

export function photoTable(target: unknown): (typeof TABLES)[PhotoTarget] | null {
  return PHOTO_TARGETS.includes(target as PhotoTarget) ? TABLES[target as PhotoTarget] : null;
}

export function isRowId(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

// The file's name in the bucket, for a photo address this app saved.
export function storedPhotoPath(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split("?")[0];
  return PHOTO_NAME.test(path) ? path : null;
}

// Never fails the change it follows: a file left behind is only clutter.
export async function deleteStoredPhotos(supabase: Db, urls: unknown[]) {
  const paths = [...new Set(urls.map(storedPhotoPath).filter((p): p is string => !!p))];
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  if (error) console.error("menu: old photos not deleted", paths, error);
}

// A photo from the browser (squared and shrunk to a ~640px JPEG there):
// checks what actually arrived (a real JPEG, 2 MB at most) before storing it.
export async function jpegFromForm(formData: unknown): Promise<{ ok: true; jpeg: Buffer } | { ok: false; error: string }> {
  const file = formData instanceof FormData ? formData.get("photo") : null;
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo to upload." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That photo is over 2 MB even after shrinking. Try a different one." };
  const jpeg = Buffer.from(await file.arrayBuffer());
  // A JPEG, going by its first bytes and not only what the browser says.
  if (file.type !== "image/jpeg" || jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
    return { ok: false, error: "That photo didn't come through as a JPEG. Try again, or try a screenshot of it." };
  }
  return { ok: true, jpeg };
}

// Where a stored picture came from. A photo someone took or chose is an
// "upload" (a person picked it, so it counts as approved, and it's never
// replaced automatically); a found one keeps its credit, its search and its
// place in the results, and is approved only when a manager keeps it.
export interface PictureMeta {
  source: Exclude<PictureSource, "label" | "text">;
  credit: PictureCredit | null;
  query: string | null;
  index: number | null;
  approved: boolean;
}

const UPLOAD: PictureMeta = { source: "upload", credit: null, query: null, index: null, approved: true };

export async function storePhoto(target: PhotoTarget, id: string, jpeg: Buffer, meta: PictureMeta = UPLOAD): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const table = photoTable(target);
  if (!table || !isRowId(id)) return NOT_THERE as { ok: false; error: string };
  const supabase = createAdminClient();
  const key = id.toLowerCase();
  const { data: row, error: readErr } = await supabase.from(table).select("image_url").eq("id", key).maybeSingle();
  if (readErr) {
    console.error("menu: photo row not read", readErr);
    return { ok: false, error: "Couldn't save that photo. Try again." };
  }
  if (!row) return NOT_THERE as { ok: false; error: string };
  const old = (row.image_url as string | null) ?? null;

  // A new name every time, so the register never shows a cached old photo
  // (and the file can be cached for good).
  const path = `${key}-${Date.now()}.jpg`;
  const { error: uploadErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (uploadErr) {
    console.error("menu: photo upload failed", uploadErr);
    return { ok: false, error: "The photo didn't upload. Check the connection and try again." };
  }
  const url = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

  // Saved only over the photo that was there when this started: if someone
  // else changed it meanwhile, theirs stays (and its file isn't deleted).
  const update = supabase
    .from(table)
    .update({
      image_url: url,
      image_source: meta.source,
      image_credit: meta.credit,
      image_query: meta.query,
      image_index: meta.index,
      image_approved_at: meta.approved ? new Date().toISOString() : null,
    })
    .eq("id", key);
  const { data: saved, error } = await (old === null ? update.is("image_url", null) : update.eq("image_url", old)).select("id");
  if (error || !saved?.length) {
    await deleteStoredPhotos(supabase, [url]);
    if (error) console.error("menu: photo not saved", error);
    return error ? { ok: false, error: "Couldn't save that photo. Try again." } : (PHOTO_RACE as { ok: false; error: string });
  }
  await deleteStoredPhotos(supabase, [old]);
  return { ok: true, url };
}

// Back to the label tile, on purpose: recorded as the label, approved, so
// finding pictures for everything leaves it alone.
const LABEL_FIELDS = { image_url: null, image_source: "label", image_credit: null, image_query: null, image_index: null };

export async function removePhoto(target: PhotoTarget, id: string): Promise<Result> {
  const table = photoTable(target);
  if (!table || !isRowId(id)) return NOT_THERE;
  const supabase = createAdminClient();
  const key = id.toLowerCase();
  const { data: row, error: readErr } = await supabase.from(table).select("image_url").eq("id", key).maybeSingle();
  if (readErr) {
    console.error("menu: photo row not read", readErr);
    return { ok: false, error: "Couldn't remove that photo. Try again." };
  }
  if (!row) return NOT_THERE;
  const old = (row.image_url as string | null) ?? null;
  const fields = { ...LABEL_FIELDS, image_approved_at: new Date().toISOString() };
  if (!old) {
    const { error } = await supabase.from(table).update(fields).eq("id", key).is("image_url", null);
    if (error) console.error("menu: label tile not saved", error);
    return error ? { ok: false, error: "Couldn't save that. Try again." } : { ok: true };
  }
  const { data: saved, error } = await supabase.from(table).update(fields).eq("id", key).eq("image_url", old).select("id");
  if (error) {
    console.error("menu: photo not removed", error);
    return { ok: false, error: "Couldn't remove that photo. Try again." };
  }
  if (!saved?.length) return PHOTO_RACE;
  await deleteStoredPhotos(supabase, [old]);
  return { ok: true };
}

// A text icon instead of a photo ("$5" glowing red): no file, just its
// words, color and style, drawn by the app. Chosen by a person, so it counts
// as approved and finding pictures for everything leaves it alone. The photo
// it replaces is deleted, landing only over the photo that was there when
// this started, like a new photo.
const NEEDS_MIGRATION = "Text icons need the database update (20261001130000_menu_text_icons.sql) first.";

export async function storeTextIcon(target: PhotoTarget, id: string, raw: unknown): Promise<PictureResult> {
  const icon = textIconOf(raw);
  if (!icon) return { ok: false, error: "Type 1 to 16 characters, and pick a color and a style." };
  const table = photoTable(target);
  if (!table || !isRowId(id)) return NOT_THERE as { ok: false; error: string };
  const supabase = createAdminClient();
  const key = id.toLowerCase();
  const { data: row, error: readErr } = await supabase.from(table).select("image_url").eq("id", key).maybeSingle();
  if (readErr) {
    console.error("menu: photo row not read", readErr);
    return { ok: false, error: "Couldn't save the text icon. Try again." };
  }
  if (!row) return NOT_THERE as { ok: false; error: string };
  const old = (row.image_url as string | null) ?? null;
  const fields = {
    image_url: null,
    image_source: "text" as const,
    image_text: icon,
    image_credit: null,
    image_query: null,
    image_index: null,
    image_approved_at: new Date().toISOString(),
  };
  const update = supabase.from(table).update(fields).eq("id", key);
  const { data: saved, error } = await (old === null ? update.is("image_url", null) : update.eq("image_url", old)).select("id");
  if (error) {
    // Before the migration: no image_text column yet (PGRST204, 42703), or
    // 'text' not allowed as a source yet (23514).
    if (error.code === "PGRST204" || error.code === "42703" || error.code === "23514") return { ok: false, error: NEEDS_MIGRATION };
    console.error("menu: text icon not saved", error);
    return { ok: false, error: "Couldn't save the text icon. Try again." };
  }
  if (!saved?.length) return PHOTO_RACE as { ok: false; error: string };
  await deleteStoredPhotos(supabase, [old]);
  return { ok: true, picture: pictureOf(fields) };
}
