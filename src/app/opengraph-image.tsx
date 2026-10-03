import { ImageResponse } from "next/og";
import { DEFAULT_SHARE_IMAGE } from "@/lib/seo/page-meta";
import { BrandCard, SHARE_SIZE, loadShareAssets, publicImage } from "@/lib/seo/share-card";

// The site-wide link preview: a 1200x630 landscape card, drawn once at build
// time. (It replaces hero-couple.jpg, a 1364x2048 portrait photo that was
// declared as 1200x800 and got cropped to a sliver in previews.) Every page's
// metadata points at it through pageMeta() in lib/seo/page-meta.ts.
export const dynamic = "force-static";
export const alt = DEFAULT_SHARE_IMAGE.alt;
export const size = SHARE_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const [{ fonts, logo }, photo] = await Promise.all([loadShareAssets(), publicImage("photos/vhs-shelf-couple.jpg", "image/jpeg")]);
  return new ImageResponse(<BrandCard logo={logo} photo={photo} />, { ...SHARE_SIZE, fonts });
}
