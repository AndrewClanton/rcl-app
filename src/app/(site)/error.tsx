"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import ReelSheet from "@/components/ReelSheet";

// The public site's error page, inside the normal header and footer (the
// (site) layout above this boundary keeps rendering). "Try again" uses
// retry(), which re-fetches the page from the server and re-renders it --
// in Next 16.3 that's the recommended recovery; reset() only re-renders
// what's already in the browser, which can't fix a server-side failure.
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ReelSheet
      label="Something went wrong"
      title="Sorry, the projector jammed."
      jammed
      actions={
        <>
          <button type="button" className="btn-primary px-6 py-3" onClick={() => retry()}>
            Try again
          </button>
          <Link href="/showtimes" className="btn-secondary px-6 py-3">
            See showtimes
          </Link>
          <Link href="/" className="text-sm font-bold underline decoration-2 underline-offset-2 hover:text-[var(--accent)]">
            Back to home
          </Link>
        </>
      }
    >
      <p>Something went wrong on our end and this page didn&apos;t load. Give it another try in a moment.</p>
      <p className="text-[var(--muted)]">
        If it keeps happening, call us at{" "}
        <a href="tel:+14172814172" className="font-bold text-[var(--foreground)] underline decoration-2 underline-offset-2">
          417-281-4172
        </a>{" "}
        and we&apos;ll help you out.
      </p>
    </ReelSheet>
  );
}
