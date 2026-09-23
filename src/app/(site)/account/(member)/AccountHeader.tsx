import Link from "next/link";
import { RATE_LABEL } from "@/lib/membership-rates";
import MemberAvatar from "@/components/MemberAvatar";
import type { Member } from "@/lib/types";
import { monthYear, points } from "./format";

export default function AccountHeader({ member, showBackOffice }: { member: Member; showBackOffice: boolean }) {
  const rate = member.price_tier && member.price_tier !== "adult" ? `${RATE_LABEL[member.price_tier]} rate` : null;
  return (
    <header className="flex flex-wrap items-center gap-5">
      <Link href="/account/profile" className="group relative" title={member.avatar_url ? "Change your photo" : "Add your photo"}>
        <MemberAvatar name={member.name} url={member.avatar_url} size={76} className="ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]" />
        {!member.avatar_url && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold leading-5 text-white">+</span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1">My account</div>
        <h1 className="font-display truncate text-3xl sm:text-4xl">{member.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-bold ${
              member.tier === "Insiders+" ? "border-[var(--foreground)] bg-[var(--gold)] text-[var(--gold-foreground)]" : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            {member.tier}
          </span>
          {rate && <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5">{rate}</span>}
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5">{points(Math.floor(Number(member.points)))} points</span>
          <span className="rounded-full px-1 py-0.5 text-[var(--muted)]">Member since {monthYear(member.created_at)}</span>
        </div>
      </div>
      {showBackOffice && (
        <Link href="/admin" className="btn-secondary !px-4 !py-2 text-sm">
          Back office
        </Link>
      )}
    </header>
  );
}
