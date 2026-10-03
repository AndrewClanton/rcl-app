import Link from "next/link";

// A back-office page that isn't there (a member who was removed, a mistyped
// link): said inside the back office's own frame, so the menu still works.
// Without it the closest not-found page would be the public website's
// (app/not-found.tsx), with its header, footer and Insiders+ pitch.
export default function AdminNotFound() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold">That page isn&apos;t here</h2>
      <p className="mt-2 text-sm">It may have been removed, or the link is out of date.</p>
      <Link href="/admin" className="mt-4 inline-block text-sm text-[var(--muted)] underline hover:text-[var(--foreground)]">
        Back to the dashboard
      </Link>
    </div>
  );
}
