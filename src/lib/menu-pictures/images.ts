import "server-only";
import sharp from "sharp";
import { isAllowedImageUrl, USER_AGENT } from "./sources";

// Downloading a found picture and making our own copy of it: squared and
// shrunk to a 480px JPEG for the register (stored in "menu-photos"), or to
// a 320px one for the ◀ ▶ preview (sent straight back, not stored). Only
// from the hosts in sources.ts, over https, following at most a few
// redirects that stay on those hosts, and never more than 12 MB.

export const PICTURE_SIZE = 480;
export const PREVIEW_SIZE = 320;
const MAX_DOWNLOAD = 12_000_000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = /^image\/(jpeg|pjpeg|png|webp|gif)$/;

export class PictureError extends Error {}

export async function downloadImage(url: string): Promise<Buffer> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(at)) throw new PictureError("That picture is on a site we don't download from.");
    const res = await fetch(at, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8" },
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
    if (!res.ok || !res.body) throw new PictureError(`The picture didn't download (${res.status}).`);
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
export async function squareJpeg(input: Buffer, size: number, fit: "cover" | "contain" = "cover"): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: 50_000_000, failOn: "error", animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(size, size, { fit, position: "centre", background: "#ffffff" })
      .jpeg({ quality: size >= PICTURE_SIZE ? 84 : 78, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PictureError("That picture couldn't be opened.");
  }
}
