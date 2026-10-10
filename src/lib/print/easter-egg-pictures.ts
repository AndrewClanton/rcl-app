import "server-only";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { ditherToRaster, type Raster } from "./raster";

// Easter egg pictures: uploaded under Back office → Printers → Easter egg
// pictures (admin/printers/easter-eggs), kept in the private easter-eggs
// bucket, and printed from the register (✨ → 🎲 Print a meme,
// pos/meme-actions.ts). Each row caches its printer-ready raster, made by
// pictureRaster below.

export const EASTER_EGG_BUCKET = "easter-eggs";
export const EASTER_EGG_TABLE = "easter_egg_pictures";

// Pictures only (no SVG, which can carry script). The stored name's
// extension comes from this list, never from the uploaded file's name.
export const EASTER_EGG_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
export const EASTER_EGG_MAX_BYTES = 8 * 1024 * 1024;

// Bump when the conversion changes: cached rasters made by an older one are
// made again the next time they print.
export const RASTER_VERSION = 1;

const WIDTH = 576; // the TM-m30's full line, in dots
const MAX_HEIGHT = 700;

export interface EasterEggRow {
  id: string;
  path: string;
  name: string;
  content_type: string;
  raster_width: number | null;
  raster_height: number | null;
  raster_data: string | null;
  raster_version: number | null;
  created_at: string;
}

// A picture to a 1-bit raster: 576 dots wide (narrower only when a tall
// picture hits the 700-dot height cap), grey, contrast stretched, a little
// lighter (thermal paper prints dark), then Floyd–Steinberg dithered. A GIF
// prints its first frame.
export async function pictureRaster(input: Buffer): Promise<Raster> {
  const upright = await sharp(input, { animated: false }).rotate().flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
  const iw = upright.info.width;
  const ih = upright.info.height;
  let w = WIDTH;
  let h = Math.max(1, Math.round((ih / iw) * w));
  if (h > MAX_HEIGHT) {
    h = MAX_HEIGHT;
    w = Math.max(8, Math.floor(((iw / ih) * h) / 8) * 8);
  }
  const { data } = await sharp(upright.data).resize({ width: w, height: h, fit: "fill" }).greyscale().normalise().raw().toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = Math.min(255, Math.max(0, (data[i] - 128) * 1.1 + 128 + 18));
  return ditherToRaster(gray, w, h);
}

// The cached raster for a row, making (and saving) it if it's missing or
// was made by an older conversion. Null if the picture can't be read.
export async function rowRaster(row: EasterEggRow): Promise<Raster | null> {
  if (row.raster_data && row.raster_width && row.raster_height && row.raster_version === RASTER_VERSION)
    return { width: row.raster_width, height: row.raster_height, data: row.raster_data };
  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(EASTER_EGG_BUCKET).download(row.path);
  if (error || !file) return null;
  try {
    const r = await pictureRaster(Buffer.from(await file.arrayBuffer()));
    await admin.from(EASTER_EGG_TABLE).update({ raster_width: r.width, raster_height: r.height, raster_data: r.data, raster_version: RASTER_VERSION }).eq("id", row.id);
    return r;
  } catch {
    return null;
  }
}
