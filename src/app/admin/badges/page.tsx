import Link from "next/link";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { catalogEntries } from "@/lib/badges/server";
import { RULE_INFO } from "@/lib/badges/rules";

export const dynamic = "force-dynamic";

// Back office -> Badges (managers and up): the catalog as a grid of cards.
// Each shows its art, name and Series line, with how many copies are out
// and its rarity. A card opens the badge: every copy by serial, who holds
// it, and Award by hand.
export default async function BadgesPage() {
  await requireManager();
  const { entries, holders } = await catalogEntries();
  const minted = entries.reduce((n, e) => n + e.copies, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        title="Badges"
        purpose="Every badge is a trading card: a numbered copy for each person who earns it, signed by Royale Cinema Lounge, with a page anyone can scan to check it's real."
      >
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link href="/admin/badges/new" className="btn-primary px-4 py-2">
            New badge
          </Link>
          <span className="text-sm text-[var(--muted)]">
            {entries.length} badges · {minted.toLocaleString("en-US")} copies minted · {holders.toLocaleString("en-US")} holders
          </span>
        </div>
      </PageHeader>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {entries.map((e) => (
          <li key={e.def.id} className={`min-w-0 ${e.def.active ? "" : "opacity-50"}`}>
            <Link href={`/admin/badges/${e.def.id}`} className="block rounded-[8px] focus-visible:outline-2">
              <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: e.front }} />
            </Link>
            <div className="mt-2 text-sm">
              <div className="font-bold">
                {e.copies.toLocaleString("en-US")} {e.copies === 1 ? "copy" : "copies"}
                {e.rarity ? ` · ${e.rarity}` : ""}
              </div>
              <div className="text-[var(--muted)]">
                {RULE_INFO[e.def.ruleType]?.label ?? e.def.ruleType} · +{e.def.points}
                {e.def.active ? "" : " · off"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
