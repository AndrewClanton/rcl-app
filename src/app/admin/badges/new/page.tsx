import Link from "next/link";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { loadCatalog } from "@/lib/badges/server";
import BadgeMaker from "./BadgeMaker";

export const dynamic = "force-dynamic";

// Back office -> Badges -> New badge: the badge maker. Pick a form, its
// colors and parts from the library (or start from a remix), name it, say
// how it's earned and what it pays. The preview is the real generator.
export default async function NewBadgePage() {
  await requireManager();
  const cat = await loadCatalog();
  const setSize = cat.setSize.get(1) ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader area="guests" title="New badge" purpose="Made from the parts library, so it looks like the rest of the set. Its art and name lock once the first copy is minted.">
        <Link href="/admin/badges" className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
          ← All badges
        </Link>
      </PageHeader>
      <BadgeMaker nextNumber={setSize + 1} issuer={cat.issuer.name} />
    </div>
  );
}
