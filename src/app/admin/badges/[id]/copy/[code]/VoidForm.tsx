"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidBadgeCopy } from "../../../actions";

// Void a copy (fraud). A reason is required; it shows on the copy's public
// certificate page. Copies are never deleted, and a void can't be undone.
export default function VoidForm({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    start(async () => {
      const r = await voidBadgeCopy(code, reason);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => setOpen(true)}>
        Void this copy
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <label className="block font-bold" htmlFor="void-reason">
        Why is it void?
      </label>
      <input
        id="void-reason"
        className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-3 py-2"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Checked in for someone else"
      />
      <p className="text-[var(--muted)]">The card stays, marked VOID, and its certificate page shows this reason. A void can&apos;t be undone.</p>
      {error && <p className="text-[var(--danger,#c8141b)]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-4 py-2" disabled={pending || reason.trim().length < 3} onClick={submit}>
          {pending ? "Voiding…" : "Void it"}
        </button>
        <button type="button" className="btn-secondary px-4 py-2" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
