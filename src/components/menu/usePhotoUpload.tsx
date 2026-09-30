"use client";

import { useRef, useState } from "react";
import { PhotoError, photoForm, UPLOAD_FAILED } from "@/lib/menu-pictures/photo-file";

type Failed = { ok: false; error: string };

// Take photo (straight to the camera) and Choose photo, for a menu button's
// picture: the file inputs they open, and what happens after. The photo is
// squared and shrunk in the browser (lib/menu-pictures/photo-file.ts), then
// handed to `upload`, a server action that checks who's asking.
export function usePhotoUpload<Done extends { ok: true }>(upload: (form: FormData) => Promise<Done | Failed>, onUploaded?: (r: Done) => void) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await upload(await photoForm(file));
      if (!r.ok) setError(r.error);
      else onUploaded?.(r);
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : UPLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  );
  return {
    takePhoto: () => cameraRef.current?.click(),
    choosePhoto: () => libraryRef.current?.click(),
    inputs,
    busy,
    error,
    setError,
  };
}
