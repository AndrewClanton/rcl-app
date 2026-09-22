"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { uploadAvatar } from "./actions";

// Shown on the customer-facing kiosk after a phone-number lookup (see
// /display/customer) -- this is where a member sets it, from their own
// account.
export default function AvatarUpload({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("avatar", file);
      const result = await uploadAvatar(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-[var(--border)]" style={{ background: "var(--surface-hover)" }}>
        {avatarUrl ? (
          <Image src={avatarUrl} alt={name} fill sizes="56px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-lg font-bold text-[var(--muted)]">{name[0]?.toUpperCase()}</div>
        )}
      </div>
      <div>
        <button type="button" className="text-xs text-[var(--accent)] hover:underline disabled:opacity-40" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Add a photo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
        {error && <div className="text-xs text-[var(--danger-text)]">{error}</div>}
      </div>
    </div>
  );
}
