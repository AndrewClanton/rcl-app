"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { findMenuPictures, keepMenuPicture, pickMenuPicture, removeMenuPhoto, uploadMenuPhoto } from "./actions";
import MenuPicture from "@/components/menu/MenuPicture";
import PicturePicker from "@/components/menu/PicturePicker";
import { usePhotoUpload } from "@/components/menu/usePhotoUpload";
import { useTouchScreen } from "@/lib/menu-pictures/photo-file";
import { creditLine, isFound, type PhotoTarget, type PictureState } from "@/lib/menu-pictures/shared";

// The picture on a register button (an item) or tab (a category): its
// thumbnail (the label tile when there's no photo), and for managers Find a
// picture (free-to-use ones, ◀ ▶), Take photo / Choose photo, and Remove.
// A picture that was found automatically and hasn't been looked at yet says
// so, with Keep one tap away (or the Photo walk does them all in a row).
//
// Photos are squared and shrunk to a 480px JPEG in the browser before they
// go up (lib/menu-pictures/photo-file.ts); found ones are downloaded by the
// server. Either way the file lives in our own bucket.
export default function MenuPhoto({
  target,
  id,
  name,
  picture,
  category,
  parent,
  canEdit,
  size = 56,
}: {
  target: PhotoTarget;
  id: string;
  name: string;
  picture: PictureState;
  category?: string | null;
  parent?: string | null;
  canEdit: boolean;
  size?: number;
}) {
  const router = useRouter();
  const touch = useTouchScreen();
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState<"remove" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photo = usePhotoUpload((form) => uploadMenuPhoto(target, id, form), () => router.refresh());

  const url = picture.image_url;
  const credit = creditLine(picture.image_source, picture.image_credit);
  const unchecked = !!url && isFound(picture.image_source) && !picture.image_approved_at;

  async function act(what: "remove" | "keep", fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(what);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error);
      router.refresh();
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const working = busy ?? (photo.busy ? "upload" : null);
  const thumb = (
    <div className="relative shrink-0 overflow-hidden rounded-md border border-[var(--border)]" style={{ width: size, height: size }} title={credit ?? undefined}>
      <MenuPicture url={url} name={name} category={category} parent={parent} sizes={`${size}px`} small className="h-full w-full" />
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white">
          {working === "upload" ? "Uploading…" : working === "keep" ? "Saving…" : "Removing…"}
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
          <button type="button" className={`${button} font-bold`} disabled={!!working} onClick={() => setFinding(true)}>
            Find picture
          </button>
          {touch && (
            <button type="button" className={button} disabled={!!working} onClick={photo.takePhoto}>
              Take photo
            </button>
          )}
          <button type="button" className={button} disabled={!!working} onClick={photo.choosePhoto}>
            Choose photo
          </button>
          {/* Holds its space with no photo, so rows of these line up. */}
          <button
            type="button"
            className={`${button} text-[var(--danger-text)] ${url ? "" : "invisible"}`}
            disabled={!!working || !url}
            aria-hidden={!url}
            onClick={() => {
              if (confirm(`Take the picture off "${name}"? It shows its label tile instead.`)) void act("remove", () => removeMenuPhoto(target, id));
            }}
          >
            Remove
          </button>
        </div>
        {unchecked && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full border border-[var(--warn-border)] px-1.5 py-0.5 text-[var(--warn-text)]">Found automatically</span>
            <button type="button" className="font-bold underline disabled:opacity-40" disabled={!!working} onClick={() => act("keep", () => keepMenuPicture(target, id))}>
              Keep it
            </button>
          </div>
        )}
        {(error || photo.error) && <div className="max-w-xs text-xs text-[var(--danger-text)]">{error || photo.error}</div>}
      </div>
      {photo.inputs}
      {finding && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={`Find a picture for ${name}`}>
          <div className="card w-full max-w-md shadow-2xl">
            <div className="eyebrow">Find a picture</div>
            <h2 className="mb-3 font-display text-2xl leading-tight">{name}</h2>
            <PicturePicker
              current={picture}
              find={(q) => findMenuPictures(target, id, q)}
              pick={(q, i, page) => pickMenuPicture(target, id, q, i, page)}
              onPicked={() => {
                setFinding(false);
                router.refresh();
              }}
              onCancel={() => setFinding(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
