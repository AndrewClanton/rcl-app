import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EASTER_EGG_BUCKET, EASTER_EGG_TABLE } from "@/lib/print/easter-egg-pictures";
import PageHeader from "@/components/admin/PageHeader";
import EasterEggPictures, { type EasterEggPicture } from "./EasterEggPictures";

export const dynamic = "force-dynamic";

// Back office → Printers → Easter egg pictures, admins only: the pictures
// the register's ✨ → 🎲 Print a meme button prints, one at random per
// press. They're in a private bucket; the thumbnails here are signed links
// that last an hour.
export default async function EasterEggPicturesPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from(EASTER_EGG_TABLE).select("id, path, name, raster_width, raster_height").order("created_at", { ascending: false });
  const rows = data ?? [];
  const signed = rows.length ? (await admin.storage.from(EASTER_EGG_BUCKET).createSignedUrls(rows.map((r) => String(r.path)), 3600)).data ?? [] : [];
  const urlFor = new Map(signed.filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  const pictures: EasterEggPicture[] = rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    url: urlFor.get(String(r.path)) ?? null,
    size: r.raster_width && r.raster_height ? `${r.raster_width}×${r.raster_height} dots` : null,
  }));
  return (
    <div>
      <PageHeader
        area="setup"
        back={{ href: "/admin/printers", label: "Printers" }}
        title="Easter egg pictures"
        purpose={<>Pictures for the register&apos;s ✨ → 🎲 Print a meme button. Each press prints one at random on that register&apos;s receipt printer, in black and white.</>}
      />
      <EasterEggPictures pictures={pictures} />
    </div>
  );
}
