"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

// The back office's error page. It sits inside the admin layout, so the
// menu across the top keeps working and they can go somewhere else. "Try
// again" uses retry(), which re-fetches the page from the server (reset()
// would only re-render what's already in the browser, which can't fix a
// failed database read). The reference is the digest Next.js logs with the
// real error on the server, so it can be found in Vercel's logs.
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold">This page didn&apos;t load</h2>
      <p className="mt-2 text-sm">
        Something went wrong on our end, usually a dropped connection to the database. Try again in a moment. Anything already saved is still saved.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !px-4 !py-1.5 text-sm" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/admin" className="text-sm text-[var(--muted)] underline hover:text-[var(--foreground)]">
          Back to the dashboard
        </Link>
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">
        If it keeps happening, tell Andrew which page it was{error.digest ? ` and this reference: ${error.digest}` : ""}.
      </p>
    </div>
  );
}
