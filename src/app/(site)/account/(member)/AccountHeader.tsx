import Link from "next/link";
import { RATE_LABEL } from "@/lib/membership-rates";
import MemberAvatar from "@/components/MemberAvatar";
import type { Member } from "@/lib/types";
import { monthYear, points } from "./format";

export default function AccountHeader({ member, showBackOffice }: { member: Member; showBackOffice: boolean }) {
  const rate = member.price_tier && member.price_tier !== "adult" ? `${RATE_LABEL[member.price_tier]} rate` : null;
  const plus = member.tier === "Insiders+";
  return (
    <header className="flex flex-wrap items-center gap-5">
      <Link href="/account/profile" className="group relative" title={member.avatar_url ? "Change your photo" : "Add your photo"}>
        <MemberAvatar
          name={member.name}
          url={member.avatar_url}
          size={84}
          plus={plus}
          className={plus ? "" : "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]"}
        />
        {!member.avatar_url && (
          <span className={`absolute -right-1 ${plus ? "-top-1" : "-bottom-1"} rounded-[3px] border-2 border-[var(--foreground)] bg-[var(--accent)] px-1.5 text-[12px] font-black leading-4 text-white`}>+</span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <span className="page-eyebrow">My account</span>
        <h1 className="font-display mt-2 text-3xl leading-none text-balance break-words sm:text-5xl">{member.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`ctag ${plus ? "ctag-yellow" : "ctag-ink"}`}>{member.tier}</span>
          {rate && <span className="ctag bg-[var(--surface)]">{rate}</span>}
          <span className="spec-code !text-[var(--foreground)]">
            {points(Math.floor(Number(member.points)))} points · Member since {monthYear(member.created_at)}
          </span>
        </div>
      </div>
      {showBackOffice && (
        <Link href="/admin" className="btn-secondary px-4 py-2 text-sm">
          Back office
        </Link>
      )}
    </header>
  );
}
