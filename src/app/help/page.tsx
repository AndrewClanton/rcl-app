import type { Metadata } from "next";
import Link from "next/link";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import { HELP_TOPICS, type HelpTopic } from "@/lib/help/topics";
import { getTraining } from "@/lib/training/catalog";
import HelpLibrary from "./HelpLibrary";

export const metadata: Metadata = { title: "Help & FAQ", robots: { index: false, follow: false } };

// Help & FAQ for staff: every help entry (src/lib/help/topics.ts), grouped
// and searchable, each with an anchor (/help#printers-add) that the little
// "i" bubbles link to. The same words the bubbles show, all in one place.
export default async function HelpPage() {
  const staff = await requireStaff();

  // Training titles for the entries that have one (the catalog is server
  // only). A slug that isn't in the catalog is left off rather than linked.
  const trainingTitles: Record<string, string> = {};
  for (const t of Object.values(HELP_TOPICS) as HelpTopic[]) {
    const training = t.trainingSlug ? getTraining(t.trainingSlug) : null;
    if (training) trainingTitles[training.slug] = training.title;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <Link href="/admin" className="text-[var(--muted)] hover:underline">
          ← Back office
        </Link>
        <div className="flex flex-wrap gap-4">
          <Link href="/pos" className="text-[var(--muted)] hover:underline">
            Register
          </Link>
          <Link href={hasManagerAccess(staff.role) ? "/admin/training" : "/training"} className="text-[var(--muted)] hover:underline">
            Training
          </Link>
        </div>
      </div>

      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">Help &amp; FAQ</h1>
        <p className="max-w-xl text-[15px] text-[var(--muted)]">
          Short, plain-English answers about the register, the back office and the printers: what each thing does and why it works that way. They&apos;re the same
          answers that pop up from the little <span className="whitespace-nowrap">circled &quot;i&quot;</span> buttons around the site. For the full walk-through, follow a
          topic&apos;s training link.
        </p>
      </header>

      <HelpLibrary trainingTitles={trainingTitles} />
    </div>
  );
}
