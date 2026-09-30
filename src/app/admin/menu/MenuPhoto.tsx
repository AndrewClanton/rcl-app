"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { removeMenuPhoto, uploadMenuPhoto, type PhotoTarget } from "./actions";

// The product photo for a register button (an item) or tab (a category):
// its thumbnail, and for managers Take photo / Choose photo / Remove.
//
// Photos are squared (cut from the middle) and shrunk to a 480px JPEG here
// in the browser before they go up, so the register loads them fast and a
// 12-megapixel phone photo never has to cross the network.

const OUT_SIZE = 480;
const MAX_BYTES = 2_000_000;
const CANT_OPEN = "This browser can't open that photo (iPhone photos are sometimes HEIC). Try a JPEG or a screenshot of it.";
const UPLOAD_FAILED = "The photo didn't upload. Check the connection and try again.";

class PhotoError extends Error {}

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
async function squareJpeg(file: File): Promise<Blob> {
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

// Take photo (straight to the camera) only makes sense on a phone or tablet.
function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
function useTouchScreen() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export default function MenuPhoto({
  target,
  id,
  name,
  url,
  canEdit,
  size = 56,
}: {
  target: PhotoTarget;
  id: string;
  name: string;
  url: string | null | undefined;
  canEdit: boolean;
  size?: number;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const touch = useTouchScreen();

  if (!canEdit && !url) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const blob = await squareJpeg(file);
      const form = new FormData();
      form.set("photo", blob, "photo.jpg");
      const r = await uploadMenuPhoto(target, id, form);
      if (!r.ok) setError(r.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : UPLOAD_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Take the photo off "${name}"?`)) return;
    setBusy("remove");
    setError(null);
    try {
      const r = await removeMenuPhoto(target, id);
      if (!r.ok) setError(r.error);
      router.refresh();
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const thumb = (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-hover)]"
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={`${name} photo`} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-1 text-center text-[10px] leading-tight text-[var(--muted)]">No photo</div>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white">
          {busy === "upload" ? "Uploading…" : "Removing…"}
        </div>
      )}
    </div>
  );
  if (!canEdit) return thumb;

  const button = "rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      {thumb}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <div className="flex flex-wrap gap-1">
          {touch && (
            <button type="button" className={button} disabled={!!busy} onClick={() => cameraRef.current?.click()}>
              Take photo
            </button>
          )}
          <button type="button" className={button} disabled={!!busy} onClick={() => libraryRef.current?.click()}>
            Choose photo
          </button>
          {/* Holds its space with no photo, so rows of these line up. */}
          <button
            type="button"
            className={`${button} text-[var(--danger-text)] ${url ? "" : "invisible"}`}
            disabled={!!busy || !url}
            aria-hidden={!url}
            onClick={remove}
          >
            Remove
          </button>
        </div>
        {error && <div className="max-w-xs text-xs text-[var(--danger-text)]">{error}</div>}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
