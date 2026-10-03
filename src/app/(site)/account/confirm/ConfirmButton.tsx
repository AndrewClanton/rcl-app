"use client";

import { useState } from "react";
import Link from "next/link";
import { confirmEmailLink } from "../actions";

export default function ConfirmButton({ tokenHash, type, next, label }: { tokenHash: string; type: string; next: string | null; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        className="btn-primary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await confirmEmailLink(tokenHash, type, next).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
          if (!r.ok) {
            setError(r.error);
            setBusy(false);
            return;
          }
          // A full page load, so every part of the site sees the new sign-in.
          window.location.assign(r.to);
        }}
      >
        {busy ? "One moment…" : label}
      </button>
      {error && (
        <div className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
          {error}{" "}
          <Link href="/account/login" className="font-bold underline">
            Sign in
          </Link>
        </div>
      )}
    </div>
  );
}
