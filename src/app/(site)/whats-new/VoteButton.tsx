"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { toggleRoadmapVote } from "./actions";

// "I want this too": one per member, with the live count. Signed out, it's
// a way in to sign in (and back to this item afterwards). On something
// already live it's just the count.
export default function VoteButton({
  itemId,
  slug,
  votes,
  voted,
  signedIn,
  open,
  big = false,
}: {
  itemId: string;
  slug: string;
  votes: number;
  voted: boolean;
  signedIn: boolean;
  open: boolean;
  big?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic({ voted, votes }, (s, next: boolean) => ({ voted: next, votes: Math.max(0, s.votes + (next ? 1 : -1)) }));

  const size = big ? "min-h-12 px-4 text-sm" : "min-h-10 px-3 text-[13px]";
  const count = (
    <span className={`ml-2 rounded-sm px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${shown.voted ? "bg-[var(--foreground)] text-[var(--gold)]" : "bg-[var(--surface-hover)]"}`}>
      {shown.votes}
    </span>
  );

  if (!open) {
    if (!votes) return null;
    return (
      <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--muted)] uppercase">
        {votes} {votes === 1 ? "person" : "people"} wanted this
      </span>
    );
  }

  const base = `inline-flex items-center rounded-[4px] border-2 border-[var(--foreground)] font-bold transition-transform active:translate-x-[1px] active:translate-y-[1px] ${size}`;

  if (!signedIn) {
    return (
      <Link href={`/account/login?next=${encodeURIComponent(`/whats-new/${slug}`)}`} className={`${base} bg-[var(--surface)] hover:bg-[var(--gold)]`} title="Sign in to say you want this">
        <span aria-hidden className="mr-1.5">＋</span>I want this too{count}
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={shown.voted}
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            setShown(!shown.voted);
            const r = await toggleRoadmapVote(itemId).catch(() => ({ ok: false as const, error: "That didn't go through. Try again." }));
            if (!r.ok) setError(r.error);
          });
        }}
        className={`${base} ${shown.voted ? "bg-[var(--gold)] shadow-[2px_2px_0_var(--foreground)]" : "bg-[var(--surface)] hover:bg-[var(--gold)]"}`}
        title={shown.voted ? "Tap to take it back" : "Tell the crew you want this"}
      >
        <span aria-hidden className="mr-1.5">{shown.voted ? "✓" : "＋"}</span>
        {shown.voted ? "You want this" : "I want this too"}
        {count}
      </button>
      {error && (
        <span role="alert" className="text-xs font-bold text-[var(--accent)]">
          {error}
        </span>
      )}
    </span>
  );
}
