"use client";

import { useSyncExternalStore } from "react";

// A photo someone takes or chooses, made ready to upload in the browser:
// squared (cut from the middle) and shrunk to a 480px JPEG, so the register
// loads it fast and a 12-megapixel phone photo never has to cross the
// network. Shared by Back office → Menu and the register's item settings.

const OUT_SIZE = 480;
const MAX_BYTES = 2_000_000;
const CANT_OPEN = "This browser can't open that photo (iPhone photos are sometimes HEIC). Try a JPEG or a screenshot of it.";
export const UPLOAD_FAILED = "The photo didn't upload. Check the connection and try again.";

export class PhotoError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    img.onload = () => resolve(img);
    img.onerror = () => reject(new PhotoError(CANT_OPEN));
    img.src = src;
  });
}

function canvasOf(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("This browser can't resize photos. Try a different browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

// An <img> draws the photo the right way up (browsers apply the camera's
// rotation tag), so it's decoded that way rather than with createImageBitmap.
export async function squarePhotoFile(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) throw new PhotoError("That file isn't a photo. Choose a photo.");
  const url = URL.createObjectURL(file);
  const made: HTMLCanvasElement[] = [];
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const side = Math.min(w, h);
    if (!side) throw new PhotoError(CANT_OPEN);
    const target = Math.min(OUT_SIZE, side);

    // A big photo is halved a step at a time on the way down: one big jump
    // leaves it jagged.
    let source: CanvasImageSource = img;
    let crop = { x: (w - side) / 2, y: (h - side) / 2, side };
    let size = side;
    do {
      size = Math.max(target, Math.round(size / 2));
      const { canvas, ctx } = canvasOf(size);
      made.push(canvas);
      // White behind a see-through PNG (a JPEG can't be see-through).
      if (size === target) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, size, size);
      }
      ctx.drawImage(source, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
      source = canvas;
      crop = { x: 0, y: 0, side: size };
    } while (size > target);

    const blob = await new Promise<Blob | null>((resolve) => (source as HTMLCanvasElement).toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.type !== "image/jpeg") throw new PhotoError("This browser couldn't make a JPEG of that photo. Try a different photo or a screenshot.");
    if (blob.size > MAX_BYTES) throw new PhotoError("That photo is still over 2 MB after shrinking. Try a different one.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
    // Frees the canvases' memory right away (older iPads run short).
    for (const c of made) c.width = c.height = 0;
  }
}

// The form a photo goes up in.
export async function photoForm(file: File): Promise<FormData> {
  const form = new FormData();
  form.set("photo", await squarePhotoFile(file), "photo.jpg");
  return form;
}

// Take photo (straight to the camera) only makes sense on a phone or tablet.
function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
export function useTouchScreen() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}
