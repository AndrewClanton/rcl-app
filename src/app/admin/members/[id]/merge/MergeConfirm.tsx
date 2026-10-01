"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { mergeMemberAccounts, type MergeResult } from "../../merge-actions";

// The last step of a merge: the plain-language result, a "they're the same
// person" tick, and the button. After it's done, a link to the account
// that stayed (the other one no longer exists).
export default function MergeConfirm({
  keepId,
  dropId,
  keepName,
  dropName,
  sentence,
}: {
  keepId: string;
  dropId: string;
  keepName: string;
  dropName: string;
  sentence: string;
}) {
  const [sure, setSure] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<MergeResult | null>(null);

  if (result?.ok) {
    return (
      <div className="notice notice-success space-y-2 !p-5 text-sm" role="status">
        <p className="text-base font-semibold">Merged.</p>
        <p>{result.sentence}</p>
        <Link href={`/admin/members/${result.keepId}`} className="inline-block font-semibold underline">
          Open {keepName}&apos;s account →
        </Link>
      </div>
    );
  }

  return (
    <section className="rounded-xl border-2 border-[var(--foreground)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Merge</h2>
      <p className="mt-1 text-base font-semibold">{sentence}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {dropName}&apos;s account is deleted once everything has moved. This can&apos;t be undone from here.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} disabled={pending} />
        I&apos;ve checked these two accounts are the same person.
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!sure || pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const r = await mergeMemberAccounts(keepId, dropId).catch((): MergeResult => ({ ok: false, error: "Couldn't reach the server. Nothing was changed; try again." }));
              setResult(r);
            });
          }}
        >
          {pending ? "Merging…" : `Merge into ${keepName}`}
        </button>
        {result && !result.ok && (
          <span className="text-sm text-[var(--danger-text)]" role="alert">
            {result.error}
          </span>
        )}
      </div>
    </section>
  );
}
