import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getDuplicatePairs, type DuplicatePair, type DuplicateSide } from "@/lib/data/member-merge";
import { pointsText } from "@/lib/member-merge";

export const dynamic = "force-dynamic";

// Accounts that may be the same person: the same name (ignoring case and
// extra spaces, two words or more), the same email, or the same 10-digit
// phone. The usual kind comes first: an account the door tablet made in
// the last 30 days, next to an older one with the same name and no usable
// phone (an old-site import with the "-" placeholder, say), which is why
// the tablet couldn't find them. Each pair opens the merge preview; nothing
// changes until that's confirmed. Owner and admin only.

function day(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export default async function DuplicateMembersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireAdmin();
  const { show } = await searchParams;
  const result = await getDuplicatePairs();
  const pairs = result.ok ? result.pairs : [];
  const likely = pairs.filter((p) => p.likely);
  const shown = show === "likely" ? likely : pairs;

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members", label: "Members" }}
        title="Possible duplicates"
        purpose="Accounts that may be the same person. Review a pair to see both side by side and merge them; nothing changes until you confirm."
      />
      {!result.ok ? (
        <div className="notice notice-warn">{result.error}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/admin/members/duplicates" className={`chip ${show !== "likely" ? "chip-selected" : ""}`}>
              All · {pairs.length}
            </Link>
            <Link href="/admin/members/duplicates?show=likely" className={`chip ${show === "likely" ? "chip-selected" : ""}`}>
              Made at the tablet · {likely.length}
            </Link>
          </div>
          <p className="text-xs text-[var(--muted)]">
            &ldquo;Made at the tablet&rdquo;: an account made at the door in the last 30 days, with an older account of the same name that has no
            usable phone. Same phone alone can be a family sharing one number, and the same name can be two people: check before merging.
          </p>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">No possible duplicates right now.</p>
          ) : (
            <ul className="space-y-2">
              {shown.map((p) => (
                <PairRow key={`${p.older.id}-${p.newer.id}`} pair={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PairRow({ pair }: { pair: DuplicatePair }) {
  const why = [pair.sameName && "Same name", pair.sameEmail && "Same email", pair.samePhone && "Same phone"].filter(Boolean).join(" · ");
  return (
    <li
      className={`rounded-xl border bg-[var(--surface)] p-4 ${pair.likely ? "border-[var(--warn-border)]" : "border-[var(--border)]"}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pair.likely && (
          <span className="rounded-full border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 font-semibold text-[var(--warn-text)]">
            Made at the tablet · likely the same person
          </span>
        )}
        <span className="text-[var(--muted)]">{why}</span>
        {pair.refusal ? (
          <span className="ml-auto text-[var(--danger-text)]">Can&apos;t merge: {pair.refusal.replace(/, so these cannot be merged here\.$/, ".")}</span>
        ) : (
          <Link href={pair.href} className="ml-auto rounded border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:border-[var(--foreground)]">
            Review →
          </Link>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Side m={pair.older} label="Older" />
        <Side m={pair.newer} label="Newer" />
      </div>
    </li>
  );
}

function Side({ m, label }: { m: DuplicateSide; label: string }) {
  const tags = [
    m.oldSite && "old site",
    m.tabletMade && "made at the tablet",
    !m.phoneUsable && "no usable phone",
    m.hasLogin && "website login",
    m.hasBilling && "Stripe billing",
  ].filter(Boolean);
  return (
    <div className="min-w-0 text-sm">
      <span className="text-xs text-[var(--muted)]">{label}: </span>
      <Link href={`/admin/members/${m.id}`} className="font-semibold hover:underline">
        {m.name}
      </Link>
      <div className="text-xs text-[var(--muted)]">
        {m.tier} · since {day(m.createdAt)} · {pointsText(m.points)}
        {m.lastActivityAt ? ` · last seen ${day(m.lastActivityAt)}` : ""}
        {tags.length ? ` · ${tags.join(" · ")}` : ""}
      </div>
    </div>
  );
}
