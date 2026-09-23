"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importGooglePhoto, removeMyPhoto, uploadAvatar } from "./actions";

// Phone photos are often several MB; shrink to a 720px JPEG in the browser
// first so uploads are quick and stay under the hosting request limit. Falls
// back to the original file if the browser can't decode it.
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function PhotoUploadButton({ label, className = "btn-secondary" }: { label: string; className?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await shrink(file);
      const fd = new FormData();
      fd.set("avatar", new File([blob], blob === file ? file.name : "photo.jpg", { type: blob.type || file.type }));
      const r = await uploadAvatar(fd);
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "Uploading…" : label}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
    </span>
  );
}

export function GooglePhotoButton({ className = "btn-secondary" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await importGooglePhoto().catch(() => ({ ok: false as const, error: "Something went wrong." }));
          setBusy(false);
          if (!r.ok) setError(r.error);
          else router.refresh();
        }}
      >
        {busy ? "Getting your photo…" : "Use my Google photo"}
      </button>
      {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
    </span>
  );
}

export function RemovePhotoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-[var(--muted)] hover:underline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await removeMyPhoto().catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Removing…" : "Remove photo"}
    </button>
  );
}
