import Link from "next/link";
import ReelSheet from "@/components/ReelSheet";
import UsageNotFound from "@/components/UsageNotFound";

// The public site's 404, inside the normal header and footer. Shown for a
// notFound() anywhere under (site) -- a showtime that's passed, been
// removed, or isn't posted yet -- and for any unknown address, which
// [...missing]/page.tsx routes here.
export default function SiteNotFound() {
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
