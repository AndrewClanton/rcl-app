import Link from "next/link";
import ReelSheet from "@/components/ReelSheet";
import UsageNotFound from "@/components/UsageNotFound";

// A profile link that doesn't lead anywhere: never shared, switched off,
// changed, or turned off by staff. All of those read the same, so a link
// never says whether someone has an account.
export default function ProfileNotFound() {
  return (
    <ReelSheet
      label="Profile not found"
      title="Nobody's on this screen."
      actions={
        <>
          <Link href="/membership" className="btn-primary px-6 py-3">
            About Royale Insiders
          </Link>
          <Link href="/" className="btn-secondary px-6 py-3">
            Back to home
          </Link>
        </>
      }
    >
      <UsageNotFound />
      <p>This profile isn&apos;t shared right now.</p>
      <p className="text-[var(--muted)]">Members choose whether to share their page, and can change its link or switch it off at any time.</p>
    </ReelSheet>
  );
}
