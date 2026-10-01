"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
const phoneCanShare = () => typeof navigator.share === "function" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// "Copy link" for an item's own page, so it can be texted to the person
// who asked for it. On a phone that can share, "Share" opens the share sheet.
export default function CopyLink({ slug, title, className = "" }: { slug: string; title: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // False on the server and while hydrating; the phone's answer after.
  const canShare = useSyncExternalStore(noSubscribe, phoneCanShare, () => false);

  const url = () => `${window.location.origin}/whats-new/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <button type="button" onClick={copy} className="btn-secondary !px-4 !py-2 text-sm" aria-live="polite">
        {state === "copied" ? "Link copied ✓" : state === "failed" ? "Couldn't copy" : "Copy link"}
      </button>
      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ title, url: url() }).catch(() => {})}
          className="btn-secondary !px-4 !py-2 text-sm"
        >
          Share
        </button>
      )}
      {state === "failed" && <span className="text-xs text-[var(--muted)] select-all">{`/whats-new/${slug}`}</span>}
    </span>
  );
}
