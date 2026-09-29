// Every "Get Insiders+" button on the site. Signed-in members go straight
// to payment; everyone else gets the short join form (see
// app/(site)/membership/join/route.ts). A plain <a>, not next/link: the
// target opens a Stripe session, so it must never be prefetched.
// `annual`: the yearly plan (15% off) instead of monthly.
export default function PlusLink({ next, annual, className, children }: { next?: string; annual?: boolean; className?: string; children: React.ReactNode }) {
  const q = new URLSearchParams();
  if (annual) q.set("plan", "annual");
  if (next) q.set("next", next);
  const qs = q.toString();
  return (
    <a href={`/membership/join${qs ? `?${qs}` : ""}`} rel="nofollow" className={className}>
      {children}
    </a>
  );
}
