"use client";

import { useState, useTransition } from "react";
import { SUGGESTION_MAX } from "@/lib/roadmap";
import { suggestRoadmapIdea } from "./actions";

// "Suggest something", for signed-in members. Goes to the crew's inbox in
// Back office; nothing here is shown publicly until the crew writes it up.
export default function SuggestBox() {
  const [body, setBody] = useState("");
  const [creditOk, setCreditOk] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="notice notice-success !p-5" role="status">
        <p className="font-display text-xl">Got it. Thank you!</p>
        <p className="mt-1 text-[15px]">The crew reads every one. If it&apos;s a yes, it goes on the list below and you can follow it from here to live.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-3 text-sm font-bold underline">
          Suggest something else
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await suggestRoadmapIdea({ body, creditOk }).catch(() => ({ ok: false as const, error: "That didn't send. Try again." }));
          if (r.ok) {
            setBody("");
            setSent(true);
          } else setError(r.error);
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="label-xs block">Your idea</span>
        <textarea
          className="input min-h-32 w-full"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={SUGGESTION_MAX}
          required
          placeholder="A movie marathon night, a new snack, a feature on your account..."
        />
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-[15px]">
        <input type="checkbox" checked={creditOk} onChange={(e) => setCreditOk(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--accent)]" />
        <span>
          <b>Credit me if it&apos;s built.</b> <span className="text-[var(--muted)]">We&apos;ll show your first name and last initial on it, nothing else.</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm font-bold text-[var(--accent)]">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !body.trim()} className="btn-primary px-6 py-3">
        {pending ? "Sending..." : "Send it to the crew"}
      </button>
    </form>
  );
}
