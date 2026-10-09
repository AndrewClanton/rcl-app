import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyCopy } from "@/lib/badges/server";

// A badge copy's public certificate page (the QR on the back of every
// card): both sides of the card, and the issuer's signature checked right
// here against its public key. The holder shows as a first name and last
// initial, and nothing else about them: no contact details, no account, no
// times of day (lib/badges/server.ts toCard's public view).
export const dynamic = "force-dynamic";

const NOINDEX = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };

export async function generateMetadata({ params }: PageProps<"/b/[code]">): Promise<Metadata> {
  const { code } = await params;
  const v = await verifyCopy(code);
  if (!v) return { title: "Badge not found", robots: NOINDEX };
  return {
    title: { absolute: `${v.card.name} #${v.card.serial} · Royale Cinema Lounge` },
    description: `A ${v.card.name} badge, #${v.card.serial}, issued by ${v.issuer}.`,
    robots: NOINDEX,
  };
}

export default async function BadgeVerifyPage({ params }: PageProps<"/b/[code]">) {
  const { code } = await params;
  const v = await verifyCopy(code);
  if (!v) notFound();
  const ok = v.verified && !v.revoked;
  return (
    <article className="space-y-6">
      <div
        className={`rounded-[6px] border-2 border-[var(--foreground)] p-4 shadow-[3px_3px_0_var(--foreground)] ${ok ? "bg-[var(--gold)]" : "bg-[var(--surface)]"}`}
        role="status"
      >
        <div className="font-display text-xl leading-tight">
          {v.revoked ? "Revoked" : v.verified ? `Verified: issued by ${v.issuer}` : "Not verified"}
        </div>
        <p className="mt-1 text-[15px]">
          {v.revoked
            ? `${v.issuer} took this copy back. It no longer counts.`
            : v.verified
              ? `The issuer's signature on this copy checks out, and its art is exactly as it was minted.`
              : `This copy's signature doesn't match its issuer's key. Treat it as a copy, not the real thing.`}
        </p>
      </div>

      <header>
        <div className="spec-code">Badge certificate</div>
        <h1 className="font-display mt-1 text-3xl leading-tight sm:text-4xl">
          {v.card.name} <span className="text-[var(--muted)]">#{v.card.serial}</span>
        </h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Held by <strong className="text-[var(--foreground)]">{v.holder}</strong> · the front and back of the card are below
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: v.card.front }} />
        <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: v.card.back }} />
      </div>

      <section className="rounded-[6px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] p-5 text-[15px]">
        <h2 className="font-display text-lg">How this works</h2>
        <p className="mt-1 text-[var(--muted)]">
          Every badge at Royale Cinema Lounge is a numbered copy, minted when it&apos;s earned and signed by the issuer. Its serial, art and stats never change after
          that, so this page can always tell a real one from a copy.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/membership" className="btn-primary px-5 py-2.5">
            Start collecting
          </Link>
          <Link href="/showtimes" className="btn-secondary px-5 py-2.5">
            What&apos;s playing
          </Link>
        </div>
      </section>
    </article>
  );
}
