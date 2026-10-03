import type { CSSProperties } from "react";
import Link from "next/link";
import { RATE_LABEL } from "@/lib/membership-rates";
import MemberAvatar from "@/components/MemberAvatar";
import type { Member } from "@/lib/types";
import { monthYear, points } from "./format";
import { TAP } from "./ui";

// The longest stretch of a name a line can't break inside, in characters
// (a hyphen stays on the end of its line, so it counts).
function longestWord(name: string): number {
  return Math.max(4, ...name.replace(/-/g, "- ").split(/\s+/).map((w) => w.length));
}

// The top of every account tab: their photo, name, tier and points.
//
// On a phone: the photo and name side by side, the tier and figures on the
// line under them, and the staff "Back office" button across the bottom.
// From a tablet up: one row, with the button at the right. The name has the
// rest of the row to itself, so it wraps between words (balanced), never
// inside one: a name with a very long word is set smaller instead.
export default function AccountHeader({ member, showBackOffice }: { member: Member; showBackOffice: boolean }) {
  const rate = member.price_tier && member.price_tier !== "adult" ? `${RATE_LABEL[member.price_tier]} rate` : null;
  const plus = member.tier === "Insiders+";
  const balance = Math.floor(Number(member.points));
  const ring = plus ? "" : "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]";
  return (
    <header className="masthead-rule grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 pb-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6 sm:pb-6">
      <Link href="/account/profile" className="group relative sm:row-span-2" title={member.avatar_url ? "Change your photo" : "Add your photo"}>
        {/* Smaller on a phone, so the name gets the room. */}
        <MemberAvatar name={member.name} url={member.avatar_url} size={64} plus={plus} className={`sm:hidden ${ring}`} />
        <MemberAvatar name={member.name} url={member.avatar_url} size={84} plus={plus} className={`hidden sm:block ${ring}`} />
        {!member.avatar_url && (
          <span className={`absolute -right-1 ${plus ? "-top-1" : "-bottom-1"} rounded-[3px] border-2 border-[var(--foreground)] bg-[var(--accent)] px-1.5 text-[12px] font-black leading-4 text-white`}>+</span>
        )}
      </Link>

      {/* The type grows with the screen, and a name with one very long word
          ("Featherstonehaugh-Worthington") sets smaller so that word still
          fits its column: --name-chars is its longest unbreakable run, at
          about 0.64em a letter. */}
      <div className="@container min-w-0">
        <span className="page-eyebrow whitespace-nowrap">My account</span>
        <h1
          className="font-display mt-2 text-[length:min(clamp(1.75rem,1.1rem+3vw,3rem),calc(100cqi/(var(--name-chars)*0.64)))] leading-[1.05] text-balance break-words"
          style={{ "--name-chars": longestWord(member.name) } as CSSProperties}
        >
          {member.name}
        </h1>
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2.5 sm:col-span-1 sm:col-start-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`ctag ${plus ? "ctag-yellow" : "ctag-ink"}`}>{member.tier}</span>
          {rate && <span className="ctag bg-[var(--surface)]">{rate}</span>}
        </span>
        {/* Each figure stays in one piece; on a narrow phone the second
            drops to its own line rather than splitting mid-phrase. */}
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
          <span className="whitespace-nowrap">
            <strong className="text-[var(--foreground)] tabular-nums">{points(balance)}</strong> {balance === 1 ? "point" : "points"}
          </span>
          <span className="whitespace-nowrap">Member since {monthYear(member.created_at)}</span>
        </p>
      </div>

      {showBackOffice && (
        <Link
          href="/admin"
          className={`btn-secondary ${TAP} col-span-2 px-4 py-2 text-sm sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:self-center`}
        >
          Back office
        </Link>
      )}
    </header>
  );
}
