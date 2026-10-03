import "server-only";
import sharp from "sharp";
import { isAllowedImageUrl, USER_AGENT } from "./sources";

// Downloading a found picture and making our own copy of it: squared and
// shrunk to a 640px JPEG for the register (stored in "menu-photos"; sharp on
// an iPad's widest button, about 260pt at 2×), or to a 400px one for the
// ◀ ▶ preview (sent straight back, not stored). Only from the hosts in
// sources.ts, over https, following at most a few redirects that stay on
// those hosts, and never more than 12 MB. Pictures stored before the size
// went up from 480px stay as they are.

export const PICTURE_SIZE = 640;
export const PREVIEW_SIZE = 400;
const MAX_DOWNLOAD = 12_000_000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = /^image\/(jpeg|pjpeg|png|webp|gif)$/;

export class PictureError extends Error {
  status: number | null; // the picture's site's answer, when it said no
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}
// Downloaded fine, but too small to look sharp on a button.
export class TooSmall extends PictureError {}

export async function downloadImage(url: string): Promise<Buffer> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(at)) throw new PictureError("That picture is on a site we don't download from.");
    const res = await fetch(at, {
      // Openverse's thumbnails answer 406 unless */* is acceptable too; the
      // content type is checked below either way.
      headers: { "User-Agent": USER_AGENT, Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      at = new URL(next, at).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new PictureError(`The picture didn't download (${res.status}).`, res.status);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) throw new PictureError("That link isn't a picture.");
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD) throw new PictureError("That picture is too big to download.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD) {
        await reader.cancel();
        throw new PictureError("That picture is too big to download.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new PictureError("The picture didn't download.");
}

// A square JPEG on white. "cover" cuts the middle square out of a photo;
// "contain" fits all of it (a candy box stays whole, with white either side).
// With `minSide`, a picture too small to look sharp at that size is turned
// down (its short side for "cover", its long side for "contain") instead of
// being blown up.
export async function squareJpeg(input: Buffer, size: number, fit: "cover" | "contain" = "cover", minSide = 0): Promise<Buffer> {
  if (minSide) {
    let w = 0;
    let h = 0;
    try {
      const meta = await sharp(input, { limitInputPixels: 50_000_000, failOn: "error" }).metadata();
      w = meta.width ?? 0;
      h = meta.height ?? 0;
    } catch {
      throw new PictureError("That picture couldn't be opened.");
    }
    if ((fit === "cover" ? Math.min(w, h) : Math.max(w, h)) < minSide) throw new TooSmall("That picture is too small to look sharp on the button. Pick another one.");
  }
  try {
    return await sharp(input, { limitInputPixels: 50_000_000, failOn: "error", animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(size, size, { fit, position: "centre", background: "#ffffff" })
      .jpeg({ quality: size >= PICTURE_SIZE ? 86 : 80, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PictureError("That picture couldn't be opened.");
  }
}
