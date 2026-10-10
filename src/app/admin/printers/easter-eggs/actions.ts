"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EASTER_EGG_BUCKET, EASTER_EGG_MAX_BYTES, EASTER_EGG_TABLE, EASTER_EGG_TYPES, pictureRaster, RASTER_VERSION } from "@/lib/print/easter-egg-pictures";

// Back office → Printers → Easter egg pictures: add and remove the pictures
// the register's 🎲 Print a meme button prints. Admins only. One picture
// per call (the page sends several one after another). The printer-ready
// raster is made here, once, so a press at the register is quick.

type Result = { ok: true } | { ok: false; error: string };

export async function addEasterEggPicture(formData: FormData): Promise<Result> {
  const staff = await assertAdmin();
  const file = formData.get("picture");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a picture." };
  const ext = EASTER_EGG_TYPES[file.type];
  if (!ext) return { ok: false, error: `${file.name}: only JPG, PNG, GIF or WebP pictures.` };
  if (file.size > EASTER_EGG_MAX_BYTES) return { ok: false, error: `${file.name} is over 8 MB.` };

  const buffer = Buffer.from(await file.arrayBuffer());
  let raster;
  try {
    raster = await pictureRaster(buffer);
  } catch {
    return { ok: false, error: `${file.name} couldn't be read as a picture.` };
  }

  const admin = createAdminClient();
  const path = `${randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from(EASTER_EGG_BUCKET).upload(path, buffer, { contentType: file.type });
  if (upErr) return { ok: false, error: `${file.name} didn't upload. Try again.` };
  const { error } = await admin.from(EASTER_EGG_TABLE).insert({
    path,
    name: file.name.slice(0, 200),
    content_type: file.type,
    raster_width: raster.width,
    raster_height: raster.height,
    raster_data: raster.data,
    raster_version: RASTER_VERSION,
    created_by: staff.employeeId,
  });
  if (error) {
    await admin.storage.from(EASTER_EGG_BUCKET).remove([path]);
    return { ok: false, error: `${file.name} uploaded but wasn't saved. Try again.` };
  }
  revalidatePath("/admin/printers/easter-eggs");
  return { ok: true };
}

export async function deleteEasterEggPicture(id: string): Promise<Result> {
  await assertAdmin();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That picture wasn't found." };
  const admin = createAdminClient();
  const { data: row } = await admin.from(EASTER_EGG_TABLE).select("path").eq("id", id).maybeSingle();
  if (!row) return { ok: true };
  const { error: rmErr } = await admin.storage.from(EASTER_EGG_BUCKET).remove([String(row.path)]);
  if (rmErr) return { ok: false, error: "Couldn't delete that picture. Try again." };
  const { error } = await admin.from(EASTER_EGG_TABLE).delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that picture. Try again." };
  revalidatePath("/admin/printers/easter-eggs");
  return { ok: true };
}
