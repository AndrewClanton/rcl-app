import Link from "next/link";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { loadCatalog } from "@/lib/badges/server";
import { eventChoices } from "@/lib/badges/events";
import BadgeMaker from "./BadgeMaker";

export const dynamic = "force-dynamic";

// Back office -> Badges -> New badge: the badge maker. Pick a form, its
// colors and parts from the library (or start from a remix), name it, say
// how it's earned and what it pays. The preview is the real generator.
// "For an event" (?for=event opens on it): pick a showing, a house event or
// a series; it goes to everyone who already came and anyone who comes later.
export default async function NewBadgePage({ searchParams }: PageProps<"/admin/badges/new">) {
  await requireManager();
  const [cat, events, sp] = await Promise.all([loadCatalog(), eventChoices(), searchParams]);
  const setSize = cat.setSize.get(1) ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader area="guests" title="New badge" purpose="Made from the parts library, so it looks like the rest of the set. Its art and name lock once the first copy is minted.">
        <Link href="/admin/badges" className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
          ← All badges
        </Link>
      </PageHeader>
      <BadgeMaker nextNumber={setSize + 1} issuer={cat.issuer.name} events={events} forEvent={sp.for === "event"} />
    </div>
  );
}
