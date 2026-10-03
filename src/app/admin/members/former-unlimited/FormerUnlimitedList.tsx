import Link from "next/link";
import InfoTip from "@/components/help/InfoTip";
import { RATE_LABEL } from "@/lib/membership-rates";
import type { FormerUnlimitedReport, FormerUnlimitedRow, FormerUnlimitedStatus } from "@/lib/data/legacy-unlimited";

// The list on Back office -> Members -> Former unlimited members (page.tsx):
// counts that filter, then one row per person with where they stand.

export type FormerUnlimitedShow = FormerUnlimitedStatus | "all";

export const SHOW: { key: FormerUnlimitedShow; label: string }[] = [
  { key: "all", label: "All" },
  { key: "set_up", label: "Set up" },
  { key: "came_in", label: "Came in, not set up" },
  { key: "not_seen", label: "Not seen yet" },
];

function day(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

const VIA: Record<string, string> = { reader: "card on the reader", phone: "on their phone", online: "online" };

export default function FormerUnlimitedList({ report, show }: { report: FormerUnlimitedReport; show: FormerUnlimitedShow }) {
  const { rows, counts, tracked } = report;
  const shown = show === "all" ? rows : rows.filter((r) => r.status === show);
  const count = (k: FormerUnlimitedShow) => (k === "all" ? counts.total : counts[k]);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SHOW.map((s) => (
          <Link
            key={s.key}
            href={s.key === "all" ? "/admin/members/former-unlimited" : `/admin/members/former-unlimited?show=${s.key}`}
            className={`rounded-xl border px-3 py-2 hover:border-[var(--foreground)] ${show === s.key ? "border-[var(--foreground)] bg-[var(--surface-hover)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
            aria-current={show === s.key ? "page" : undefined}
          >
            <div className="text-2xl font-black tabular-nums leading-tight">{count(s.key)}</div>
            <div className="text-xs text-[var(--muted)]">{s.label}</div>
          </Link>
        ))}
      </div>
      <p className="flex items-center text-xs text-[var(--muted)]">
        &ldquo;Came in&rdquo;: checked in or bought something since the new system opened.
        <InfoTip topic="unlimited-no-payment" />
      </p>
      {!tracked && (
        <p className="notice notice-warn text-xs">
          Set-up dates show once the onboarding migration is applied. Until then, anyone with Insiders+ paying counts as set up.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">Nobody here.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
              <Link href={`/admin/members/${r.id}`} className="min-w-0 flex-1 basis-48 truncate font-semibold hover:underline">
                {r.name}
              </Link>
              <StatusText r={r} />
              <span className="w-full text-xs text-[var(--muted)] sm:w-auto">
                {[r.oldPlan ? `Old site: ${r.oldPlan}` : null, r.lastIn ? `Last in ${day(r.lastIn)}` : "Not in since the new system"].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatusText({ r }: { r: FormerUnlimitedRow }) {
  if (r.status === "set_up") {
    const plan = r.comped ? "complimentary" : `${RATE_LABEL[r.rate ?? "adult"]} ${r.interval === "year" ? "yearly" : "monthly"}`;
    const when = [day(r.setUpAt), r.setUpVia ? VIA[r.setUpVia] : null, r.setUpBy].filter(Boolean).join(", ");
    const ended = r.subscriptionStatus && !["active", "trialing"].includes(r.subscriptionStatus);
    return (
      <span className="text-xs font-semibold" style={{ color: ended ? "var(--warn-text)" : "var(--success-text)" }}>
        ✓ Set up{when ? ` ${when}` : ""} · {plan}
        {ended ? ` · ${r.subscriptionStatus === "past_due" ? "payment failed" : r.subscriptionStatus}` : ""}
      </span>
    );
  }
  if (r.status === "came_in") {
    return (
      <span className="text-xs font-semibold" style={{ color: "var(--warn-text)" }}>
        Came in, not set up
      </span>
    );
  }
  return <span className="text-xs text-[var(--muted)]">Not seen yet</span>;
}
