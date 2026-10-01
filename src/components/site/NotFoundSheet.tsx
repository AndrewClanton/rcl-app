import Link from "next/link";
import ReelSheet from "@/components/ReelSheet";
import UsageNotFound from "@/components/UsageNotFound";

// "This reel's missing": the body of the public site's 404, shared by the
// site-wide page (app/not-found.tsx: unknown addresses and dead showtime
// links, in the full HTML with a 404 status) and the (site) boundary
// (a notFound() met while moving around inside the site).
export default function NotFoundSheet() {
  return (
    <ReelSheet
      label="Page not found"
      title="This reel's missing."
      actions={
        <>
          <Link href="/showtimes" className="btn-primary px-6 py-3">
            See showtimes
          </Link>
          <Link href="/" className="btn-secondary px-6 py-3">
            Back to home
          </Link>
        </>
      }
    >
      <UsageNotFound />
      <p>We couldn&apos;t find the page you were looking for.</p>
      <p className="text-[var(--muted)]">
        If it was a link to a showing, that show may have already started or come off the schedule, or it may not be posted yet. Head to Showtimes to see
        what&apos;s playing.
      </p>
    </ReelSheet>
  );
}
