// Pictures for the receipt printer. The TM-m30 prints 1-bit raster images
// (black dot or no dot), so photos are dithered: grey levels become dot
// patterns, which is what makes a poster recognizable on thermal paper.
// The pure functions here also run in node (scripts/check-receipt.mjs).

export interface Raster {
  width: number; // dots; always a multiple of 8
  height: number;
  data: string; // base64, 1 bit per dot, most significant bit first, 1 = black
}

// Floyd–Steinberg dithering of 0-255 grey values (0 = black) into packed bits.
// `gray` is modified in place.
export function ditherToRaster(gray: Float32Array, width: number, height: number): Raster {
  const bytesPerRow = width / 8;
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const black = old < 128;
      if (black) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16;
        gray[i + width] += (err * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += err / 16;
      }
    }
  }
  return { width, height, data: toBase64(out) };
}

// RGBA pixels (canvas order) to grey, brightened a little: thermal printing
// runs dark, and an unadjusted poster turns into a black block.
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    const onWhite = lum * a + 255 * (1 - a);
    gray[i] = Math.min(255, Math.max(0, (onWhite - 128) * 1.15 + 128 + 22));
  }
  return gray;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Browser only: fetch an image (it must allow cross-origin reads, which the
// poster storage does) and turn it into a raster `width` dots wide.
export async function imageToRaster(url: string, width: number, maxHeight: number): Promise<Raster | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    let w = width - (width % 8);
    let h = Math.round((img.naturalHeight / img.naturalWidth) * w);
    if (h > maxHeight) {
      w = Math.floor(((maxHeight / h) * w) / 8) * 8;
      h = Math.round((img.naturalHeight / img.naturalWidth) * w);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return ditherToRaster(rgbaToGray(data, w, h), w, h);
  } catch {
    return null; // the ticket still prints, just without the poster
  }
}
