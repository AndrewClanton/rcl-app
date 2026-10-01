"use client";

import { useState, useTransition } from "react";
import { NOTE_MAX } from "@/lib/roadmap";
import { sendRoadmapNote } from "./actions";

// A private note to the crew about one item ("I'd use this every Friday",
// "please make it work for groups"). Only staff ever see it.
export default function NoteBox({ itemId }: { itemId: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await sendRoadmapNote(itemId, body).catch(() => ({ ok: false as const, error: "That didn't send. Try again." }));
          if (r.ok) {
            setBody("");
            setSent((n) => n + 1);
          } else setError(r.error);
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="label-xs block">A note for the crew</span>
        <textarea
          className="input min-h-28 w-full"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={NOTE_MAX}
          required
          placeholder="How would you use it? Anything we should know?"
        />
      </label>
      <p className="text-sm text-[var(--muted)]">Private: only the Royale crew sees notes. They&apos;re never shown on the site.</p>
      {error && (
        <p role="alert" className="text-sm font-bold text-[var(--accent)]">
          {error}
        </p>
      )}
      {sent > 0 && !error && (
        <p role="status" className="text-sm font-bold text-[var(--success-text)]">
          Sent. Thanks for telling us!
        </p>
      )}
      <button type="submit" disabled={pending || !body.trim()} className="btn-primary px-5 py-2.5">
        {pending ? "Sending..." : "Send note"}
      </button>
    </form>
  );
}
