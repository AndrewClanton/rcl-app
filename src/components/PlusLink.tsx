// Every "Get Insiders+" button on the site. Signed-in members go straight
// to payment; everyone else gets the short join form (see
// app/(site)/membership/join/route.ts). A plain <a>, not next/link: the
// target opens a Stripe session, so it must never be prefetched.
export default function PlusLink({ next, className, children }: { next?: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={`/membership/join${next ? `?next=${encodeURIComponent(next)}` : ""}`} rel="nofollow" className={className}>
      {children}
    </a>
  );
}
