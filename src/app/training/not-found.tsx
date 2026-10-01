import Link from "next/link";

// A training that isn't there (a retired one, a mistyped link), said inside
// the training pages' own frame rather than the public website's 404
// (app/not-found.tsx), which would bring its header, footer and pitches.
export default function TrainingNotFound() {
  return (
    <div className="sheet p-6">
      <h1 className="font-display text-2xl">That training isn&apos;t here</h1>
      <p className="mt-2 text-[15px] text-[var(--muted)]">It may have been retired, or the link is out of date.</p>
      <Link href="/training" className="mt-4 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
        ← Your training
      </Link>
    </div>
  );
}
